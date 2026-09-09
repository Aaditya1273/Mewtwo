# LINGER

**The Presence Protocol — Making Worlds Remember.**

> The World that is never empty, because everyone who leaves, stays.

*The Friendzone That Misses You.*

---

## The problem

Multiplayer Worlds have a cold-start problem. A visitor arrives, finds nobody there, and
leaves — which makes it more likely the next visitor finds nobody there either. Every
session starts from empty, and nothing a person does in a World survives their leaving it.

## The solution

LINGER lets a person's presence persist after they go.

You visit a small sanctuary. You spend twenty seconds at the Hearth. When you leave, you
leave an **Echo** behind. The next visitor sees genuine Echoes from the people who came
before, and can reach back to them. When two real people meet here and stay together, they
leave a **Bond** — and the Bond is permanent.

The World accumulates social history instead of resetting to empty.

This is not a mini-game. It is a presence primitive that other Decentraland Worlds could
eventually reuse.

---

## The loop

```
  linger at the Hearth  ──▶  leave an Echo  ──▶  someone interacts with it
          ▲                                                │
          │                                                ▼
       a Bond  ◀──  two real people meet  ◀──  you return and find out
```

1. **Linger.** Stand at the Hearth for about twenty seconds. The fire brightens as you stay.
2. **Echo.** Your presence persists for 24 hours as a translucent figure facing the fire.
3. **Interaction.** A later visitor taps your Echo — a Heart, a High-five, or reading your note.
4. **Return.** You come back and the World tells you: *someone remembered your Echo.*
5. **Bond.** Two live people wave to each other and stay together. A Bond stone appears near
   the Hearth with both names on it, and it never goes away.

---

## Try it

Two terminals. No database, no accounts, no external services.

```bash
# 1. the server
cd server && npm install && npm start

# 2. the scene
cd scene && npm install && npm start
```

The server runs on an in-memory store by default and seeds five Genesis Echoes, so the
World is never blank on a first visit.

### Verify it without a Decentraland client

```bash
cd server
npm test              # 157 unit tests covering every product rule
npm run test:journey     # two real clients drive the whole loop over the live protocol
npm run test:resilience  # server restart, reconnect, and mid-Bond disconnect
npm run test:all         # all three
```

`test:journey` boots the built server, connects two Colyseus clients, and walks the entire
judge journey: enter alone → find the Genesis Echoes → interact → leave a real Echo → leave
→ second player arrives and finds it → interacts → first player returns to *While You Were
Away* → both wave → **Bond #0001** → a later visitor still finds the Bond stone.

---

## Genesis Echoes

A judge may walk in alone. The World must still show what it is.

Five **Genesis Echoes** are authored by the LINGER team. They are not fake users, and
LINGER takes some care to make that impossible to mistake:

- they are named **LINGER Founding Visitor**
- they render **warm amber**; real visitor Echoes render **cool blue**
- their card says *Genesis Echo · LINGER Founding Visitor*
- they are marked `isGenesis` in the data and owned by a `linger:genesis:*` id that can
  never be a wallet
- **they are excluded from World Vitality.** A World nobody has visited reports an
  intensity of zero even with five Genesis Echoes standing in it.

A real person's interaction *with* a Genesis Echo does count — a real human made it.

LINGER never presents authored content as a real visitor.

---

## Architecture

```
scene/                        Decentraland SDK7, TypeScript
  src/linger/
    world/environment.ts      sanctuary built from engine primitives — no GLB, no textures
    hearth/                   proximity, 20s linger timer, vitality-driven glow
    echo/                     pooled visuals, lifecycle, interaction, Genesis fallback
    bond/                     permanent Bond stones
    presence/                 throttled position reporting, nearby-player tracking
    network/                  Colyseus client
    ui/                       mobile-first UI: theme, state, panels, root

server/                       Colyseus + Express, TypeScript
  src/linger/
    domain/                   product rules as pure functions
    persistence/              SocialPersistence interface + adapters
    service.ts                LingerService — every rule lives here
    rooms/LingerRoom.ts       live presence, Echo commit, Bond detection
    api/routes.ts             REST surface over the same service
```

**One rule engine, two entry points.** The Colyseus room and the REST routes are both thin
adapters over `LingerService`, so the tests exercise the real rules with no Decentraland
client and no database.

**Storage is an interface.** `SocialPersistence` has a complete in-memory adapter (the
default) and is the seam a durable or on-chain adapter plugs into later without touching
Echo or Bond logic.

```
SocialPersistence
├── MemoryPersistence      complete — the default, needs no services
├── MongoPersistence       not implemented yet
└── BlockchainPersistence  future — Bond provenance only, never per-interaction
```

### Security

- **Identity comes from a verified Decentraland signature.** The scene calls `signedFetch`,
  the server verifies the auth chain with Decentraland's own `decentraland-crypto-middleware`,
  and mints a single-use join ticket. That ticket is what crosses the Colyseus handshake,
  because a WebSocket upgrade cannot carry signature headers. A `publicKey` supplied by the
  client is ignored entirely.
- **Unsigned visitors are guests.** They get a `guest:<sessionId>` identity, which is
  namespaced and session-scoped, so it can never equal or collide with a wallet address.
  Set `LINGER_REQUIRE_SIGNED_AUTH=true` to refuse unsigned joins. A guest is a new person
  each session, so *"While You Were Away"* only works for a signed-in wallet.
- **Identity is bound once, at join, and held server-side.** No message or request body
  ever carries an owner or actor field. A client cannot act as anyone but itself.
- **The World is server configuration.** `LINGER_WORLD_URN` decides which World records
  belong to; a client cannot choose what it writes to, so Worlds cannot bleed into
  each other.
