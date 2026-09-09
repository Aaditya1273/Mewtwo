import { Vector3 } from '@dcl/sdk/math'

/**
 * Every tunable number in LINGER lives here.
 *
 * Nothing else in the scene should hardcode a radius, a duration or a cap —
 * the mobile and performance passes both work by editing this file.
 */

/** Centre of the sanctuary. The Hearth sits here; everything is laid out around it. */
export const HEARTH_POSITION = Vector3.create(24, 0, 24)

/** Where the player arrives. South of the Hearth, facing it. */
export const ENTRY_POSITION = Vector3.create(24, 0, 10)

export const HEARTH = {
  /** Player must be inside this radius (metres) for the linger timer to run. */
  interactionRadius: 5,
  /** How long a player must linger before an Echo is committed. */
  lingerDurationMs: 20_000,
  /** How often the linger proximity check runs. 4/s is far below per-frame and feels instant. */
  checkIntervalMs: 250,
  /** Visual radius of the hearth stone itself. */
  stoneRadius: 1.6
}

export const ECHO = {
  /** Hard cap on simultaneously rendered Echoes. The pool is allocated to this size. */
  maxVisible: 18,
  /** Echoes are arranged on a ring around the Hearth at this radius. */
  ringRadius: 9,
  /** Ring radius jitter, so the arrangement does not read as a perfect circle. */
  ringJitter: 2.2,
  /** Default Echo lifetime. The server is authoritative; this is only for local expiry cleanup. */
  ttlMs: 24 * 60 * 60 * 1000,
  /** Height of an Echo silhouette in metres. */
  height: 1.8,
  /** How often the local expiry sweep runs. */
  sweepIntervalMs: 30_000
}

export const BOND = {
  /** Two live players must stay within this radius of each other. */
  radius: 4,
  /** ...for this long, after both have waved, before a Bond forms. */
  durationMs: 30_000,
  /** A wave stays "open" this long, so the two waves need not be simultaneous. */
  waveWindowMs: 15_000,
  /** Bond stones are placed on a ring at this radius, north of the Hearth. */
  ringRadius: 12
}

export const PRESENCE = {
  /**
   * Minimum interval between position reports to the server.
   * This is the single most important number for network cost: never send per frame.
   */
  reportIntervalMs: 1000,
  /** Do not report at all unless the player moved at least this far since the last report. */
  minMoveDistance: 0.75
}

/**
 * Server endpoint.
 *
 * Preview builds talk to a local server. The production value is a PLACEHOLDER and is
 * stamped in at deploy time by `scripts/configure-world.js` from LINGER_SERVER_WSS.
 * No host is claimed here.
 */
export const NETWORK = {
  localWss: 'ws://localhost:2567',
  productionWss: 'wss://LINGER_SERVER_WSS',
  /** Room name registered by the LINGER server. */
  roomName: 'linger_world',
  /** Give up reconnecting after this many consecutive failures. */
  maxReconnectAttempts: 5,
  reconnectBackoffMs: 2000
}

/**
 * Display-only World label.
 *
 * Persistent records are scoped by the SERVER's LINGER_WORLD_URN, never by anything the
 * client sends — a client cannot choose which World it writes to. This value exists only
 * for local placeholder Echoes shown before the server answers.
 */
export const WORLD_ID = 'linger'
