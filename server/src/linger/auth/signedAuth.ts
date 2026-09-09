import verify from 'decentraland-crypto-middleware/lib/verify'
import { Identity } from '../domain/types'
import { isReservedIdentity } from '../domain/rules'
import { VALID_SIGNATURE_TOLERANCE_INTERVAL_MS } from '../../helpers/utils'

/**
 * Decentraland signed-request verification.
 *
 * A thin wrapper over `decentraland-crypto-middleware`'s own `verify()` — the same
 * primitive Decentraland's first-party services use. No signature checking is implemented
 * here; that would be exactly the "fake authentication system" to avoid.
 *
 * The scene calls `signedFetch` from `~system/SignedFetch`. The Decentraland runtime signs
 * the request with the player's identity and attaches:
 *
 *   x-identity-auth-chain-0..N   auth chain: wallet -> ephemeral key -> signature
 *   x-identity-timestamp         when it was signed
 *   x-identity-metadata          scene metadata, also covered by the signature
 *
 * `verify()` reconstructs the signed payload from (method, path, timestamp, metadata),
 * recovers the signer, walks the auth chain back to the owning wallet, and enforces the
 * timestamp window. It handles both personal-sign and EIP-1654 smart-contract wallets.
 *
 * REPLAY: the timestamp window bounds replay of the signature itself. A captured signature
 * is additionally worth only one ticket, and tickets are single-use — see `ticketStore.ts`.
 */

export interface VerifiedSigner {
  address: string
  metadata: Record<string, unknown>
}

export type SignedHeaders = Record<string, string | string[] | undefined>

/**
 * Verify a signed request. Returns null on any failure.
 *
 * `method` and `path` must be exactly what the client signed — they are part of the signed
 * payload, so a mismatch is indistinguishable from a forgery and is rejected.
 *
 * Never throws, and never guesses an identity. The caller decides what an unverified
 * request means.
 */
export async function verifySignedRequest(
  method: string,
  path: string,
  headers: SignedHeaders
): Promise<VerifiedSigner | null> {
  try {
    const result = await verify(method, path, headers, {
      expiration: VALID_SIGNATURE_TOLERANCE_INTERVAL_MS
    })

    const address = String(result.auth ?? '')
      .trim()
      .toLowerCase()
    if (!address) return null

    // A verified wallet address can never fall inside the namespace reserved for LINGER's
    // authored content. An address is hex so this cannot trigger today; it keeps the
    // invariant local rather than depending on that fact staying true.
    if (isReservedIdentity(address)) return null

    return { address, metadata: (result.authMetadata ?? {}) as Record<string, unknown> }
  } catch {
    // A failed verification is an ordinary outcome — unsigned, expired, or a bad chain —
    // not an exceptional one.
    return null
  }
}

/** Build a LINGER identity from a verified signer. */
export function identityForSigner(signer: VerifiedSigner, displayName: unknown): Identity {
  const name = typeof displayName === 'string' ? displayName.trim().slice(0, 40) : ''
  return {
    id: signer.address,
    name: name || 'Someone',
    hasWallet: true
  }
}
