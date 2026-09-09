import assert from 'assert'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import { Client, Room } from 'colyseus.js'
import { joinSigned, personaWallet } from './support/authClient'

/**
 * The judge journey, driven over the real Colyseus protocol.
 *
 * Boots the actual built server as a child process and connects two real clients — the
 * same `colyseus.js` version and the same messages the Decentraland scene uses. This is
 * the test that proves the product loop works end to end, not just that the rules do.
 *
 *   enter alone -> see Genesis Echoes -> interact -> linger -> leave a real Echo
 *   -> second player arrives -> sees it live -> interacts
 *   -> first player returns -> "While You Were Away"
 *   -> both wave, stay together -> permanent Bond
 *
 * Run with `npm run test:journey`. Kept out of the unit suite because it takes seconds
 * and binds a port.
 */

const PORT = 2591
const ENDPOINT = `ws://localhost:${PORT}`
const ROOM = 'linger_world'

/** Bond timings are compressed so the whole journey runs in a few seconds. */
const BOND_TOGETHER_MS = 2000

let server: ChildProcess | undefined

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Wait for a specific message, or fail with a useful timeout. */
function expectMessage<T = any>(room: Room, type: string, timeoutMs = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${type}"`)),
      timeoutMs
    )
    room.onMessage(type, (payload: any) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

async function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, '..', '..', '..', 'lib', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      LINGER_WORLD_URN: 'linger.test',
      LINGER_PERSISTENCE: 'memory',
      LINGER_SEED_GENESIS: 'true',
      LINGER_BOND_MIN_TOGETHER_MS: String(BOND_TOGETHER_MS),
      LINGER_BOND_WAVE_WINDOW_MS: '60000',
      LINGER_ECHO_COOLDOWN_MS: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 20000)
    server!.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().indexOf('Listening on') !== -1) {
        clearTimeout(timer)
        resolve()
      }
    })
    server!.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))
  })

  await ready
  // Colyseus prints "Listening" a beat before the socket accepts.
  await wait(400)
}

function stopServer() {
  if (server && !server.killed) server.kill('SIGTERM')
}

/**
 * Join as a signed-in persona.
 *
 * `seed` maps to a stable wallet, so the same persona keeps one verified address across
 * sessions. Unsigned clients are `guest:<sessionId>` — a new identity each time — so any
 * test of returning must sign, exactly as a real returning player must.
 */
async function join(name: string, seed: string): Promise<Room> {
  return joinSigned(ENDPOINT, ROOM, personaWallet(seed), name)
}

function step(n: number, text: string) {
  console.log(`  ${n}. ${text}`)
}

