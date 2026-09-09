import {
  Billboard,
  engine,
  Entity,
  InputAction,
  Material,
  MeshCollider,
  MeshRenderer,
  pointerEventsSystem,
  TextShape,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { ECHO, HEARTH_POSITION } from '../config'
import { palette, type as typeScale } from '../ui/theme'
import { Echo } from '../types/linger'

/**
 * Fixed-size pool of Echo visuals.
 *
 * The pool is allocated once at startup and never grows. Showing an Echo binds it to a
 * free slot; hiding it releases the slot. No entity is created or destroyed while the
 * player is in the World, and no pointer handler is ever re-registered.
 *
 * An Echo is three entities: body, head, label. At the default cap of 18 that is 54
 * entities total for the entire social layer — versus roughly 18 skinned avatars, which
 * is what "render the visitors" would naively cost.
 */

interface Slot {
  body: Entity
  head: Entity
  label: Entity
  /** Bound Echo id, or null when the slot is free. */
  echoId: string | null
}

const slots: Slot[] = []
/** echoId -> slot index, so an update can find its slot without scanning. */
const bound = new Map<string, number>()

let onTap: (echoId: string) => void = () => {}

const BODY_HEIGHT = ECHO.height * 0.66
const HEAD_RADIUS = 0.17

function makeSlot(index: number): Slot {
  const body = engine.addEntity()
  Transform.create(body, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(body, 0.55, 0.26)
  // Collider on the body only — one generous, thumb-sized tap target per Echo.
  MeshCollider.setCylinder(body, 0.55, 0.26)
  VisibilityComponent.create(body, { visible: false })

  const head = engine.addEntity()
  Transform.create(head, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setSphere(head)
  VisibilityComponent.create(head, { visible: false })

  const label = engine.addEntity()
  Transform.create(label, { position: Vector3.create(0, -50, 0) })
  TextShape.create(label, {
    text: '',
    fontSize: typeScale.caption,
    textColor: palette.ink,
    outlineColor: palette.stone,
    outlineWidth: 0.2
  })
  Billboard.create(label)
  VisibilityComponent.create(label, { visible: false })

  const slot: Slot = { body, head, label, echoId: null }

  // Registered exactly once, for the lifetime of the scene. The handler reads the
  // slot's current binding, so re-binding a slot to a different Echo needs no re-register.
  pointerEventsSystem.onPointerDown(
    { entity: body, opts: { button: InputAction.IA_POINTER, hoverText: 'Remember' } },
    () => {
      if (slot.echoId) onTap(slot.echoId)
    }
  )

  slots.push(slot)
  return slot
}

export function buildEchoPool(handler: (echoId: string) => void) {
  onTap = handler
  // The pool is fixed for the lifetime of the scene. Guarding this means a second call —
  // from a hot reload or a future re-init path — cannot quietly double the entity budget.
  if (slots.length > 0) {
    console.log('[linger] echo pool already built; keeping the existing slots')
    return
  }
  for (let i = 0; i < ECHO.maxVisible; i++) makeSlot(i)
}

function tint(echo: Echo): Color4 {
  // Genesis Echoes are warm, so they read as part of the World itself.
  // Visitor Echoes are cool. The two are never visually confusable — a viewer can always
  // tell a seeded Echo from a real one.
  return echo.isGenesis ? palette.emberSoft : palette.echo
}

function paint(slot: Slot, echo: Echo) {
  const color = tint(echo)
  // More interactions, slightly more presence. Caps quickly so a popular Echo does not
  // dominate the ring.
  const warmth = Math.min(1, echo.interactionCount / 6)
  const alpha = 0.30 + warmth * 0.22

  const material = {
    albedoColor: Color4.create(color.r, color.g, color.b, alpha),
    emissiveColor: color,
    emissiveIntensity: 0.7 + warmth * 1.4,
    roughness: 1,
    metallic: 0
  }
  Material.setPbrMaterial(slot.body, material)
  Material.setPbrMaterial(slot.head, material)
}

function place(slot: Slot, echo: Echo) {
  const p = echo.position

  Transform.createOrReplace(slot.body, {
    position: Vector3.create(p.x, p.y + BODY_HEIGHT / 2, p.z),
    scale: Vector3.create(1, BODY_HEIGHT, 1),
    // Face the Hearth — every Echo is turned toward the fire, which reads as a gathering.
    rotation: faceHearth(p.x, p.z)
  })
  Transform.createOrReplace(slot.head, {
    position: Vector3.create(p.x, p.y + BODY_HEIGHT + HEAD_RADIUS * 0.9, p.z),
    scale: Vector3.create(HEAD_RADIUS * 2, HEAD_RADIUS * 2, HEAD_RADIUS * 2)
  })
  Transform.createOrReplace(slot.label, {
    position: Vector3.create(p.x, p.y + ECHO.height + 0.42, p.z)
  })
}

function faceHearth(x: number, z: number) {
  const angle = Math.atan2(HEARTH_POSITION.x - x, HEARTH_POSITION.z - z)
  const deg = (angle * 180) / Math.PI
  return { x: 0, y: Math.sin((deg * Math.PI) / 360), z: 0, w: Math.cos((deg * Math.PI) / 360) }
}

function labelFor(echo: Echo): string {
  const marks =
    (echo.interactionsByType.heart ? ' ♥' : '') + (echo.interactionsByType.highfive ? ' ✋' : '')
  const who = echo.isGenesis ? `${echo.owner.name} · Genesis` : echo.owner.name
  return `${who}${marks}`
}

function setVisible(slot: Slot, visible: boolean) {
  VisibilityComponent.createOrReplace(slot.body, { visible })
  VisibilityComponent.createOrReplace(slot.head, { visible })
  VisibilityComponent.createOrReplace(slot.label, { visible })
}

/** Bind an Echo to a free slot, or update it if already shown. Returns false when full. */
export function showEcho(echo: Echo): boolean {
  const existing = bound.get(echo.id)
  if (existing !== undefined) {
    updateEcho(echo)
    return true
  }

  const index = slots.findIndex((s) => s.echoId === null)
  if (index === -1) return false

  const slot = slots[index]
  slot.echoId = echo.id
  bound.set(echo.id, index)

  place(slot, echo)
  paint(slot, echo)
  TextShape.getMutable(slot.label).text = labelFor(echo)
  setVisible(slot, true)
  return true
}

/** Refresh a visible Echo in place — used when its interaction count changes. */
export function updateEcho(echo: Echo) {
  const index = bound.get(echo.id)
  if (index === undefined) return
  const slot = slots[index]
  paint(slot, echo)
  TextShape.getMutable(slot.label).text = labelFor(echo)
}

export function hideEcho(echoId: string) {
  const index = bound.get(echoId)
  if (index === undefined) return
  const slot = slots[index]
  setVisible(slot, false)
  slot.echoId = null
  bound.delete(echoId)
}

export function hideAllEchoes() {
  for (const slot of slots) {
    if (slot.echoId === null) continue
    setVisible(slot, false)
    slot.echoId = null
  }
  bound.clear()
}

export function visibleEchoIds(): string[] {
  return Array.from(bound.keys())
}

export function poolCapacity(): number {
  return slots.length
}
