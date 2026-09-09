/**
 * The LINGER wire format.
 *
 * These types are shared in shape (not by import — the scene and server are separate
 * TypeScript projects) with `server/src/linger/domain`. Keep them in sync.
 */

/** How a player is identified. Web3 players have an address; guests have a session-scoped id. */
export interface Identity {
  /** Wallet address when available, otherwise the Decentraland userId. Lowercased. */
  id: string
  /** Display name at the time of the record. Denormalised on purpose — names change. */
  name: string
  /** False when the player connected without a wallet. */
  hasWallet: boolean
}

export type EchoEmote = 'wave' | 'sit' | 'gaze' | 'rest'

export type InteractionType = 'heart' | 'highfive' | 'read'

/** A trace left behind by a real visitor. */
export interface Echo {
  id: string
  owner: Identity
  worldId: string
  realmId: string
  position: { x: number; y: number; z: number }
  emote: EchoEmote
  /** Optional short message. Server-trimmed and length-capped. */
  note: string
  createdAt: number
  expiresAt: number
  interactionCount: number
  /** Which interaction types this Echo has received, for the owner's return summary. */
  interactionsByType: Partial<Record<InteractionType, number>>
  /** True when this Echo was seeded by the project team rather than left by a visitor. */
  isGenesis: boolean
}

export interface EchoInteraction {
  id: string
  echoId: string
  actor: Identity
  type: InteractionType
  createdAt: number
}

/** A permanent record that two real players spent time together. */
export interface Bond {
  id: string
  /** Sequential, human-facing. Rendered as "Bond #0042". */
  number: number
  playerA: Identity
  playerB: Identity
  worldId: string
  createdAt: number
  /** Where the Bond stone stands. Assigned by the server so it is stable across sessions. */
  position: { x: number; y: number; z: number }
}

/** What the owner of an Echo sees when they come back. */
export interface ReturnActivity {
  /** Interactions received since the player was last seen. */
  hearts: number
  highfives: number
  reads: number
  /** Bonds formed while away (rare, but possible if a Bond completed after they left). */
  newBonds: Bond[]
  /** Server timestamp of the previous visit, so the panel can say "since yesterday". */
  lastSeenAt: number
  /** True when there is genuinely nothing to show; the UI stays silent in that case. */
  isEmpty: boolean
}

/** Aggregate signal describing how socially alive this World currently is. */
export interface WorldVitality {
  activeEchoes: number
  livePlayers: number
  interactionsLast24h: number
  totalBonds: number
  /** Normalised 0..1. Drives Hearth brightness and ambient warmth. */
  intensity: number
}

/** Another player currently in the World. */
export interface LivePresence {
  sessionId: string
  identity: Identity
  position: { x: number; y: number; z: number }
  /** Timestamp of their most recent wave, or 0. */
  wavedAt: number
}
