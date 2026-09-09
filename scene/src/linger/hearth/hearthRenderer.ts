import { engine, Entity, Material, MeshCollider, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { HEARTH, HEARTH_POSITION } from '../config'
import { palette } from '../ui/theme'

/**
 * The Hearth: the visual and social centre of the World.
 *
 * Three entities only. It brightens as the World accumulates social history, which is
 * the entire "world memory" signal expressed as one continuously variable property
 * rather than a pile of new objects.
 */

let base: Entity
let core: Entity
let halo: Entity

/** 0..1 — driven by WorldVitality. Starts low so a first visitor can see it grow. */
let intensity = 0.25
/** Rises while the local player is lingering, so the Hearth visibly responds to them. */
let lingerBoost = 0

export function buildHearth() {
  const c = HEARTH_POSITION

  base = engine.addEntity()
  Transform.create(base, {
    position: Vector3.create(c.x, c.y + 0.35, c.z),
    scale: Vector3.create(HEARTH.stoneRadius * 2, 0.7, HEARTH.stoneRadius * 2)
  })
  MeshRenderer.setCylinder(base, 1, 0.78)
  MeshCollider.setCylinder(base, 1, 0.78)
  Material.setPbrMaterial(base, {
    albedoColor: palette.stoneLight,
    roughness: 0.85,
    metallic: 0
  })

  core = engine.addEntity()
  Transform.create(core, {
    position: Vector3.create(c.x, c.y + 1.0, c.z),
    scale: Vector3.create(0.85, 0.85, 0.85)
  })
  MeshRenderer.setSphere(core)

  // A larger, very transparent sphere reads as glow without a particle system or a light.
  halo = engine.addEntity()
  Transform.create(halo, {
    position: Vector3.create(c.x, c.y + 1.0, c.z),
    scale: Vector3.create(2.4, 2.4, 2.4)
  })
  MeshRenderer.setSphere(halo)

  applyGlow()
}

function applyGlow() {
  const level = Math.min(1, intensity + lingerBoost)

  Material.setPbrMaterial(core, {
    albedoColor: palette.ember,
    emissiveColor: palette.ember,
    emissiveIntensity: 1.2 + level * 4.5,
    roughness: 0.35,
    metallic: 0
  })

  Material.setPbrMaterial(halo, {
    albedoColor: Color4.create(
      palette.emberSoft.r,
      palette.emberSoft.g,
      palette.emberSoft.b,
      0.05 + level * 0.16
    ),
    emissiveColor: palette.emberSoft,
    emissiveIntensity: 0.4 + level * 1.8,
    roughness: 1,
    metallic: 0
  })
}

/**
 * Set the ambient brightness from World vitality.
 * Called on vitality updates only — never per frame.
 */
export function setHearthIntensity(next: number) {
  const clamped = Math.max(0, Math.min(1, next))
  if (Math.abs(clamped - intensity) < 0.01) return
  intensity = clamped
  applyGlow()
}

/**
 * Feedback while the local player lingers: the Hearth brightens as their timer fills.
 * Driven by the linger tick (4/s), not the render loop.
 */
export function setLingerProgress(progress: number) {
  const boost = Math.max(0, Math.min(1, progress)) * 0.55
  if (Math.abs(boost - lingerBoost) < 0.02) return
  lingerBoost = boost
  applyGlow()
}

export function getHearthEntity(): Entity {
  return base
}
