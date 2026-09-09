import { randomUUID } from 'crypto'
import { SocialPersistence } from './persistence/SocialPersistence'
import { KeyedLock } from './domain/keyedLock'
import {
  BondPreservation,
  PreservationState,
  initialPreservationState,
  isPreserveFailure
} from './chain/BondPreservation'
import { DisabledPreservation } from './chain/DisabledPreservation'
import {
  Bond,
  Echo,
  Identity,
  InteractionType,
  PlayerActivity,
  ReturnActivity,
  Result,
  WorldScope,
  WorldVitality,
  err,
  ok
} from './domain/types'
import {
  LIMITS,
  bondPairKey,
  bondStonePosition,
  computeIntensity,
  echoRingPosition,
  isEchoExpired,
  isInteractionType,
  normaliseIdentity,
  sanitiseEmote,
  sanitiseNote
} from './domain/rules'

/**
 * LingerService — the single place LINGER's product rules live.
 *
 * Both entry points (the Colyseus room and the REST routes) are thin adapters over this
 * class. That is what lets the test suite exercise the real rules without a Decentraland
 * client and without a database.
 *
 * SECURITY CONTRACT: every method takes the actor's identity as its first argument, and
 * that identity must be established by the caller from a trusted source — the Colyseus
 * session established at join, or a verified Decentraland signature on the REST side.
 * No method ever reads an owner or actor field out of a request payload.
 */

export interface WorldLayout {
  centre: { x: number; z: number }
  echoRingRadius: number
  echoRingJitter: number
  bondRingRadius: number
}

export const DEFAULT_LAYOUT: WorldLayout = {
  // Must match `scene/src/linger/config.ts`.
  centre: { x: 24, z: 24 },
  echoRingRadius: 9,
  echoRingJitter: 2.2,
  bondRingRadius: 12
}

export type Clock = () => number

export class LingerService {
  /**
   * Serialises check-then-write sequences. See `domain/keyedLock.ts` for why every one of
   * them needs it.
   */
  private readonly lock = new KeyedLock()

  constructor(
    private readonly store: SocialPersistence,
    private readonly now: Clock = () => Date.now(),
    private readonly layout: WorldLayout = DEFAULT_LAYOUT,
    /**
     * Blockchain backend. Disabled by default — LINGER is fully playable without it, and
     * every code path below treats a chain failure as an ordinary outcome.
     */
    private readonly preservation: BondPreservation = new DisabledPreservation()
  ) {}

  async init() {
    await this.store.init()
  }

  // === Echoes ==================================================================

  /**
   * Create an Echo for a player who completed a full linger.
   *
   * The client cannot choose the owner, the timestamps, the expiry, the position, or the
   * id. It contributes a note and an emote, both sanitised.
   */
  async createEcho(
    actor: Identity,
    scope: WorldScope,
    input: { note?: unknown; emote?: unknown }
  ): Promise<Result<Echo>> {
    const identity = normaliseIdentity(actor)
    if (!identity) return err('INVALID', 'A valid identity is required to leave an Echo.')

    return this.lock.run(`echo:${scope.worldId}:${identity.id}`, () =>
      this.createEchoLocked(identity, scope, input)
    )
  }

  private async createEchoLocked(
    identity: Identity,
    scope: WorldScope,
    input: { note?: unknown; emote?: unknown }
  ): Promise<Result<Echo>> {
    const now = this.now()

    const previous = await this.store.latestEchoByOwner(scope.worldId, identity.id)
    if (previous && now - previous.createdAt < LIMITS.echoCooldownMs) {
      const waitMs = LIMITS.echoCooldownMs - (now - previous.createdAt)
      return err(
        'RATE_LIMITED',
        `You already left an Echo here. Try again in ${Math.ceil(waitMs / 60000)} min.`
      )
    }

    const id = randomUUID()
    const echo: Echo = {
      id,
      owner: identity,
      worldId: scope.worldId,
      realmId: scope.realmId,
      position: echoRingPosition(
        id,
        this.layout.centre,
        this.layout.echoRingRadius,
        this.layout.echoRingJitter
      ),
      emote: sanitiseEmote(input.emote),
      note: sanitiseNote(input.note),
      createdAt: now,
      expiresAt: now + LIMITS.echoTtlMs,
      interactionCount: 0,
      interactionsByType: {},
      isGenesis: false
    }

    await this.store.createEcho(echo)
    await this.touchPresence(identity, scope)
    return ok(echo)
  }

