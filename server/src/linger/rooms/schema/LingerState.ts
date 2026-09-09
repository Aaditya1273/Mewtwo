import { MapSchema, Schema, type } from '@colyseus/schema'

/**
 * Live room state.
 *
 * Only what genuinely has to be synchronised in real time lives here. Echoes and Bonds are
 * NOT in the schema — they are persistent records fetched on demand and pushed as discrete
 * events, so a World with hundreds of Echoes costs nothing per tick.
 */

export class PresencePlayer extends Schema {
  /** Wallet address or userId, lowercased. Assigned by the server at join. */
  @type('string') identityId: string = ''
  @type('string') name: string = ''
  @type('boolean') hasWallet: boolean = false

  /** Coarse position, updated at most once per second by the client. */
  @type('number') x: number = 0
  @type('number') z: number = 0

  /** Server timestamp of this player's most recent wave, or 0. */
  @type('number') wavedAt: number = 0

  /** True while the player is inside the Hearth radius. Drives the "together" feel. */
  @type('boolean') atHearth: boolean = false
}

export class LingerState extends Schema {
  @type({ map: PresencePlayer }) players = new MapSchema<PresencePlayer>()

  /** World vitality, 0..1. Broadcast on a slow interval, not per tick. */
  @type('number') intensity: number = 0

  /** Live counts for the Warmth bar. */
  @type('number') visitorEchoes: number = 0
  @type('number') totalBonds: number = 0
}
