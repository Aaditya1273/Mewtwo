import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { layout, palette, type as typeScale } from './theme'
import { closeOverlay, toggleDiagnostics, ui } from './state'

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

let preserveHandler: (bondId: string) => void = () => {}
export function onPreserve(handler: (bondId: string) => void) {
  preserveHandler = handler
}

let echoActionHandler: (action: EchoAction) => void = () => {}
export function onEchoAction(handler: (action: EchoAction) => void) {
  echoActionHandler = handler
}

/**
 * Top band: how alive the World is right now. Read-only, never blocks a tap.
 *
 * The label is memoised. react-ecs re-invokes every component each frame, so building
 * this string inline meant an array plus a join 60 times a second for a value that
 * changes a few times a minute.
 */
let warmthLabel = ''
let warmthKey = ''

export function WarmthBar() {
  const key = `${ui.livePlayers}|${ui.activeEchoes}`
  if (key !== warmthKey) {
    warmthKey = key
    const parts: string[] = []
    if (ui.livePlayers > 0) {
      parts.push(ui.livePlayers === 1 ? 'you are here' : `${ui.livePlayers} here now`)
    }
    parts.push(ui.activeEchoes === 1 ? '1 echo' : `${ui.activeEchoes} echoes`)
    warmthLabel = parts.join('   ·   ')
  }

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
          value: warmthLabel,
          fontSize: typeScale.caption,
          color: ui.connected ? palette.ink : palette.inkDim
        }}
      />
    </UiEntity>
  )
}

/**
 * Progress bar width, quantised to 2% steps.
 *
 * Without this the width is a newly allocated template string on every frame. Quantising
 * means the string changes about fifty times across a twenty second linger instead of
 * twelve hundred, and the bar still looks continuous.
 */
let barWidth: `${number}%` = '0%'
let barStep = -1

function lingerBarWidth(): `${number}%` {
  const step = Math.round(ui.lingerProgress * 50)
  if (step !== barStep) {
    barStep = step
    barWidth = `${step * 2}%`
  }
  return barWidth
}

/**
 * Connection dot plus the developer diagnostic.
 *
 * Collapsed it is one small dot: green connected, amber connecting, red offline. Tapping
 * it expands the panel. This is the only way, on a deployed World, to confirm that two
 * demo devices landed in the SAME realm — Decentraland can put two people on different
 * islands, and two people on different islands get different live rooms and can never
 * form a Bond with each other.
 *
 * Nothing here fakes cross-realm synchronisation. It reports what is actually true.
 */
export function Diagnostics() {
  const dot = ui.connected ? palette.echo : palette.bond

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: ui.diagnosticsOpen ? 170 : 28,
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: layout.touchTarget,
          height: 28,
          justifyContent: 'center',
          alignItems: 'center'
        }}
        uiText={{ value: ui.connected ? '●' : '○', fontSize: typeScale.caption, color: dot }}
        onMouseDown={toggleDiagnostics}
      />

      {ui.diagnosticsOpen ? (
        <UiEntity
          uiTransform={{
            width: '86%',
            maxWidth: 420,
            height: 138,
            flexDirection: 'column',
            padding: { left: 16, right: 16, top: 10, bottom: 10 }
          }}
          uiBackground={{ color: palette.glass }}
        >
          {[
            `world    ${ui.diag.worldId || '—'}`,
            `realm    ${ui.diag.realmId || '—'}`,
            `server   ${ui.connected ? 'connected' : 'offline'}  ${ui.diag.endpoint}`,
            `session  ${ui.diag.sessionId || '—'}`,
            `identity ${ui.diag.authenticated ? 'wallet (signature verified)' : 'guest'}`,
            `players  ${ui.diag.livePlayers} here (including you)`
          ].map((line, i) => (
            <UiEntity
              key={i}
              uiTransform={{ width: '100%', height: 20 }}
              uiText={{ value: line, fontSize: typeScale.caption, color: palette.inkDim }}
            />
          ))}
        </UiEntity>
      ) : (
        <UiEntity uiTransform={{ width: 0, height: 0 }} />
      )}
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
            uiTransform={{ width: lingerBarWidth(), height: '100%' }}
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
let returnLines: string[] = []
let returnLinesFor: unknown = null

