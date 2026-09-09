import { Echo, WorldScope } from './domain/types'
import { echoRingPosition } from './domain/rules'
import { SocialPersistence } from './persistence/SocialPersistence'
import { DEFAULT_LAYOUT, WorldLayout } from './service'

/**
 * Genesis Echoes.
 *
 * Authored by the LINGER team so that the first person through the door still sees the
 * mechanic working. They are marked `isGenesis: true`, owned by a `linger:genesis:*`
 * identity that cannot be a wallet, never expire, and say what they are on their own card.
 *
 * They are not fabricated visitors, and nothing in LINGER ever counts them as one.
 */

const SEEDS: { note: string }[] = [
  { note: 'I sat by the fire for twenty seconds and the World kept me. So will it keep you.' },
  { note: 'Tap someone. They find out later that they were remembered. That is the whole idea.' },
  { note: 'Nobody was here when I arrived either. Look around now.' },
  { note: 'If someone real is standing here with you — wave. Stay a while. See what forms.' },
  { note: 'Everything here was left by someone who left.' }
]

export const GENESIS_NAME = 'LINGER Founding Visitor'

function genesisId(worldId: string, index: number) {
  return `genesis:${worldId}:${index}`
}

/**
 * Ensure the Genesis set exists for a World. Idempotent — safe to call on every boot.
 * Returns how many were newly created.
 */
export async function seedGenesisEchoes(
  store: SocialPersistence,
  scope: WorldScope,
  now: number,
  layout: WorldLayout = DEFAULT_LAYOUT
): Promise<number> {
  let created = 0

  for (let i = 0; i < SEEDS.length; i++) {
    const id = genesisId(scope.worldId, i)
    if (await store.getEcho(id)) continue

    const echo: Echo = {
      id,
      owner: { id: `linger:genesis:${i}`, name: GENESIS_NAME, hasWallet: false },
      worldId: scope.worldId,
      realmId: scope.realmId,
      position: echoRingPosition(id, layout.centre, layout.echoRingRadius, layout.echoRingJitter),
      emote: 'rest',
      note: SEEDS[i].note,
      createdAt: now - (i + 1) * 3600_000,
      // Genesis Echoes are part of the World, not a visit, so they do not expire.
      expiresAt: 0,
      interactionCount: 0,
      interactionsByType: {},
      isGenesis: true
    }

    await store.createEcho(echo)
    created++
  }

  return created
}
