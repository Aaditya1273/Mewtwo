import { Client, Room } from 'colyseus.js'
import { isPreviewMode } from '~system/EnvironmentApi'
import * as utils from '@dcl-sdk/utils'
import { NETWORK } from '../config'
import { Bond, Echo, Identity, InteractionType, LivePresence, ReturnActivity } from '../types/linger'
import { decodeActivity, decodeBond, decodeBonds, decodeEcho, decodeEchoes, decodeIdentity } from './decode'
import { requestJoinTicket } from './signedAuth'

/**
 * Colyseus client for LINGER.
 *
 * Structure follows the donor project's NetworkManager (Apache-2.0, see
 * THIRD_PARTY_NOTICES.md), with three corrections:
 *
 *  1. Reconnect attempts are bounded and backed off. The donor reconnected in an
 *     unbounded loop.
 *  2. Listeners are registered exactly once against the client, not re-registered on every
 *     reconnect. The donor accumulated a new handler set per reconnect.
 *  3. Nothing is sent per frame. Presence is throttled by the caller; everything else is
 *     an event.
 */

export interface LingerHandlers {
  onWelcome: (payload: {
    identity: Identity
    worldId: string
    realmId: string
    /** Whether the server offers Bond preservation. Off by default. */
    preservationEnabled: boolean
    echoes: Echo[]
    bonds: Bond[]
    activity: ReturnActivity
  }) => void
  onEchoCreated: (echo: Echo) => void
  onEchoAdded: (echo: Echo) => void
  onEchoUpdated: (echo: Echo) => void
  onEchoRejected: (error: string, message: string) => void
  onInteractionRejected: (echoId: string, error: string, message: string) => void
  onBondCreated: (bond: Bond) => void
  onBondAdded: (bond: Bond) => void
  onPreservationUpdated: (bondId: string, status: string, consented: string[]) => void
  onPreservationRejected: (bondId: string, error: string, message: string) => void
  onPresence: (players: LivePresence[], intensity: number) => void
  onConnectionChange: (connected: boolean) => void
}

let room: Room | undefined
let handlers: LingerHandlers
let attempts = 0
let connected = false
/** Display name offered as a label with the ticket request. Never used as identity. */
let displayName = 'Someone'
/** True when the server verified a wallet signature for this session. */
let authenticated = false

export function setDisplayName(name: string) {
  displayName = name || 'Someone'
}

export function isAuthenticated(): boolean {
  return authenticated
}

let sessionId = ''

/** Colyseus session id. Shown in the diagnostic so two devices can be told apart. */
export function getSessionId(): string {
  return sessionId
}

/** Realm label, reported so two demo devices can confirm they share a live room. */
let currentRealm = 'unknown'

export function setRealm(realm: string) {
  currentRealm = realm || 'unknown'
}

export function getRealm(): string {
  return currentRealm
}

async function endpoint(): Promise<string> {
  try {
    const preview = await isPreviewMode({})
    return preview.isPreview ? NETWORK.localWss : NETWORK.productionWss
  } catch {
    return NETWORK.productionWss
  }
}

/** Read a string off an untrusted payload without throwing. */
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function setConnected(next: boolean) {
  if (connected === next) return
  connected = next
  handlers.onConnectionChange(next)
}

/**
 * Rebuild a plain snapshot of live players from room state.
 *
 * Colyseus 0.14 offers per-field change callbacks, but with a Hearth-sized group a whole
 * snapshot is a handful of objects and it keeps the consumer free of schema types.
 */
function snapshotPresence(state: any): LivePresence[] {
  const players: LivePresence[] = []
  if (!state?.players) return players

  state.players.forEach((player: any, sessionId: string) => {
    const x = Number(player?.x)
    const z = Number(player?.z)
    // A player mid-sync can have no position yet. Skip them rather than placing them at
    // the origin, where they would falsely read as standing next to the entry portal.
    if (!Number.isFinite(x) || !Number.isFinite(z)) return

    const wavedAt = Number(player?.wavedAt)

    players.push({
      sessionId,
      identity: {
        id: typeof player?.identityId === 'string' ? player.identityId : '',
        name: (typeof player?.name === 'string' && player.name) || 'Someone',
        hasWallet: player?.hasWallet === true
      },
      position: { x, y: 0, z },
      wavedAt: Number.isFinite(wavedAt) ? wavedAt : 0
    })
  })

  return players
}