export function ReturnPanel() {
  const a = ui.returnPanel
  if (!a) return <UiEntity uiTransform={{ width: 0, height: 0 }} />

  // Built once when the panel opens, not on every one of the frames it stays open.
  if (returnLinesFor === a) return renderReturnPanel(returnLines)
  returnLinesFor = a

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

  returnLines = lines
  return renderReturnPanel(lines)
}

function renderReturnPanel(lines: string[]) {
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

      <PreserveSection />

      <ActionButton
        label={bond.status === 'PRESERVED' ? 'Beautiful' : 'Not now'}
        color={palette.ink}
        width="70%"
        onPress={closeOverlay}
      />
    </Card>
  )
}

/**
 * Optional permanence.
 *
 * Only rendered when the server says preservation is available; otherwise the Bond card is
 * exactly what it always was and no blockchain concept appears anywhere in the product.
 *
 * The language stays memory / bond / preserve. Never mint, token, asset, or gas — a player
 * is recording a memory, not buying anything.
 *
 * One explanation, one action, one status. Nothing here can remove the Bond.
 */
function PreserveSection() {
  const bond = ui.bondCard
  if (!bond || !bond.canPreserve) return <UiEntity uiTransform={{ width: 0, height: 0 }} />

  if (bond.status === 'PRESERVED') {
    return (
      <UiEntity
        uiTransform={{ width: '100%', height: 40, justifyContent: 'center' }}
        uiText={{
          value: `✓  Bond #${String(bond.number).padStart(4, '0')} preserved`,
          fontSize: typeScale.body,
          color: palette.emberSoft
        }}
      />
    )
  }

  if (bond.status === 'PRESERVING') {
    return (
      <UiEntity
        uiTransform={{ width: '100%', height: 40, justifyContent: 'center' }}
        uiText={{ value: 'Preserving...', fontSize: typeScale.body, color: palette.inkDim }}
      />
    )
  }

  if (bond.status === 'FAILED') {
    return (
      <UiEntity
        uiTransform={{ width: '100%', height: 86, flexDirection: 'column', alignItems: 'center' }}
      >
        <UiEntity
          uiTransform={{ width: '100%', height: 38, justifyContent: 'center' }}
          uiText={{
            value: "Your Bond is still here.\nWe couldn't preserve it yet.",
            fontSize: typeScale.caption,
            color: palette.inkDim
          }}
        />
        <ActionButton
          label="Try again"
          color={palette.bond}
          width="70%"
          onPress={() => preserveHandler(bond.bondId)}
        />
      </UiEntity>
    )
  }

  // NOT_PRESERVED — either offer the action, or say we are waiting on the other person.
  if (bond.awaitingPartner) {
    return (
      <UiEntity
        uiTransform={{ width: '100%', height: 40, justifyContent: 'center' }}
        uiText={{
          value: `Waiting for ${bond.partnerName} to agree...`,
          fontSize: typeScale.caption,
          color: palette.inkDim
        }}
      />
    )
  }

  return (
    <UiEntity
      uiTransform={{ width: '100%', height: 104, flexDirection: 'column', alignItems: 'center' }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 34, justifyContent: 'center' }}
        uiText={{
          value: 'This memory can outlast the World.\nBoth of you must agree.',
          fontSize: typeScale.caption,
          color: palette.inkDim
        }}
      />
      <ActionButton
        label="Preserve this memory"
        color={palette.bond}
        width="80%"
        onPress={() => preserveHandler(bond.bondId)}
      />
    </UiEntity>
  )
}
