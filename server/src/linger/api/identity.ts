import { Request } from 'express'
import { Identity } from '../domain/types'
import { normaliseIdentity } from '../domain/rules'

/**
 * Identity resolution for the REST surface.
 *
 * Two modes, and the insecure one is off unless explicitly enabled:
 *
 *  - **signature** (default): the request must carry a verified Decentraland identity,
 *    attached upstream by `decentraland-crypto-middleware` as `req.auth`. That middleware
 *    validates the auth chain, so the address cannot be forged.
 *
 *  - **dev**: reads `x-linger-identity`. Enabled only when `LINGER_ALLOW_DEV_AUTH=true`.
 *    This exists for local testing and demos. It trusts a header, so it must never be
 *    enabled on a deployment that holds real social history.
 */

export type IdentityResolver = (req: Request) => Identity | null

export function devAuthEnabled(): boolean {
  return process.env.LINGER_ALLOW_DEV_AUTH === 'true'
}

/** Reads the address the Decentraland signature middleware verified and attached. */
export function signatureIdentity(req: Request): Identity | null {
  const auth = (req as Request & { auth?: string }).auth
  if (typeof auth !== 'string' || !auth) return null

  const metadata = (req as Request & { authMetadata?: Record<string, unknown> }).authMetadata
  const name = typeof metadata?.displayName === 'string' ? metadata.displayName : 'Someone'

  return normaliseIdentity({ id: auth, name, hasWallet: true })
}

export function devIdentity(req: Request): Identity | null {
  if (!devAuthEnabled()) return null
  const header = req.header('x-linger-identity')
  if (!header) return null
  const name = req.header('x-linger-name') ?? 'Someone'
  return normaliseIdentity({ id: header, name, hasWallet: false })
}

/** Signature first, dev header only as an explicitly enabled fallback. */
export function resolveIdentity(req: Request): Identity | null {
  return signatureIdentity(req) ?? devIdentity(req)
}
