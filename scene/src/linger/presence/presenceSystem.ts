import { engine, Transform } from '@dcl/sdk/ecs'
import * as utils from '@dcl-sdk/utils'
import { BOND, PRESENCE } from '../config'
import { LivePresence } from '../types/linger'
import { isPlayerAtHearth } from '../hearth/hearthSystem'
import { sendPresence, sendWave } from '../network/lingerClient'
import { ui } from '../ui/state'

/**
 * Reports where the local player is, and tracks who else is nearby.
 *
 * NETWORK COST: one message per second at most, and only when the player has actually
 * moved `PRESENCE.minMoveDistance` or crossed the Hearth boundary. A player standing
 * still sends nothing at all. This is the single most important rule in the scene for
 * keeping the World cheap with several people in it.
 *
 * Native Decentraland comms renders other players' avatars. This system exists for the
 * social layer — knowing who is close enough to Bond with — not for drawing anyone.
 */

let others: LivePresence[] = []
let lastSent = { x: Number.NaN, z: Number.NaN, atHearth: false }
let tickTimer: unknown
/** Session id of the closest player inside Bond radius, or null. */
let nearestSessionId: string | null = null
let localWavedAt = 0

const bondRadiusSquared = BOND.radius * BOND.radius
const moveThresholdSquared = PRESENCE.minMoveDistance * PRESENCE.minMoveDistance

function localPosition(): { x: number; z: number } | null {
  if (!Transform.has(engine.PlayerEntity)) return null
  const p = Transform.get(engine.PlayerEntity).position
  return { x: p.x, z: p.z }
}

function tick() {
  const position = localPosition()
  if (!position) return

  const atHearth = isPlayerAtHearth()

  const dx = position.x - lastSent.x
  const dz = position.z - lastSent.z
  const moved = Number.isNaN(lastSent.x) || dx * dx + dz * dz >= moveThresholdSquared
  const hearthChanged = atHearth !== lastSent.atHearth

  if (moved || hearthChanged) {
    if (sendPresence(position.x, position.z, atHearth)) {
      lastSent = { x: position.x, z: position.z, atHearth }
    }
  }

  updateNearest(position)
}

/** Find the closest live player inside Bond radius and drive the wave affordance. */
function updateNearest(position: { x: number; z: number }) {
  let closest: LivePresence | null = null
  let closestDistance = Number.MAX_VALUE

  for (const other of others) {
    const dx = other.position.x - position.x
    const dz = other.position.z - position.z
    const distance = dx * dx + dz * dz
    if (distance <= bondRadiusSquared && distance < closestDistance) {
      closestDistance = distance
      closest = other
    }
  }

  nearestSessionId = closest ? closest.sessionId : null

  const now = Date.now()
  const iWavedRecently = localWavedAt > 0 && now - localWavedAt <= BOND.waveWindowMs
  const theyWavedRecently =
    !!closest && closest.wavedAt > 0 && now - closest.wavedAt <= BOND.waveWindowMs

  ui.nearbyName = closest ? closest.identity.name : ''
  ui.canWave = !!closest && !iWavedRecently
  ui.theyWaved = theyWavedRecently
  ui.bothWaved = iWavedRecently && theyWavedRecently
}

/** Called from the wave button. Explicit, deliberate — never automatic. */
export function wave() {
  if (!ui.canWave) return
  if (!sendWave()) return
  localWavedAt = Date.now()
  ui.canWave = false
}

/** Live roster from the server. Replaces the previous snapshot wholesale. */
export function setLivePresence(players: LivePresence[]) {
  others = players
  ui.livePlayers = players.length + 1
  const position = localPosition()
  if (position) updateNearest(position)
}

export function startPresenceSystem() {
  tickTimer = utils.timers.setInterval(tick, PRESENCE.reportIntervalMs)
}

export function stopPresenceSystem() {
  if (tickTimer !== undefined) utils.timers.clearInterval(tickTimer as number)
  tickTimer = undefined
}

/** Reset local wave state — called after a Bond forms, so the pair starts clean. */
export function clearWave() {
  localWavedAt = 0
  ui.canWave = !!nearestSessionId
  ui.theyWaved = false
  ui.bothWaved = false
}
