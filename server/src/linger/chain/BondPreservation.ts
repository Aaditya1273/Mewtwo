import { Bond, Identity } from '../domain/types'

/**
 * The blockchain seam.
 *
 * Bond logic depends on this interface and never on a chain library. Everything about
 * Polygon, meta-transactions, relayers and contracts lives behind it, so the core product
 * cannot break when the chain does — and does not even know the chain exists.
 *
 * Ordering is fixed and must never be inverted: the gameplay Bond is created first and is
 * the source of truth. Preservation is a later annotation on an already-real Bond. A
 * pending transaction NEVER determines whether a Bond exists.
 */

export type PreservationStatus = 'NOT_PRESERVED' | 'PRESERVING' | 'PRESERVED' | 'FAILED'

export interface PreservationState {
  status: PreservationStatus
  /** Identity ids that have consented. Both participants are required. */
  consented: string[]
  /** Set only once a confirmation has actually been observed. */
  proof?: BondProof
  /** Why the last attempt failed. Shown to nobody but the logs and a retry decision. */
  error?: string
  /** Attempts so far, so a retry can be refused after enough failures. */
  attempts: number
  updatedAt: number
}

/** What comes back from the chain once a preservation is confirmed. */
export interface BondProof {
  /** Opaque reference: keccak256(worldId, bondNumber). Not a lookup key into anything. */
  bondRef: string
  transactionHash: string
  blockNumber: number
  network: string
  /** On-chain record version, so a later format change stays readable. */
  protocolVersion: number
  confirmedAt: number
}

export interface PreserveRequest {
  bond: Bond
  /** The two verified participants. Never taken from a client payload. */
  participants: [Identity, Identity]
}

export interface PreserveFailure {
  ok: false
  retryable: boolean
  error: string
}

export type PreserveOutcome = { ok: true; proof: BondProof } | PreserveFailure

/**
 * Narrow an outcome to its failure branch.
 *
 * TypeScript 4.6 does not reliably narrow these unions inline — the same reason
 * `isFailure` exists for `Result` in `domain/types`. Callers use this guard.
 */
export function isPreserveFailure(outcome: PreserveOutcome): outcome is PreserveFailure {
  return outcome.ok === false
}

/**
 * A preservation backend.
 *
 * Implementations must never throw: a chain failure is an ordinary outcome and the caller
 * has a Bond to protect.
 */
export interface BondPreservation {
  /** False when the feature is off. The UI does not offer preservation at all. */
  readonly enabled: boolean
  /** Human-readable target, for the diagnostic. */
  readonly network: string
  /** Attempt to preserve. Resolves with an outcome; never rejects. */
  preserve(request: PreserveRequest): Promise<PreserveOutcome>
}

export function initialPreservationState(now: number): PreservationState {
  return { status: 'NOT_PRESERVED', consented: [], attempts: 0, updatedAt: now }
}
