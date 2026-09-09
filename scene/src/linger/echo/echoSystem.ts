import { Vector3 } from '@dcl/sdk/math'
import * as utils from '@dcl-sdk/utils'
import { ECHO, HEARTH_POSITION } from '../config'
import { Echo } from '../types/linger'
import { hideEcho, showEcho, updateEcho, visibleEchoIds } from './echoPool'

/**
 * Owns the local Echo store and decides which Echoes occupy the render pool.
 *
 * Selection policy: newest first, capped at the pool size. Newest-first matters more than
 * nearest-first here, because the product promise is "someone was here recently" — a
 * fresh Echo is the one worth a slot.
 */

const store = new Map<string, Echo>()
let sweepTimer: unknown

function isExpired(echo: Echo, now: number): boolean {
  return echo.expiresAt > 0 && echo.expiresAt <= now
}

/** Rebuild the visible set from the store. Cheap: at most `maxVisible` binds. */
function reconcile() {
  const now = Date.now()

  const live = Array.from(store.values())
    .filter((e) => !isExpired(e, now))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, ECHO.maxVisible)

  const shouldShow = new Set(live.map((e) => e.id))

  // Release slots that no longer qualify, so the binds below always find room.
  for (const id of visibleEchoIds()) {
    if (!shouldShow.has(id)) hideEcho(id)
  }

  for (const echo of live) showEcho(echo)
}

/** Replace the whole store — used on the initial fetch and on reconnect. */
export function setEchoes(echoes: Echo[]) {
  store.clear()
  for (const echo of echoes) store.set(echo.id, echo)
  reconcile()
}

/** Add or replace one Echo (a new visitor's Echo arriving live). */
export function upsertEcho(echo: Echo) {
  const isNew = !store.has(echo.id)
  store.set(echo.id, echo)
  if (isNew) reconcile()
  else updateEcho(echo)
}

export function removeEcho(echoId: string) {
  store.delete(echoId)
  hideEcho(echoId)
  closeCardFor(echoId)
  reconcile()
}

/**
 * Called when an Echo disappears while its card may be open.
 *
 * Injected rather than imported so the Echo store stays independent of the UI — importing
 * ui/state here would make this module untestable in isolation.
 */
let closeCardFor: (echoId: string) => void = () => {}
export function onEchoRemoved(handler: (echoId: string) => void) {
  closeCardFor = handler
}

export function getEcho(echoId: string): Echo | undefined {
  return store.get(echoId)
}

export function echoCount(): number {
  return store.size
}

/**
 * Apply an interaction locally so the player sees their tap land immediately,
 * without waiting for the server round trip. The server's echo update overwrites this.
 */
export function applyLocalInteraction(echoId: string, type: 'heart' | 'highfive' | 'read') {
  const echo = store.get(echoId)
  if (!echo) return
  echo.interactionCount += 1
  echo.interactionsByType[type] = (echo.interactionsByType[type] ?? 0) + 1
  updateEcho(echo)
}

/** Drop expired Echoes. Runs on a slow timer — expiry is a 24 h concern, not a frame one. */
function sweep() {
  const now = Date.now()
  let removed = false
  for (const [id, echo] of store) {
    if (isExpired(echo, now)) {
      store.delete(id)
      hideEcho(id)
      closeCardFor(id)
      removed = true
    }
  }
  if (removed) reconcile()
}

export function startEchoSystem() {
  sweepTimer = utils.timers.setInterval(sweep, ECHO.sweepIntervalMs)
}

export function stopEchoSystem() {
  if (sweepTimer !== undefined) utils.timers.clearInterval(sweepTimer as number)
  sweepTimer = undefined
}

/**
 * Deterministic position on the Echo ring.
 *
 * Derived from the Echo id so a given Echo always stands in the same place, across
 * sessions and across clients. The server uses the same function shape when it assigns
 * a position at creation time; this copy exists so the scene can place locally-created
 * Echoes before the server confirms them.
 */
export function ringSlotPosition(seed: string): Vector3 {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const angle = (hash % 3600) / 3600 * Math.PI * 2
  const jitter = ((hash >>> 12) % 1000) / 1000
  const radius = ECHO.ringRadius - ECHO.ringJitter / 2 + jitter * ECHO.ringJitter

  return Vector3.create(
    HEARTH_POSITION.x + Math.cos(angle) * radius,
    HEARTH_POSITION.y,
    HEARTH_POSITION.z + Math.sin(angle) * radius
  )
}
