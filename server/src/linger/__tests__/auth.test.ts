import assert from 'assert'
import { describe, it, beforeEach } from 'node:test'
import { Authenticator } from '@dcl/crypto'
import { Wallet } from 'ethers'

import { TicketStore } from '../auth/ticketStore'
import { verifySignedRequest, identityForSigner } from '../auth/signedAuth'
import { isReservedIdentity } from '../domain/rules'
import { Identity } from '../domain/types'

/**
 * Signed authentication tests.
 *
 * These use REAL Decentraland auth chains, signed by real ethers wallets, and verified by
 * `decentraland-crypto-middleware` — the same library Decentraland's own services use.
 * Nothing here is mocked, so a passing test means the actual verification path works.
 */

const TICKET_PATH = '/api/auth/ticket'

/** Build genuine signed-fetch headers, the way the Decentraland runtime does. */
async function signRequest(
  wallet: Wallet,
  method: string,
  path: string,
  timestamp: number = Date.now(),
  metadata: Record<string, unknown> = {}
): Promise<Record<string, string>> {
  // An ephemeral key signed by the wallet — this is the Decentraland identity model:
  // the wallet delegates to a short-lived key, and the chain proves the delegation.
  const ephemeral = Wallet.createRandom()
  const identity = await Authenticator.initializeAuthChain(
    wallet.address,
    { address: ephemeral.address, privateKey: ephemeral.privateKey, publicKey: '' },
    60,
    (message: string) => wallet.signMessage(message)
  )

  const payload = [method.toLowerCase(), path.toLowerCase(), timestamp, JSON.stringify(metadata)]
    .join(':')
    .toLowerCase()

  const chain = Authenticator.signPayload(identity, payload)

  const headers: Record<string, string> = {
    'x-identity-timestamp': String(timestamp),
    'x-identity-metadata': JSON.stringify(metadata)
  }
  chain.forEach((link, index) => {
    headers[`x-identity-auth-chain-${index}`] = JSON.stringify(link)
  })
  return headers
}

let wallet: Wallet
let tickets: TicketStore

beforeEach(() => {
  wallet = Wallet.createRandom()
  tickets = new TicketStore()
})

// === Real signature verification ==============================================

