import { Client, Room } from 'colyseus'
import { LingerState, PresencePlayer } from './schema/LingerState'
import { LingerService } from '../service'
import { Identity, WorldScope, isFailure } from '../domain/types'
import { bondPairKey, isBondEligible, LIMITS } from '../domain/rules'
import { config } from '../config'

/**
 * The live LINGER room.
 *
 * Responsibilities:
 *  - establish each player's identity ONCE, at join, and hold it server-side
 *  - synchronise coarse presence so players can see each other
 *  - watch pairs for Bond eligibility
 *  - forward Echo work to LingerService, which owns every rule
 *
 * IDENTITY: `sessionIdentities` is the only identity source used after join. Message
 * payloads never carry an owner or actor field — the room looks the sender up by their
 * Colyseus session id. A client therefore cannot act as anyone but itself, which is what
 * closes the donor project's "trust `options.userData.publicKey` on every request" hole.
 */

interface PairWatch {
  /** When these two first came within Bond radius, or 0 if they are currently apart. */
  togetherSinceMs: number
}

export class LingerRoom extends Room<LingerState> {
  /** Injected by arena.config so the room and the REST routes share one service. */
  static service: LingerService

  /** sessionId -> identity, established at join and never read from a message. */
  private sessionIdentities = new Map<string, Identity>()
  /** pairKey -> proximity watch. */
  private pairs = new Map<string, PairWatch>()

  private scope!: WorldScope
  private vitalityTimer: NodeJS.Timeout | undefined
  private bondTimer: NodeJS.Timeout | undefined

  private get service(): LingerService {
    return LingerRoom.service
  }

  onCreate(options: any) {
    this.setState(new LingerState())

    // The World is server configuration. A client's claim about which World it is in is
    // recorded as provenance only and never used to scope a record.
    this.scope = {
      worldId: config.worldId,
      realmId: typeof options?.realm === 'string' ? options.realm.slice(0, 80) : 'unknown'
    }

    this.registerHandlers()

    // Vitality is recomputed on a slow interval, never per message.
    this.vitalityTimer = setInterval(() => {
      void this.refreshVitality()
    }, config.vitalityIntervalSeconds * 1000)

    // Bond eligibility is evaluated once a second. Proximity does not need finer
    // resolution when the qualifying duration is 30 seconds.
    this.bondTimer = setInterval(() => {
      void this.evaluateBonds()
    }, 1000)

    void this.refreshVitality()
  }

  // === Join / leave ============================================================

  async onJoin(client: Client, options: any) {
    // Identity is asserted by the Decentraland client at join. See SECURITY.md for the
    // residual risk and the signature-verified path that closes it.
    const raw = options?.userData ?? {}
    const identity: Identity = {
      id: String(raw.publicKey ?? raw.userId ?? `guest:${client.sessionId}`).toLowerCase(),
      name: String(raw.displayName ?? 'Someone').slice(0, 40),
      hasWallet: !!raw.publicKey
    }
    this.sessionIdentities.set(client.sessionId, identity)

    const player = new PresencePlayer()
    player.identityId = identity.id
    player.name = identity.name
    player.hasWallet = identity.hasWallet
    this.state.players.set(client.sessionId, player)

    // The return summary is computed BEFORE presence is touched, so "since you were last
    // here" still means what it says.
    const activity = await this.service.getReturnActivity(identity, this.scope)
    await this.service.touchPresence(identity, this.scope)

    const echoes = await this.service.listEchoes(this.scope)
    const bonds = await this.service.listBonds(this.scope)

    client.send('welcome', {
      identity,
      worldId: this.scope.worldId,
      echoes,
      bonds,
      activity
    })

    await this.refreshVitality()
  }

  onLeave(client: Client) {
    this.sessionIdentities.delete(client.sessionId)
    this.state.players.delete(client.sessionId)

    // Drop every pair watch involving this session, so a reconnect cannot inherit
    // proximity credit it did not earn.
    for (const key of Array.from(this.pairs.keys())) {
      if (key.indexOf(client.sessionId) !== -1) this.pairs.delete(key)
    }

    void this.refreshVitality()
  }

  onDispose() {
    if (this.vitalityTimer) clearInterval(this.vitalityTimer)
    if (this.bondTimer) clearInterval(this.bondTimer)
  }

  // === Messages ================================================================