function attachRoomListeners(joined: Room, ownSessionId: string) {
  joined.onMessage('welcome', (payload: any) =>
    handlers.onWelcome({
      identity: decodeIdentity(payload?.identity),
      worldId: typeof payload?.worldId === 'string' ? payload.worldId : '',
      realmId: typeof payload?.realmId === 'string' ? payload.realmId : '',
      // Defaults to false: an old or partial payload must never light up blockchain UI.
      preservationEnabled: payload?.preservationEnabled === true,
      echoes: decodeEchoes(payload?.echoes),
      bonds: decodeBonds(payload?.bonds),
      activity: decodeActivity(payload?.activity)
    })
  )

  joined.onMessage('echoCreated', (payload: any) => {
    const echo = decodeEcho(payload?.echo)
    if (echo) handlers.onEchoCreated(echo)
  })
  joined.onMessage('echoAdded', (payload: any) => {
    const echo = decodeEcho(payload?.echo)
    if (echo) handlers.onEchoAdded(echo)
  })
  joined.onMessage('echoUpdated', (payload: any) => {
    const echo = decodeEcho(payload?.echo)
    if (echo) handlers.onEchoUpdated(echo)
  })

  joined.onMessage('echoRejected', (payload: any) =>
    handlers.onEchoRejected(text(payload?.error, 'INVALID'), text(payload?.message, 'That did not work.'))
  )
  joined.onMessage('interactionRejected', (payload: any) =>
    handlers.onInteractionRejected(
      text(payload?.echoId, ''),
      text(payload?.error, 'INVALID'),
      text(payload?.message, 'That did not work.')
    )
  )

  joined.onMessage('bondCreated', (payload: any) => {
    const bond = decodeBond(payload?.bond)
    if (bond) handlers.onBondCreated(bond)
  })
  joined.onMessage('bondAdded', (payload: any) => {
    const bond = decodeBond(payload?.bond)
    if (bond) handlers.onBondAdded(bond)
  })

  joined.onMessage('preservationUpdated', (payload: any) => {
    const bondId = text(payload?.bondId, '')
    if (!bondId) return
    const consented = Array.isArray(payload?.state?.consented)
      ? payload.state.consented.filter((id: unknown) => typeof id === 'string')
      : []
    handlers.onPreservationUpdated(bondId, text(payload?.state?.status, 'NOT_PRESERVED'), consented)
  })

  joined.onMessage('preservationRejected', (payload: any) =>
    handlers.onPreservationRejected(
      text(payload?.bondId, ''),
      text(payload?.error, 'INVALID'),
      text(payload?.message, 'That did not work.')
    )
  )

  joined.onStateChange((state: any) => {
    // Exclude ourselves: the local player is rendered by the Decentraland client already.
    const others = snapshotPresence(state).filter((p) => p.sessionId !== ownSessionId)
    const intensity = Number(state?.intensity)
    handlers.onPresence(others, Number.isFinite(intensity) ? intensity : 0)
  })

  joined.onLeave(() => {
    setConnected(false)
    room = undefined
    scheduleReconnect()
  })

  joined.onError(() => setConnected(false))
}

function scheduleReconnect() {
  if (attempts >= NETWORK.maxReconnectAttempts) {
    console.log('[linger] giving up reconnecting; the World stays browsable offline')
    return
  }
  attempts++
  // Linear backoff. The World remains fully explorable while disconnected, so there is no
  // reason to hammer the server.
  utils.timers.setTimeout(() => void connect(), NETWORK.reconnectBackoffMs * attempts)
}

/** Connect, or reconnect. Safe to call repeatedly — a live room short-circuits. */
export async function connect(): Promise<boolean> {
  if (room) return true

  try {
    const wsEndpoint = await endpoint()

    // Exchange a real Decentraland signature for a single-use join ticket. A WebSocket
    // upgrade cannot carry the signature headers, so the signature is verified over HTTP
    // and only the resulting ticket crosses the handshake.
    const auth = await requestJoinTicket(wsEndpoint, displayName)
    authenticated = auth?.authenticated === true

    const client = new Client(wsEndpoint)
    const joined = await client.joinOrCreate(NETWORK.roomName, {
      ticket: auth?.ticket,
      realm: currentRealm,
      // A label only. The server ignores it for identity and derives the address from
      // the signature; without a signature it assigns a session-scoped guest id.
      userData: { displayName }
    })

    room = joined
    sessionId = joined.sessionId
    attempts = 0
    attachRoomListeners(joined, joined.sessionId)
    setConnected(true)
    return true
  } catch (error) {
    console.log('[linger] connection failed', error)
    setConnected(false)
    scheduleReconnect()
    return false
  }
}

export function initNetwork(next: LingerHandlers) {
  handlers = next
}

export function isConnected(): boolean {
  return connected
}

// === Outbound =================================================================

function send(type: string, payload?: any) {
  if (!room) return false
  try {
    room.send(type, payload)
    return true
  } catch (error) {
    console.log('[linger] send failed', type, error)
    return false
  }
}

/** Throttled by the presence system — never call this per frame. */
export function sendPresence(x: number, z: number, atHearth: boolean) {
  return send('presence', { x, z, atHearth })
}

export function sendWave() {
  return send('wave')
}

export function sendCreateEcho(note: string, emote: string) {
  return send('createEcho', { note, emote })
}

export function sendInteraction(echoId: string, type: InteractionType) {
  return send('interact', { echoId, type })
}

/** Confirms the return panel was actually shown, so the watermark only then advances. */
export function sendActivityRead() {
  return send('activityRead')
}

/** Consent to preserving a Bond. Both participants must send this. */
export function sendPreserveBond(bondId: string) {
  return send('preserveBond', { bondId })
}