describe('signature verification', () => {
  it('accepts a genuine Decentraland signature and recovers the wallet', async () => {
    const headers = await signRequest(wallet, 'post', TICKET_PATH)
    const signer = await verifySignedRequest('post', TICKET_PATH, headers)

    assert.ok(signer, 'a valid signature must verify')
    assert.strictEqual(signer!.address, wallet.address.toLowerCase())
  })

  it('rejects a request with no signature at all', async () => {
    assert.strictEqual(await verifySignedRequest('post', TICKET_PATH, {}), null)
  })

  it('rejects a tampered auth chain', async () => {
    const headers = await signRequest(wallet, 'post', TICKET_PATH)
    const link = JSON.parse(headers['x-identity-auth-chain-0'])
    // Swap in a different wallet's address, keeping the original signatures.
    link.payload = Wallet.createRandom().address
    headers['x-identity-auth-chain-0'] = JSON.stringify(link)

    assert.strictEqual(await verifySignedRequest('post', TICKET_PATH, headers), null)
  })

  it('rejects a signature made for a different path', async () => {
    // Signed for an unrelated endpoint, replayed against the ticket endpoint.
    const headers = await signRequest(wallet, 'post', '/api/something-else')
    assert.strictEqual(await verifySignedRequest('post', TICKET_PATH, headers), null)
  })

  it('rejects a signature made for a different method', async () => {
    const headers = await signRequest(wallet, 'get', TICKET_PATH)
    assert.strictEqual(await verifySignedRequest('post', TICKET_PATH, headers), null)
  })

  it('rejects an expired signature (replay window)', async () => {
    const longAgo = Date.now() - 60 * 60 * 1000 // an hour old
    const headers = await signRequest(wallet, 'post', TICKET_PATH, longAgo)
    assert.strictEqual(
      await verifySignedRequest('post', TICKET_PATH, headers),
      null,
      'a captured signature must stop working'
    )
  })

  it('rejects a signature with a tampered timestamp', async () => {
    const headers = await signRequest(wallet, 'post', TICKET_PATH)
    // The timestamp is part of the signed payload, so moving it invalidates the signature.
    headers['x-identity-timestamp'] = String(Date.now() + 1000)
    assert.strictEqual(await verifySignedRequest('post', TICKET_PATH, headers), null)
  })

  it('rejects tampered metadata', async () => {
    const headers = await signRequest(wallet, 'post', TICKET_PATH, Date.now(), { realm: 'a' })
    headers['x-identity-metadata'] = JSON.stringify({ realm: 'somewhere-else' })
    assert.strictEqual(await verifySignedRequest('post', TICKET_PATH, headers), null)
  })

  it('two different wallets recover to two different addresses', async () => {
    const other = Wallet.createRandom()
    const a = await verifySignedRequest('post', TICKET_PATH, await signRequest(wallet, 'post', TICKET_PATH))
    const b = await verifySignedRequest('post', TICKET_PATH, await signRequest(other, 'post', TICKET_PATH))

    assert.ok(a && b)
    assert.notStrictEqual(a!.address, b!.address)
  })

  it('never throws, whatever the headers contain', async () => {
    const junk: any[] = [
      {},
      { 'x-identity-auth-chain-0': 'not json' },
      { 'x-identity-auth-chain-0': '{}', 'x-identity-timestamp': 'abc' },
      { 'x-identity-timestamp': String(Date.now()) },
      { 'x-identity-auth-chain-0': '[]', 'x-identity-metadata': '{{{' }
    ]
    for (const headers of junk) {
      assert.strictEqual(await verifySignedRequest('post', TICKET_PATH, headers), null)
    }
  })
})

// === Impersonation ============================================================

describe('impersonation is not expressible', () => {
  it('a signature always recovers its own signer, never a claimed address', async () => {
    const victim = Wallet.createRandom()
    const attacker = Wallet.createRandom()

    // The attacker signs honestly but puts the victim's address in the metadata, and
    // would send it in the body too. Neither is consulted.
    const headers = await signRequest(attacker, 'post', TICKET_PATH, Date.now(), {
      publicKey: victim.address,
      address: victim.address
    })

    const signer = await verifySignedRequest('post', TICKET_PATH, headers)
    assert.ok(signer)
    assert.strictEqual(signer!.address, attacker.address.toLowerCase())
    assert.notStrictEqual(signer!.address, victim.address.toLowerCase())
  })

  it('the identity built from a signer ignores any supplied name shenanigans', async () => {
    const headers = await signRequest(wallet, 'post', TICKET_PATH)
    const signer = await verifySignedRequest('post', TICKET_PATH, headers)
    const identity = identityForSigner(signer!, 'x'.repeat(500))

    assert.strictEqual(identity.id, wallet.address.toLowerCase())
    assert.strictEqual(identity.name.length, 40, 'display name is capped')
    assert.strictEqual(identity.hasWallet, true)
  })

  it('a verified address is never inside the reserved namespace', async () => {
    const headers = await signRequest(wallet, 'post', TICKET_PATH)
    const signer = await verifySignedRequest('post', TICKET_PATH, headers)
    assert.ok(signer)
    assert.strictEqual(isReservedIdentity(signer!.address), false)
  })
})

// === Tickets ==================================================================

