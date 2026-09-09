# LINGER — Migration Audit

**Donor project:** MRT-Backrooms (Decentraland GameJam 2023), Apache License 2.0.
**Target product:** LINGER — *The Presence Protocol — Making Worlds Remember.*

This document records what the donor project actually contains, what LINGER keeps,
what it removes, and what it rewrites. It was produced by inspecting the repository,
installing both projects' dependencies, and running the typechecker and build against
the current SDK — not from the donor's README.

---

## 1. Verified facts about the donor

Measured on 2026-09-09, Node v26.5.0 / npm 10.9.8.

| Item | Finding |
|---|---|
| Scene SDK | `@dcl/sdk` declared `^7.3.1` → **resolves and installs 7.27.0** |
| `@dcl/js-runtime` | pinned exactly `7.3.1` (mismatched with the SDK it types) |
| Scene TypeScript | inherited from `@dcl/sdk/types/tsconfig.ecs7.json`, `strict: true`, `jsx: react` |
| Scene build | `sdk-commands build` — **esbuild bundle succeeds** (`bin/index.js` written), **typecheck fails with 11 errors** |
| Server TypeScript | `4.6.4`, `experimentalDecorators`, `skipLibCheck` already on |
| Server typecheck | **failed** — TS 4.6 cannot *parse* hoisted `@types/node@26` (syntax errors, `skipLibCheck` does not help). **Fixed** by pinning `@types/node@^18`; now **0 errors** |
| Server runtime | Colyseus `0.14` via `@colyseus/arena` `0.14.24` |
| Database | MongoDB via MikroORM `4.5` |
| Tests | **none**, either project. `server` test script is `exit 1` |
| CI | none for these two projects |
| Git | scene/ and server/ were **entirely untracked**; repo HEAD held an unrelated project. Snapshotted on branch `linger` as commit `f0116e4` before any change |

### The 11 scene typecheck errors — both causes are trivial

1. **8 × `TS2353: 'name' does not exist in type 'PBAnimationState'`**
   SDK7 removed `name` from animation states; only `clip` remains
   (`@dcl/protocol/.../animator.gen.d.ts:16-29`). Sites: `enemies/enemy.ts:131,137,143`,
   `modules/entityManager.ts:15`, `modules/mapgen/levelgeneration.ts:703,709,1397,1403`.
   All but `entityManager.ts` are in code LINGER deletes.
2. **3 × errors inside `node_modules/@colyseus/schema/lib/types/ArraySchema.d.ts`**
   colyseus.js 0.14's `ArraySchema<V> extends Array<V>` is not assignable under a modern
   `lib.es`. Scene-side only. Resolved with `skipLibCheck` in the scene tsconfig.

**Conclusion: there is no SDK compatibility blocker.** The donor is one deprecated field
and one tsconfig flag away from a clean build on SDK 7.27.

---

## 2. Existing MRT architecture

```
scene/  (Decentraland SDK7, ~4.5k LOC, 84 MB assets)
  src/index.ts            → main() → initGamePlay()
  src/gameplay.ts         → one executeTask: userData → colyseus → systems → UI
  src/globals.ts          → tuning constants, backend URL, leaderboard cache
  src/modules/
    connection.ts         → NetworkManager: colyseus.js client, room lifecycle, listeners
    userState.ts          → local player model (health, timers, inventory, flags)
    entityManager.ts      → createEntity / createPlaneShapeEntity helpers
    playerSounds.ts       → AvatarAttach-ed one-shot AudioSource, auto-cleanup
    fog.ts                → AvatarAttach-ed fog model (zero per-frame cost)
    text_collection.ts    → hardcoded horror copy
    compatibility/polyfill/  → XMLHttpRequest, setTimeout, FormData, base64 shims
    mapgen/               → 2.6k LOC procedural dungeon generator
    logic/weighted_random.ts
  src/enemies/            → Enemy/Mimic/Ink/Worm components, systems, A* grid
  src/objects/            → inventory, pickups, traps, ink spots
  src/ui.tsx              → 1009 LOC react-ecs: title, leaderboard, HUD, prompts
  src/resources/          → asset path constants

server/  (Colyseus + Express + MikroORM/Mongo, ~700 LOC)
  src/index.ts            → listen(arenaConfig, PORT)
  src/arena.config.ts     → Arena(): room defs, Express, CORS allowlist, Sentry, monitor
  src/rooms/MainRoom.ts   → 'lobby_room', filterBy(['realm']), message handlers
  src/rooms/dbUtils.ts    → repository access, join/save/leaderboard
  src/rooms/schema/       → Colyseus Schema (Player, MainRoomState)
  src/rooms/env.ts        → config map, admin list, leaderboard cache
  src/entities/           → MikroORM BaseEntity, User, Stat, Config
  src/config/database.config.ts → MikroORM DI container
  src/helpers/security/   → runChecks, checkPlayer — WRITTEN BUT NEVER CALLED
  src/helpers/logger.js, timeUtils.ts, utils.ts, telegram.ts (empty)
```

