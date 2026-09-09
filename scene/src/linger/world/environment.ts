import {
  engine,
  Entity,
  Material,
  MeshCollider,
  MeshRenderer,
  TextShape,
  Billboard,
  Transform
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { ECHO, ENTRY_POSITION, HEARTH, HEARTH_POSITION } from '../config'
import { palette, type as typeScale } from '../ui/theme'

/**
 * The LINGER sanctuary.
 *
 * Built entirely from engine primitives — no GLB, no textures. That keeps first load
 * near-instant on mobile (the scene downloads code and nothing else) and means the
 * environment carries no inherited assets from the donor project.
 *
 * Layout, south to north:
 *
 *        Bond stones          (ring, radius BOND.ringRadius)
 *        Echo ring            (ring, radius ECHO.ringRadius)
 *        HEARTH               (centre)
 *        entry portal         (south, where the player spawns)
 */

const created: Entity[] = []

function surface(entity: Entity, color = palette.stone, emissive = 0) {
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    emissiveColor: emissive > 0 ? color : undefined,
    emissiveIntensity: emissive,
    roughness: 0.9,
    metallic: 0
  })
}

/** A flat disc lying on the ground: a cylinder squashed on Y. */
function disc(center: Vector3, radius: number, thickness: number, color = palette.stone, emissive = 0) {
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(center.x, center.y + thickness / 2, center.z),
    scale: Vector3.create(radius * 2, thickness, radius * 2)
  })
  MeshRenderer.setCylinder(e, 1, 1)
  surface(e, color, emissive)
  created.push(e)
  return e
}

/**
 * A thin ring drawn as a ribbon of short segments.
 * Cheaper and more controllable than a torus mesh, and it lets the ring glow.
 */
function ring(center: Vector3, radius: number, segments: number, color = palette.stoneLight, emissive = 0) {
  const width = (2 * Math.PI * radius) / segments
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const e = engine.addEntity()
    Transform.create(e, {
      position: Vector3.create(
        center.x + Math.cos(angle) * radius,
        center.y + 0.02,
        center.z + Math.sin(angle) * radius
      ),
      rotation: Quaternion.fromEulerDegrees(0, -(angle * 180) / Math.PI, 0),
      scale: Vector3.create(width * 1.05, 0.04, 0.18)
    })
    MeshRenderer.setBox(e)
    surface(e, color, emissive)
    created.push(e)
  }
}

/** A small standing stone. Used for the entry portal and the memory garden. */
function standingStone(position: Vector3, height: number, color = palette.stoneLight) {
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(position.x, position.y + height / 2, position.z),
    scale: Vector3.create(0.42, height, 0.42)
  })
  MeshRenderer.setCylinder(e, 0.9, 0.55)
  MeshCollider.setCylinder(e, 0.9, 0.55)
  surface(e, color)
  created.push(e)
  return e
}

/** Floating text that always faces the player. Used sparingly — signage, not HUD. */
export function worldLabel(position: Vector3, text: string, size = typeScale.caption) {
  const e = engine.addEntity()
  Transform.create(e, { position })
  TextShape.create(e, {
    text,
    fontSize: size,
    textColor: palette.inkDim,
    outlineColor: palette.stone,
    outlineWidth: 0.14
  })
  Billboard.create(e)
  created.push(e)
  return e
}

export function buildSanctuary() {
  const c = HEARTH_POSITION

  // Ground platform. Wide enough to hold the Bond ring, no wider — the World should
  // read as intimate, and an oversized floor is the fastest way to feel empty.
  disc(c, 17, 0.12, palette.stone)

  // Inner plinth the Hearth sits on. Its edge is the visual cue for the linger radius.
  disc(c, HEARTH.interactionRadius, 0.22, palette.stoneLight)
  ring(c, HEARTH.interactionRadius, 48, palette.emberSoft, 0.6)

  // The Echo ring — a faint circle so returning Echoes always have somewhere to belong.
  ring(c, ECHO.ringRadius, 72, palette.echo, 0.25)

  // Entry portal: two stones the player walks between on arrival.
  standingStone(Vector3.create(ENTRY_POSITION.x - 1.7, 0, ENTRY_POSITION.z), 2.6)
  standingStone(Vector3.create(ENTRY_POSITION.x + 1.7, 0, ENTRY_POSITION.z), 2.6)
  worldLabel(Vector3.create(ENTRY_POSITION.x, 3.3, ENTRY_POSITION.z), 'LINGER', typeScale.title)

  // Memory garden: a scatter of low stones between the Echo ring and the Bond ring.
  // Purely atmospheric, and deliberately few — this is where the World will later grow.
  const gardenSeeds = [0.4, 1.35, 2.1, 3.0, 3.9, 4.7, 5.5, 6.1]
  for (let i = 0; i < gardenSeeds.length; i++) {
    const angle = gardenSeeds[i]
    const r = ECHO.ringRadius + 1.6 + (i % 3) * 0.9
    standingStone(
      Vector3.create(c.x + Math.cos(angle) * r, 0, c.z + Math.sin(angle) * r),
      0.5 + (i % 4) * 0.16
    )
  }
}

/** Tear the sanctuary down. Only used by tests and hot-reload paths. */
export function clearSanctuary() {
  for (const e of created) engine.removeEntity(e)
  created.length = 0
}