async function run() {
  console.log('\nLINGER — judge journey over the live protocol\n')
  await startServer()

  // --- 1. A judge enters an empty World, alone. --------------------------------
  const alice = await join('Aaditya', '0xAAAA1111')
  const aliceWelcome = await expectMessage<any>(alice, 'welcome')

  assert.strictEqual(aliceWelcome.echoes.length, 5, 'expected the five Genesis Echoes')
  assert.ok(
    aliceWelcome.echoes.every((e: any) => e.isGenesis),
    'a World nobody has visited must contain only Genesis Echoes'
  )
  assert.ok(
    aliceWelcome.echoes.every((e: any) => e.owner.name === 'LINGER Founding Visitor'),
    'Genesis Echoes must identify themselves'
  )
  assert.strictEqual(aliceWelcome.activity.isEmpty, true, 'a first visit has no return activity')
  step(1, 'enters alone and finds 5 labelled Genesis Echoes')

  // --- 2. She interacts with one. ----------------------------------------------
  const genesis = aliceWelcome.echoes[0]
  const genesisUpdated = expectMessage<any>(alice, 'echoUpdated')
  alice.send('interact', { echoId: genesis.id, type: 'heart' })
  const hearted = await genesisUpdated
  assert.strictEqual(hearted.echo.interactionCount, 1)
  step(2, 'hearts a Genesis Echo and sees it respond')

  // --- 3. She lingers and leaves a real Echo. ----------------------------------
  const created = expectMessage<any>(alice, 'echoCreated')
  alice.send('createEcho', { note: 'I was the first one here.', emote: 'rest' })
  const aliceEcho = (await created).echo

  assert.strictEqual(
    aliceEcho.owner.id,
    personaWallet('0xAAAA1111').address.toLowerCase(),
    'the Echo owner is the address that actually signed, not anything the client sent'
  )
  assert.strictEqual(aliceEcho.isGenesis, false)
  assert.strictEqual(aliceEcho.note, 'I was the first one here.')
  assert.ok(aliceEcho.expiresAt > Date.now(), 'a visitor Echo expires in 24 hours')
  step(3, 'lingers and leaves a real Echo')

  // --- 4. She leaves. ----------------------------------------------------------
  await alice.leave()
  await wait(300)
  step(4, 'leaves the World')

  // --- 5. A second player arrives and finds her Echo. --------------------------
  const bob = await join('Bob', '0xBBBB2222')
  const bobWelcome = await expectMessage<any>(bob, 'welcome')

  assert.strictEqual(bobWelcome.echoes.length, 6, 'Genesis set plus one real Echo')
  assert.strictEqual(bobWelcome.echoes[0].id, aliceEcho.id, 'the real Echo sorts first')
  assert.strictEqual(bobWelcome.echoes[0].owner.name, 'Aaditya')
  step(5, 'a second player arrives and finds her Echo at the top')

  // --- 6. He interacts with it. ------------------------------------------------
  const bobInteracted = expectMessage<any>(bob, 'echoUpdated')
  bob.send('interact', { echoId: aliceEcho.id, type: 'heart' })
  assert.strictEqual((await bobInteracted).echo.interactionCount, 1)

  const bobHighfived = expectMessage<any>(bob, 'echoUpdated')
  bob.send('interact', { echoId: aliceEcho.id, type: 'highfive' })
  assert.strictEqual((await bobHighfived).echo.interactionCount, 2)
  step(6, 'hearts and high-fives her Echo')

  // --- 7. She returns and is told. ---------------------------------------------
  const aliceAgain = await join('Aaditya', '0xAAAA1111')
  const returnWelcome = await expectMessage<any>(aliceAgain, 'welcome')

  assert.strictEqual(returnWelcome.activity.isEmpty, false, 'the World remembered her')
  assert.strictEqual(returnWelcome.activity.hearts, 1)
  assert.strictEqual(returnWelcome.activity.highfives, 1)
  step(7, 'she returns to "While You Were Away": 1 heart, 1 high-five')

  // Confirm the panel was shown, then verify the same activity is not replayed.
  aliceAgain.send('activityRead')
  await wait(400)

  const aliceThird = await join('Aaditya', '0xAAAA1111')
  const thirdWelcome = await expectMessage<any>(aliceThird, 'welcome')
  assert.strictEqual(thirdWelcome.activity.isEmpty, true, 'activity must not repeat')
  await aliceThird.leave()
  step(8, 'the same activity is never shown twice')

  // --- 8. Two real players meet, wave, and stay together. ----------------------
  const bondForAlice = expectMessage<any>(aliceAgain, 'bondCreated', 20000)
  const bondForBob = expectMessage<any>(bob, 'bondCreated', 20000)

  // Both stand at the Hearth, together.
  aliceAgain.send('presence', { x: 24, z: 24, atHearth: true })
  bob.send('presence', { x: 25, z: 24, atHearth: true })
  await wait(300)

  // Reciprocal, deliberate gesture from each.
  aliceAgain.send('wave', {})
  await wait(200)
  bob.send('wave', {})
  step(9, 'both wave at each other')

  // They remain together past the qualifying duration.
  const bond = (await bondForAlice).bond
  const bondSeenByBob = (await bondForBob).bond

  assert.strictEqual(bond.id, bondSeenByBob.id, 'both players see the same Bond')
  assert.strictEqual(bond.number, 1, 'Bond #0001')
  const names = [bond.playerA.name, bond.playerB.name].sort()
  assert.deepStrictEqual(names, ['Aaditya', 'Bob'])
  step(10, `Bond #${String(bond.number).padStart(4, '0')} forms: ${bond.playerA.name} + ${bond.playerB.name}`)

  // --- 9. The Bond outlives the session. ---------------------------------------
  await aliceAgain.leave()
  await bob.leave()
  await wait(400)

  const carol = await join('Carol', '0xCCCC3333')
  const carolWelcome = await expectMessage<any>(carol, 'welcome')
  assert.strictEqual(carolWelcome.bonds.length, 1, 'the Bond is still standing')
  assert.strictEqual(carolWelcome.bonds[0].id, bond.id)
  await carol.leave()
  step(11, 'a later visitor still finds the Bond stone')

  console.log('\n  the World remembered every one of them.\n')
}

run()
  .then(() => {
    stopServer()
    console.log('journey: PASS\n')
    process.exit(0)
  })
  .catch((error) => {
    stopServer()
    console.error('\njourney: FAIL\n', error)
    process.exit(1)
  })