---

## 3. What we reuse

### Scene — reuse as-is or lightly adapted

| Asset | Why it is worth keeping |
|---|---|
| `modules/compatibility/polyfill/` | **The single most valuable donation.** SDK7's runtime has no `XMLHttpRequest`, `setTimeout`, `FormData` or `atob`/`btoa`. These shims are what let the stock `colyseus.js` client run inside Decentraland at all. Rebuilding this is days of work. Credited upstream to `decentraland-scenes/cube-jumper-colyesus-sdk7`. |
| `modules/connection.ts` | Correct Colyseus connect / create-or-join / reconnect / listener shape. LINGER simplifies it (bounded reconnect, listener de-duplication) but keeps the structure. |
| `modules/entityManager.ts` | Small correct entity factory helpers. Needs the `PBAnimationState.name` → `clip` fix. |
| `modules/playerSounds.ts` | `AvatarAttach` + auto-removing one-shot audio. Reused verbatim for LINGER's warm feedback sounds. |
| `modules/fog.ts` (pattern only) | The *technique* — attach a visual to `AAPT_POSITION` instead of tracking the player per frame — is exactly how LINGER's Warmth aura should work. The horror fog models go. |
| `modules/logic/weighted_random.ts` | Tiny, correct, dependency-free. Kept for Echo pose/emote variety. |
| react-ecs UI framework | `ReactEcsRenderer.setUiRenderer(fn)` with a module-level `currentUi` switch is the right SDK7 pattern. The **framework usage** stays; every screen is rewritten. |
| `pointerEventsSystem.onPointerDown` | Correct SDK7 interaction primitive, and it is touch-friendly on mobile. Reused for Echo taps. |
| ECS component patterns | `engine.defineComponent('X', {…Schemas})` + `engine.getEntitiesWith(...)` usage is idiomatic and correct. |
| `scene.json` structure | Kept; parcels shrunk, `worldConfiguration` made configurable. |

### Server — reuse as-is or lightly adapted

| Asset | Why |
|---|---|
| `arena.config.ts` skeleton | Room registration, Express mounting, CORS allowlist, basic-auth monitor. Sound structure; LINGER swaps the room and hardens the details. |
| `filterBy(['realm'])` | **Already solves the realm-isolation requirement** for live rooms. LINGER extends the same key into persistent records. |
| `MikroORM` + `BaseEntity` | Working `_id`/`id`/`createdAt`/`updatedAt` base class and DI container. New LINGER entities extend it. No new database introduced. |
| `dbUtils.ts` repository pattern | `DI.em.fork().getRepository(X)` per operation is correct for Colyseus concurrency. Reused shape. |
| Colyseus `Schema` state | Correct approach for live presence sync. LINGER defines its own schema. |
| `helpers/security/*` | Currently dead code, but it is *correct* dead code — origin check, IP denylist, catalyst position verification, Decentraland signature types. LINGER **wires it up** rather than reinventing it. |
| `helpers/logger.js`, `timeUtils.ts` | Small utilities, no reason to rewrite. |

---

## 4. What we remove

Nothing below is salvageable for a social-presence product.