- **The server owns every field that matters** — id, owner, position, timestamps, expiry.
- **Rate limits** on Echo creation, interactions, and Bonds.
- **No `POST /bond`.** A Bond requires two live people to be co-present, both having waved,
  for a sustained period. Only the live room can witness that. Exposing a create endpoint
  would hand anyone a way to manufacture relationships over HTTP.

---

## Deployment

**This repository does not control any Decentraland World namespace, and does not claim
one.** `scene.json` ships the literal placeholder `LINGER_WORLD_URN`, and `npm run deploy`
refuses to run until a real name is configured.

```bash
cd scene
LINGER_WORLD_URN=yourname.dcl.eth \
LINGER_SERVER_WSS=wss://your-server.example.com \
  npm run configure

npm run deploy        # production build, then deploy
```

Server configuration:

| Variable | Default | Purpose |
|---|---|---|
| `LINGER_WORLD_URN` | `linger.local` | the World records are scoped to |
| `LINGER_PERSISTENCE` | `memory` | `memory` or `mongo` (not implemented) |
| `LINGER_SEED_GENESIS` | `true` | seed the five Genesis Echoes |
| `LINGER_REQUIRE_SIGNED_AUTH` | `false` | refuse joins without a verified signature |
| `LINGER_TICKET_TTL_SECONDS` | `60` | how long a join ticket stays redeemable |
| `LINGER_ALLOW_DEV_AUTH` | unset | trusts an identity header — **never in production** |
| `LINGER_CHAIN_ENABLED` | `false` | optional Bond preservation on Polygon |
| `MONITOR_PASSWORD` | unset | Colyseus monitor is disabled when unset |
| `PORT` | `2567` | |

---

## Mobile

Mobile is the primary platform, desktop is secondary.

The bottom 34% of the screen is reserved for the client's joystick and action buttons and
carries no LINGER control. Touch targets are 64 px. There are at most three actions on
screen at once and never more than one modal. Nothing requires a keyboard, precision
aiming, or an inventory. The wave is a single large button rather than an emote wheel,
because emotes are not reachable one-thumbed.

A first visit downloads about **537 KB** — the production bundle — and no 3-D assets at
all. See [`PERFORMANCE.md`](./PERFORMANCE.md) for the entity budget, the network rules, and
an honest list of what has and has not been measured. **No frame rate is claimed anywhere
in this repository**, because LINGER has not been profiled on a physical device.

---

## World Vitality

LINGER computes its own **World Vitality** signal from recent visitors, live Echoes,
interactions and Bonds, and uses it to drive how brightly the Hearth burns.

This is a **prototype discovery signal**. It is LINGER's own metric. It is not read by,
submitted to, or integrated with Decentraland Discover in any way.

---

## Known limitation: history does not survive a server restart

**Read this before a live demonstration.**

LINGER currently runs on `MemoryPersistence`. Echoes, interactions, Bonds and return
activity all live in the server process. **Restarting the server erases every one of
them.** The durable adapter is not implemented, and `LINGER_PERSISTENCE=mongo`
deliberately throws at boot rather than silently falling back and losing history.

What actually happens on restart, verified live by `npm run test:resilience`:

| | Behaviour |
|---|---|
| Visitor Echoes | **lost** |
| Interactions and return activity | **lost** |
| Bonds | **lost**, and numbering restarts at #0001 |
| Genesis Echoes | re-seeded — the World is never blank |
| A connected client | reconnects on its own and receives the re-seeded World |
| That client's Hearth | re-arms, with *"The Hearth was rekindled. You can linger again."* |

The client detects this: on every `welcome` it checks whether the Echo it left this visit
is still in the authoritative set, and if not it clears its local state. Without that the
player would be locked out of lingering for the rest of the session, holding an Echo id
that no longer exists.

**For a demo:** start the server once and leave it running. Everything created during the
session persists for as long as the process lives. If it does restart mid-demo, nothing
breaks and nothing needs restarting on the client — the accumulated history is simply gone
and the World starts over from the Genesis set.


---

## Status

Working: Hearth, Echo persistence, Echo rendering, Echo interaction, return activity, live
multiplayer presence, real-player Bonds, permanent Bond stones, mobile UI, a performance
pass, a hardening pass, and verified signed authentication — 118 unit tests plus two live
integration suites that authenticate with real Decentraland signatures.

Web3 is designed and abstracted but **not live**: `LINGER_CHAIN_ENABLED` defaults to
`false`, no contract is deployed, and nothing about the experience depends on it. See
[`WEB3_ARCHITECTURE.md`](./WEB3_ARCHITECTURE.md) — the target is a Polygon meta-transaction
so a player signs and pays no gas, and preservation requires both people to agree.

Not built yet, deliberately: the durable Mongo adapter, the on-chain contract itself,
Kindling, and cross-World features. The core loop comes first.

---

## Credits and licence

LINGER is Apache-2.0.

It is built on **MRT-Backrooms** (Decentraland GameJam 2023, Apache-2.0) as a technical
donor — principally its SDK7 Colyseus polyfills, without which the standard Colyseus client
cannot run inside Decentraland at all. The horror game it used to be is gone; the
infrastructure it contributed is credited in full.

[`MOBILE_TEST.md`](./MOBILE_TEST.md) is the manual checklist to run on a real phone before
a demonstration — including how to confirm two devices are on the same realm.

[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) lists exactly which files came from the
donor and which are original LINGER work. [`LINGER_MIGRATION.md`](./LINGER_MIGRATION.md)
records the audit the transformation was based on.
