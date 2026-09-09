import { Authenticator } from '@dcl/crypto'
import { Wallet } from 'ethers'
import { Client, Room } from 'colyseus.js'

/**
 * Test client that authenticates the way the real scene does.
 *
 * Signs a request with a real wallet, exchanges it at `POST /api/auth/ticket` for a
 * single-use join ticket, then joins Colyseus with that ticket. This is the production
 * path end to end — signature, verification, ticket, handshake — not a shortcut.
 *
 * It also matters for correctness of the tests themselves: without a verified signature a
 * client is a `guest:<sessionId>`, which is a NEW identity every session. Cross-session
 * behaviour like "While You Were Away" only exists for a signed identity, so any test of
 * returning must sign.
 */

const TICKET_PATH = '/api/auth/ticket'

export interface SignedTestClient {
  room: Room
  address: string
  wallet: Wallet
}

/** Produce genuine signed-fetch headers, as the Decentraland runtime would. */
export async function signHeaders(
  wallet: Wallet,
  method: string,
  path: string,
  metadata: Record<string, unknown> = {}
): Promise<Record<string, string>> {
  const timestamp = Date.now()
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
    'Content-Type': 'application/json',
    'x-identity-timestamp': String(timestamp),
    'x-identity-metadata': JSON.stringify(metadata)
  }
  chain.forEach((link, index) => {
    headers[`x-identity-auth-chain-${index}`] = JSON.stringify(link)
  })
  return headers
}

/** Exchange a real signature for a join ticket over HTTP. */
export async function fetchTicket(
  httpBase: string,
  wallet: Wallet,
  displayName: string
): Promise<string> {
  const headers = await signHeaders(wallet, 'post', TICKET_PATH)

  const response = await fetch(httpBase + TICKET_PATH, {
    method: 'POST',
    headers,
    body: JSON.stringify({ displayName })
  })

  if (!response.ok) {
    throw new Error(`ticket request failed: ${response.status} ${await response.text()}`)
  }

  const parsed: any = await response.json()
  const ticket = parsed?.data?.ticket
  if (typeof ticket !== 'string') throw new Error('no ticket in response')
  return ticket
}

/** Sign in and join, exactly as the scene does. */
export async function joinSigned(
  wsEndpoint: string,
  roomName: string,
  wallet: Wallet,
  displayName: string,
  realm = 'test-realm'
): Promise<Room> {
  const httpBase = wsEndpoint.replace(/^ws/, 'http')
  const ticket = await fetchTicket(httpBase, wallet, displayName)

  return new Client(wsEndpoint).joinOrCreate(roomName, {
    ticket,
    realm,
    userData: { displayName }
  })
}

/** A stable wallet per test persona, so "the same person returning" means what it says. */
export function personaWallet(seed: string): Wallet {
  // Deterministic 32-byte key from the seed, so a persona keeps one address across joins.
  let hex = ''
  for (let i = 0; i < 32; i++) {
    hex += ((seed.charCodeAt(i % seed.length) * (i + 7) + 13) % 256).toString(16).padStart(2, '0')
  }
  return new Wallet('0x' + hex)
}