  async listEchoes(scope: WorldScope): Promise<Echo[]> {
    return this.store.listEchoes(scope.worldId, this.now(), LIMITS.echoPageSize)
  }

  async getEcho(id: string): Promise<Echo | null> {
    return this.store.getEcho(id)
  }

  /** Housekeeping: drop expired Echoes. Safe to call on a timer. */
  async purgeExpired(scope: WorldScope): Promise<number> {
    return this.store.purgeExpiredEchoes(scope.worldId, this.now())
  }

  // === Interactions ============================================================

  /**
   * Record a Heart / High-five / Note-read against an Echo.
   *
   * Rejected when: the Echo does not exist, has expired, belongs to the actor, has already
   * received this interaction type from this actor, or the actor is over their hourly cap.
   */
  async interact(
    actor: Identity,
    scope: WorldScope,
    echoId: unknown,
    type: unknown
  ): Promise<Result<Echo>> {
    const identity = normaliseIdentity(actor)
    if (!identity) return err('INVALID', 'A valid identity is required.')
    if (typeof echoId !== 'string' || !echoId) return err('INVALID', 'Unknown Echo.')
    if (!isInteractionType(type)) return err('INVALID', 'Unknown interaction.')

    // Keyed on the Echo: two people may interact with two different Echoes concurrently,
    // but two interactions against the SAME Echo are serialised, so neither the duplicate
    // check nor the interaction counter can be raced.
    return this.lock.run(`interact:${echoId}`, () =>
      this.interactLocked(identity, scope, echoId, type as InteractionType)
    )
  }

  private async interactLocked(
    identity: Identity,
    scope: WorldScope,
    echoId: string,
    type: InteractionType
  ): Promise<Result<Echo>> {
    const now = this.now()

    const echo = await this.store.getEcho(echoId)
    if (!echo) return err('NOT_FOUND', 'That Echo is gone.')
    // A record from another World must never be reachable through this World's room.
    if (echo.worldId !== scope.worldId) return err('NOT_FOUND', 'That Echo is gone.')
    if (isEchoExpired(echo, now)) return err('EXPIRED', 'That Echo has faded.')
    if (echo.owner.id === identity.id) {
      return err('SELF_INTERACTION', 'That Echo is yours.')
    }

    if (await this.store.hasInteracted(echoId, identity.id, type)) {
      return err('DUPLICATE', 'You already did that here.')
    }

    const sentThisHour = await this.store.countInteractionsBy(
      scope.worldId,
      identity.id,
      now - 60 * 60 * 1000
    )
    if (sentThisHour >= LIMITS.interactionsPerHour) {
      return err('RATE_LIMITED', 'Slow down a moment.')
    }

    await this.store.createInteraction({
      id: randomUUID(),
      echoId,
      echoOwnerId: echo.owner.id,
      actor: identity,
      type: type as InteractionType,
      worldId: scope.worldId,
      createdAt: now
    })

    echo.interactionCount += 1
    echo.interactionsByType[type as InteractionType] =
      (echo.interactionsByType[type as InteractionType] ?? 0) + 1
    const updated = await this.store.updateEcho(echo)

    await this.touchPresence(identity, scope)
    return ok(updated)
  }

  // === Return activity =========================================================

  /**
   * What happened to this player's Echoes since they last read their activity.
   *
   * Read-only: it does not advance the watermark. The caller advances it with
   * `markActivityRead` once the panel has actually been shown, so a player who
   * disconnects mid-load does not silently lose the moment.
   */
  async getReturnActivity(actor: Identity, scope: WorldScope): Promise<ReturnActivity> {
    const identity = normaliseIdentity(actor)
    const empty: ReturnActivity = {
      hearts: 0,
      highfives: 0,
      reads: 0,
      newBonds: [],
      lastSeenAt: 0,
      isEmpty: true
    }
    if (!identity) return empty

    const activity = await this.store.getActivity(scope.worldId, identity.id)
    // A first-time visitor has no "while you were away" — the panel stays silent.
    if (!activity) return empty

    const since = activity.activityReadAt
    const interactions = await this.store.listInteractionsForOwner(
      scope.worldId,
      identity.id,
      since
    )
    const newBonds = await this.store.listBondsForIdentity(scope.worldId, identity.id, since)

    let hearts = 0
    let highfives = 0
    let reads = 0
    for (const i of interactions) {
      if (i.type === 'heart') hearts++
      else if (i.type === 'highfive') highfives++
      else if (i.type === 'read') reads++
    }

    return {
      hearts,
      highfives,
      reads,
      newBonds,
      lastSeenAt: activity.lastSeenAt,
      isEmpty: hearts + highfives + reads + newBonds.length === 0
    }
  }

