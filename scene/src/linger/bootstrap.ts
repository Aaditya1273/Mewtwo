import { executeTask } from '@dcl/sdk/ecs'
import { getUserData } from '~system/UserIdentity'
import { getCurrentRealm } from '~system/EnvironmentApi'
import { movePlayerTo } from '~system/RestrictedActions'
import { Vector3 } from '@dcl/sdk/math'
import * as utils from '@dcl-sdk/utils'

import { ENTRY_POSITION, HEARTH_POSITION, WORLD_ID } from './config'
import { Echo, Identity } from './types/linger'
import { buildSanctuary } from './world/environment'
import { buildHearth } from './hearth/hearthRenderer'
import { resumeHearthSystem, startHearthSystem } from './hearth/hearthSystem'
import { buildEchoPool } from './echo/echoPool'
import { echoCount, ringSlotPosition, setEchoes, startEchoSystem, upsertEcho } from './echo/echoSystem'
import { handleEchoTap, initEchoInteraction } from './echo/echoInteraction'
import { localGenesisEchoes } from './echo/genesis'
import { initUi, toast } from './ui/root'
import { clearPrompt, setLinger, setPrompt, ui } from './ui/state'

/**
 * LINGER bootstrap.
 *
 * Order matters: the World must be visible before anything asynchronous is awaited, so a
 * slow identity call or a slow server never leaves the player staring at empty ground.
 */

let identity: Identity = { id: '', name: '', hasWallet: false }
let realmId = 'unknown'
/** Set once the player has left an Echo this visit. */
let myEchoId: string | null = null

export function getIdentity(): Identity {
  return identity
}

export function getRealmId(): string {
  return realmId
}

export function getMyEchoId(): string | null {
  return myEchoId
}

export function bootstrapLinger() {
  // ---- Synchronous: the World exists immediately. -------------------------------
  buildSanctuary()
  buildHearth()
  buildEchoPool(handleEchoTap)
  initEchoInteraction()
  initUi()
  startEchoSystem()

  startHearthSystem({
    onEnter: () => setPrompt('Sit & Linger'),
    onLeave: () => clearPrompt(),
    onProgress: (p) => {
      setLinger(p)
      setPrompt(p < 1 ? 'Sit & Linger' : 'Staying...')
    },
    onComplete: () => commitEcho()
  })

  // ---- Asynchronous: identity, realm, and eventually the server. -----------------
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

    // Until the network layer lands, the World is seeded with the local Genesis set so
    // a first visitor always has something real to interact with.
    setEchoes(localGenesisEchoes(realmId))
    ui.activeEchoes = echoCount()
    ui.livePlayers = 1

    // Place the player at the entry portal, facing the Hearth.
    movePlayerTo({
      newRelativePosition: Vector3.create(ENTRY_POSITION.x, 1, ENTRY_POSITION.z),
      cameraTarget: Vector3.create(HEARTH_POSITION.x, 1.4, HEARTH_POSITION.z)
    })
  })
}

/**
 * The player completed a full linger. Create their Echo.
 *
 * Local-only for now: the Echo is created client-side and shown immediately. When the
 * network layer lands this becomes an optimistic local insert plus a server commit, and
 * the server's id replaces the temporary one.
 */
function commitEcho() {
  if (myEchoId !== null) {
    // Already left an Echo this visit. Re-arm and say nothing.
    resumeHearthSystem()
    return
  }

  const now = Date.now()
  const id = `local-${identity.id || 'guest'}-${now}`

  const echo: Echo = {
    id,
    owner: identity.id ? identity : { id: 'guest', name: 'Someone', hasWallet: false },
    worldId: WORLD_ID,
    realmId,
    // Stand the Echo on the ring rather than exactly where the player stood, so Echoes
    // never pile up on the Hearth and always read as a gathering around the fire.
    position: ringSlotPosition(id),
    emote: 'rest',
    note: '',
    createdAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
    interactionCount: 0,
    interactionsByType: {},
    isGenesis: false
  }

  myEchoId = id
  upsertEcho(echo)
  ui.activeEchoes = echoCount()

  clearPrompt()
  toast('You left an Echo here.', 3800)

  // Let the message land before the Hearth is ready to accept another linger.
  utils.timers.setTimeout(() => {
    resumeHearthSystem()
    setPrompt('Your Echo will stay when you go')
    utils.timers.setTimeout(() => clearPrompt(), 4000)
  }, 1200)
}
