import { Client, Room } from 'colyseus.js'
import { isPreviewMode } from '~system/EnvironmentApi'
import * as utils from '@dcl-sdk/utils'
import { NETWORK } from '../config'
import { Bond, Echo, Identity, InteractionType, LivePresence, ReturnActivity } from '../types/linger'

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
  onPresence: (players: LivePresence[], intensity: number) => void
  onConnectionChange: (connected: boolean) => void
}

let room: Room | undefined
let handlers: LingerHandlers
let attempts = 0
let connected = false

async function endpoint(): Promise<string> {
  try {
    const preview = await isPreviewMode({})
    return preview.isPreview ? NETWORK.localWss : NETWORK.productionWss
  } catch {
    return NETWORK.productionWss
  }
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
    players.push({
      sessionId,
      identity: {
        id: player.identityId ?? '',
        name: player.name ?? 'Someone',
        hasWallet: !!player.hasWallet
      },
      position: { x: player.x ?? 0, y: 0, z: player.z ?? 0 },
      wavedAt: player.wavedAt ?? 0
    })
  })

  return players
}

function attachRoomListeners(joined: Room, ownSessionId: string) {
  joined.onMessage('welcome', (payload: any) => handlers.onWelcome(payload))
  joined.onMessage('echoCreated', (payload: any) => handlers.onEchoCreated(payload.echo))
  joined.onMessage('echoAdded', (payload: any) => handlers.onEchoAdded(payload.echo))
  joined.onMessage('echoUpdated', (payload: any) => handlers.onEchoUpdated(payload.echo))
  joined.onMessage('echoRejected', (payload: any) =>
    handlers.onEchoRejected(payload.error, payload.message)
  )
  joined.onMessage('interactionRejected', (payload: any) =>
    handlers.onInteractionRejected(payload.echoId, payload.error, payload.message)
  )
  joined.onMessage('bondCreated', (payload: any) => handlers.onBondCreated(payload.bond))
  joined.onMessage('bondAdded', (payload: any) => handlers.onBondAdded(payload.bond))

  joined.onStateChange((state: any) => {
    // Exclude ourselves: the local player is rendered by the Decentraland client already.
    const others = snapshotPresence(state).filter((p) => p.sessionId !== ownSessionId)
    handlers.onPresence(others, state?.intensity ?? 0)
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
    const client = new Client(await endpoint())
    const joined = await client.joinOrCreate(NETWORK.roomName, {})

    room = joined
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