  /** Advance the watermark so the same activity is never shown twice. */
  async markActivityRead(actor: Identity, scope: WorldScope): Promise<void> {
    const identity = normaliseIdentity(actor)
    if (!identity) return
    const now = this.now()
    const existing = await this.store.getActivity(scope.worldId, identity.id)
    await this.store.saveActivity({
      identityId: identity.id,
      worldId: scope.worldId,
      lastSeenAt: existing?.lastSeenAt ?? now,
      activityReadAt: now
    })
  }

  /** Record that a player is here now. Called at join and after meaningful actions. */
  async touchPresence(actor: Identity, scope: WorldScope): Promise<PlayerActivity | null> {
    const identity = normaliseIdentity(actor)
    if (!identity) return null
    const now = this.now()
    const existing = await this.store.getActivity(scope.worldId, identity.id)
    return this.store.saveActivity({
      identityId: identity.id,
      worldId: scope.worldId,
      lastSeenAt: now,
      activityReadAt: existing?.activityReadAt ?? 0
    })
  }

  // === Bonds ===================================================================

  /**
   * Create a Bond between two real players.
   *
   * Eligibility (both present, both waved, together long enough) is decided by the caller,
   * because only the live room knows it. This method owns the invariants that survive a
   * restart: distinct identities, no duplicates, per-day caps, sequential numbering.
   */
  async createBond(a: Identity, b: Identity, scope: WorldScope): Promise<Result<Bond>> {
    const idA = normaliseIdentity(a)
    const idB = normaliseIdentity(b)
    if (!idA || !idB) return err('INVALID', 'Both players must be identified.')
    if (idA.id === idB.id) return err('INVALID', 'A Bond needs two people.')

    // Keyed on the unordered pair, so A+B and B+A serialise against each other. Without
    // this, two overlapping Bond evaluations for one pair both see "no existing Bond"
    // and both write, producing two Bond records for the same two people.
    return this.lock.run(`bond:${scope.worldId}:${bondPairKey(idA.id, idB.id)}`, () =>
      this.createBondLocked(idA, idB, scope)
    )
  }

  private async createBondLocked(
    idA: Identity,
    idB: Identity,
    scope: WorldScope
  ): Promise<Result<Bond>> {
    const existing = await this.store.findBond(scope.worldId, idA.id, idB.id)
    if (existing) return err('DUPLICATE', 'You two already share a Bond here.')

    const now = this.now()
    const dayAgo = now - 24 * 60 * 60 * 1000
    for (const identity of [idA, idB]) {
      const recent = await this.store.countBondsBy(scope.worldId, identity.id, dayAgo)
      if (recent >= LIMITS.bondsPerDay) {
        return err('RATE_LIMITED', 'That is enough Bonds for one day.')
      }
    }

    const number = await this.store.nextBondNumber(scope.worldId)
    const bond: Bond = {
      id: randomUUID(),
      number,
      playerA: idA,
      playerB: idB,
      worldId: scope.worldId,
      createdAt: now,
      position: bondStonePosition(number, this.layout.centre, this.layout.bondRingRadius)
    }

    await this.store.createBond(bond)
    return ok(bond)
  }

  async listBonds(scope: WorldScope): Promise<Bond[]> {
    return this.store.listBonds(scope.worldId, 200)
  }

  // === Bond preservation (optional, off-chain-first) ==========================

  /** Whether the preserve action should be offered at all. */
  get preservationEnabled(): boolean {
    return this.preservation.enabled
  }

  get preservationNetwork(): string {
    return this.preservation.network
  }

  /** Current preservation state for a Bond. Never null — an untouched Bond is NOT_PRESERVED. */
  async getPreservation(bondId: string): Promise<PreservationState> {
    const existing = await this.store.getPreservation(bondId)
    return existing ?? initialPreservationState(this.now())
  }

