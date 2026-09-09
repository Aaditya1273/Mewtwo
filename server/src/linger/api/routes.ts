import { Router, Request, Response } from 'express'
import { LingerService } from '../service'
import { config } from '../config'
import { Identity, LingerError, Result, isFailure } from '../domain/types'

/**
 * REST surface over the same LingerService the Colyseus room uses.
 *
 * The scene itself talks Colyseus, not HTTP — this exists so the product rules can be
 * exercised, demonstrated and integration-tested without a Decentraland client, and so a
 * future World can read LINGER's social history without joining the room.
 *
 * AUTHENTICATION: identity comes from `resolveIdentity`, which is injected. In production
 * that is the Decentraland signature middleware in `helpers/security`. There is no code
 * path that reads an owner or actor id out of a request body.
 */

export type IdentityResolver = (req: Request) => Identity | null

const STATUS: Record<LingerError, number> = {
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  EXPIRED: 410,
  FORBIDDEN: 403,
  INVALID: 400,
  DUPLICATE: 409,
  SELF_INTERACTION: 409
}

function send<T>(res: Response, result: Result<T>) {
  if (isFailure(result)) {
    res.status(STATUS[result.error] ?? 400).json({
      ok: false,
      error: result.error,
      message: result.message
    })
    return
  }
  res.status(200).json({ ok: true, data: result.value })
}

/** Wrap an async handler so a rejected promise becomes a 500 instead of an unhandled crash. */
function guard(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error) => {
      console.error('[linger:api]', error)
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL' })
    })
  }
}

export function createLingerRouter(
  service: LingerService,
  resolveIdentity: IdentityResolver
): Router {
  const router = Router()

  const scope = () => ({ worldId: config.worldId, realmId: 'rest' })

  /** Require an authenticated identity, or answer 401. */
  function identityOr401(req: Request, res: Response): Identity | null {
    const identity = resolveIdentity(req)
    if (!identity) {
      res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' })
      return null
    }
    return identity
  }

  // --- Echoes ------------------------------------------------------------------

  router.get(
    '/echoes',
    guard(async (_req, res) => {
      res.json({ ok: true, data: await service.listEchoes(scope()) })
    })
  )

  router.post(
    '/echo',
    guard(async (req, res) => {
      const identity = identityOr401(req, res)
      if (!identity) return
      // Only `note` and `emote` are read. Owner, position, timestamps and expiry are the
      // server's to decide.
      send(res, await service.createEcho(identity, scope(), {
        note: req.body?.note,
        emote: req.body?.emote
      }))
    })
  )

  router.post(
    '/echo/:id/interaction',
    guard(async (req, res) => {
      const identity = identityOr401(req, res)
      if (!identity) return
      send(res, await service.interact(identity, scope(), req.params.id, req.body?.type))
    })
  )

  // --- Return activity ---------------------------------------------------------

  router.get(
    '/me/activity',
    guard(async (req, res) => {
      const identity = identityOr401(req, res)
      if (!identity) return
      res.json({ ok: true, data: await service.getReturnActivity(identity, scope()) })
    })
  )

  router.post(
    '/me/activity/read',
    guard(async (req, res) => {
      const identity = identityOr401(req, res)
      if (!identity) return
      await service.markActivityRead(identity, scope())
      res.json({ ok: true })
    })
  )

  // --- Bonds -------------------------------------------------------------------

  router.get(
    '/bonds',
    guard(async (_req, res) => {
      res.json({ ok: true, data: await service.listBonds(scope()) })
    })
  )

  /**
   * There is deliberately no `POST /bond`.
   *
   * A Bond requires two live players to be co-present, both having waved, for a sustained
   * period. Only the room observes that, so Bonds are created there. Exposing a create
   * endpoint would hand anyone a way to manufacture relationships over HTTP, which is
   * precisely the fake social activity this product must not have.
   */

  // --- World -------------------------------------------------------------------

  router.get(
    '/world/presence',
    guard(async (_req, res) => {
      // livePlayers is 0 here: HTTP has no view of the live room. The room's own broadcast
      // carries the live figure.
      const vitality = await service.getVitality(scope(), 0)
      res.json({
        ok: true,
        data: {
          ...vitality,
          worldId: config.worldId,
          // Named so nobody mistakes this for a Decentraland Discover integration.
          signal: 'LINGER World Vitality — prototype discovery signal'
        }
      })
    })
  )

  return router
}