**Scene**
- `src/enemies/` — Enemy/Mimic/Ink/Worm components, systems, spawn tables *(the A* grid in `pathfinding.ts` goes with it; LINGER has no navigation problem)*
- `src/objects/` — inventory, pickups, traps, ink spots, the lorem-ipsum `createBox` prompt
- `src/modules/mapgen/` — all 2.6k LOC of dungeon generation, decal maps, furniture maps, room shapes, zones
- `src/modules/fog.ts` — horror fog models (the *pattern* is kept, the content is not)
- `src/modules/text_collection.ts` — horror copy
- `src/ui.tsx` — title/leaderboard/health/inventory HUD, all horror imagery
- `src/globals.ts` — monster speeds, health, inventory enums
- `src/inputSystem.ts` — hotkey item use (keyboard-dependent; fails the mobile requirement)
- Horror assets: `models/enemies/`, `models/doors/`, `models/rooms/`, `models/furniture/`, horror `models/objects/`, `images/textures/decals/`, `images/UI/`, `sounds/objects/monsters/`, `sounds/tape/`
- Branding: MRT title card, Backrooms description, `scene-thumbnail.png`, README

**Server**
- `MainRoom` message handlers: `damageReceived`, `healingReceived`, `healthBuffing`, `setLeader`
- Health/leaderboard fields on `Player` and `User`
- Unused Web3 surface: `ethers`, `abi-decoder`, `ethereum-multicall`, `@colyseus/social`, and the never-called `getProvider`/`getSigner`
- `mikro-orm.config.ts` (100% commented out), `telegram.ts` (empty file)

---

## 5. What we rewrite or modernize

| Item | Action |
|---|---|
| `PBAnimationState.name` | → `clip`. The one genuine deprecated-API break. |
| Scene `tsconfig.json` | add `skipLibCheck: true` for the colyseus.js 0.14 `ArraySchema` d.ts. |
| `@dcl/js-runtime` `7.3.1` | → track the SDK version. |
| `@types/node` (server) | pin `^18`. **Already applied** — TS 4.6 cannot parse v26. |
| `@colyseus/ws-transport` | imported by `arena.config.ts` but **absent from `package.json`**; only resolves transitively. Declare it. |
| Identity trust | MRT takes the wallet from `options.userData.publicKey` and never verifies it. LINGER binds identity to the Colyseus session **once, at join**, and derives every owner field server-side. Client-supplied owner/actor fields are ignored. |
| Dead security code | `runChecks` / `checkPlayer` get wired into the REST surface instead of sitting unused. |
| `getPath` allocations | deleted with the enemy system — the donor's worst hot path leaves with it. |
| `pickUpSystem` re-registering pointer handlers every 30 frames | pattern not carried forward; LINGER registers handlers once at spawn. |
| Module-level timer handles (`ink_timer` etc.) overwritten per spawn | pattern not carried forward; LINGER tracks timers per entity. |
| `resources.ts` `images/ui/…` vs on-disk `images/UI/…` | case-mismatched paths — a latent break on case-sensitive hosting. Directory deleted; new paths are lowercase. |
| Hardcoded `backend_wss` and Sentry DSN | moved to configuration. |
| `MONITOR_PASSWORD` used with no presence check | guarded. |

---

## 6. Dependency and SDK risk register

| Risk | Severity | Decision |
|---|---|---|
| TS 4.6 vs `@types/node` 26 | **was blocking** | Fixed: pin `@types/node@^18`. Server typechecks clean. |
| `PBAnimationState.name` removed | low | Rename to `clip` in the 1 surviving file. |
| colyseus.js `0.14.15-alpha.0` client, server `0.14` | medium | **Do not upgrade.** Client and server match, and 0.14 is what the SDK7 polyfills were written against. 0.16 changes the client API and would invalidate the polyfill work. Frozen deliberately. |
| `@colyseus/arena` 0.14.24 is superseded by `@colyseus/tools` | low | Works; migrating buys nothing for this MVP. Frozen. |
| MikroORM 4.5 (current: 7.x) | medium | Frozen — it typechecks and works. Isolated behind `SocialPersistence` so it can be replaced later without touching product logic. |
| Requiring MongoDB to demo | medium | Mitigated by shipping an in-memory persistence adapter as the default. The server runs with **zero external services**; Mongo is opt-in via env. |
| `@dcl/sdk` floats on `^7.3.1` | medium | Pin explicitly so a judge's `npm i` cannot silently drift. |
| Node 26 vs `engines: node >=16` | low | Both installed and ran fine. |

