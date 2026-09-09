import { Bond, Echo, EchoEmote, Identity, ReturnActivity } from '../types/linger'

/**
 * The trust boundary between the network and the scene.
 *
 * Everything arriving over the wire passes through here before any renderer sees it.
 * Before this existed the renderers dereferenced `echo.position.x`,
 * `echo.interactionsByType.heart` and `echo.owner.name` directly, so a single malformed
 * or truncated payload — an older server, a partial message, a field renamed in a future
 * version — threw inside the render path and took the scene down with it.
 *
 * The rule here is: never throw, never crash the World. A record that cannot be made sense
 * of is dropped and logged. Losing one Echo is survivable; losing the scene is not.
 */

const EMOTES: EchoEmote[] = ['wave', 'sit', 'gaze', 'rest']

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

function identity(raw: any): Identity {
  return {
    id: str(raw?.id),
    // A nameless owner still renders — as "Someone", which is honest.
    name: str(raw?.name) || 'Someone',
    hasWallet: bool(raw?.hasWallet)
  }
}

function counts(raw: any): Echo['interactionsByType'] {
  const out: Echo['interactionsByType'] = {}
  if (!raw || typeof raw !== 'object') return out
  const heart = num(raw.heart, 0)
  const highfive = num(raw.highfive, 0)
  const read = num(raw.read, 0)
  if (heart > 0) out.heart = heart
  if (highfive > 0) out.highfive = highfive
  if (read > 0) out.read = read
  return out
}

/**
 * Decode one Echo, or null if it is unusable.
 *
 * An Echo without an id cannot be addressed, and one without a finite position cannot be
 * placed — those are the only two hard requirements. Every other field degrades.
 */
export function decodeEcho(raw: any): Echo | null {
  if (!raw || typeof raw !== 'object') return null

  const id = str(raw.id)
  if (!id) return null

  const p = raw.position
  if (!p || typeof p !== 'object') return null
  const x = num(p.x, Number.NaN)
  const y = num(p.y, 0)
  const z = num(p.z, Number.NaN)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null

  const emote = EMOTES.indexOf(raw.emote) !== -1 ? (raw.emote as EchoEmote) : 'rest'

  return {
    id,
    owner: identity(raw.owner),
    worldId: str(raw.worldId),
    realmId: str(raw.realmId),
    position: { x, y, z },
    emote,
    note: str(raw.note),
    createdAt: num(raw.createdAt, Date.now()),
    // 0 means "never expires". A negative or absent value is treated as never rather than
    // as already-expired, so a bad field cannot silently empty the World.
    expiresAt: Math.max(0, num(raw.expiresAt, 0)),
    interactionCount: Math.max(0, num(raw.interactionCount, 0)),
    interactionsByType: counts(raw.interactionsByType),
    isGenesis: bool(raw.isGenesis)
  }
}

/** Decode a list, silently dropping any entry that cannot be made sense of. */
export function decodeEchoes(raw: any): Echo[] {
  if (!Array.isArray(raw)) return []
  const out: Echo[] = []
  let dropped = 0
  for (const item of raw) {
    const echo = decodeEcho(item)
    if (echo) out.push(echo)
    else dropped++
  }
  if (dropped > 0) console.log(`[linger] dropped ${dropped} unreadable Echo record(s)`)
  return out
}

export function decodeBond(raw: any): Bond | null {
  if (!raw || typeof raw !== 'object') return null

  const id = str(raw.id)
  if (!id) return null

  const p = raw.position
  const x = num(p?.x, Number.NaN)
  const z = num(p?.z, Number.NaN)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null

  return {
    id,
    number: Math.max(0, num(raw.number, 0)),
    playerA: identity(raw.playerA),
    playerB: identity(raw.playerB),
    worldId: str(raw.worldId),
    createdAt: num(raw.createdAt, Date.now()),
    position: { x, y: num(p?.y, 0), z }
  }
}

export function decodeBonds(raw: any): Bond[] {
  if (!Array.isArray(raw)) return []
  const out: Bond[] = []
  for (const item of raw) {
    const bond = decodeBond(item)
    if (bond) out.push(bond)
  }
  return out
}

/**
 * Decode return activity.
 *
 * Defaults to empty, which means the panel stays silent. A malformed activity payload
 * must never produce a "while you were away" panel with nothing in it — an empty
 * celebration is worse than no celebration.
 */
export function decodeActivity(raw: any): ReturnActivity {
  const empty: ReturnActivity = {
    hearts: 0,
    highfives: 0,
    reads: 0,
    newBonds: [],
    lastSeenAt: 0,
    isEmpty: true
  }
  if (!raw || typeof raw !== 'object') return empty

  const hearts = Math.max(0, num(raw.hearts, 0))
  const highfives = Math.max(0, num(raw.highfives, 0))
  const reads = Math.max(0, num(raw.reads, 0))
  const newBonds = decodeBonds(raw.newBonds)

  // isEmpty is recomputed rather than trusted, so the panel can only open when there is
  // genuinely something in it.
  return {
    hearts,
    highfives,
    reads,
    newBonds,
    lastSeenAt: num(raw.lastSeenAt, 0),
    isEmpty: hearts + highfives + reads + newBonds.length === 0
  }
}

export function decodeIdentity(raw: any): Identity {
  return identity(raw)
}
