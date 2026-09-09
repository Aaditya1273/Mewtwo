import {
  Billboard,
  engine,
  Entity,
  Material,
  MeshCollider,
  MeshRenderer,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Bond } from '../types/linger'
import { palette, type as typeScale } from '../ui/theme'

/**
 * Bond stones: the permanent record that two people were here together.
 *
 * A crystal — two leaning shards sharing one glow — rather than a plaque. It should read
 * as something the pair left behind, not as a leaderboard row.
 *
 * Bonds are rare compared to Echoes, so these are created on arrival rather than pooled.
 * A cap keeps a very old World from accumulating unbounded geometry; beyond it the newest
 * Bonds are shown.
 */

const MAX_STONES = 40

interface Stone {
  bondId: string
  entities: Entity[]
}

const stones: Stone[] = []
const rendered = new Set<string>()

function shard(position: Vector3, lean: number, height: number): Entity {
  const e = engine.addEntity()
  Transform.create(e, {
    position,
    scale: Vector3.create(0.32, height, 0.32),
    rotation: { x: Math.sin(lean / 2), y: 0, z: 0, w: Math.cos(lean / 2) }
  })
  MeshRenderer.setCylinder(e, 0.85, 0.05)
  Material.setPbrMaterial(e, {
    albedoColor: Color4.create(palette.bond.r, palette.bond.g, palette.bond.b, 0.55),
    emissiveColor: palette.bond,
    emissiveIntensity: 1.6,
    roughness: 0.25,
    metallic: 0
  })
  return e
}

export function addBondStone(bond: Bond) {
  if (rendered.has(bond.id)) return
  rendered.add(bond.id)

  const p = bond.position
  const base = Vector3.create(p.x, 0, p.z)

  const plinth = engine.addEntity()
  Transform.create(plinth, {
    position: Vector3.create(base.x, 0.09, base.z),
    scale: Vector3.create(1.15, 0.18, 1.15)
  })
  MeshRenderer.setCylinder(plinth, 1, 0.88)
  MeshCollider.setCylinder(plinth, 1, 0.88)
  Material.setPbrMaterial(plinth, {
    albedoColor: palette.stoneLight,
    roughness: 0.9,
    metallic: 0
  })

  // Two shards leaning into each other: one per person, meeting at the top.
  const left = shard(Vector3.create(base.x - 0.16, 0.62, base.z), 0.14, 1.15)
  const right = shard(Vector3.create(base.x + 0.16, 0.62, base.z), -0.14, 1.15)

  const label = engine.addEntity()
  Transform.create(label, { position: Vector3.create(base.x, 1.72, base.z) })
  TextShape.create(label, {
    text: `${bond.playerA.name}\n+\n${bond.playerB.name}\nBond #${String(bond.number).padStart(4, '0')}`,
    fontSize: typeScale.caption,
    textColor: palette.ink,
    outlineColor: palette.stone,
    outlineWidth: 0.2
  })
  Billboard.create(label)

  stones.push({ bondId: bond.id, entities: [plinth, left, right, label] })

  // Retire the oldest stone once past the cap. The Bond record itself is untouched — this
  // is a rendering budget, not a deletion.
  while (stones.length > MAX_STONES) {
    const oldest = stones.shift()
    if (!oldest) break
    for (const e of oldest.entities) engine.removeEntity(e)
    rendered.delete(oldest.bondId)
  }
}

export function setBondStones(bonds: Bond[]) {
  for (const bond of bonds) addBondStone(bond)
}

export function bondStoneCount(): number {
  return stones.length
}
