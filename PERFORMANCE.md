# LINGER — Performance

Mobile is the primary platform. This document records what LINGER actually does about
that, and what has and has not been measured.

**No frame rate is claimed anywhere in this repository.** We have not profiled LINGER on a
physical phone, so any FPS number would be invented. What follows is either counted from
the source, measured from a build, or stated as a design decision with its reasoning.

---

## 1. Measured

| Measurement | Value | How |
|---|---|---|
| Scene bundle, development build | 5.9 MB | `stat bin/index.js` after `sdk-commands build` |
| Scene bundle, **production build** | **534 KB** | after `sdk-commands build --production` |
| Scene payload excluding bundle | 440 KB | `du -sh scene` excluding `node_modules`/`bin` |
| 3-D assets shipped | **0 bytes** | the environment is generated from engine primitives |
| Scene typecheck | 0 errors | `npm run typecheck` |
| Server unit tests | 118 pass | `npm test` |
| Two-player journey over the live protocol | pass | `npm run test:journey` |
| Live restart / reconnect / disconnect resilience | pass | `npm run test:resilience` |

The production build is an 11× reduction and it is what `npm run deploy` uses. The
difference is sourcemaps; the donor project shipped the development build.

**Download comparison with the donor:** MRT-Backrooms shipped 84 MB of models, textures and
audio. LINGER ships none. A first visit downloads roughly half a megabyte total, which is
the single largest thing we did for mobile.

---

## 2. Entity budget

Counted directly from the source, not estimated.

| Group | Entities | Notes |
|---|---|---|
| Sanctuary ground + plinth | 2 | two squashed cylinders |
| Hearth glow ring | 48 | ribbon segments |
| Echo ring | 72 | ribbon segments |
| Entry portal | 3 | two stones + one label |
| Memory garden | 8 | low stones |
| Hearth | 3 | base, core, halo |
| **Echo pool** | **54** | 18 slots × (body + head + label) |
| **Baseline total** | **190** | everything present on arrival |
| Per Bond stone | 4 | plinth + two shards + label |
| Bond stones, capped | 160 | 40 stones maximum rendered |
| **Ceiling** | **350** | a World with 40 Bonds |

The count does not grow with visitor traffic. A World that has hosted ten thousand people
renders the same 190 entities as one that has hosted none, because Echoes are pooled and
capped and Bond stones have a render budget.

### The ring segment trade-off

The two decorative rings are 120 of the 190 baseline entities — the largest single group.
They are individual boxes because that lets the ring glow and lets its radius follow
`config.ts` without authoring a mesh. If a device profile ever shows this is too many, the
segment counts are two literals in `environment.ts` and can drop to 24/36 with little
visual loss. **This is the first thing to turn down**, and it is deliberately left as an
obvious knob rather than optimised prematurely.

---

## 3. Echo rendering strategy

The naive reading of "show me who was here" is to render previous visitors as avatars.
Roughly 18 skinned, animated avatars would be the most expensive thing on the screen by a
wide margin, and on a phone it would be the whole frame budget.

LINGER renders each Echo as **three primitives**: a tapered cylinder body, a sphere head,
and a billboarded text label. No skinning, no animation, no textures, no GLB.

- **Pooled.** `echoPool.ts` allocates `ECHO.maxVisible` slots once at startup. Showing an
  Echo binds it to a free slot; hiding it releases the slot. No entity is created or
  destroyed while the player is in the World.
- **Pointer handlers registered once.** Each slot's tap handler is registered at pool
  construction and reads the slot's *current* binding, so re-binding a slot to a different
  Echo costs nothing. (The donor re-registered a pointer handler for every pickup every 30
  frames; that pattern was not carried forward.)
- **Capped and configurable.** `ECHO.maxVisible` is 18. One number, one file.
- **Newest first.** When more Echoes exist than slots, the most recent win — "someone was
  here recently" is the product promise, so a fresh Echo is the one worth a slot.
- **Real Echoes outrank Genesis Echoes** for a contested slot, server-side.
- **Material, not geometry, carries state.** An Echo with more interactions is brighter and
  less transparent. Interaction count changes a colour, never an entity count.

---

## 4. Network

The rule is: **never send anything per frame.**

| Traffic | Rate | Trigger |
|---|---|---|
| Presence (position) | ≤ 1/s | only after moving ≥ 0.75 m or crossing the Hearth boundary |
| Wave | once | explicit button press |
| Create Echo | once per visit | 20-second linger completes |
| Interaction | once per tap | one action per opening of an Echo card |
| Activity read | once per visit | the return panel was actually displayed |
| Vitality broadcast | every 20 s | server-side interval |
| Bond evaluation | every 1 s | server-side, never sent by clients |

A player standing still sends **nothing at all**. `PRESENCE.minMoveDistance` exists
specifically so a player watching the Hearth is silent on the wire.