  /**
   * Record one participant's consent to preserve a Bond, and dispatch once both agree.
   *
   * CONSENT: only the two identities recorded on the Bond may consent, and the caller's
   * identity comes from the verified session — never from a payload. An on-chain
   * relationship is never created from one person's decision alone.
   *
   * ORDERING: the Bond already exists and is untouched by everything here. Preservation is
   * an annotation. A failure leaves the Bond exactly as it was.
   */
  async consentToPreserve(actor: Identity, bond: Bond): Promise<Result<PreservationState>> {
    const identity = normaliseIdentity(actor)
    if (!identity) return err('INVALID', 'A valid identity is required.')

    const isParticipant = bond.playerA.id === identity.id || bond.playerB.id === identity.id
    if (!isParticipant) {
      return err('FORBIDDEN', 'Only the two people in a Bond can preserve it.')
    }

    if (!this.preservation.enabled) {
      return err('INVALID', 'Preservation is not available right now.')
    }

    // Serialised per Bond: two people tapping "Preserve" at the same moment must not
    // produce two dispatches.
    return this.lock.run(`preserve:${bond.id}`, () => this.consentLocked(identity, bond))
  }

  private async consentLocked(identity: Identity, bond: Bond): Promise<Result<PreservationState>> {
    const now = this.now()
    const state = (await this.store.getPreservation(bond.id)) ?? initialPreservationState(now)

    if (state.status === 'PRESERVED') {
      return err('DUPLICATE', 'This Bond is already preserved.')
    }
    if (state.status === 'PRESERVING') {
      return err('DUPLICATE', 'This Bond is being preserved right now.')
    }

    if (state.consented.indexOf(identity.id) === -1) {
      state.consented.push(identity.id)
    }
    state.updatedAt = now

    const bothConsented =
      state.consented.indexOf(bond.playerA.id) !== -1 &&
      state.consented.indexOf(bond.playerB.id) !== -1

    if (!bothConsented) {
      // Waiting on the other person. Deliberately still NOT_PRESERVED — nothing has been
      // attempted, and the UI should say it is waiting rather than working.
      state.status = 'NOT_PRESERVED'
      return ok(await this.store.savePreservation(bond.id, state))
    }

    state.status = 'PRESERVING'
    state.attempts += 1
    state.error = undefined
    await this.store.savePreservation(bond.id, state)

    const outcome = await this.preservation.preserve({
      bond,
      participants: [bond.playerA, bond.playerB]
    })

    const settled: PreservationState = {
      ...state,
      updatedAt: this.now()
    }

    if (isPreserveFailure(outcome)) {
      settled.status = 'FAILED'
      settled.error = outcome.error
      // Consent is kept, so a retry does not have to ask both people again.
    } else {
      // Only now, with a confirmation actually in hand, is this PRESERVED.
      settled.status = 'PRESERVED'
      settled.proof = outcome.proof
      settled.error = undefined
    }

    return ok(await this.store.savePreservation(bond.id, settled))
  }

  /** Find a Bond by id within a World. Used to authorise a preservation request. */
  async findBondById(scope: WorldScope, bondId: unknown): Promise<Bond | null> {
    if (typeof bondId !== 'string' || !bondId) return null
    const bonds = await this.store.listBonds(scope.worldId, 500)
    return bonds.find((b) => b.id === bondId) ?? null
  }


  // === Vitality ================================================================

  /**
   * LINGER World Vitality — a prototype discovery signal.
   *
   * This is LINGER's own metric. It is not read by, submitted to, or integrated with
   * Decentraland Discover in any way.
   *
   * Genesis Echoes are excluded from `activeEchoes`. They are content we authored, so
   * counting them would mean a World that nobody has ever visited reports social
   * activity — the exact dishonesty this product exists to avoid. A cold World reads
   * as cold here even while five Genesis Echoes stand around the Hearth.
   */
  async getVitality(scope: WorldScope, livePlayers: number): Promise<WorldVitality> {
    const now = this.now()
    const activeEchoes = await this.store.countVisitorEchoes(scope.worldId, now)
    const interactionsLast24h = await this.store.countInteractionsSince(
      scope.worldId,
      now - 24 * 60 * 60 * 1000
    )
    const totalBonds = await this.store.countBonds(scope.worldId)

    const stats = { activeEchoes, livePlayers, interactionsLast24h, totalBonds }
    return { ...stats, intensity: computeIntensity(stats) }
  }
}
