import assert from 'assert'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import { Client, Room } from 'colyseus.js'
import { joinSigned, personaWallet } from './support/authClient'

/**
 * Live resilience checks.
 *
 * Covers the two hardening questions that cannot be answered by a unit test, because they
 * are about a real socket and a real process:
 *
 *   1. what a client sees when the server restarts under it
 *   2. whether a reconnecting client is given correct, current state
 *   3. whether a player who disconnects mid-qualification can still trigger a Bond
 *
 * Run with `npm run test:resilience`.
 */

const PORT = 2593
const ENDPOINT = `ws://localhost:${PORT}`
const ROOM = 'linger_world'
const BOND_TOGETHER_MS = 1500

const SERVER_ENTRY = path.join(__dirname, '..', '..', '..', 'lib', 'index.js')

let server: ChildProcess | undefined

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function expectMessage<T = any>(room: Room, type: string, timeoutMs = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${type}"`)), timeoutMs)
    room.onMessage(type, (payload: any) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

/** Resolves true if `type` arrives before the window closes, false otherwise. */
function expectNoMessage(room: Room, type: string, windowMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let seen = false
    room.onMessage(type, () => {
      seen = true
    })
    setTimeout(() => resolve(seen), windowMs)
  })
}

async function startServer(): Promise<void> {
  server = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      LINGER_WORLD_URN: 'linger.resilience',
      LINGER_PERSISTENCE: 'memory',
      LINGER_SEED_GENESIS: 'true',
      LINGER_BOND_MIN_TOGETHER_MS: String(BOND_TOGETHER_MS),
      LINGER_BOND_WAVE_WINDOW_MS: '60000',
      LINGER_ECHO_COOLDOWN_MS: '500'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 20000)
    server!.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().indexOf('Listening on') !== -1) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  await wait(400)
}