**What is not in the synchronised state.** `LingerState` carries only live presence plus
three numbers. Echoes and Bonds are persistent records delivered once at join and then as
discrete events. A World holding hundreds of Echoes costs nothing per tick, because the
Echoes are not in the tick.

**Optimistic local feedback.** A tap updates the local Echo immediately and sends in the
background. The server broadcasts the authoritative Echo, which overwrites the optimistic
value — so a rejected action self-corrects without the player ever waiting on a round trip.

**Bounded reconnect.** Five attempts with linear backoff, then it stops. The World stays
fully explorable while disconnected. (The donor reconnected in an unbounded loop and
accumulated a fresh set of listeners on every attempt.)

---

## 5. Per-frame work

The scene registers **no ECS systems**. Everything is on a timer sized to what it actually
observes:

| Work | Interval | Why not per frame |
|---|---|---|
| Hearth proximity + linger timer | 250 ms | one distance check against a fixed point; 4 Hz is imperceptible against a 20-second timer |
| Presence report + nearest-player | 1000 ms | matches the network throttle |
| Echo expiry sweep | 30 s | expiry is a 24-hour concern |
| Bond evaluation (server) | 1000 ms | the qualifying duration is 30 s |

The only genuinely per-frame code is the react-ecs UI renderer, which the SDK invokes each
frame. That was the one real hot spot, and this pass fixed it:

- **Warmth bar label** was building an array and a `join` every frame for a value that
  changes a few times a minute. Now memoised on `livePlayers|activeEchoes`.
- **Linger progress bar width** was allocating a fresh template string every frame. Now
  quantised to 2% steps — about 50 string allocations across a 20-second linger instead of
  roughly 1,200, and the bar still reads as continuous.
- **Return panel lines** were rebuilt every frame the panel stayed open. Now built once
  when it opens.

Material writes are also delta-guarded: `setHearthIntensity` ignores changes under 0.01 and
`setLingerProgress` under 0.02, so a 4 Hz tick does not mean 4 component writes a second.

---

## 6. Mobile-specific decisions

- **Bottom 34% of the screen is reserved.** `layout.reservedBottom` keeps every overlay out
  of the virtual joystick (bottom-left) and action buttons (bottom-right). No LINGER
  control is ever placed there.
- **64 px minimum touch target**, above the 44 pt guideline, because this is played with a
  thumb.
- **At most three actions on screen** at once, and never more than one modal.
- **The tap target is the Echo body collider**, one generous cylinder per Echo — no
  precision aiming, and the head and label are non-interactive so they cannot steal a tap.
- **No keyboard anywhere.** The wave is a button, not an emote wheel; emotes are not
  reachable one-thumbed on mobile.
- **The base UI layer is never interactive**, so a mis-tap cannot trigger anything.
- **The World is explorable before any network call resolves.** The sanctuary, Hearth and
  Echo pool are built synchronously; identity, realm and connection are all awaited after.

---

## 7. Known bottlenecks and honest limits

1. **Not profiled on a physical device.** Everything above is counted or measured from
   builds. The next real step is a mid-range Android run, and until that happens no frame
   rate should be quoted.
2. **The 120 ring segments are the obvious thing to reduce first.** See §2.
3. **Bond evaluation is O(n²) over players in a room**, once per second. Fine for a
   Hearth-sized group; if a room ever holds tens of players this wants a spatial bucket.
   Marked in `LingerRoom.evaluateBonds`.
4. **`MemoryPersistence` scans on every query.** It is a Map and array walk, correct and
   fast for demo volumes, and it does not survive a restart. The durable adapter is not
   implemented yet and `LINGER_PERSISTENCE=mongo` deliberately throws rather than silently
   falling back and losing a deployment's history. See the restart limitation in the README.
7. **`KeyedLock` is single-process.** It serialises the three check-then-write paths
   (Echo creation, interaction, Bond creation) within one server. Running more than one
   server process against shared storage would need a storage-level unique constraint or a
   distributed lock instead; a Map in one process cannot protect the others. Marked in
   `domain/keyedLock.ts`.
5. **`reconcile()` sorts the whole Echo store** whenever a new Echo arrives. Bounded by the
   server's 60-Echo page, so it is at most a 60-element sort on an event, not a frame.
6. **The production bundle is still ~529 KB**, essentially all SDK runtime. Not reducible
   from application code.

---

## 8. How to re-measure

```bash
# Bundle size
cd scene && npm run build:prod && stat -c '%s bytes' bin/index.js

# Entity budget — the counts in §2 come from config.ts and environment.ts
grep -n "maxVisible" scene/src/linger/config.ts
grep -n "ring(c," scene/src/linger/world/environment.ts

# Correctness
cd server && npm test           # 53 unit tests
cd server && npm run test:journey   # two players over the live protocol
```
