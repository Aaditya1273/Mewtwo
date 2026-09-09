import { randomBytes, timingSafeEqual } from 'crypto'
import { Identity } from '../domain/types'

/**
 * Short-lived, single-use join tickets.
 *
 * WHY A TICKET AT ALL. Colyseus calls `onAuth(client, options, request)` with the
 * WebSocket **upgrade** request, and neither a browser nor the Decentraland runtime can
 * set custom headers on a WebSocket upgrade. The `x-identity-*` signature headers
 * therefore cannot ride the handshake, and there is no way to verify a signature at the
 * moment of joining.
 *
 * What CAN cross the handshake is the `options` object from the matchmaking POST. So the
 * signature is verified over HTTP — where headers work — and the server issues a bearer it
 * minted itself, which the client presents in `options`.
 *
 * This is not a substitute for the signature. The signature is what authenticates; the
 * ticket only carries that already-proven result across a transport that cannot hold
 * headers. It is worthless without a prior verified signature, expires in seconds, and
 * cannot be reused.
 *
 * ponytail: in-process Map, matching MemoryPersistence and the single-process KeyedLock.
 * Multi-process deployment needs a shared store (Redis) or signed stateless tickets.
 */

export interface TicketRecord {
  identity: Identity
  issuedAt: number
  expiresAt: number
}

export interface TicketStoreOptions {
  /** How long a ticket stays redeemable. Seconds, not minutes — it is used immediately. */
  ttlMs?: number
  clock?: () => number
}

const DEFAULT_TTL_MS = 60_000

export class TicketStore {
  private tickets = new Map<string, TicketRecord>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: TicketStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.now = options.clock ?? (() => Date.now())
  }

  /** Mint a ticket for an already-verified identity. */
  issue(identity: Identity): { ticket: string; expiresAt: number } {
    this.sweep()

    // 256 bits from the CSPRNG. Not guessable, and not derived from the address, so a
    // ticket reveals nothing about who it belongs to.
    const ticket = randomBytes(32).toString('hex')
    const issuedAt = this.now()
    const expiresAt = issuedAt + this.ttlMs

    this.tickets.set(ticket, { identity, issuedAt, expiresAt })
    return { ticket, expiresAt }
  }

  /**
   * Redeem a ticket. Returns the verified identity, or null.
   *
   * Single-use: the ticket is deleted on the first successful redemption, so a replayed
   * one fails even inside its TTL.
   */
  redeem(ticket: unknown): Identity | null {
    if (typeof ticket !== 'string' || ticket.length !== 64) return null

    const record = this.findConstantTime(ticket)
    if (!record) return null

    this.tickets.delete(record.key)

    if (record.value.expiresAt <= this.now()) return null
    return record.value.identity
  }

  /**
   * Look a ticket up without leaking timing information about which prefix matched.
   *
   * The map lookup itself would be the fast path for a wrong key, so comparisons are done
   * over the full candidate set with a constant-time equality. With a 256-bit random
   * ticket this is close to paranoia, but it costs nothing at this scale.
   */
  private findConstantTime(ticket: string): { key: string; value: TicketRecord } | null {
    const candidate = Buffer.from(ticket, 'utf8')
    let found: { key: string; value: TicketRecord } | null = null

    for (const [key, value] of this.tickets) {
      const known = Buffer.from(key, 'utf8')
      if (known.length !== candidate.length) continue
      if (timingSafeEqual(known, candidate)) found = { key, value }
    }

    return found
  }

  /** Drop expired tickets. Called on issue, so the map cannot grow unbounded. */
  sweep(): number {
    const now = this.now()
    let removed = 0
    for (const [key, value] of this.tickets) {
      if (value.expiresAt <= now) {
        this.tickets.delete(key)
        removed++
      }
    }
    return removed
  }

  /** Outstanding tickets. Test-only visibility. */
  get size(): number {
    return this.tickets.size
  }
}
