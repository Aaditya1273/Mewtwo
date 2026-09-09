import { Echo } from '../types/linger'
import { ringSlotPosition } from './echoSystem'
import { WORLD_ID } from '../config'

/**
 * Genesis Echoes.
 *
 * These are NOT fabricated visitors. They are authored by the LINGER team, are labelled
 * "Genesis" in the data, render in a different colour than visitor Echoes, and say so on
 * their own card. Their only job is to teach the mechanic to the first person who walks
 * in, so an empty World still demonstrates what a full one feels like.
 *
 * The moment a real visitor leaves an Echo, theirs sits alongside these and is visibly
 * distinct. No Genesis Echo ever claims to be a random real user.
 */

const seeds: { name: string; note: string }[] = [
  {
    name: 'LINGER Founding Visitor',
    note: 'I sat by the fire for twenty seconds and the World kept me. So will it keep you.'
  },
  {
    name: 'LINGER Founding Visitor',
    note: 'Tap someone. They find out later that they were remembered. That is the whole idea.'
  },
  {
    name: 'LINGER Founding Visitor',
    note: 'Nobody was here when I arrived either. Look around now.'
  },
  {
    name: 'LINGER Founding Visitor',
    note: 'If someone real is standing here with you — wave. Stay a while. See what forms.'
  },
  {
    name: 'LINGER Founding Visitor',
    note: 'Everything here was left by someone who left.'
  }
]

/**
 * Local Genesis set, used only until the server responds. The server owns the real
 * Genesis Echoes; these exist so the World is never blank during connection.
 */
export function localGenesisEchoes(realmId: string): Echo[] {
  const now = Date.now()
  return seeds.map((seed, i) => {
    const id = `genesis-${i}`
    return {
      id,
      owner: { id: `linger:genesis:${i}`, name: seed.name, hasWallet: false },
      worldId: WORLD_ID,
      realmId,
      position: ringSlotPosition(id),
      emote: 'rest',
      note: seed.note,
      createdAt: now - (i + 1) * 3600_000,
      // Genesis Echoes do not expire — they are part of the World, not a visit.
      expiresAt: 0,
      interactionCount: 0,
      interactionsByType: {},
      isGenesis: true
    }
  })
}