async function stopServer(): Promise<void> {
  if (!server || server.killed) return
  const done = new Promise<void>((resolve) => server!.once('exit', () => resolve()))
  server.kill('SIGKILL')
  await done
  await wait(300)
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

function step(text: string) {
  console.log(`  · ${text}`)
}

async function run() {
  console.log('\nLINGER — live resilience checks\n')

  // ===== 1. Server restart ====================================================
  console.log(' server restart')
  await startServer()

  const alice = await join('Aaditya', '0xAAAA1111')
  const firstWelcome = await expectMessage<any>(alice, 'welcome')
  assert.strictEqual(firstWelcome.echoes.length, 5, 'Genesis set on a cold World')

  const created = expectMessage<any>(alice, 'echoCreated')
  alice.send('createEcho', { note: 'before the restart', emote: 'rest' })
  const aliceEcho = (await created).echo
  step('client left an Echo')

  await stopServer()
  step('server killed')

  await startServer()
  step('server restarted')

  // A client reconnecting after a restart must get a coherent World, not a crash.
  const aliceAgain = await join('Aaditya', '0xAAAA1111')
  const afterRestart = await expectMessage<any>(aliceAgain, 'welcome')

  assert.strictEqual(afterRestart.echoes.length, 5, 'only the re-seeded Genesis set survives')
  assert.ok(
    afterRestart.echoes.every((e: any) => e.isGenesis),
    'in-memory history does not survive a restart — this is the documented limitation'
  )
  assert.ok(
    !afterRestart.echoes.some((e: any) => e.id === aliceEcho.id),
    "the pre-restart Echo is genuinely gone, not a stale copy"
  )
  assert.strictEqual(afterRestart.activity.isEmpty, true)
  step('client reconnected to a coherent, re-seeded World (history lost, as documented)')

  // The client must be able to leave a new Echo — not be locked out holding a dead id.
  const recreated = expectMessage<any>(aliceAgain, 'echoCreated')
  aliceAgain.send('createEcho', { note: 'after the restart', emote: 'rest' })
  const newEcho = (await recreated).echo
  assert.notStrictEqual(newEcho.id, aliceEcho.id)
  step('client can linger again after the restart')

  // ===== 2. Reconnect gets current state ======================================
  console.log('\n reconnect state')

  const bob = await join('Bob', '0xBBBB2222')
  await expectMessage<any>(bob, 'welcome')

  const bobHearted = expectMessage<any>(bob, 'echoUpdated')
  bob.send('interact', { echoId: newEcho.id, type: 'heart' })
  await bobHearted

  // A fresh join must reflect everything that happened while away.
  const carol = await join('Carol', '0xCCCC3333')
  const carolWelcome = await expectMessage<any>(carol, 'welcome')

  const seen = carolWelcome.echoes.find((e: any) => e.id === newEcho.id)
  assert.ok(seen, 'a newly joined client sees the current Echo set')
  assert.strictEqual(seen.interactionCount, 1, 'with current interaction counts')
  assert.strictEqual(seen.interactionsByType.heart, 1)
  step('a fresh join receives current Echo state, not a stale snapshot')

  await aliceAgain.leave()
  await wait(300)
  const aliceThird = await join('Aaditya', '0xAAAA1111')
  const returning = await expectMessage<any>(aliceThird, 'welcome')
  assert.strictEqual(returning.activity.hearts, 1, 'return activity survives a rejoin')
  step('return activity is correct on rejoin')

  await carol.leave()
  await aliceThird.leave()
  await wait(300)

  // ===== 3. Disconnect during Bond qualification ==============================
  console.log('\n disconnect during Bond qualification')

  const dana = await join('Dana', '0xDDDD4444')
  await expectMessage<any>(dana, 'welcome')
  const evan = await join('Evan', '0xEEEE5555')
  await expectMessage<any>(evan, 'welcome')

  // Both stand together and both wave — full qualification is under way.
  dana.send('presence', { x: 24, z: 24, atHearth: true })
  evan.send('presence', { x: 24.5, z: 24, atHearth: true })
  await wait(200)
  dana.send('wave', {})
  evan.send('wave', {})
  step('two players are together and both waved')

  // Evan drops out well before the qualifying duration elapses.
  await wait(300)
  await evan.leave()
  step('one player disconnects mid-qualification')

  const danaGotBond = await expectNoMessage(dana, 'bondCreated', BOND_TOGETHER_MS + 2500)
  assert.strictEqual(danaGotBond, false, 'a Bond must not form when one player left')
  step('no Bond formed — correct')

  // And the remaining player is not left in a broken state: a new partner still works.
  const frank = await join('Frank', '0xFFFF6666')
  await expectMessage<any>(frank, 'welcome')

  const bondForDana = expectMessage<any>(dana, 'bondCreated', 20000)
  dana.send('presence', { x: 24, z: 24, atHearth: true })
  frank.send('presence', { x: 24.5, z: 24, atHearth: true })
  await wait(200)
  dana.send('wave', {})
  frank.send('wave', {})

  const bond = (await bondForDana).bond
  assert.strictEqual(bond.number, 1, 'the abandoned attempt consumed no Bond number')
  const names = [bond.playerA.name, bond.playerB.name].sort()
  assert.deepStrictEqual(names, ['Dana', 'Frank'])
  step(`Bond #${String(bond.number).padStart(4, '0')} forms with a new partner`)

  await dana.leave()
  await frank.leave()
  await bob.leave()
  await wait(200)

  // ===== 4. Identity cannot be claimed ========================================
  console.log('\n identity')

  // The old hole: userData.publicKey was trusted at join. A client sending a victim's
  // address with no ticket must NOT be able to act as them.
  const impostorAddress = '0xvictim0000000000000000000000000000000001'
  const impostor = await new Client(ENDPOINT).joinOrCreate(ROOM, {
    realm: 'test-realm',
    userData: { publicKey: impostorAddress, displayName: 'Totally The Victim' }
  })
  const impostorWelcome = await expectMessage<any>(impostor, 'welcome')

  assert.notStrictEqual(
    impostorWelcome.identity.id,
    impostorAddress,
    'a claimed publicKey must not become the session identity'
  )
  assert.ok(
    impostorWelcome.identity.id.indexOf('guest:') === 0,
    `unsigned join must be a guest, got "${impostorWelcome.identity.id}"`
  )
  assert.strictEqual(impostorWelcome.authenticated, false)
  step('a claimed wallet address is ignored — the join becomes a guest')

  // And the Echo they leave is owned by the guest id, not the claimed wallet.
  const impostorEcho = expectMessage<any>(impostor, 'echoCreated')
  impostor.send('createEcho', { note: 'not really the victim', emote: 'rest' })
  const forged = (await impostorEcho).echo

  assert.notStrictEqual(forged.owner.id, impostorAddress)
  assert.ok(forged.owner.id.indexOf('guest:') === 0)
  assert.strictEqual(forged.owner.hasWallet, false)
  step('their Echo is owned by the guest id, not the claimed wallet')

  // A reserved Genesis identity claim is likewise refused.
  const genesisClaimer = await new Client(ENDPOINT).joinOrCreate(ROOM, {
    realm: 'test-realm',
    userData: { publicKey: 'linger:genesis:0', displayName: 'LINGER Founding Visitor' }
  })
  const genesisWelcome = await expectMessage<any>(genesisClaimer, 'welcome')
  assert.ok(genesisWelcome.identity.id.indexOf('guest:') === 0)
  assert.strictEqual(genesisWelcome.identity.hasWallet, false)
  step('a reserved Genesis identity claim is refused')

  // A bogus ticket is refused too, falling back to guest rather than being honoured.
  const badTicket = await new Client(ENDPOINT).joinOrCreate(ROOM, {
    realm: 'test-realm',
    ticket: 'f'.repeat(64),
    userData: { publicKey: impostorAddress, displayName: 'Forged Ticket' }
  })
  const badWelcome = await expectMessage<any>(badTicket, 'welcome')
  assert.ok(badWelcome.identity.id.indexOf('guest:') === 0)
  assert.strictEqual(badWelcome.authenticated, false)
  step('a forged ticket is refused')

  await impostor.leave()
  await genesisClaimer.leave()
  await badTicket.leave()
  await wait(200)

  console.log('\n  the World held together.\n')
}

run()
  .then(async () => {
    await stopServer()
    console.log('resilience: PASS\n')
    process.exit(0)
  })
  .catch(async (error) => {
    await stopServer()
    console.error('\nresilience: FAIL\n', error)
    process.exit(1)
  })
