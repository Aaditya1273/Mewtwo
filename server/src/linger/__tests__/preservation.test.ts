import assert from 'assert'
import { describe, it, beforeEach } from 'node:test'

import { MemoryPersistence } from '../persistence/MemoryPersistence'
import { LingerService } from '../service'
import { DisabledPreservation } from '../chain/DisabledPreservation'
import { MetaTransactionPreservation } from '../chain/MetaTransactionPreservation'
import {
  BondPreservation,
  BondProof,
  PreserveOutcome,
  PreserveRequest
} from '../chain/BondPreservation'
import { readChainConfig, validateChainConfig } from '../chain/chainConfig'
import { Bond, Identity, LingerError, Result, WorldScope, isFailure } from '../domain/types'

/**
 * Bond preservation tests.
 *
 * The chain is mocked ONLY at the `BondPreservation` boundary — the same seam the real
 * adapter plugs into. Everything above it (consent, participant checks, state machine,
 * ordering, retry) is the real code.
 *
 * The governing rule these all protect: **the gameplay Bond is never affected by anything
 * the chain does.** Every test asserts the Bond still stands.
 */

const WORLD: WorldScope = { worldId: 'linger.dcl.eth', realmId: 'realm-a' }

const alice: Identity = { id: '0xalice', name: 'Aaditya', hasWallet: true }
const bob: Identity = { id: '0xbob', name: 'Bob', hasWallet: true }
const carol: Identity = { id: '0xcarol', name: 'Carol', hasWallet: true }

function errorOf(result: Result<unknown>): LingerError {
  if (!isFailure(result)) assert.fail('expected the operation to fail')
  return result.error
}

/** A controllable chain, standing in for Polygon at the abstraction boundary. */
class FakeChain implements BondPreservation {
  readonly enabled = true
  readonly network = 'fake-testnet'

  calls: PreserveRequest[] = []
  outcome: PreserveOutcome = {
    ok: true,
    proof: {
      bondRef: '0xref',
      transactionHash: '0xhash',
      blockNumber: 1,
      network: 'fake-testnet',
      protocolVersion: 1,
      confirmedAt: 0
    }
  }
  /** Set to make preserve() hang, modelling a wallet prompt left open on a phone. */
  hang = false

  async preserve(request: PreserveRequest): Promise<PreserveOutcome> {
    this.calls.push(request)
    if (this.hang) await new Promise((resolve) => setTimeout(resolve, 50))
    return this.outcome
  }

  fail(error: string, retryable = true) {
    this.outcome = { ok: false, retryable, error }
  }

  succeed(proof: Partial<BondProof> = {}) {
    this.outcome = {
      ok: true,
      proof: {
        bondRef: '0xref',
        transactionHash: '0xhash',
        blockNumber: 1,
        network: 'fake-testnet',
        protocolVersion: 1,
        confirmedAt: 0,
        ...proof
      }
    }
  }
}

let store: MemoryPersistence
let chain: FakeChain
let service: LingerService
let clock: number

beforeEach(() => {
  store = new MemoryPersistence()
  chain = new FakeChain()
  clock = 1_700_000_000_000
  service = new LingerService(store, () => clock, undefined, chain)
})

async function aBond(a: Identity = alice, b: Identity = bob): Promise<Bond> {
  const result = await service.createBond(a, b, WORLD)
  assert.ok(result.ok)
  return result.value
}

/** Both participants consent, which is what dispatches to the chain. */
async function bothConsent(bond: Bond) {
  await service.consentToPreserve(bond.playerA, bond)
  return service.consentToPreserve(bond.playerB, bond)
}

// === The chain never affects the Bond =========================================

describe('the gameplay Bond is independent of the chain', () => {
  it('creates a Bond with no chain involvement at all', async () => {
    const bond = await aBond()
    assert.strictEqual(chain.calls.length, 0, 'Bond creation must not touch the chain')

    const state = await service.getPreservation(bond.id)
    assert.strictEqual(state.status, 'NOT_PRESERVED')
  })

  it('creates Bonds normally when preservation is disabled', async () => {
    const offline = new LingerService(store, () => clock, undefined, new DisabledPreservation())
    const result = await offline.createBond(alice, bob, WORLD)
    assert.ok(result.ok)
    assert.strictEqual((await offline.listBonds(WORLD)).length, 1)
  })

  it('survives a chain that fails every call', async () => {
    chain.fail('RPC_UNREACHABLE')
    const bond = await aBond()
    await bothConsent(bond)

    const bonds = await service.listBonds(WORLD)
    assert.strictEqual(bonds.length, 1, 'the Bond must never be deleted')
    assert.strictEqual(bonds[0].id, bond.id)
    assert.strictEqual((await service.getPreservation(bond.id)).status, 'FAILED')
  })

  it('never duplicates the Bond, however many preservation attempts are made', async () => {
    chain.fail('TIMEOUT')
    const bond = await aBond()
    for (let i = 0; i < 5; i++) await bothConsent(bond)
    assert.strictEqual((await service.listBonds(WORLD)).length, 1)
  })
})

