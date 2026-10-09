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

## Path to decentralized Guardians (planned, not built)

Today one ATTEST engine holds the attestor key, and `Config.attestor` is a single pubkey. That is a central point
of trust, and it is the honest state of this MVP.

Solana Mobile already coordinates device and dApp trust through independent **Guardians** that SKR holders stake
to. The intended evolution reuses that model:

1. **Attestor set.** Extend `Config` from one `attestor` to an allowlist of Guardian pubkeys plus a threshold `m`.
2. **Independent verification.** Each Guardian runs its own ATTEST engine over the same evidence (the chain is
   deterministic and the golden vectors are public), and signs `(profile, mission, day, seq, evidence_root)`.
3. **Quorum on-chain.** `record_attestation` verifies `m` Guardian Ed25519 signatures through the Ed25519 precompile
   before creating the `DailyAttestation`.
4. **Stake and slashing.** Guardians stake SKR behind their attestations; an attestation later proven fraudulent
   costs stake.

There is deliberately no code stub for this. A "Guardian mode" that doesn't verify signatures would be a fake check.
