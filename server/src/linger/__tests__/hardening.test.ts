import assert from 'assert'
import { describe, it, beforeEach } from 'node:test'

import { MemoryPersistence } from '../persistence/MemoryPersistence'
import { LingerService } from '../service'
import { KeyedLock } from '../domain/keyedLock'
import {
  LIMITS,
  isReservedIdentity,
  normaliseIdentity,
  sanitiseNote,
  bondPairKey
} from '../domain/rules'
import { seedGenesisEchoes, GENESIS_NAME } from '../genesis'
import { Identity, LingerError, Result, WorldScope, isFailure } from '../domain/types'

/**
 * Hardening tests.
 *
 * Each of these corresponds to a defect found during the pre-demo audit. They exist to
 * stop those specific failures coming back, not to restate the P0 behaviour that
 * `linger.test.ts` already covers.
 */

const WORLD: WorldScope = { worldId: 'linger.dcl.eth', realmId: 'realm-a' }
const OTHER_WORLD: WorldScope = { worldId: 'other.dcl.eth', realmId: 'realm-b' }

const alice: Identity = { id: '0xALICE', name: 'Aaditya', hasWallet: true }
const bob: Identity = { id: '0xbob', name: 'Bob', hasWallet: true }
const carol: Identity = { id: '0xcarol', name: 'Carol', hasWallet: true }

let store: MemoryPersistence
let clock: number
let service: LingerService

function errorOf(result: Result<unknown>): LingerError {
  if (!isFailure(result)) assert.fail('expected the operation to fail')
  return result.error
}

beforeEach(() => {
  store = new MemoryPersistence()
  clock = 1_700_000_000_000
  service = new LingerService(store, () => clock)
})

async function anEcho(owner: Identity = alice, scope: WorldScope = WORLD) {
  const result = await service.createEcho(owner, scope, { note: 'hello' })
  assert.ok(result.ok)
  return result.value
}

// === Concurrency ==============================================================
//
// Colyseus dispatches messages in order, but every handler is async and yields at its
// first await. Before the KeyedLock these three sequences could interleave.

describe('concurrent interactions (audit finding)', () => {
  it('two simultaneous identical interactions produce exactly one', async () => {
    const echo = await anEcho(alice)

    const [first, second] = await Promise.all([
      service.interact(bob, WORLD, echo.id, 'heart'),
      service.interact(bob, WORLD, echo.id, 'heart')
    ])

    const succeeded = [first, second].filter((r) => r.ok).length
    assert.strictEqual(succeeded, 1, 'exactly one must succeed')

    const failed = [first, second].find((r) => !r.ok)
    assert.strictEqual(errorOf(failed!), 'DUPLICATE')

    const after = await service.getEcho(echo.id)
    assert.strictEqual(after!.interactionCount, 1, 'the counter must not double-count')
    assert.strictEqual(after!.interactionsByType.heart, 1)
  })

  it('ten simultaneous interactions from ten people all land exactly once', async () => {
    const echo = await anEcho(alice)
    const actors: Identity[] = []
    for (let i = 0; i < 10; i++) {
      actors.push({ id: `0xfan${i}`, name: `Fan ${i}`, hasWallet: true })
    }

    const results = await Promise.all(
      actors.map((actor) => service.interact(actor, WORLD, echo.id, 'heart'))
    )
    assert.strictEqual(results.filter((r) => r.ok).length, 10)

    const after = await service.getEcho(echo.id)
    // The read-modify-write on interactionCount is the part that used to be lost.
    assert.strictEqual(after!.interactionCount, 10)
    assert.strictEqual(after!.interactionsByType.heart, 10)
  })

  it('two simultaneous Echo creations respect the cooldown', async () => {
    const [first, second] = await Promise.all([
      service.createEcho(alice, WORLD, { note: 'one' }),
      service.createEcho(alice, WORLD, { note: 'two' })
    ])

    assert.strictEqual([first, second].filter((r) => r.ok).length, 1)
    assert.strictEqual(errorOf([first, second].find((r) => !r.ok)!), 'RATE_LIMITED')
    assert.strictEqual((await service.listEchoes(WORLD)).length, 1)
  })

  it('interactions on different Echoes still run concurrently', async () => {
    const one = await anEcho(alice)
    clock += LIMITS.echoCooldownMs + 1
    const two = await anEcho(carol)

    const results = await Promise.all([
      service.interact(bob, WORLD, one.id, 'heart'),
      service.interact(bob, WORLD, two.id, 'heart')
    ])
    assert.ok(results.every((r) => r.ok), 'the lock must be per-Echo, not global')
  })
})

