import { executeTask } from '@dcl/sdk/ecs'
import { getUserData } from '~system/UserIdentity'
import { getCurrentRealm } from '~system/EnvironmentApi'
import { movePlayerTo } from '~system/RestrictedActions'
import { Vector3 } from '@dcl/sdk/math'
import * as utils from '@dcl-sdk/utils'

import { ENTRY_POSITION, HEARTH_POSITION } from './config'
import { Identity } from './types/linger'
import { buildSanctuary } from './world/environment'
import { buildHearth, setHearthIntensity } from './hearth/hearthRenderer'
import { resumeHearthSystem, startHearthSystem } from './hearth/hearthSystem'
import { buildEchoPool } from './echo/echoPool'
import {
  echoCount,
  getEcho,
  onEchoRemoved,
  removeEcho,
  setEchoes,
  startEchoSystem,
  upsertEcho
} from './echo/echoSystem'
import { handleEchoTap, initEchoInteraction, setInteractionSender } from './echo/echoInteraction'
import { localGenesisEchoes } from './echo/genesis'
import { addBondStone, setBondStones } from './bond/bondRenderer'
import { clearWave, setLivePresence, startPresenceSystem, wave } from './presence/presenceSystem'
import { onPreserve, onWave } from './ui/panels'
import { initUi, toast } from './ui/root'
import {
  connect,
  getSessionId,
  initNetwork,
  isAuthenticated,
  sendActivityRead,
  sendCreateEcho,
  sendInteraction,
  sendPreserveBond,
  setDisplayName,
  setRealm
} from './network/lingerClient'
import {
  clearPrompt,
  closeOverlay,
  openBondCard,
  openReturnPanel,
  setLinger,
  setPreservation,
  setPrompt,
  ui
} from './ui/state'

/**
 * LINGER bootstrap.
 *
 * Order matters: the World is built synchronously and is fully explorable before anything
 * is awaited. A slow identity call, a slow server, or no server at all never leaves the
 * player looking at empty ground.
 */

let identity: Identity = { id: '', name: '', hasWallet: false }
let realmId = 'unknown'
/** Id of the Echo the server confirmed for this visit, or null. */
let myEchoId: string | null = null
/** Queued so the return panel is not the first thing a player sees while still loading. */
let pendingReturnPanel: (() => void) | null = null

export function getIdentity(): Identity {
  return identity
}

export function bootstrapLinger() {
  // ---- Synchronous: the World exists immediately. -------------------------------
  buildSanctuary()
  buildHearth()
  buildEchoPool(handleEchoTap)
  initEchoInteraction()
  initUi()
  startEchoSystem()

  // Until the server answers, show the authored Genesis set so the World is never blank.
  // These are replaced wholesale by the server's own Echoes on `welcome`.
  setEchoes(localGenesisEchoes(realmId))
  ui.activeEchoes = echoCount()
  ui.livePlayers = 1

  onWave(wave)
  onPreserve((bondId) => sendPreserveBond(bondId))

  // If an Echo vanishes while its card is open — expiry, or a server rejection — close
  // the card rather than leaving the player looking at a record that no longer exists.
  onEchoRemoved((echoId) => {
    if (ui.echoCard && ui.echoCard.echoId === echoId) closeOverlay()
  })

  startHearthSystem({
    onEnter: () => setPrompt(myEchoId ? 'Your Echo is here' : 'Sit & Linger'),
    onLeave: () => clearPrompt(),
    onProgress: (p) => {
      setLinger(p)
      setPrompt(p < 1 ? 'Sit & Linger' : 'Staying...')
    },
    onComplete: () => commitEcho()
  })

  wireNetwork()

  // ---- Asynchronous: identity, realm, connection. --------------------------------
  executeTask(async () => {
    try {
      const data = await getUserData({})
      const user = data.data
      identity = {
        id: (user?.publicKey ?? user?.userId ?? '').toLowerCase(),
        name: user?.displayName ?? 'Someone',
        hasWallet: !!user?.publicKey
      }

      const realm = await getCurrentRealm({})
      realmId = realm.currentRealm?.displayName ?? realm.currentRealm?.domain ?? 'unknown'
    } catch (error) {
      // Identity is a nicety, not a requirement — the World still works without it.
      console.log('[linger] identity unavailable', error)
    }

    movePlayerTo({
      newRelativePosition: Vector3.create(ENTRY_POSITION.x, 1, ENTRY_POSITION.z),
      cameraTarget: Vector3.create(HEARTH_POSITION.x, 1.4, HEARTH_POSITION.z)
    })

    setDisplayName(identity.name)
    setRealm(realmId)
    ui.diag.realmId = realmId

    await connect()
    startPresenceSystem()
  })
}

// === Network wiring ===========================================================