// === Disabled =================================================================

describe('preservation disabled', () => {
  beforeEach(() => {
    service = new LingerService(store, () => clock, undefined, new DisabledPreservation())
  })

  it('reports itself as disabled so the UI offers nothing', () => {
    assert.strictEqual(service.preservationEnabled, false)
    assert.strictEqual(service.preservationNetwork, 'disabled')
  })

  it('refuses a consent request', async () => {
    const bond = await aBond()
    const result = await service.consentToPreserve(alice, bond)
    assert.strictEqual(errorOf(result), 'INVALID')
  })

  it('leaves the Bond untouched and unpreserved', async () => {
    const bond = await aBond()
    await service.consentToPreserve(alice, bond)
    assert.strictEqual((await service.getPreservation(bond.id)).status, 'NOT_PRESERVED')
    assert.strictEqual((await service.listBonds(WORLD)).length, 1)
  })

  it('the disabled backend is not retryable — waiting will not turn it on', async () => {
    const outcome = await new DisabledPreservation().preserve({
      bond: await aBond(),
      participants: [alice, bob]
    })
    assert.strictEqual(outcome.ok, false)
    if (outcome.ok === false) {
      assert.strictEqual(outcome.retryable, false)
      assert.strictEqual(outcome.error, 'PRESERVATION_DISABLED')
    }
  })
})

// === Consent ==================================================================

describe('two-person consent', () => {
  it('one person alone does not dispatch to the chain', async () => {
    const bond = await aBond()
    const result = await service.consentToPreserve(alice, bond)

    assert.ok(result.ok)
    assert.strictEqual(result.value.status, 'NOT_PRESERVED', 'still waiting on the other person')
    assert.deepStrictEqual(result.value.consented, ['0xalice'])
    assert.strictEqual(chain.calls.length, 0, 'no silent on-chain relationship')
  })

  it('dispatches once both have consented', async () => {
    const bond = await aBond()
    const result = await bothConsent(bond)

    assert.ok(result.ok)
    assert.strictEqual(result.value.status, 'PRESERVED')
    assert.strictEqual(chain.calls.length, 1)
  })

  it('the same person consenting twice does not count as two people', async () => {
    const bond = await aBond()
    await service.consentToPreserve(alice, bond)
    const again = await service.consentToPreserve(alice, bond)

    assert.ok(again.ok)
    assert.deepStrictEqual(again.value.consented, ['0xalice'])
    assert.strictEqual(chain.calls.length, 0)
  })

  it('refuses someone who is not in the Bond', async () => {
    const bond = await aBond(alice, bob)
    const result = await service.consentToPreserve(carol, bond)

    assert.strictEqual(errorOf(result), 'FORBIDDEN')
    assert.strictEqual(chain.calls.length, 0)
  })

  it('refuses an unidentified actor', async () => {
    const bond = await aBond()
    const result = await service.consentToPreserve({ id: '', name: '', hasWallet: false }, bond)
    assert.strictEqual(errorOf(result), 'INVALID')
  })

  it('a mismatched identity cannot consent on a participant behalf', async () => {
    const bond = await aBond(alice, bob)
    // Same display name, different verified identity — the id is what counts.
    const impostor: Identity = { id: '0xnotalice', name: 'Aaditya', hasWallet: true }
    assert.strictEqual(errorOf(await service.consentToPreserve(impostor, bond)), 'FORBIDDEN')
  })

  it('passes both real participants to the chain, not client-supplied ones', async () => {
    const bond = await aBond()
    await bothConsent(bond)

    const [request] = chain.calls
    const ids = request.participants.map((p) => p.id).sort()
    assert.deepStrictEqual(ids, ['0xalice', '0xbob'])
    assert.strictEqual(request.bond.id, bond.id)
  })
})

// === Outcomes =================================================================

