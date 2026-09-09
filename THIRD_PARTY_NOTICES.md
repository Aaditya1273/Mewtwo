# Third-Party Notices and Attribution

LINGER is a derivative work. This file records honestly what we wrote and what we did not.

---

## 1. MRT-Backrooms (Decentraland GameJam 2023)

**License:** Apache License 2.0 — full text in [`LICENSE`](./LICENSE) and [`scene/LICENSE`](./scene/LICENSE)
**Copyright:** the MRT Team
**Role in LINGER:** technical donor. LINGER is built on this project's Decentraland SDK7
scene scaffolding and Colyseus server scaffolding.

We do **not** claim authorship of the following. They originate with the MRT Team and are
used under the Apache License 2.0:

| Path | What it is |
|---|---|
| `scene/src/modules/compatibility/polyfill/` | `XMLHttpRequest`, `setTimeout`, `FormData` and base64 shims that let `colyseus.js` run inside Decentraland's SDK7 runtime |
| `scene/src/modules/entityManager.ts` | entity/GLTF factory helpers *(modified: `PBAnimationState.name` → `clip`)* |
| `scene/src/modules/playerSounds.ts` | avatar-attached one-shot audio with automatic cleanup |
| `scene/src/modules/logic/weighted_random.ts` | weighted random selection |
| `server/src/arena.config.ts` | Colyseus Arena bootstrap, Express mounting, CORS allowlist, monitor auth *(modified for LINGER)* |
| `server/src/config/database.config.ts` | MikroORM connection *(modified: entities are now an argument rather than hardcoded)* |
| `server/src/entities/BaseEntity.ts` | MikroORM base entity (`_id`, `id`, `createdAt`, `updatedAt`) |
| `server/src/helpers/security/` | Decentraland origin, IP denylist and catalyst-position checks |
| `server/src/helpers/utils.ts` | constants and types the security checks depend on |

The Apache-2.0 `NOTICE` and copyright headers present in the donor sources are preserved.

### What was removed from the donor

**Scene:** the procedural dungeon generator, the enemy and combat systems, inventory and
pickups, the horror UI, all branding, and roughly 84 MB of models, textures and audio.

**Server:** `MainRoom`, `dbUtils`, `rooms/env`, `MainRoomState`, and the `User` / `Stat` /
`Config` entities (all MRT gameplay); `mikro-orm.config.ts` (entirely commented out in the
donor); `telegram.ts` (an empty file); and `logger.js` / `timeUtils.ts`, which nothing in
LINGER uses.

None of the donor's art, audio or written content appears in LINGER.

---

## 2. SDK7 Colyseus polyfills — upstream credit

The polyfill approach in `scene/src/modules/compatibility/polyfill/` was contributed to the
MRT project by **wacaine**, from
[`decentraland-scenes/cube-jumper-colyesus-sdk7`](https://github.com/decentraland-scenes/cube-jumper-colyesus-sdk7).
That credit appears in the source header and is retained.

---

## 3. Dependencies

| Package | License |
|---|---|
| `@dcl/sdk`, `@dcl/js-runtime`, `@dcl-sdk/utils` | Apache-2.0 |
| `colyseus`, `colyseus.js`, `@colyseus/*` | MIT |
| `@mikro-orm/core`, `@mikro-orm/mongodb` | MIT |
| `express`, `cors`, `express-basic-auth` | MIT |
| `winston` | MIT |

Each dependency's full license text ships in its own `node_modules` directory.

---

## 4. Original LINGER work

Everything below is original to LINGER and is offered under the same Apache License 2.0:

- The product: the Presence Protocol, and the Linger → Echo → Interaction → Return → Bond loop
- `scene/src/linger/**` — Hearth, Echo pool and lifecycle, Echo interaction, Bond system,
  presence reporting, the network client, and the entire UI layer
- `server/src/linger/**` — the LINGER domain rules, `SocialPersistence` abstraction and its
  adapters, the LINGER Colyseus room, and the REST surface
- The sanctuary environment, which is generated from engine primitives at runtime and
  contains no imported 3-D assets
- All LINGER visual design, copy, and Genesis Echo text
- All LINGER documentation

**Genesis Echoes** are written by the LINGER team. They are labelled `isGenesis` in the data,
rendered in a distinct colour, and identify themselves as Genesis Echoes on their own card.
LINGER never presents an authored Echo as a real visitor.
