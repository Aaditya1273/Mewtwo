import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import * as utils from '@dcl-sdk/utils'
import { HEARTH, HEARTH_POSITION } from '../config'
import { setLingerProgress } from './hearthRenderer'

/**
 * Detects that the local player is at the Hearth and runs the linger timer.
 *
 * Deliberately NOT an ECS system: proximity to a single fixed point does not need to be
 * evaluated 60 times a second. A 250 ms interval is imperceptible to the player and costs
 * roughly 0.4% of the per-frame equivalent.
 *
 * Emits nothing to the network itself. It reports state changes through callbacks and the
 * caller decides what to persist — which is what keeps this free of per-frame writes.
 */

export interface HearthCallbacks {
  /** Player entered the radius. Show the "Sit & Linger" prompt. */
  onEnter: () => void
  /** Player left the radius before completing. Progress is discarded. */
  onLeave: () => void
  /** Fires at ~4 Hz while lingering. `progress` is 0..1. */
  onProgress: (progress: number) => void
  /** The full linger duration elapsed inside the radius. Commit an Echo. */
  onComplete: () => void
}

let inside = false
let elapsedMs = 0
let tickTimer: unknown
let callbacks: HearthCallbacks
/** Set while an Echo is being committed, so a lingering player cannot commit twice. */
let suspended = false

const radiusSquared = HEARTH.interactionRadius * HEARTH.interactionRadius

function distanceToHearthSquared(): number {
  if (!Transform.has(engine.PlayerEntity)) return Number.MAX_VALUE
  const p = Transform.get(engine.PlayerEntity).position
  // Horizontal distance only — standing on the plinth should not change the result.
  const dx = p.x - HEARTH_POSITION.x
  const dz = p.z - HEARTH_POSITION.z
  return dx * dx + dz * dz
}

function tick() {
  if (suspended) return

  const near = distanceToHearthSquared() <= radiusSquared

  if (near && !inside) {
    inside = true
    elapsedMs = 0
    callbacks.onEnter()
  } else if (!near && inside) {
    inside = false
    elapsedMs = 0
    setLingerProgress(0)
    callbacks.onLeave()
    return
  }

  if (!inside) return

  elapsedMs += HEARTH.checkIntervalMs
  const progress = Math.min(1, elapsedMs / HEARTH.lingerDurationMs)
  setLingerProgress(progress)
  callbacks.onProgress(progress)

  if (progress >= 1) {
    // Suspend before the callback: committing is async, and without this the next tick
    // would fire onComplete again while the first commit is still in flight.
    suspended = true
    elapsedMs = 0
    callbacks.onComplete()
  }
}

export function startHearthSystem(cb: HearthCallbacks) {
  callbacks = cb
  tickTimer = utils.timers.setInterval(tick, HEARTH.checkIntervalMs)
}

/**
 * Re-arm after a completed linger. The player must leave the radius and come back
 * before another Echo can be created — one Echo per visit, enforced client-side for
 * feel and server-side for real.
 */
export function resumeHearthSystem() {
  suspended = false
  inside = false
  elapsedMs = 0
  setLingerProgress(0)
}

export function stopHearthSystem() {
  if (tickTimer !== undefined) utils.timers.clearInterval(tickTimer as number)
  tickTimer = undefined
}

/** Exposed for the presence system, which reports "at hearth" as part of live state. */
export function isPlayerAtHearth(): boolean {
  return inside
}

/** Current player position, used when placing a newly created Echo. */
export function playerPosition(): Vector3 {
  if (!Transform.has(engine.PlayerEntity)) return HEARTH_POSITION
  const p = Transform.get(engine.PlayerEntity).position
  return Vector3.create(p.x, p.y, p.z)
}
