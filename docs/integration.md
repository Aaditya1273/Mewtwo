# Integration

## 1. `verifyPresence()`: read attestations from chain (trustless)

`sdk/verify-presence` (TypeScript, `@solana/web3.js`) asks Solana, not our server:

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { verifyPresence } from "@presence/verify-presence";

const r = await verifyPresence(new Connection("https://api.devnet.solana.com"), wallet,
                               { mission: "asha-village-visit" });   // today, first claim
if (r.verified && r.assuranceLevel >= 2) payWorker();                // e.g. an NGO paying per verified visit
```

It derives the PDAs, checks the accounts are owned by the program and carry the right discriminators, and checks
that the recorded attestor is `Config.attestor`, or one of `trustedAttestors` you pass. It returns
`{ verified, assuranceLevel, evidenceRoot, attestor, recordedAt, profile: { streak, reputation, attestations, level } }`.

Tested: `sdk/verify-presence/test/localnet.test.ts`, run by `scripts/e2e_localnet.sh` against a real attestation,
including wrong-mission, wrong-day and untrusted-attestor rejections. It was also checked against devnet.

Raw layout, if you'd rather not use the SDK:

```text
profile     = PDA(["profile", wallet], PROGRAM_ID)
attestation = PDA(["attestation", profile, sha256(mission_id), day_i64_le, [seq_u8]], PROGRAM_ID)   day = unix_ts / 86400
```

`DailyAttestation { profile, day, mission_id: sha256(mission id), evidence_root, assurance_level, attestor, recorded_at }`
and `PresenceProfile { owner, sgt_mint, level, reputation, stats { attestations, current_streak, best_streak, last_day } }`.
The IDL is generated at `target/idl/presence.json` by `anchor build`.

## 2. Ask ATTEST (operational)

| Endpoint | Purpose |
|---|---|
| `GET /health` | mode (`development`/`production`), network, settlement adapter |
| `GET /missions` | public mission policies |
| `GET /profile/{wallet}` | XP, league, rank, streak, counters |
| `GET /session/{id}/receipt` | stored Trust Receipt |
| `GET /sponsor/pools` | pool account, mint, per-mission deposited / remaining / claims funded |
| `POST /sponsor/deposit {mission_id, signature}` | credit a mission pool with a confirmed on-chain transfer into the pool |
| `POST /missions/generate {prompt}` | draft a mission policy from plain language (for review) |
| `POST /session` → `/authorize` → `/checkpoint`×N → `/evidence` → `POST /verify` | the protocol (see evidence-model.md) |

Errors are `{"error": REASON, "detail": "..."}` with reasons from `backend/attest/errors.py`.

