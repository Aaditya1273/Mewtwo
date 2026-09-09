import { Bond, Echo, EchoInteraction, PlayerActivity } from '../domain/types'
import { bondPairKey } from '../domain/rules'
import { PreservationState } from '../chain/BondPreservation'
import { SocialPersistence } from './SocialPersistence'

/**
 * In-process storage. The default adapter.
 *
 * This exists so LINGER runs with no external services at all: a judge clones the repo,
 * runs `npm start`, and the whole product loop works. It is also what the test suite runs
 * against, which is why the tests need no database fixture.
 *
 * Data does not survive a restart. `MongoPersistence` is the durable adapter.
 */
export class MemoryPersistence implements SocialPersistence {
  private echoes = new Map<string, Echo>()
  private interactions: EchoInteraction[] = []
  private bonds = new Map<string, Bond>()
  /** worldId|pairKey -> bondId, for O(1) duplicate detection. */
  private bondPairs = new Map<string, string>()
  private bondCounters = new Map<string, number>()
  /** worldId|identityId -> activity */
  private activity = new Map<string, PlayerActivity>()

  async init(): Promise<void> {
    // Nothing to connect.
  }

  private static key(worldId: string, id: string) {
    return `${worldId}|${id}`
  }

  // --- Echoes ------------------------------------------------------------------

  async createEcho(echo: Echo): Promise<Echo> {
    this.echoes.set(echo.id, { ...echo })
    return { ...echo }
  }

  async getEcho(id: string): Promise<Echo | null> {
    const found = this.echoes.get(id)
    return found ? { ...found } : null
  }

  async listEchoes(worldId: string, now: number, limit: number): Promise<Echo[]> {
    const live: Echo[] = []
    for (const echo of this.echoes.values()) {
      if (echo.worldId !== worldId) continue
      if (echo.expiresAt > 0 && echo.expiresAt <= now) continue
      live.push({ ...echo })
    }
    // Genesis Echoes sort last, so a real visitor's Echo always wins a contested slot.
    live.sort((a, b) => {
      if (a.isGenesis !== b.isGenesis) return a.isGenesis ? 1 : -1
      return b.createdAt - a.createdAt
    })
    return live.slice(0, limit)
  }

  async latestEchoByOwner(worldId: string, ownerId: string): Promise<Echo | null> {
    let newest: Echo | null = null
    for (const echo of this.echoes.values()) {
      if (echo.worldId !== worldId || echo.owner.id !== ownerId) continue
      if (!newest || echo.createdAt > newest.createdAt) newest = echo
    }
    return newest ? { ...newest } : null
  }

  async updateEcho(echo: Echo): Promise<Echo> {
    this.echoes.set(echo.id, { ...echo })
    return { ...echo }
  }

  async purgeExpiredEchoes(worldId: string, now: number): Promise<number> {
    let removed = 0
    for (const [id, echo] of this.echoes) {
      if (echo.worldId !== worldId) continue
      if (echo.expiresAt > 0 && echo.expiresAt <= now) {
        this.echoes.delete(id)
        removed++
      }
    }
    return removed
  }

  async countVisitorEchoes(worldId: string, now: number): Promise<number> {
    let count = 0
    for (const echo of this.echoes.values()) {
      if (echo.worldId !== worldId) continue
      if (echo.isGenesis) continue
      if (echo.expiresAt > 0 && echo.expiresAt <= now) continue
      count++
    }
    return count
  }

  // --- Interactions ------------------------------------------------------------

  async createInteraction(interaction: EchoInteraction): Promise<EchoInteraction> {
    this.interactions.push({ ...interaction })
    return { ...interaction }
  }

  async hasInteracted(echoId: string, actorId: string, type: string): Promise<boolean> {
    return this.interactions.some(
      (i) => i.echoId === echoId && i.actor.id === actorId && i.type === type
    )
  }

  async countInteractionsBy(worldId: string, actorId: string, since: number): Promise<number> {
    return this.interactions.filter(
      (i) => i.worldId === worldId && i.actor.id === actorId && i.createdAt >= since
    ).length
  }

