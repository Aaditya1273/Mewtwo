import { Client, Room } from 'colyseus'
import { LingerState, PresencePlayer } from './schema/LingerState'
import { LingerService } from '../service'
import { Identity, WorldScope, isFailure } from '../domain/types'
import { bondPairKey, isBondEligible, isReservedIdentity, LIMITS } from '../domain/rules'
import { config } from '../config'
import { TicketStore } from '../auth/ticketStore'

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
  /** Injected by arena.config. Redeems the tickets minted by POST /api/auth/ticket. */
  static tickets: TicketStore

  /** sessionId -> identity, established at join and never read from a message. */
  private sessionIdentities = new Map<string, Identity>()
  /** pairKey -> proximity watch. */
  private pairs = new Map<string, PairWatch>()

  private scope!: WorldScope
  private vitalityTimer: NodeJS.Timeout | undefined
  private bondTimer: NodeJS.Timeout | undefined
  /**
   * Guards against overlapping Bond evaluations.
   *
   * The evaluation is async and runs on a 1 s interval. A slow pass — a storage adapter
   * with real latency, say — would otherwise have a second pass start while the first is
   * still awaiting, and both would see the same pair as eligible.
   */
  private evaluatingBonds = false

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

  /**
   * Establish who this client actually is, before they are allowed to join.
   *
   * This is the ONLY place an identity enters the system. It reads exactly one thing from
   * the client: a join ticket, which the server itself minted after verifying a real
   * Decentraland signature over HTTP (`POST /api/auth/ticket`). A `publicKey` in the
   * options is ignored entirely — the field that used to be trusted here.
   *
   * Without a valid ticket the client becomes a `guest:<sessionId>` identity. A guest id
   * is namespaced and session-scoped, so it can never equal or collide with a wallet
   * address, and impersonation is not expressible. Set LINGER_REQUIRE_SIGNED_AUTH=true to
   * refuse unsigned joins outright.
   *
   * Returning a falsy value makes Colyseus reject the connection with AUTH_FAILED.
   */
  onAuth(client: Client, options: any): Identity | false {
    const verified = LingerRoom.tickets.redeem(options?.ticket)

    if (verified) {
      // Defence in depth: a ticket is only ever minted for a verified wallet, so this can
      // only fire if minting is ever changed carelessly.
      if (isReservedIdentity(verified.id)) {
        console.warn('[linger] refused a ticket bearing a reserved identity')
        return false
      }
      return verified
    }

    if (config.requireSignedAuth) {
      console.warn('[linger] refused an unsigned join (LINGER_REQUIRE_SIGNED_AUTH=true)')
      return false
    }

    // Unverified visitor. Their name is cosmetic and is the only thing taken from the
    // client; the id is ours and is scoped to this session.
    const name = String(options?.userData?.displayName ?? 'Someone').slice(0, 40)
    return { id: `guest:${client.sessionId}`, name, hasWallet: false }
  }

  async onJoin(client: Client, options: any, auth: Identity) {
    // `auth` is the value onAuth returned. Identity is never re-derived from options.
    const identity = auth
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
      // Whether to offer the preserve action at all. Off by default.
      preservationEnabled: this.service.preservationEnabled,
      preservationNetwork: this.service.preservationNetwork,
      // The client shows this so a player can see whether they are signed in as their
      // wallet or browsing as a guest.
      authenticated: identity.hasWallet,
      worldId: this.scope.worldId,
      realmId: this.scope.realmId,
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

    /**
     * A participant consents to preserving a Bond on-chain.
     *
     * The identity is the verified session identity — a client cannot consent on anyone
     * else's behalf. The gameplay Bond is never modified by any outcome here.
     */
    this.onMessage('preserveBond', async (client, message: any) => {
      const identity = this.sessionIdentities.get(client.sessionId)
      if (!identity) return

      const bond = await this.service.findBondById(this.scope, message?.bondId)
      if (!bond) {
        client.send('preservationRejected', {
          bondId: message?.bondId,
          error: 'NOT_FOUND',
          message: 'That Bond is not here.'
        })
        return
      }

      const result = await this.service.consentToPreserve(identity, bond)
      if (isFailure(result)) {
        client.send('preservationRejected', {
          bondId: bond.id,
          error: result.error,
          message: result.message
        })
        return
      }

      // Tell both participants, so the second person sees that the first is waiting.
      const update = { bondId: bond.id, state: result.value }
      for (const other of this.clients) {
        const who = this.sessionIdentities.get(other.sessionId)
        if (!who) continue
        if (who.id === bond.playerA.id || who.id === bond.playerB.id) {
          other.send('preservationUpdated', update)
        }
      }
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
    if (this.evaluatingBonds) return
    this.evaluatingBonds = true
    try {
      await this.evaluateBondsOnce()
    } finally {
      this.evaluatingBonds = false
    }
  }

  private async evaluateBondsOnce() {
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

        // Both must still be connected. `onLeave` clears the pair watch, so someone who
        // disconnects mid-qualification loses their progress; this closes the remaining
        // window where a player leaves between the snapshot at the top of this pass and
        // the write below. There is no `await` between this check and the call.
        if (!this.state.players.has(sessionA) || !this.state.players.has(sessionB)) {
          this.pairs.delete(key)
          continue
        }

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