describe('concurrent Bond creation (audit finding)', () => {
  it('two simultaneous requests for the same pair create one Bond', async () => {
    const [first, second] = await Promise.all([
      service.createBond(alice, bob, WORLD),
      service.createBond(alice, bob, WORLD)
    ])

    assert.strictEqual([first, second].filter((r) => r.ok).length, 1)
    assert.strictEqual(errorOf([first, second].find((r) => !r.ok)!), 'DUPLICATE')
    assert.strictEqual((await service.listBonds(WORLD)).length, 1)
  })

  it('simultaneous requests in opposite order still create one Bond', async () => {
    const [first, second] = await Promise.all([
      service.createBond(alice, bob, WORLD),
      service.createBond(bob, alice, WORLD)
    ])

    assert.strictEqual([first, second].filter((r) => r.ok).length, 1)
    assert.strictEqual((await service.listBonds(WORLD)).length, 1)
  })

  it('five simultaneous requests for one pair still create one Bond', async () => {
    const attempts = []
    for (let i = 0; i < 5; i++) attempts.push(service.createBond(alice, bob, WORLD))
    const results = await Promise.all(attempts)

    assert.strictEqual(results.filter((r) => r.ok).length, 1)
    assert.strictEqual((await service.listBonds(WORLD)).length, 1)
  })

  it('Bond numbers stay unique under concurrent creation of different pairs', async () => {
    const results = await Promise.all([
      service.createBond(alice, bob, WORLD),
      service.createBond(alice, carol, WORLD),
      service.createBond(bob, carol, WORLD)
    ])
    assert.ok(results.every((r) => r.ok))

    const bonds = await service.listBonds(WORLD)
    const numbers = bonds.map((b) => b.number).sort((a, b) => a - b)
    assert.deepStrictEqual(numbers, [1, 2, 3], 'no two Bonds may share a number')
  })
})

describe('KeyedLock', () => {
  it('serialises the same key and parallelises different keys', async () => {
    const lock = new KeyedLock()
    const order: string[] = []

    const slow = async (tag: string, ms: number) => {
      order.push(`${tag}:start`)
      await new Promise((r) => setTimeout(r, ms))
      order.push(`${tag}:end`)
    }

    await Promise.all([
      lock.run('same', () => slow('a', 20)),
      lock.run('same', () => slow('b', 1)),
      lock.run('other', () => slow('c', 1))
    ])

    // 'a' must fully finish before 'b' starts.
    assert.ok(order.indexOf('a:end') < order.indexOf('b:start'))
    // 'c' holds a different key, so it does not wait for 'a'.
    assert.ok(order.indexOf('c:start') < order.indexOf('a:end'))
  })

  it('a thrown critical section does not deadlock the key', async () => {
    const lock = new KeyedLock()
    await assert.rejects(
      lock.run('k', async () => {
        throw new Error('boom')
      })
    )
    const after = await lock.run('k', async () => 'ok')
    assert.strictEqual(after, 'ok', 'the key must still be usable')
  })

  it('releases keys so the map does not grow without bound', async () => {
    const lock = new KeyedLock()
    for (let i = 0; i < 50; i++) {
      await lock.run(`k${i}`, async () => i)
    }
    assert.strictEqual(lock.size, 0)
  })
})

