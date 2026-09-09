import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import * as utils from '@dcl-sdk/utils'
import { BondCard, Diagnostics, EchoCard, Prompt, ReturnPanel, Toast, WarmthBar, WavePanel } from './panels'
import { ui } from './state'

/**
 * UI root.
 *
 * One always-present layer (warmth + prompt + toast) and at most one modal overlay.
 * There is never more than one overlay on screen, and the base layer is never
 * interactive — so a mis-tap can't ever hit something the player didn't mean.
 */

const root = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column' }}>
    <WarmthBar />
    <Diagnostics />
    {ui.overlay === 'none' ? <Prompt /> : <UiEntity uiTransform={{ width: 0, height: 0 }} />}
    {ui.overlay === 'none' ? <WavePanel /> : <UiEntity uiTransform={{ width: 0, height: 0 }} />}
    <Toast />

    {ui.overlay === 'echo' ? <EchoCard /> : <UiEntity uiTransform={{ width: 0, height: 0 }} />}
    {ui.overlay === 'return' ? <ReturnPanel /> : <UiEntity uiTransform={{ width: 0, height: 0 }} />}
    {ui.overlay === 'bond' ? <BondCard /> : <UiEntity uiTransform={{ width: 0, height: 0 }} />}
  </UiEntity>
)

export function initUi() {
  ReactEcsRenderer.setUiRenderer(root)
}

let toastTimer: unknown

/** Show a one-line confirmation for a moment. A second call replaces the first. */
export function toast(message: string, durationMs = 2600) {
  if (toastTimer !== undefined) utils.timers.clearTimeout(toastTimer as number)
  ui.toast = message
  toastTimer = utils.timers.setTimeout(() => {
    ui.toast = ''
    toastTimer = undefined
  }, durationMs)
}
