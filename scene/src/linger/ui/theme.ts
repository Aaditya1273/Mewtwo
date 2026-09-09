import { Color4 } from '@dcl/sdk/math'

/**
 * LINGER visual language: warm, quiet, premium.
 *
 * One amber accent (the Hearth), one cool accent (Echoes), one rose accent (Bonds).
 * Everything else is neutral. No gradients, no neon, no HUD chrome.
 */

export const palette = {
  /** Hearth amber — the only truly saturated colour in the scene. */
  ember: Color4.create(1.0, 0.62, 0.26, 1),
  emberSoft: Color4.create(1.0, 0.74, 0.45, 1),

  /** Echo pale blue-white — present, but never competing with the Hearth. */
  echo: Color4.create(0.72, 0.85, 0.95, 1),

  /** Bond rose — reserved exclusively for the Bond moment and Bond stones. */
  bond: Color4.create(0.96, 0.58, 0.72, 1),

  /** Ground and architecture. */
  stone: Color4.create(0.20, 0.19, 0.22, 1),
  stoneLight: Color4.create(0.30, 0.28, 0.32, 1),

  /** Text. */
  ink: Color4.create(0.98, 0.96, 0.93, 1),
  inkDim: Color4.create(0.98, 0.96, 0.93, 0.62),

  /** Soft glass panel background. */
  glass: Color4.create(0.08, 0.07, 0.09, 0.82),
  glassLight: Color4.create(1, 1, 1, 0.10),

  transparent: Color4.create(0, 0, 0, 0)
}

/**
 * Mobile safe zones.
 *
 * Decentraland's mobile client puts a virtual joystick bottom-left and the action
 * buttons bottom-right. Nothing interactive may sit in the lower third of the screen.
 * All LINGER UI lives in the top band or the vertical centre.
 */
export const layout = {
  /** Top band — Warmth / presence indicator. */
  topInset: 24,
  /** Minimum touch target. Apple's guidance is 44pt; we use more because of gloves-and-thumbs. */
  touchTarget: 64,
  /** Bottom region reserved for the client's own controls. Keep UI out of it. */
  reservedBottom: '34%' as `${number}%`,
  radius: 16,
  gap: 12
}

export const type = {
  hero: 34,
  title: 24,
  body: 18,
  caption: 14
}