// === Genesis integrity ========================================================

describe('reserved Genesis identities (audit finding)', () => {
  it('recognises the reserved namespace', () => {
    assert.strictEqual(isReservedIdentity('linger:genesis:0'), true)
    assert.strictEqual(isReservedIdentity('LINGER:Genesis:0'), true)
    assert.strictEqual(isReservedIdentity('0xabc'), false)
    assert.strictEqual(isReservedIdentity('guest:abc'), false)
  })

  it('refuses to normalise a reserved identity', () => {
    assert.strictEqual(normaliseIdentity({ id: 'linger:genesis:0', name: 'x' }), null)
  })

  it('a client impersonating a Genesis owner cannot leave an Echo', async () => {
    const impostor: Identity = { id: 'linger:genesis:0', name: GENESIS_NAME, hasWallet: false }
    const result = await service.createEcho(impostor, WORLD, { note: 'I am founding' })
    assert.ok(!result.ok)
    assert.strictEqual(errorOf(result), 'INVALID')
    assert.strictEqual((await service.listEchoes(WORLD)).length, 0)
  })

  it('a Genesis identity can never become a Bond participant', async () => {
    const impostor: Identity = { id: 'linger:genesis:2', name: GENESIS_NAME, hasWallet: false }

    const asA = await service.createBond(impostor, alice, WORLD)
    assert.ok(!asA.ok)
    assert.strictEqual(errorOf(asA), 'INVALID')

    const asB = await service.createBond(alice, impostor, WORLD)
    assert.ok(!asB.ok)
    assert.strictEqual(errorOf(asB), 'INVALID')

    assert.strictEqual((await service.listBonds(WORLD)).length, 0)
  })

  it('a Genesis identity cannot send interactions', async () => {
    await seedGenesisEchoes(store, WORLD, clock)
    const echo = await anEcho(alice)
    const impostor: Identity = { id: 'linger:genesis:1', name: GENESIS_NAME, hasWallet: false }

    const result = await service.interact(impostor, WORLD, echo.id, 'heart')
    assert.ok(!result.ok)
    assert.strictEqual(errorOf(result), 'INVALID')
  })

  it('seeded Genesis Echoes are still owned by reserved ids', async () => {
    // Seeding writes directly to storage and bypasses identity normalisation on purpose:
    // the reserved namespace is what makes them recognisable as authored content.
    await seedGenesisEchoes(store, WORLD, clock)
    const echoes = await service.listEchoes(WORLD)
    assert.strictEqual(echoes.length, 5)
    assert.ok(echoes.every((e) => isReservedIdentity(e.owner.id)))
    assert.ok(echoes.every((e) => e.isGenesis))
  })

  it('Genesis Echoes never inflate vitality, however many exist', async () => {
    await seedGenesisEchoes(store, WORLD, clock)
    const cold = await service.getVitality(WORLD, 0)
    assert.strictEqual(cold.activeEchoes, 0)
    assert.strictEqual(cold.intensity, 0)
  })
})

// === Expiry ===================================================================

describe('expiry (audit)', () => {
  it('an Echo expiring exactly on the boundary is gone', async () => {
    const echo = await anEcho(alice)
    clock = echo.expiresAt
    assert.strictEqual((await service.listEchoes(WORLD)).length, 0)
  })

  it('an Echo one millisecond before expiry is still present', async () => {
    const echo = await anEcho(alice)
    clock = echo.expiresAt - 1
    assert.strictEqual((await service.listEchoes(WORLD)).length, 1)
  })

  it('interacting with an Echo that expires mid-session is refused, not counted', async () => {
    const echo = await anEcho(alice)
    clock += LIMITS.echoTtlMs + 1

    const result = await service.interact(bob, WORLD, echo.id, 'heart')
    assert.strictEqual(errorOf(result), 'EXPIRED')

    const stored = await service.getEcho(echo.id)
    assert.strictEqual(stored!.interactionCount, 0, 'an expired Echo must not accrue activity')
  })

  it('purging is idempotent', async () => {
    await anEcho(alice)
    clock += LIMITS.echoTtlMs + 1
    assert.strictEqual(await service.purgeExpired(WORLD), 1)
    assert.strictEqual(await service.purgeExpired(WORLD), 0)
  })

  it('purging one World does not touch another', async () => {
    await anEcho(alice, WORLD)
    await anEcho(bob, OTHER_WORLD)
    clock += LIMITS.echoTtlMs + 1

    assert.strictEqual(await service.purgeExpired(WORLD), 1)
    assert.strictEqual((await service.listEchoes(OTHER_WORLD)).length, 0, 'expired but not purged')
    assert.strictEqual(await service.purgeExpired(OTHER_WORLD), 1)
  })
})

