import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { layout, palette, type as typeScale } from './theme'
import { closeOverlay, ui } from './state'

/**
 * LINGER panels.
 *
 * Mobile rules applied throughout:
 *  - nothing interactive below `layout.reservedBottom` (joystick / action buttons)
 *  - every tappable row is at least `layout.touchTarget` tall
 *  - at most three actions on screen at once
 *  - no scrolling, no nesting, no keyboard input anywhere
 */

export type EchoAction = 'heart' | 'highfive' | 'read'

let waveHandler: () => void = () => {}
export function onWave(handler: () => void) {
  waveHandler = handler
}

let echoActionHandler: (action: EchoAction) => void = () => {}
export function onEchoAction(handler: (action: EchoAction) => void) {
  echoActionHandler = handler
}

/** Top band: how alive the World is right now. Read-only, never blocks a tap. */
export function WarmthBar() {
  const parts: string[] = []
  if (ui.livePlayers > 0) {
    parts.push(ui.livePlayers === 1 ? 'you are here' : `${ui.livePlayers} here now`)
  }
  parts.push(ui.activeEchoes === 1 ? '1 echo' : `${ui.activeEchoes} echoes`)

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
        margin: { top: layout.topInset, left: 0, right: 0, bottom: 0 }
      }}
    >
      <UiEntity
        uiTransform={{
          height: 40,
          minWidth: 220,
          justifyContent: 'center',
          alignItems: 'center',
          padding: { left: 20, right: 20, top: 0, bottom: 0 }
        }}
        uiBackground={{ color: palette.glass }}
        uiText={{
          value: parts.join('   ·   '),
          fontSize: typeScale.caption,
          color: ui.connected ? palette.ink : palette.inkDim
        }}
      />
    </UiEntity>
  )
}

/** Centre contextual prompt plus the linger progress bar. */
export function Prompt() {
  if (!ui.prompt) return <UiEntity uiTransform={{ width: 0, height: 0 }} />

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 120,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        margin: { top: 40, left: 0, right: 0, bottom: 0 }
      }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 44, justifyContent: 'center' }}
        uiText={{ value: ui.prompt, fontSize: typeScale.title, color: palette.ink }}
      />

      {ui.lingering ? (
        <UiEntity
          uiTransform={{
            width: 260,
            height: 6,
            margin: { top: 14, left: 0, right: 0, bottom: 0 }
          }}
          uiBackground={{ color: palette.glassLight }}
        >
          <UiEntity
            uiTransform={{ width: `${Math.round(ui.lingerProgress * 100)}%`, height: '100%' }}
            uiBackground={{ color: palette.ember }}
          />
        </UiEntity>
      ) : (
        <UiEntity uiTransform={{ width: 0, height: 0 }} />
      )}
    </UiEntity>
  )
}

/**
 * The wave affordance.
 *
 * Appears only when another live player is within Bond radius. A Bond needs a deliberate,
 * reciprocal gesture from both people — this is that gesture, as a single large button
 * rather than an emote wheel, because emotes are not reachable on mobile with one thumb.
 */
export function WavePanel() {
  if (!ui.nearbyName) return <UiEntity uiTransform={{ width: 0, height: 0 }} />

  const line = ui.bothWaved
    ? `Stay with ${ui.nearbyName} a little longer...`
    : ui.theyWaved
      ? `${ui.nearbyName} waved at you`
      : `${ui.nearbyName} is here`

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 130,
        flexDirection: 'column',
        alignItems: 'center',
        margin: { top: 8, left: 0, right: 0, bottom: 0 }
      }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 30, justifyContent: 'center' }}
        uiText={{
          value: line,
          fontSize: typeScale.body,
          color: ui.bothWaved ? palette.bond : palette.ink
        }}
      />

      {ui.canWave ? (
        <ActionButton
          label="👋  Wave back"
          color={palette.emberSoft}
          width="52%"
          onPress={() => waveHandler()}
        />
      ) : (
        <UiEntity uiTransform={{ width: 0, height: 0 }} />
      )}
    </UiEntity>
  )
}

/** Transient confirmation line. One at a time; never a queue. */
export function Toast() {
  if (!ui.toast) return <UiEntity uiTransform={{ width: 0, height: 0 }} />
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 40,
        justifyContent: 'center',
        margin: { top: 12, left: 0, right: 0, bottom: 0 }
      }}
      uiText={{ value: ui.toast, fontSize: typeScale.body, color: palette.emberSoft }}
    />
  )
}

function ActionButton(props: {
  label: string
  color: Color4
  onPress: () => void
  width?: number | `${number}%`
}) {
  return (
    <UiEntity
      uiTransform={{
        width: props.width ?? '31%',
        height: layout.touchTarget,
        justifyContent: 'center',
        alignItems: 'center',
        margin: { left: 4, right: 4, top: 0, bottom: 0 }
      }}
      uiBackground={{ color: palette.glassLight }}
      uiText={{ value: props.label, fontSize: typeScale.body, color: props.color }}
      onMouseDown={props.onPress}
    />
  )
}