  private registerHandlers() {
    /**
     * Coarse presence update. The client throttles these to at most one per second and
     * only sends when the player has actually moved, so this is not a per-frame write.
     */
    this.onMessage('presence', (client, message: any) => {
      const player = this.state.players.get(client.sessionId)
      if (!player) return
      if (typeof message?.x !== 'number' || typeof message?.z !== 'number') return
      if (!Number.isFinite(message.x) || !Number.isFinite(message.z)) return

      player.x = message.x
      player.z = message.z
      player.atHearth = !!message.atHearth
    })

    /** An explicit, deliberate social gesture. Required for a Bond. */
    this.onMessage('wave', (client) => {
      const player = this.state.players.get(client.sessionId)
      if (!player) return
      player.wavedAt = Date.now()
    })

    this.onMessage('createEcho', async (client, message: any) => {
      const identity = this.sessionIdentities.get(client.sessionId)
      if (!identity) return

      const result = await this.service.createEcho(identity, this.scope, {
        note: message?.note,
        emote: message?.emote
      })

      if (isFailure(result)) {
        client.send('echoRejected', { error: result.error, message: result.message })
        return
      }

      client.send('echoCreated', { echo: result.value })
      // Everyone else learns about it live, so a second player standing here watches an
      // Echo appear rather than finding it on their next visit.
      this.broadcast('echoAdded', { echo: result.value }, { except: client })
      await this.refreshVitality()
    })

    this.onMessage('interact', async (client, message: any) => {
      const identity = this.sessionIdentities.get(client.sessionId)
      if (!identity) return

      const result = await this.service.interact(
        identity,
        this.scope,
        message?.echoId,
        message?.type
      )

      if (isFailure(result)) {
        client.send('interactionRejected', {
          echoId: message?.echoId,
          error: result.error,
          message: result.message
        })
        return
      }

      // Broadcast to everyone including the actor: the authoritative Echo overwrites the
      // client's optimistic update, so a rejected or adjusted count self-corrects.
      this.broadcast('echoUpdated', { echo: result.value })
      await this.refreshVitality()
    })

    /** The client confirms it has actually displayed the return panel. */
    this.onMessage('activityRead', async (client) => {
      const identity = this.sessionIdentities.get(client.sessionId)
      if (!identity) return
      await this.service.markActivityRead(identity, this.scope)
    })
  }

  // === Bonds ===================================================================

  /**
   * Watch every live pair for Bond eligibility.
   *
   * O(n²) over players in one room. With a Hearth-sized social space that is a handful of
   * players, and the loop runs once a second — this is deliberately the simple version.
   * If a room ever holds tens of players, switch to a spatial bucket keyed on the Hearth.
   */
  private async evaluateBonds() {
    const now = Date.now()
    const entries = Array.from(this.state.players.entries())
    if (entries.length < 2) {
      this.pairs.clear()
      return
    }

    const radiusSquared = LIMITS.bondRadius * LIMITS.bondRadius
    const seen = new Set<string>()

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [sessionA, a] = entries[i]
        const [sessionB, b] = entries[j]

        // Never Bond a player with themselves across two sessions.
        if (a.identityId === b.identityId) continue

        const key = bondPairKey(sessionA, sessionB)
        seen.add(key)

        const dx = a.x - b.x
        const dz = a.z - b.z
        const near = dx * dx + dz * dz <= radiusSquared

        let watch = this.pairs.get(key)
        if (!watch) {
          watch = { togetherSinceMs: 0 }
          this.pairs.set(key, watch)
        }

        if (!near) {
          // Leaving the radius resets the clock. Being together has to be continuous.
          watch.togetherSinceMs = 0
          continue
        }

        if (watch.togetherSinceMs === 0) watch.togetherSinceMs = now

        const eligible = isBondEligible(
          {
            togetherSinceMs: watch.togetherSinceMs,
            wavedAtA: a.wavedAt,
            wavedAtB: b.wavedAt
          },
          now
        )
        if (!eligible) continue

        const identityA = this.sessionIdentities.get(sessionA)
        const identityB = this.sessionIdentities.get(sessionB)
        if (!identityA || !identityB) continue

        const result = await this.service.createBond(identityA, identityB, this.scope)

        // Stop re-evaluating this pair either way: on success there is a Bond, and on a
        // duplicate they already have one. Both mean "leave these two alone".
        watch.togetherSinceMs = 0
        a.wavedAt = 0
        b.wavedAt = 0

        if (!result.ok) continue

        const clientA = this.clients.find((c) => c.sessionId === sessionA)
        const clientB = this.clients.find((c) => c.sessionId === sessionB)
        if (clientA) clientA.send('bondCreated', { bond: result.value })
        if (clientB) clientB.send('bondCreated', { bond: result.value })
        // Everyone in the World sees the new Bond stone appear.
        this.broadcast('bondAdded', { bond: result.value })

        await this.refreshVitality()
      }
    }

    // Forget watches for pairs that no longer both exist.
    for (const key of Array.from(this.pairs.keys())) {
      if (!seen.has(key)) this.pairs.delete(key)
    }
  }

  // === Vitality ================================================================

  private async refreshVitality() {
    const vitality = await this.service.getVitality(this.scope, this.state.players.size)
    this.state.intensity = vitality.intensity
    this.state.visitorEchoes = vitality.activeEchoes
    this.state.totalBonds = vitality.totalBonds
  }
}
