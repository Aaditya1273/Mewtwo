import { Bond, Echo, EchoInteraction, PlayerActivity } from '../domain/types'
import { PreservationState } from '../chain/BondPreservation'

/**
 * The storage seam.
 *
 * Every LINGER product rule lives above this interface, so swapping storage — memory for
 * demos, Mongo for durability, a chain for provenance — never touches Echo or Bond logic.
 *
 * Implementations are responsible for storage only. They do no validation, enforce no
 * rate limits, and make no product decisions; `LingerService` owns all of that.
 */
export interface SocialPersistence {
  /** Called once at startup. Adapters that need a connection open it here. */
  init(): Promise<void>

  // --- Echoes ------------------------------------------------------------------

  createEcho(echo: Echo): Promise<Echo>
  getEcho(id: string): Promise<Echo | null>
  /** Non-expired Echoes for a World, newest first. */
  listEchoes(worldId: string, now: number, limit: number): Promise<Echo[]>
  /** Most recent Echo an identity created in a World, expired or not. */
  latestEchoByOwner(worldId: string, ownerId: string): Promise<Echo | null>
  updateEcho(echo: Echo): Promise<Echo>
  /** Hard-delete expired Echoes. Returns how many went. */
  purgeExpiredEchoes(worldId: string, now: number): Promise<number>
  /**
   * Count live Echoes left by real visitors, excluding Genesis Echoes.
   * This is the metrics-grade count: authored content must never inflate a social number.
   */
  countVisitorEchoes(worldId: string, now: number): Promise<number>

  // --- Interactions ------------------------------------------------------------

  createInteraction(interaction: EchoInteraction): Promise<EchoInteraction>
  /** Whether this actor already sent this interaction type to this Echo. */
  hasInteracted(echoId: string, actorId: string, type: string): Promise<boolean>
  /** Interactions this actor sent in a World since a timestamp. Used for rate limiting. */
  countInteractionsBy(worldId: string, actorId: string, since: number): Promise<number>
  /** Interactions received by an owner's Echoes since a timestamp. Drives the return panel. */
  listInteractionsForOwner(worldId: string, ownerId: string, since: number): Promise<EchoInteraction[]>
  countInteractionsSince(worldId: string, since: number): Promise<number>

  // --- Bonds -------------------------------------------------------------------

  createBond(bond: Bond): Promise<Bond>
  /** Existing Bond between an unordered pair, if any. */
  findBond(worldId: string, aId: string, bId: string): Promise<Bond | null>
  listBonds(worldId: string, limit: number): Promise<Bond[]>
  countBonds(worldId: string): Promise<number>
  /** Bonds involving an identity created since a timestamp. */
  listBondsForIdentity(worldId: string, identityId: string, since: number): Promise<Bond[]>
  countBondsBy(worldId: string, identityId: string, since: number): Promise<number>
  /** Next sequential Bond number for a World. Must be atomic per World. */
  nextBondNumber(worldId: string): Promise<number>

  /**
   * Preservation state for a Bond, or null if it has never been touched.
   * Stored separately from the Bond so the gameplay record is never rewritten by a
   * chain outcome — the Bond is the source of truth and stays immutable.
   */
  getPreservation(bondId: string): Promise<PreservationState | null>
  savePreservation(bondId: string, state: PreservationState): Promise<PreservationState>

  // --- Player activity ---------------------------------------------------------

  getActivity(worldId: string, identityId: string): Promise<PlayerActivity | null>
  saveActivity(activity: PlayerActivity): Promise<PlayerActivity>
}