describe('confirmed preservation', () => {
  it('records the proof only after a confirmation', async () => {
    const bond = await aBond()
    chain.succeed({ transactionHash: '0xabc123', blockNumber: 42 })
    const result = await bothConsent(bond)

    assert.ok(result.ok)
    assert.strictEqual(result.value.status, 'PRESERVED')
    assert.strictEqual(result.value.proof?.transactionHash, '0xabc123')
    assert.strictEqual(result.value.proof?.blockNumber, 42)
  })

  it('persists the proof against the Bond', async () => {
    const bond = await aBond()
    await bothConsent(bond)

    const reread = await service.getPreservation(bond.id)
    assert.strictEqual(reread.status, 'PRESERVED')
    assert.strictEqual(reread.proof?.transactionHash, '0xhash')
  })

  it('refuses to preserve an already-preserved Bond', async () => {
    const bond = await aBond()
    await bothConsent(bond)

    const again = await service.consentToPreserve(alice, bond)
    assert.strictEqual(errorOf(again), 'DUPLICATE')
    assert.strictEqual(chain.calls.length, 1, 'must not dispatch twice')
  })

  it('two simultaneous consents dispatch only once', async () => {
    const bond = await aBond()
    await service.consentToPreserve(alice, bond)

    // Both tap at the same instant.
    chain.hang = true
    await Promise.all([
      service.consentToPreserve(bob, bond),
      service.consentToPreserve(bob, bond)
    ])

    assert.strictEqual(chain.calls.length, 1, 'the per-Bond lock must serialise dispatch')
  })
})

describe('failed preservation', () => {
  it('a rejected transaction leaves the Bond and reports FAILED', async () => {
    chain.fail('USER_REJECTED', false)
    const bond = await aBond()
    const result = await bothConsent(bond)

    assert.ok(result.ok)
    assert.strictEqual(result.value.status, 'FAILED')
    assert.strictEqual(result.value.error, 'USER_REJECTED')
    assert.strictEqual((await service.listBonds(WORLD)).length, 1)
  })

  it('handles every realistic chain failure without losing the Bond', async () => {
    const failures = [
      'RPC_UNREACHABLE',
      'INSUFFICIENT_GAS',
      'TIMEOUT',
      'CONTRACT_REVERT',
      'WALLET_DISCONNECTED',
      'USER_REJECTED'
    ]

    for (const error of failures) {
      const fresh = new MemoryPersistence()
      const freshChain = new FakeChain()
      freshChain.fail(error)
      const svc = new LingerService(fresh, () => clock, undefined, freshChain)

      const created = await svc.createBond(alice, bob, WORLD)
      assert.ok(created.ok)
      await svc.consentToPreserve(alice, created.value)
      await svc.consentToPreserve(bob, created.value)

      const state = await svc.getPreservation(created.value.id)
      assert.strictEqual(state.status, 'FAILED', `${error} must be FAILED`)
      assert.strictEqual(state.error, error)
      assert.strictEqual((await svc.listBonds(WORLD)).length, 1, `${error} must keep the Bond`)
    }
  })

  it('never reports PRESERVED without a proof', async () => {
    chain.fail('TIMEOUT')
    const bond = await aBond()
    await bothConsent(bond)

    const state = await service.getPreservation(bond.id)
    assert.notStrictEqual(state.status, 'PRESERVED')
    assert.strictEqual(state.proof, undefined)
  })
})

// === Retry ====================================================================

describe('retry after failure', () => {
  it('a retry does not ask both people again', async () => {
    chain.fail('TIMEOUT')
    const bond = await aBond()
    await bothConsent(bond)

    const state = await service.getPreservation(bond.id)
    assert.strictEqual(state.status, 'FAILED')
    assert.strictEqual(state.consented.length, 2, 'consent survives a failure')
  })

  it('a retry after a transient failure can succeed', async () => {
    chain.fail('RPC_UNREACHABLE')
    const bond = await aBond()
    await bothConsent(bond)
    assert.strictEqual((await service.getPreservation(bond.id)).status, 'FAILED')

    chain.succeed({ transactionHash: '0xsecondtry' })
    const retry = await service.consentToPreserve(alice, bond)

    assert.ok(retry.ok)
    assert.strictEqual(retry.value.status, 'PRESERVED')
    assert.strictEqual(retry.value.proof?.transactionHash, '0xsecondtry')
  })

  it('counts attempts', async () => {
    chain.fail('TIMEOUT')
    const bond = await aBond()
    await bothConsent(bond)
    assert.strictEqual((await service.getPreservation(bond.id)).attempts, 1)

    await service.consentToPreserve(alice, bond)
    assert.strictEqual((await service.getPreservation(bond.id)).attempts, 2)
  })

  it('clears the previous error on a successful retry', async () => {
    chain.fail('CONTRACT_REVERT')
    const bond = await aBond()
    await bothConsent(bond)

    chain.succeed()
    const retry = await service.consentToPreserve(bob, bond)
    assert.ok(retry.ok)
    assert.strictEqual(retry.value.error, undefined)
  })
})

// === Bond lookup ==============================================================

