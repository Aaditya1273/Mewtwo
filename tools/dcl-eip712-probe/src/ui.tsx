import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

/** Minimal on-screen readout, so the probe is usable on a phone without a console. */

export interface ProbeState {
  status: 'RUNNING' | 'PASS' | 'FAIL' | 'UNVERIFIED'
  lines: string[]
  detail: string
}

let state: ProbeState = { status: 'RUNNING', lines: [], detail: '' }

export function setResult(next: ProbeState) {
  state = { status: next.status, lines: next.lines.slice(-14), detail: next.detail }
}

const colours: Record<string, Color4> = {
  RUNNING: Color4.create(0.85, 0.85, 0.9, 1),
  PASS: Color4.create(0.45, 0.9, 0.55, 1),
  FAIL: Color4.create(1, 0.42, 0.42, 1),
  UNVERIFIED: Color4.create(1, 0.78, 0.35, 1)
}

const ui = () => (
  <UiEntity
    uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', padding: 16 }}
  >
    <UiEntity
      uiTransform={{ width: '100%', height: 56, justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: Color4.create(0.06, 0.06, 0.08, 0.92) }}
      uiText={{
        value: `EIP-712 PROBE — ${state.status}`,
        fontSize: 26,
        color: colours[state.status]
      }}
    />
    <UiEntity
      uiTransform={{ width: '100%', height: 26 }}
      uiText={{ value: state.detail, fontSize: 14, color: Color4.create(0.85, 0.85, 0.9, 1) }}
    />
    {state.lines.map((line, i) => (
      <UiEntity
        key={i}
        uiTransform={{ width: '100%', height: 18 }}
        uiText={{
          value: line,
          fontSize: 11,
          color: Color4.create(0.78, 0.78, 0.84, 1),
          textAlign: 'middle-left'
        }}
      />
    ))}
  </UiEntity>
)

export function initUi() {
  ReactEcsRenderer.setUiRenderer(ui)
}
