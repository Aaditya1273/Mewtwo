/**
 * LINGER domain types.
 *
 * Mirrors `scene/src/linger/types/linger.ts` in shape. The two projects are separate
 * TypeScript builds and deliberately do not share a package — the wire format is small
 * and stable enough that a shared build step would cost more than it saves.
 */

export interface Identity {
  /** Wallet address when available, otherwise the Decentraland userId. Always lowercased. */
  id: string
  name: string
  hasWallet: boolean
}

export type EchoEmote = 'wave' | 'sit' | 'gaze' | 'rest'
export type InteractionType = 'heart' | 'highfive' | 'read'

export const INTERACTION_TYPES: InteractionType[] = ['heart', 'highfive', 'read']

export interface Echo {
  id: string
  owner: Identity
  worldId: string
  realmId: string
  position: { x: number; y: number; z: number }
  emote: EchoEmote
  note: string
  createdAt: number
  /** 0 means "never expires" — used only by Genesis Echoes. */
  expiresAt: number
  interactionCount: number
  interactionsByType: Partial<Record<InteractionType, number>>
  isGenesis: boolean
}

export interface EchoInteraction {
  id: string
  echoId: string
  /** Denormalised so the owner's return summary does not need to join back to the Echo. */
  echoOwnerId: string
  actor: Identity
  type: InteractionType
  worldId: string
  createdAt: number
}

export interface Bond {
  id: string
  number: number
  playerA: Identity
  playerB: Identity
  worldId: string
  createdAt: number
  position: { x: number; y: number; z: number }
}

export interface PlayerActivity {
  identityId: string
  worldId: string
  /** When the player was last seen in this World. */
  lastSeenAt: number
  /**
   * Watermark for the return summary. Interactions after this timestamp are "new".
   * Advanced only once the player has actually been shown the summary.
   */
  activityReadAt: number
}

export interface ReturnActivity {
  hearts: number
  highfives: number
  reads: number
  newBonds: Bond[]
  lastSeenAt: number
  isEmpty: boolean
}

export interface WorldVitality {
  activeEchoes: number
  livePlayers: number
  interactionsLast24h: number
  totalBonds: number
  intensity: number
}

/** Records are scoped by World. Realm is recorded for provenance, never used to partition. */
export interface WorldScope {
  worldId: string
  realmId: string
}

/**
 * Result type used across the domain.
 *
 * Product rules fail for expected reasons — rate limits, duplicates, expired Echoes —
 * and those are not exceptional. Returning them keeps the Colyseus room and the REST
 * routes handling failure identically.
 */
export interface LingerFailure {
  ok: false
  error: LingerError
  message: string
}

export type Result<T> = { ok: true; value: T } | LingerFailure

export type LingerError =
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'FORBIDDEN'
  | 'INVALID'
  | 'DUPLICATE'
  | 'SELF_INTERACTION'

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<T>(error: LingerError, message: string): Result<T> {
  return { ok: false, error, message }
}

/**
 * Narrow a Result to its failure branch.
 *
 * TypeScript 4.6 does not reliably narrow a union parameterised by a type variable, so
 * callers use this guard rather than testing `result.ok` inline.
 */
export function isFailure(result: Result<unknown>): result is LingerFailure {
  return result.ok === false
}
