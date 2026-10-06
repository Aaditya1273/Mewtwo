# Integration

There is no SDK package yet. An app can integrate today in two ways.

## 1. Read on-chain attestations (trustless)

```text
profile     = PDA(["profile", wallet], PROGRAM_ID)
attestation = PDA(["attestation", profile, day_i64_le], PROGRAM_ID)    day = unix_ts / 86400
```

`DailyAttestation { profile, day, mission_id: sha256(mission id), evidence_root, assurance_level, attestor, recorded_at }`
and `PresenceProfile { owner, sgt_mint, level, reputation, stats { attestations, current_streak, best_streak, last_day } }`.
The IDL is generated at `target/idl/presence.json` by `anchor build`. Check `attestation.attestor` against the program
`Config.attestor` you trust.

A Python reference for PDAs and instruction layout: `backend/attest/settlement.py`.

## 2. Ask ATTEST (operational)

| Endpoint | Purpose |
|---|---|
| `GET /health` | mode (`development`/`production`), network, settlement adapter |
| `GET /missions` | public mission policies |
| `GET /profile/{wallet}` | XP, league, rank, streak, counters |
| `GET /session/{id}/receipt` | stored Trust Receipt |
| `POST /session` → `/authorize` → `/checkpoint`×N → `/evidence` → `POST /verify` | the protocol (see evidence-model.md) |

Errors are `{"error": REASON, "detail": "..."}` with reasons from `backend/attest/errors.py`.

## Planned (not built)

```ts
const v = await verifyPresence(wallet, { assurance: "P2", recency: { maximumAge: "7d" } })
```

It would wrap option 1 with an assurance/recency filter. It does not exist yet.