// === Malformed and hostile input ==============================================

describe('malformed input cannot corrupt state', () => {
  it('survives every junk value as an interaction type', async () => {
    const echo = await anEcho(alice)
    const junk = [null, undefined, 0, 1, '', 'HEART', 'heart ', {}, [], true, NaN, Infinity]

    for (const value of junk) {
      const result = await service.interact(bob, WORLD, echo.id, value)
      assert.ok(!result.ok, `"${String(value)}" must be rejected`)
      assert.strictEqual(errorOf(result), 'INVALID')
    }

    const after = await service.getEcho(echo.id)
    assert.strictEqual(after!.interactionCount, 0)
  })

  it('survives every junk value as an Echo id', async () => {
    const junk = [null, undefined, 0, '', {}, [], true, NaN]
    for (const value of junk) {
      const result = await service.interact(bob, WORLD, value, 'heart')
      assert.ok(!result.ok)
    }
  })

  it('accepts junk note and emote values without storing them', async () => {
    const junk = [null, undefined, 0, {}, [], true, NaN]
    for (const value of junk) {
      clock += LIMITS.echoCooldownMs + 1
      const result = await service.createEcho(alice, WORLD, { note: value, emote: value })
      assert.ok(result.ok)
      assert.strictEqual(result.value.note, '')
      assert.strictEqual(result.value.emote, 'rest', 'an unknown emote falls back, never stored raw')
    }
  })

  it('a very long note cannot bloat a record', () => {
    const enormous = 'x'.repeat(100_000)
    assert.strictEqual(sanitiseNote(enormous).length, LIMITS.noteMaxLength)
  })

  it('a name is length-capped', () => {
    const identity = normaliseIdentity({ id: '0xabc', name: 'y'.repeat(500) })
    assert.ok(identity)
    assert.strictEqual(identity!.name.length, 40)
  })

  it('an Echo always has a finite position the client can render', async () => {
    const echo = await anEcho(alice)
    assert.ok(Number.isFinite(echo.position.x))
    assert.ok(Number.isFinite(echo.position.y))
    assert.ok(Number.isFinite(echo.position.z))
  })

  it('interactionsByType is always an object, never undefined', async () => {
    const echo = await anEcho(alice)
    assert.strictEqual(typeof echo.interactionsByType, 'object')
    assert.ok(echo.interactionsByType !== null)
  })
})

// === World isolation under stress =============================================