/** Overlay shell: a centred glass card that never reaches the reserved bottom band. */
function Card(props: { height: number; children?: any }) {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        positionType: 'absolute'
      }}
    >
      <UiEntity
        uiTransform={{
          width: '86%',
          maxWidth: 460,
          height: props.height,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: { left: 22, right: 22, top: 18, bottom: 18 },
          margin: { bottom: layout.reservedBottom, top: 0, left: 0, right: 0 }
        }}
        uiBackground={{ color: palette.glass }}
      >
        {props.children}
      </UiEntity>
    </UiEntity>
  )
}

/** Compact Echo interaction card: three large actions, nothing else. */
export function EchoCard() {
  const card = ui.echoCard
  if (!card) return <UiEntity uiTransform={{ width: 0, height: 0 }} />

  const acted = card.acted !== ''

  return (
    <Card height={acted ? 210 : 300}>
      <UiEntity
        uiTransform={{ width: '100%', height: 34 }}
        uiText={{
          value: card.name,
          fontSize: typeScale.title,
          color: card.isGenesis ? palette.emberSoft : palette.ink
        }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: 22 }}
        uiText={{ value: card.subtitle, fontSize: typeScale.caption, color: palette.inkDim }}
      />

      {acted ? (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 60,
            justifyContent: 'center',
            margin: { top: 12, left: 0, right: 0, bottom: 0 }
          }}
          uiText={{
            value:
              card.acted === 'read'
                ? card.note || 'They left no words.'
                : 'They will know you were here.',
            fontSize: typeScale.body,
            color: palette.ink
          }}
        />
      ) : (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: layout.touchTarget,
            flexDirection: 'row',
            justifyContent: 'center',
            margin: { top: 22, left: 0, right: 0, bottom: 0 }
          }}
        >
          <ActionButton
            label="♥  Heart"
            color={palette.bond}
            onPress={() => echoActionHandler('heart')}
          />
          <ActionButton
            label="✋  High-five"
            color={palette.emberSoft}
            onPress={() => echoActionHandler('highfive')}
          />
          <ActionButton
            label="✉  Note"
            color={palette.echo}
            onPress={() => echoActionHandler('read')}
          />
        </UiEntity>
      )}

      <ActionButton
        label={acted ? 'Close' : 'Not now'}
        color={palette.inkDim}
        width="60%"
        onPress={closeOverlay}
      />
    </Card>
  )
}

/** "While you were away" — the retention moment. Quiet, never a notification dump. */
export function ReturnPanel() {
  const a = ui.returnPanel
  if (!a) return <UiEntity uiTransform={{ width: 0, height: 0 }} />

  const lines: string[] = []
  if (a.hearts > 0) {
    lines.push(a.hearts === 1 ? '♥   Someone left a Heart on your Echo.' : `♥   ${a.hearts} Hearts on your Echo.`)
  }
  if (a.highfives > 0) {
    lines.push(
      a.highfives === 1 ? '✋   Someone high-fived your Echo.' : `✋   ${a.highfives} high-fives on your Echo.`
    )
  }
  if (a.reads > 0) {
    lines.push(a.reads === 1 ? '✉   Someone read your note.' : `✉   ${a.reads} people read your note.`)
  }
  for (const bond of a.newBonds) {
    lines.push(`◈   Your Bond with ${bond.playerB.name || 'someone'} still stands.`)
  }

  return (
    <Card height={150 + lines.length * 36}>
      <UiEntity
        uiTransform={{ width: '100%', height: 30 }}
        uiText={{ value: 'WHILE YOU WERE AWAY', fontSize: typeScale.caption, color: palette.inkDim }}
      />
      {lines.map((line, i) => (
        <UiEntity
          key={i}
          uiTransform={{
            width: '100%',
            height: 34,
            margin: { top: 6, left: 0, right: 0, bottom: 0 }
          }}
          uiText={{ value: line, fontSize: typeScale.body, color: palette.ink }}
        />
      ))}
      <ActionButton
        label="The World remembered me"
        color={palette.ink}
        width="90%"
        onPress={closeOverlay}
      />
    </Card>
  )
}

/** Bond celebration. The single most emotionally loaded screen in the product. */
export function BondCard() {
  const bond = ui.bondCard
  if (!bond) return <UiEntity uiTransform={{ width: 0, height: 0 }} />

  return (
    <Card height={280}>
      <UiEntity
        uiTransform={{ width: '100%', height: 28 }}
        uiText={{ value: 'YOU MADE A BOND', fontSize: typeScale.caption, color: palette.bond }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: 44, margin: { top: 10, left: 0, right: 0, bottom: 0 } }}
        uiText={{ value: bond.nameA, fontSize: typeScale.hero, color: palette.ink }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: 26 }}
        uiText={{ value: '+', fontSize: typeScale.title, color: palette.bond }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: 44 }}
        uiText={{ value: bond.nameB, fontSize: typeScale.hero, color: palette.ink }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: 24, margin: { top: 8, left: 0, right: 0, bottom: 0 } }}
        uiText={{
          value: `Bond #${String(bond.number).padStart(4, '0')}  ·  it stays here`,
          fontSize: typeScale.caption,
          color: palette.inkDim
        }}
      />
      <ActionButton label="Beautiful" color={palette.ink} width="70%" onPress={closeOverlay} />
    </Card>
  )
}