function wireNetwork() {
  setInteractionSender((echoId, type) => {
    sendInteraction(echoId, type)
  })

  initNetwork({
    onConnectionChange: (connected) => {
      ui.connected = connected
      ui.diag.authenticated = isAuthenticated()
    },

    onWelcome: ({
      echoes,
      bonds,
      activity,
      worldId,
      realmId: serverRealm,
      identity: authIdentity,
      preservationEnabled
    }) => {
      // When the chain layer is off, no blockchain UI is rendered anywhere.
      ui.preservationEnabled = preservationEnabled
      // Everything the diagnostic shows comes from the server, so two devices comparing
      // panels are comparing what the server actually believes.
      ui.diag.worldId = worldId
      if (serverRealm) ui.diag.realmId = serverRealm
      ui.diag.sessionId = getSessionId()
      ui.diag.authenticated = isAuthenticated()
      if (authIdentity && authIdentity.name) identity = authIdentity

      // The server is authoritative from here: its Echo set replaces the local Genesis
      // placeholders, including the server's own Genesis Echoes.
      setEchoes(echoes)
      ui.activeEchoes = echoCount()
      setBondStones(bonds)

      // Reconnect and restart recovery.
      //
      // `welcome` arrives on every join, including a reconnect after the server was
      // restarted. If the Echo we left this visit is not in the authoritative set, it no
      // longer exists — an in-memory server lost it, or it expired — so re-arm the Hearth
      // and let the player leave another. Without this the player would be permanently
      // locked out of lingering for the rest of the session, holding an Echo that is not
      // there.
      if (myEchoId && !getEcho(myEchoId)) {
        myEchoId = null
        toast('The Hearth was rekindled. You can linger again.', 4000)
      }

      if (!activity.isEmpty) {
        // Hold the panel until the player has arrived and looked around. Opening it during
        // the loading fade would waste the strongest moment in the product.
        pendingReturnPanel = () => {
          openReturnPanel(activity)
          sendActivityRead()
        }
        utils.timers.setTimeout(() => {
          if (pendingReturnPanel) {
            pendingReturnPanel()
            pendingReturnPanel = null
          }
        }, 4000)
      }
    },

    onEchoCreated: (echo) => {
      myEchoId = echo.id
      upsertEcho(echo)
      ui.activeEchoes = echoCount()
      clearPrompt()
      toast('You left an Echo here.', 3800)
      utils.timers.setTimeout(() => {
        resumeHearthSystem()
        setPrompt('Your Echo will stay when you go')
        utils.timers.setTimeout(() => clearPrompt(), 4000)
      }, 1200)
    },

    onEchoRejected: (_error, message) => {
      // The most common rejection is the cooldown, and the message says so plainly.
      toast(message, 3400)
      clearPrompt()
      resumeHearthSystem()
    },

    onEchoAdded: (echo) => {
      upsertEcho(echo)
      ui.activeEchoes = echoCount()
      toast(`${echo.owner.name} left an Echo.`, 3000)
    },

    onEchoUpdated: (echo) => {
      // Authoritative state: overwrites the optimistic local increment.
      upsertEcho(echo)
    },

    onInteractionRejected: (echoId, error, message) => {
      // The optimistic update was wrong. Drop the stale Echo and let the server's next
      // update stand.
      if (error === 'EXPIRED' || error === 'NOT_FOUND') removeEcho(echoId)
      toast(message, 3000)
      closeOverlay()
    },

    onPresence: (players, intensity) => {
      setLivePresence(players)
      setHearthIntensity(intensity)
      ui.diag.livePlayers = players.length + 1
    },

    onBondCreated: (bond) => {
      addBondStone(bond)
      clearWave()
      openBondCard(bond, identity.id)
    },

    onPreservationUpdated: (bondId, status, consented) => {
      setPreservation(bondId, status as any, consented, identity.id)
      if (status === 'PRESERVED') toast('This memory is permanent now.', 4000)
    },

    onPreservationRejected: (_bondId, _error, message) => {
      // The Bond is untouched by any of this — say so rather than showing a bare error.
      toast(message, 3600)
    },

    onBondAdded: (bond) => {
      addBondStone(bond)
    }
  })
}

// === Echo commit ==============================================================

/**
 * The player completed a full linger.
 *
 * The Echo is NOT created locally. The server owns the id, the owner, the position, the
 * timestamps and the expiry — so what appears in the World is the record that actually
 * persisted, never an optimistic guess that might not be there tomorrow.
 */
function commitEcho() {
  if (myEchoId) {
    resumeHearthSystem()
    return
  }

  if (!ui.connected) {
    toast('Cannot reach the Hearth right now — your Echo was not saved.', 4000)
    clearPrompt()
    resumeHearthSystem()
    return
  }

  setPrompt('Leaving your Echo...')
  sendCreateEcho('', 'rest')

  // If the server never answers, re-arm rather than leaving the player stuck on a prompt.
  utils.timers.setTimeout(() => {
    if (!myEchoId) {
      clearPrompt()
      resumeHearthSystem()
    }
  }, 8000)
}