describe('bond lookup for preservation', () => {
  it('finds a real Bond', async () => {
    const bond = await aBond()
    const found = await service.findBondById(WORLD, bond.id)
    assert.strictEqual(found?.id, bond.id)
  })

  it('rejects an invalid Bond id', async () => {
    await aBond()
    for (const value of [null, undefined, '', 0, {}, [], 'no-such-bond']) {
      assert.strictEqual(await service.findBondById(WORLD, value), null)
    }
  })

  it('does not find a Bond from another World', async () => {
    const bond = await aBond()
    const elsewhere: WorldScope = { worldId: 'other.dcl.eth', realmId: 'r' }
    assert.strictEqual(await service.findBondById(elsewhere, bond.id), null)
  })
})

// === On-chain reference =======================================================

describe('bond reference hashing', () => {
  it('is deterministic', () => {
    const a = MetaTransactionPreservation.bondRef('linger.dcl.eth', 1)
    const b = MetaTransactionPreservation.bondRef('linger.dcl.eth', 1)
    assert.strictEqual(a, b)
  })

  it('differs per Bond and per World', () => {
    const one = MetaTransactionPreservation.bondRef('linger.dcl.eth', 1)
    const two = MetaTransactionPreservation.bondRef('linger.dcl.eth', 2)
    const other = MetaTransactionPreservation.bondRef('other.dcl.eth', 1)
    assert.notStrictEqual(one, two)
    assert.notStrictEqual(one, other)
  })

  it('cannot be collided by shifting the boundary between World and number', () => {
    // Length-prefixing is what stops ("ab", 1) colliding with ("a", 11).
    assert.notStrictEqual(
      MetaTransactionPreservation.bondRef('ab', 1),
      MetaTransactionPreservation.bondRef('a', 11)
    )
  })

  it('reveals nothing about the World in plain text', () => {
    const ref = MetaTransactionPreservation.bondRef('linger.dcl.eth', 1)
    assert.strictEqual(ref.indexOf('linger'), -1)
    assert.ok(/^0x[0-9a-f]{64}$/.test(ref))
  })

  it('the unimplemented adapter never claims success', async () => {
    const adapter = new MetaTransactionPreservation({
      enabled: true,
      network: 'polygon-amoy',
      rpcUrl: 'https://example.invalid',
      contractAddress: '0x0',
      relayerUrl: 'https://example.invalid',
      protocolVersion: 1,
      confirmations: 3
    })
    const outcome = await adapter.preserve({
      bond: await aBond(),
      participants: [alice, bob]
    })
    assert.strictEqual(outcome.ok, false, 'must not fake an on-chain result')
  })
})

// === Configuration ============================================================

describe('chain configuration', () => {
  it('is disabled by default', () => {
    const previous = process.env.LINGER_CHAIN_ENABLED
    delete process.env.LINGER_CHAIN_ENABLED

    const config = readChainConfig()
    assert.strictEqual(config.enabled, false)
    assert.deepStrictEqual(validateChainConfig(config), [], 'disabled needs no configuration')

    if (previous !== undefined) process.env.LINGER_CHAIN_ENABLED = previous
  })

  it('reports every missing setting when enabled', () => {
    const missing = validateChainConfig({
      enabled: true,
      network: 'polygon-amoy',
      rpcUrl: '',
      contractAddress: '',
      relayerUrl: '',
      protocolVersion: 1,
      confirmations: 3
    })
    assert.deepStrictEqual(missing, [
      'LINGER_CHAIN_RPC_URL',
      'LINGER_BOND_CONTRACT',
      'LINGER_RELAYER_URL'
    ])
  })

  it('accepts a complete configuration', () => {
    assert.deepStrictEqual(
      validateChainConfig({
        enabled: true,
        network: 'polygon-amoy',
        rpcUrl: 'https://rpc.example',
        contractAddress: '0xcontract',
        relayerUrl: 'https://relay.example',
        protocolVersion: 1,
        confirmations: 3
      }),
      []
    )
  })

  it('rejects a nonsensical confirmation depth', () => {
    const missing = validateChainConfig({
      enabled: true,
      network: 'polygon-amoy',
      rpcUrl: 'https://rpc.example',
      contractAddress: '0xcontract',
      relayerUrl: 'https://relay.example',
      protocolVersion: 1,
      confirmations: 0
    })
    assert.ok(missing.some((m) => m.indexOf('CONFIRMATIONS') !== -1))
  })

  it('holds no key material', () => {
    const config = readChainConfig()
    const serialised = JSON.stringify(config).toLowerCase()
    for (const forbidden of ['privatekey', 'private_key', 'mnemonic', 'secret', 'seed']) {
      assert.strictEqual(serialised.indexOf(forbidden), -1, `config must not carry ${forbidden}`)
    }
  })
})