---

## 7. Proposed LINGER architecture

```
scene/src/
  index.ts                    main() → bootstrapLinger()
  linger/
    config.ts                 all tunables: radii, durations, caps, endpoints
    types/linger.ts           Echo, EchoInteraction, Bond, Presence, WorldVitality
    world/
      environment.ts          sanctuary geometry from primitives (no heavy GLB)
      vitality.ts             world-state → visual intensity mapping
    hearth/
      hearthSystem.ts         proximity detection, linger timer, Echo commit
      hearthRenderer.ts       Hearth entity + activity-driven glow
    echo/
      echoPool.ts             fixed-size pooled visuals, no per-frame allocation
      echoRenderer.ts         silhouette build/update from Echo data
      echoSystem.ts           fetch, expiry, pooling policy, cap enforcement
      echoInteraction.ts      tap → action card → server call → local feedback
    bond/
      bondSystem.ts           live-player proximity + mutual wave → Bond request
      bondRenderer.ts         permanent Bond stones near the Hearth
    presence/
      presenceSystem.ts       throttled position/emote reporting, live roster
    network/
      lingerClient.ts         Colyseus room wrapper (replaces NetworkManager)
      lingerApi.ts            typed request/response helpers
    ui/
      root.tsx                UI router
      warmthUI.tsx            top presence/warmth indicator
      promptUI.tsx            centre contextual prompt ("Sit & Linger")
      echoUI.tsx              compact Heart / High-five / Read Note card
      returnUI.tsx            "While You Were Away"
      bondUI.tsx              Bond celebration card
      theme.ts                colours, spacing, type scale, safe-area zones
  modules/compatibility/      KEPT — SDK7 polyfills
  modules/entityManager.ts    KEPT — fixed
  modules/playerSounds.ts     KEPT
  modules/logic/              KEPT

server/src/
  linger/
    domain/
      echo.ts                 creation, expiry, validation rules
      bond.ts                 eligibility, duplicate prevention
      vitality.ts             world vitality computation
      rateLimit.ts            per-identity token buckets
    persistence/
      SocialPersistence.ts    the interface
      MemoryPersistence.ts    default; zero external services
      MongoPersistence.ts     MikroORM adapter reusing the existing DI
      BlockchainPersistence.ts  P2 — provenance only, stubbed behind the same interface
    entities/                 EchoEntity, BondEntity, ActivityEntity (extend BaseEntity)
    rooms/LingerRoom.ts       live presence, Echo commit, interaction, Bond detection
    rooms/schema/             LingerState, PresencePlayer
    api/routes.ts             REST surface over the same service layer
    service.ts                LingerService — the single place product rules live
  helpers/security/           KEPT and finally wired in
  config/database.config.ts   KEPT
```

**Two entry points, one implementation.** Every product rule lives in `LingerService`.
The Colyseus room and the REST routes are both thin adapters over it, so the tests can
exercise the real rules over HTTP without a Decentraland client.

**Persistence is an interface from day one**, which is what makes the later blockchain
layer an added adapter rather than a rewrite:

```
SocialPersistence
├── MemoryPersistence      (default — demo and tests, no services required)
├── MongoPersistence       (durable — reuses MRT's MikroORM/Mongo)
└── BlockchainPersistence  (P2 — Bond provenance only, never per-interaction)
```

---

## 8. Sequencing

P0 — Hearth · Echo · Echo persistence · Echo interaction · Return activity · live
multiplayer · Bond · mobile UX.
P1 — Hearth vitality · Bond visual polish · richer return experience · analytics.
P2 — Kindling · cross-world signals · blockchain Bond certificate.

Typecheck, test and build run after every step.

---

## 9. Attribution

The donor project is Apache-2.0. `scene/LICENSE` is retained unmodified, the notice is
preserved, and `THIRD_PARTY_NOTICES.md` records which files originate from MRT-Backrooms
and which are original LINGER work. The SDK7 polyfills carry their own upstream credit to
`decentraland-scenes/cube-jumper-colyesus-sdk7`, which is preserved in the source header.

LINGER does not claim authorship of donor infrastructure, and does not present the donor
project's assets or copy as its own.
