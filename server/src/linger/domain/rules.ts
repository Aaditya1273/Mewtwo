import { Echo, EchoEmote, Identity, InteractionType, INTERACTION_TYPES } from './types'

/**
 * LINGER product rules, as pure functions.
 *
 * Nothing here touches storage, the clock (it is passed in), or the network — which is
 * what makes the whole rule set directly testable.
 */

/**
 * Read a tuning knob from the environment, falling back to the shipped default.
 *
 * These are genuine product tuning values — the Bond duration is specified as
 * "approximately 30-60 seconds" — so they are configurable rather than baked in.
 * Keeping them here rather than importing the config module leaves this file pure
 * apart from a single read at load time, which the tests rely on.
 */
function tunable(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const LIMITS = {
  /** Echo lifetime. */
  echoTtlMs: 24 * 60 * 60 * 1000,

  /** One Echo per identity per World in this window. Stops Echo spam at the source. */
  echoCooldownMs: tunable('LINGER_ECHO_COOLDOWN_MS', 5 * 60 * 1000),

  /** Interactions an identity may send per World per hour. */
  interactionsPerHour: 60,

  /** Maximum note length after trimming. */
  noteMaxLength: 140,

  /** Two live players must be within this many metres of each other. */
  bondRadius: 4,

  /** Two players must be together this long before a Bond is eligible. */
  bondMinTogetherMs: tunable('LINGER_BOND_MIN_TOGETHER_MS', 30 * 1000),

  /** A wave counts toward Bond eligibility for this long. */
  bondWaveWindowMs: tunable('LINGER_BOND_WAVE_WINDOW_MS', 15 * 1000),

  /** Bonds an identity may form per World per day. */
  bondsPerDay: 20,

  /** Echoes returned by a single list call. */
  echoPageSize: 60
}

const EMOTES: EchoEmote[] = ['wave', 'sit', 'gaze', 'rest']

/**
 * Normalise an identity.
 *
 * Called on every identity that enters the system. Addresses are lowercased so
 * `0xABC` and `0xabc` are the same person, and names are length-capped so a crafted
 * display name cannot break a UI or bloat a record.
 */
export const RESERVED_IDENTITY_PREFIX = 'linger:'

/**
 * True for ids LINGER reserves for its own authored content.
 *
 * Genesis Echoes are owned by `linger:genesis:N`. Without this guard a client could join
 * claiming `publicKey: "linger:genesis:0"` and then leave Echoes, send interactions, and
 * form Bonds while wearing a Founding Visitor identity — turning authored content into
 * something that looks like a real participant, which is the one thing this product must
 * never allow.
 */
export function isReservedIdentity(id: string): boolean {
  return id.trim().toLowerCase().indexOf(RESERVED_IDENTITY_PREFIX) === 0
}

export function normaliseIdentity(raw: Partial<Identity> | undefined): Identity | null {
  if (!raw || typeof raw.id !== 'string') return null
  const id = raw.id.trim().toLowerCase()
  if (!id) return null
  // A real participant can never hold a reserved id.
  if (isReservedIdentity(id)) return null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : ''
  return { id, name: name || 'Someone', hasWallet: !!raw.hasWallet }
}

/**
 * Clean a note.
 *
 * Control characters are stripped rather than escaped: the note is rendered into a 3-D
 * text component, not HTML, so the risk is layout corruption rather than injection.
 */
export function sanitiseNote(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.noteMaxLength)
}

export function sanitiseEmote(raw: unknown): EchoEmote {
  return EMOTES.indexOf(raw as EchoEmote) !== -1 ? (raw as EchoEmote) : 'rest'
}

export function isInteractionType(raw: unknown): raw is InteractionType {
  return INTERACTION_TYPES.indexOf(raw as InteractionType) !== -1
}

export function isEchoExpired(echo: Echo, now: number): boolean {
  return echo.expiresAt > 0 && echo.expiresAt <= now
}

/**
 * Deterministic ring position for an Echo.
 *
 * The same id always yields the same spot, so an Echo does not move between sessions or
 * between clients. Mirrors `ringSlotPosition` in the scene.
 */
export function echoRingPosition(
  seed: string,
  centre: { x: number; z: number },
  ringRadius: number,
  jitter: number
) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const angle = ((hash % 3600) / 3600) * Math.PI * 2
  const spread = ((hash >>> 12) % 1000) / 1000
  const radius = ringRadius - jitter / 2 + spread * jitter
  return {
    x: centre.x + Math.cos(angle) * radius,
    y: 0,
    z: centre.z + Math.sin(angle) * radius
  }
}

/** Bond stones are laid out on their own ring, indexed by Bond number so they never collide. */
export function bondStonePosition(bondNumber: number, centre: { x: number; z: number }, radius: number) {
  // Golden-angle placement: consecutive Bonds land far apart, so the ring fills evenly
  // however many exist.
  const angle = bondNumber * 2.399963229728653
  return {
    x: centre.x + Math.cos(angle) * radius,
    y: 0,
    z: centre.z + Math.sin(angle) * radius
  }
}

/** Canonical key for an unordered pair, so A+B and B+A are recognised as the same Bond. */
export function bondPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Whether two live players qualify for a Bond right now.
 *
 * Both must have waved inside the wave window, and they must have been together for the
 * minimum duration. Proximity alone is never enough — standing next to a stranger is not
 * a relationship, and the product would feel cheap if it were.
 */
export function isBondEligible(
  input: { togetherSinceMs: number; wavedAtA: number; wavedAtB: number },
  now: number
): boolean {
  if (input.togetherSinceMs <= 0) return false
  if (now - input.togetherSinceMs < LIMITS.bondMinTogetherMs) return false

  const waveOk = (at: number) => at > 0 && now - at <= LIMITS.bondWaveWindowMs
  return waveOk(input.wavedAtA) && waveOk(input.wavedAtB)
}

/**
 * Map raw World activity onto a 0..1 brightness.
 *
 * Logarithmic on purpose: the difference between 0 and 3 visitors should be dramatic,
 * and the difference between 300 and 400 should be almost nothing.
 */
export function computeIntensity(input: {
  activeEchoes: number
  livePlayers: number
  interactionsLast24h: number
  totalBonds: number
}): number {
  const weighted =
    input.activeEchoes * 1 +
    input.livePlayers * 4 +
    input.interactionsLast24h * 0.5 +
    input.totalBonds * 3

  if (weighted <= 0) return 0
  // log10(1 + w) / log10(1 + 200) reaches 1.0 at roughly 200 weighted points.
  const normalised = Math.log10(1 + weighted) / Math.log10(201)
  return Math.max(0, Math.min(1, normalised))
}
