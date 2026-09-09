import { signedFetch } from '~system/SignedFetch'
import { NETWORK } from '../config'

/**
 * Obtain a signed join ticket.
 *
 * `signedFetch` is the Decentraland runtime's own signing primitive: it attaches the
 * player's auth chain to the request. The scene never sees or handles a private key, and
 * cannot choose whose signature is attached.
 *
 * The server verifies that signature and returns a single-use ticket, which is what
 * crosses the Colyseus handshake — a WebSocket upgrade cannot carry the signature headers.
 *
 * Failing to get a ticket is not fatal. The player joins as a guest, which is a
 * session-scoped identity that cannot impersonate any wallet.
 */

/** The path the server verifies against. Must match `TICKET_PATH` on the server exactly. */
const TICKET_PATH = '/api/auth/ticket'

/** Derive the HTTP origin from the configured WebSocket endpoint. */
export function httpBaseFrom(wsEndpoint: string): string {
  if (wsEndpoint.indexOf('wss://') === 0) return 'https://' + wsEndpoint.slice(6)
  if (wsEndpoint.indexOf('ws://') === 0) return 'http://' + wsEndpoint.slice(5)
  return wsEndpoint
}

export interface TicketResult {
  ticket: string
  /** True when the server verified a wallet signature. */
  authenticated: boolean
  name: string
}

export async function requestJoinTicket(wsEndpoint: string, displayName: string): Promise<TicketResult | null> {
  const url = httpBaseFrom(wsEndpoint) + TICKET_PATH

  try {
    const response = await signedFetch({
      url,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only a display label. The address comes from the signature, never from here.
        body: JSON.stringify({ displayName })
      }
    })

    if (!response.ok) {
      console.log(`[linger] ticket request refused (${response.status})`)
      return null
    }

    const parsed = JSON.parse(response.body)
    const ticket = parsed?.data?.ticket
    if (typeof ticket !== 'string' || !ticket) return null

    return {
      ticket,
      authenticated: parsed?.data?.identity?.hasWallet === true,
      name: typeof parsed?.data?.identity?.name === 'string' ? parsed.data.identity.name : ''
    }
  } catch (error) {
    // No signature available (a guest client), the server is down, or the scene lacks the
    // USE_FETCH permission. All three mean the same thing here: join as a guest.
    console.log('[linger] could not obtain a signed ticket', error)
    return null
  }
}

export function defaultEndpointHttpBase(isPreview: boolean): string {
  return httpBaseFrom(isPreview ? NETWORK.localWss : NETWORK.productionWss)
}
