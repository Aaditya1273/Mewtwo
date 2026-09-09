/**
 * LINGER server configuration.
 *
 * Everything deployment-specific is read from the environment, with defaults that let the
 * server run locally with no setup at all.
 */

function env(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  /**
   * The World this server stores records for.
   *
   * SECURITY: this is server-side configuration, never taken from a client. A client that
   * claims to be in a different World is still scoped to this one, so a malicious client
   * cannot read or write another World's Echoes and Bonds.
   *
   * DEPLOYMENT: set `LINGER_WORLD_URN` to the Decentraland World name you actually control
   * (for example `yourname.dcl.eth`). The default below is a local placeholder and is NOT
   * a claim to any namespace.
   */
  worldId: env('LINGER_WORLD_URN', 'linger.local'),

  /** 'memory' (default, no external services) or 'mongo'. */
  persistence: env('LINGER_PERSISTENCE', 'memory') as 'memory' | 'mongo',

  /** Seed the five authored Genesis Echoes on boot. */
  seedGenesis: env('LINGER_SEED_GENESIS', 'true') === 'true',

  /** How often expired Echoes are swept, in seconds. */
  purgeIntervalSeconds: envInt('LINGER_PURGE_INTERVAL_SECONDS', 600),

  /** How often World vitality is recomputed and broadcast, in seconds. */
  vitalityIntervalSeconds: envInt('LINGER_VITALITY_INTERVAL_SECONDS', 20),

  port: envInt('PORT', 2567),

  /** Password for the Colyseus monitor at /colyseus. Monitor is disabled when unset. */
  monitorPassword: process.env.MONITOR_PASSWORD,

  /**
   * When true, a client that cannot present a valid signed-auth ticket is refused entry.
   *
   * Default false: a visitor without a wallet still gets to linger, as a session-scoped
   * `guest:` identity that cannot collide with or impersonate any wallet address. Set true
   * for a deployment where only verified wallets may leave social history.
   */
  requireSignedAuth: env('LINGER_REQUIRE_SIGNED_AUTH', 'false') === 'true',

  /** How long a join ticket stays redeemable, in seconds. */
  ticketTtlSeconds: envInt('LINGER_TICKET_TTL_SECONDS', 60),

  /** Origins allowed to call the REST API. */
  corsAllowlist: env(
    'LINGER_CORS_ALLOWLIST',
    'https://play.decentraland.org,https://play.decentraland.zone'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

/** True when the World name is still the local placeholder rather than a real World. */
export function isPlaceholderWorld(): boolean {
  return config.worldId === 'linger.local'
}