  async listInteractionsForOwner(
    worldId: string,
    ownerId: string,
    since: number
  ): Promise<EchoInteraction[]> {
    return this.interactions
      .filter(
        (i) =>
          i.worldId === worldId &&
          i.echoOwnerId === ownerId &&
          i.createdAt > since &&
          // Never report a player's interactions with their own Echo back to them.
          i.actor.id !== ownerId
      )
      .map((i) => ({ ...i }))
  }

  async countInteractionsSince(worldId: string, since: number): Promise<number> {
    return this.interactions.filter((i) => i.worldId === worldId && i.createdAt >= since).length
  }

  // --- Bonds -------------------------------------------------------------------

  async createBond(bond: Bond): Promise<Bond> {
    this.bonds.set(bond.id, { ...bond })
    this.bondPairs.set(
      MemoryPersistence.key(bond.worldId, bondPairKey(bond.playerA.id, bond.playerB.id)),
      bond.id
    )
    return { ...bond }
  }

  async findBond(worldId: string, aId: string, bId: string): Promise<Bond | null> {
    const id = this.bondPairs.get(MemoryPersistence.key(worldId, bondPairKey(aId, bId)))
    if (!id) return null
    const bond = this.bonds.get(id)
    return bond ? { ...bond } : null
  }

  async listBonds(worldId: string, limit: number): Promise<Bond[]> {
    return Array.from(this.bonds.values())
      .filter((b) => b.worldId === worldId)
      .sort((a, b) => a.number - b.number)
      .slice(0, limit)
      .map((b) => ({ ...b }))
  }

  async countBonds(worldId: string): Promise<number> {
    let count = 0
    for (const bond of this.bonds.values()) if (bond.worldId === worldId) count++
    return count
  }

  async listBondsForIdentity(
    worldId: string,
    identityId: string,
    since: number
  ): Promise<Bond[]> {
    return Array.from(this.bonds.values())
      .filter(
        (b) =>
          b.worldId === worldId &&
          b.createdAt > since &&
          (b.playerA.id === identityId || b.playerB.id === identityId)
      )
      // Always present the reader as playerA, so the UI can say "your Bond with <playerB>".
      .map((b) =>
        b.playerA.id === identityId ? { ...b } : { ...b, playerA: b.playerB, playerB: b.playerA }
      )
  }

  async countBondsBy(worldId: string, identityId: string, since: number): Promise<number> {
    let count = 0
    for (const bond of this.bonds.values()) {
      if (bond.worldId !== worldId || bond.createdAt < since) continue
      if (bond.playerA.id === identityId || bond.playerB.id === identityId) count++
    }
    return count
  }

  async nextBondNumber(worldId: string): Promise<number> {
    const next = (this.bondCounters.get(worldId) ?? 0) + 1
    this.bondCounters.set(worldId, next)
    return next
  }

  /** bondId -> preservation state. Separate from the Bond, which never changes. */
  private preservation = new Map<string, PreservationState>()

  async getPreservation(bondId: string): Promise<PreservationState | null> {
    const found = this.preservation.get(bondId)
    return found ? { ...found, consented: [...found.consented] } : null
  }

  async savePreservation(bondId: string, state: PreservationState): Promise<PreservationState> {
    this.preservation.set(bondId, { ...state, consented: [...state.consented] })
    return { ...state, consented: [...state.consented] }
  }

  // --- Player activity ---------------------------------------------------------

  async getActivity(worldId: string, identityId: string): Promise<PlayerActivity | null> {
    const found = this.activity.get(MemoryPersistence.key(worldId, identityId))
    return found ? { ...found } : null
  }

  async saveActivity(activity: PlayerActivity): Promise<PlayerActivity> {
    this.activity.set(MemoryPersistence.key(activity.worldId, activity.identityId), { ...activity })
    return { ...activity }
  }

  /** Test helper: wipe everything. Not part of the interface. */
  reset() {
    this.echoes.clear()
    this.interactions = []
    this.bonds.clear()
    this.bondPairs.clear()
    this.bondCounters.clear()
    this.activity.clear()
    this.preservation.clear()
  }
}