describe('World isolation (audit)', () => {
  it('concurrent activity in two Worlds does not cross over', async () => {
    await Promise.all([
      service.createEcho(alice, WORLD, { note: 'here' }),
      service.createEcho(alice, OTHER_WORLD, { note: 'there' })
    ])

    const here = await service.listEchoes(WORLD)
    const there = await service.listEchoes(OTHER_WORLD)
    assert.strictEqual(here.length, 1)
    assert.strictEqual(there.length, 1)
    assert.strictEqual(here[0].note, 'here')
    assert.strictEqual(there[0].note, 'there')
  })

  it('a Bond in one World does not block the same pair in another', async () => {
    assert.ok((await service.createBond(alice, bob, WORLD)).ok)
    assert.ok((await service.createBond(alice, bob, OTHER_WORLD)).ok)
  })

  it('return activity is scoped per World', async () => {
    const echo = await anEcho(alice, WORLD)
    await service.markActivityRead(alice, WORLD)
    await service.markActivityRead(alice, OTHER_WORLD)
    clock += 1000
    await service.interact(bob, WORLD, echo.id, 'heart')

    assert.strictEqual((await service.getReturnActivity(alice, WORLD)).hearts, 1)
    assert.strictEqual((await service.getReturnActivity(alice, OTHER_WORLD)).isEmpty, true)
  })

  it('vitality is scoped per World', async () => {
    await anEcho(alice, WORLD)
    assert.strictEqual((await service.getVitality(WORLD, 0)).activeEchoes, 1)
    assert.strictEqual((await service.getVitality(OTHER_WORLD, 0)).activeEchoes, 0)
  })
})

// === Restart behaviour ========================================================

describe('server restart behaviour (documented limitation)', () => {
  it('a fresh in-memory store starts empty — history does not survive a restart', async () => {
    await anEcho(alice)
    await service.createBond(alice, bob, WORLD)
    assert.strictEqual((await service.listEchoes(WORLD)).length, 1)
    assert.strictEqual((await service.listBonds(WORLD)).length, 1)

    // A restart is a brand new MemoryPersistence. This is the known limitation, and it is
    // asserted here so it is a documented property rather than a surprise on demo day.
    const afterRestart = new LingerService(new MemoryPersistence(), () => clock)
    assert.strictEqual((await afterRestart.listEchoes(WORLD)).length, 0)
    assert.strictEqual((await afterRestart.listBonds(WORLD)).length, 0)
  })

  it('Genesis Echoes are restored on restart, so the World is never blank', async () => {
    const fresh = new MemoryPersistence()
    const rebuilt = new LingerService(fresh, () => clock)
    await seedGenesisEchoes(fresh, WORLD, clock)

    const echoes = await rebuilt.listEchoes(WORLD)
    assert.strictEqual(echoes.length, 5)
    assert.ok(echoes.every((e) => e.isGenesis))
  })

  it('Bond numbering restarts from 1 with an empty store', async () => {
    const fresh = new LingerService(new MemoryPersistence(), () => clock)
    const bond = await fresh.createBond(alice, bob, WORLD)
    assert.ok(bond.ok)
    assert.strictEqual(bond.value.number, 1)
  })
})

// === Idempotence and identity =================================================

describe('identity is always server-derived', () => {
  it('address casing never creates a second person', async () => {
    const echo = await anEcho({ id: '0xAbCdEf', name: 'Mixed', hasWallet: true })
    assert.strictEqual(echo.owner.id, '0xabcdef')

    // The same human, typed differently, still trips their own cooldown.
    const again = await service.createEcho(
      { id: '0XABCDEF', name: 'Mixed', hasWallet: true },
      WORLD,
      {}
    )
    assert.strictEqual(errorOf(again), 'RATE_LIMITED')
  })

  it('self-interaction is refused regardless of casing', async () => {
    const echo = await anEcho({ id: '0xAAA', name: 'A', hasWallet: true })
    const result = await service.interact({ id: '0xaaa', name: 'A', hasWallet: true }, WORLD, echo.id, 'heart')
    assert.strictEqual(errorOf(result), 'SELF_INTERACTION')
  })

  it('the pair key is order-independent and case-normalised by the caller', () => {
    assert.strictEqual(bondPairKey('0xa', '0xb'), bondPairKey('0xb', '0xa'))
  })

  it('a guest without a wallet can still take part', async () => {
    const guest: Identity = { id: 'guest:session-1', name: 'Visitor', hasWallet: false }
    const echo = await service.createEcho(guest, WORLD, { note: 'passing through' })
    assert.ok(echo.ok)
    assert.strictEqual(echo.value.owner.hasWallet, false)
  })
})
