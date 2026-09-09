/**
 * LINGER server bootstrap.
 *
 * Derived from the MRT-Backrooms `arena.config.ts` (Apache-2.0 — see THIRD_PARTY_NOTICES.md).
 * The Arena/Express/monitor structure is the donor's; the room, the routes, the CORS
 * handling and the credential guards are LINGER's.
 */
import Arena from '@colyseus/arena'
import { monitor } from '@colyseus/monitor'
import { WebSocketTransport } from '@colyseus/ws-transport'
import express from 'express'
import cors from 'cors'
import basicAuth from 'express-basic-auth'

import { config, isPlaceholderWorld } from './linger/config'
import { LingerService } from './linger/service'
import { MemoryPersistence } from './linger/persistence/MemoryPersistence'
import { SocialPersistence } from './linger/persistence/SocialPersistence'
import { LingerRoom } from './linger/rooms/LingerRoom'
import { createLingerRouter } from './linger/api/routes'
import { devAuthEnabled, resolveIdentity } from './linger/api/identity'
import { seedGenesisEchoes } from './linger/genesis'
import { TicketStore } from './linger/auth/ticketStore'
import { readChainConfig, validateChainConfig } from './linger/chain/chainConfig'
import { DisabledPreservation } from './linger/chain/DisabledPreservation'
import { MetaTransactionPreservation } from './linger/chain/MetaTransactionPreservation'
import { BondPreservation } from './linger/chain/BondPreservation'

function buildPersistence(): SocialPersistence {
  if (config.persistence === 'mongo') {
    // MongoPersistence is the durable adapter. It is not wired up yet, so fail loudly at
    // boot rather than silently falling back to memory and losing a deployment's history.
    throw new Error(
      'LINGER_PERSISTENCE=mongo is not implemented yet. Unset it to use the in-memory ' +
        'adapter, which is complete and is what the test suite covers.'
    )
  }
  return new MemoryPersistence()
}

/**
 * Blockchain backend.
 *
 * Disabled unless explicitly turned on AND fully configured. A half-configured chain layer
 * refuses to start rather than failing later, in front of an audience.
 */
function buildPreservation(): BondPreservation {
  const chain = readChainConfig()
  if (!chain.enabled) return new DisabledPreservation()

  const missing = validateChainConfig(chain)
  if (missing.length > 0) {
    throw new Error(
      `LINGER_CHAIN_ENABLED=true but these are unset: ${missing.join(', ')}. ` +
        'Configure them, or unset LINGER_CHAIN_ENABLED to run without the chain layer.'
    )
  }
  return new MetaTransactionPreservation(chain)
}

const persistence = buildPersistence()
const preservation = buildPreservation()
const service = new LingerService(persistence, () => Date.now(), undefined, preservation)

// Tickets are minted by the REST auth route and redeemed by the room's onAuth, so both
// sides must share one store.
const tickets = new TicketStore({ ttlMs: config.ticketTtlSeconds * 1000 })

// The room and the REST routes share one service instance, so both go through identical
// rules and see identical state.
LingerRoom.service = service
LingerRoom.tickets = tickets

export default Arena({
  getId: () => 'LINGER',

  initializeGameServer: (gameServer) => {
    gameServer
      .define('linger_world', LingerRoom)
      // Realms are separate live islands. Persistent records are scoped by World on the
      // server; this only keeps two islands from sharing one live room.
      .filterBy(['realm'])
      .enableRealtimeListing()
  },

  initializeTransport: (options) =>
    new WebSocketTransport({
      ...options,
      pingInterval: 6000,
      pingMaxRetries: 4
    }),

  initializeExpress: (app) => {
    app.use(express.json({ limit: '16kb' }))
    app.use(express.urlencoded({ extended: true, limit: '16kb' }))

    const allowlist = config.corsAllowlist
    app.use(
      cors({
        origin: (origin, callback) => {
          // No Origin header means a server-to-server or tooling call, which CORS does
          // not govern. Browser origins must be on the allowlist.
          if (!origin) return callback(null, true)
          callback(null, allowlist.indexOf(origin) !== -1)
        }
      })
    )

    app.get('/', (_req, res) => {
      res.json({
        name: 'LINGER',
        tagline: 'The Presence Protocol — Making Worlds Remember.',
        worldId: config.worldId,
        persistence: config.persistence
      })
    })

    app.get('/health', (_req, res) => res.json({ ok: true }))

    app.use('/api', createLingerRouter(service, resolveIdentity, tickets))

    // The Colyseus monitor exposes room internals, so it is mounted only when a password
    // is actually configured. The donor mounted it with `undefined` as the password.
    if (config.monitorPassword) {
      app.use(
        '/colyseus',
        basicAuth({ users: { linger: config.monitorPassword }, challenge: true }),
        monitor()
      )
    } else {
      console.warn('[linger] MONITOR_PASSWORD not set — /colyseus monitor is disabled.')
    }

    app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('[linger]', error)
      res.status(500).json({ ok: false, error: 'INTERNAL' })
    })
  },

  beforeListen: async () => {
    await service.init()

    if (config.seedGenesis) {
      const created = await seedGenesisEchoes(
        persistence,
        { worldId: config.worldId, realmId: 'genesis' },
        Date.now()
      )
      if (created > 0) console.log(`[linger] seeded ${created} Genesis Echoes`)
    }

    if (isPlaceholderWorld()) {
      console.warn(
        '[linger] LINGER_WORLD_URN is unset — using the local placeholder "linger.local".\n' +
          '[linger] Set it to a Decentraland World you control before deploying.'
      )
    }
    console.log(
      `[linger] signed auth: ${config.requireSignedAuth ? 'REQUIRED' : 'optional (guests allowed)'}`
    )
    if (devAuthEnabled()) {
      console.warn(
        '[linger] LINGER_ALLOW_DEV_AUTH=true — the REST API trusts the x-linger-identity ' +
          'header. Never enable this on a deployment holding real social history.'
      )
    }

    console.log(
      `[linger] bond preservation: ${
        preservation.enabled ? `enabled (${preservation.network})` : 'disabled'
      }`
    )
    console.log(`[linger] world=${config.worldId} persistence=${config.persistence}`)
  }
})
