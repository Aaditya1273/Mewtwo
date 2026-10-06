# Trust model

## Who decides what

| Decision | Owner | Why |
|---|---|---|
| Session nonce | ATTEST | Client-generated nonces are replayable |
| Wallet identity | ATTEST (verifies ed25519 over the exact SIWS bytes it issued) | Client can be patched |
| Seeker eligibility | ATTEST (reads mainnet Token-2022 state for the *signing* wallet) | An address alone proves nothing |
| Timing / duration | ATTEST server clock | Client timestamps are informational only |
| Evidence validity | ATTEST (recomputes every hash) | |
| Policy PASS/FAIL | ATTEST `policy.evaluate` | |
| Claim limit, XP, streak, league | ATTEST database | |
| Durable anchor | Solana program; only the configured attestor key can write | Inspectable by anyone |

The Android client never sends `verified`, `reward` or `assurance`. It sends evidence and signatures.

## Assurance levels

| Level | Meaning in this implementation | Status |
|---|---|---|
| **P1 VERIFIED** | Wallet signed a fresh server nonce (SIWS format) **and** holds a Seeker Genesis Token | Implemented (SGT check bypassed and labeled in development mode) |
| **P2 PROCESS** | P1 + a continuous, server-timed, ephemeral-key-signed evidence chain that satisfies the mission policy | Implemented |
| **P3 WITNESSED** | P2 + fresh-challenge co-presence witnesses (BLE) under a quorum policy | **Not implemented.** Policies with `witness_required` are refused at load time. |
| **P4 HIGH ASSURANCE** | Hardware-backed device attestation | **Not implemented** |

Assurance is a policy-defined level of evidence, not proof of personhood and not a bot-detection guarantee.

## Development mode

`ATTEST_DEV_MODE=true` replaces the SGT verifier with `DevSgtVerifier`, which returns `DEV_BYPASS`. It is surfaced:

- in `/health`, every session response and every receipt (`"mode": "development"`),
- as `seeker_eligibility: "DEV_BYPASS"` in receipt checks,
- in the app as a **DEVELOPMENT MODE** chip and an explicit receipt warning.

Development mode is never the default (`Settings.from_env` defaults to `false`; a test enforces it).