describe('join tickets', () => {
  const identity: Identity = { id: '0xabc', name: 'Aaditya', hasWallet: true }

  it('issues a ticket that redeems to the bound identity', () => {
    const { ticket } = tickets.issue(identity)
    const redeemed = tickets.redeem(ticket)
    assert.deepStrictEqual(redeemed, identity)
  })

  it('is single-use — a replayed ticket is refused', () => {
    const { ticket } = tickets.issue(identity)
    assert.ok(tickets.redeem(ticket))
    assert.strictEqual(tickets.redeem(ticket), null, 'the second redemption must fail')
  })

  it('expires', () => {
    let now = 1_000_000
    const store = new TicketStore({ ttlMs: 5000, clock: () => now })
    const { ticket } = store.issue(identity)

    now += 5001
    assert.strictEqual(store.redeem(ticket), null)
  })

  it('is still valid just inside its window', () => {
    let now = 1_000_000
    const store = new TicketStore({ ttlMs: 5000, clock: () => now })
    const { ticket } = store.issue(identity)

    now += 4999
    assert.ok(store.redeem(ticket))
  })

  it('refuses a guessed or malformed ticket', () => {
    tickets.issue(identity)
    const junk = [null, undefined, '', 'x', 'a'.repeat(64), 123, {}, [], true]
    for (const value of junk) {
      assert.strictEqual(tickets.redeem(value), null)
    }
  })

  it('issues unguessable, non-colliding tickets', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const { ticket } = tickets.issue(identity)
      assert.strictEqual(ticket.length, 64, '256 bits of hex')
      assert.strictEqual(seen.has(ticket), false, 'tickets must not collide')
      seen.add(ticket)
    }
  })

  it('a ticket reveals nothing about its owner', () => {
    const { ticket } = tickets.issue({ id: '0xdeadbeef', name: 'Someone', hasWallet: true })
    assert.strictEqual(ticket.indexOf('deadbeef'), -1)
  })

  it('sweeps expired tickets so the store does not grow without bound', () => {
    let now = 1_000_000
    const store = new TicketStore({ ttlMs: 1000, clock: () => now })
    for (let i = 0; i < 10; i++) store.issue(identity)
    assert.strictEqual(store.size, 10)

    now += 2000
    store.issue(identity) // issuing sweeps first
    assert.strictEqual(store.size, 1)
  })

  it('two tickets for different people redeem to their own identities', () => {
    const a: Identity = { id: '0xaaa', name: 'A', hasWallet: true }
    const b: Identity = { id: '0xbbb', name: 'B', hasWallet: true }
    const ta = tickets.issue(a).ticket
    const tb = tickets.issue(b).ticket

    assert.strictEqual(tickets.redeem(tb)!.id, '0xbbb')
    assert.strictEqual(tickets.redeem(ta)!.id, '0xaaa')
  })
})

// === End-to-end: signature -> ticket -> identity ===============================

describe('signature to identity, end to end', () => {
  it('the verified address is what a ticket redeems to', async () => {
    const headers = await signRequest(wallet, 'post', TICKET_PATH)
    const signer = await verifySignedRequest('post', TICKET_PATH, headers)
    assert.ok(signer)

    const identity = identityForSigner(signer!, 'Aaditya')
    const { ticket } = tickets.issue(identity)
    const redeemed = tickets.redeem(ticket)

    assert.ok(redeemed)
    assert.strictEqual(
      redeemed!.id,
      wallet.address.toLowerCase(),
      'the identity that reaches the room is the address that signed'
    )
    assert.strictEqual(redeemed!.hasWallet, true)
  })

  it('an attacker cannot obtain a ticket for a wallet they do not control', async () => {
    const victim = Wallet.createRandom()
    const attacker = Wallet.createRandom()

    const headers = await signRequest(attacker, 'post', TICKET_PATH, Date.now(), {
      publicKey: victim.address
    })
    const signer = await verifySignedRequest('post', TICKET_PATH, headers)
    const { ticket } = tickets.issue(identityForSigner(signer!, 'Impostor'))

    const redeemed = tickets.redeem(ticket)
    assert.strictEqual(redeemed!.id, attacker.address.toLowerCase())
    assert.notStrictEqual(redeemed!.id, victim.address.toLowerCase())
  })
})
