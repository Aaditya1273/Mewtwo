# Security

## Threats and what actually mitigates them

| Threat | Mitigation in this code | Residual risk |
|---|---|---|
| **Replay** | Server nonce (UNIQUE), single-use state machine: any repeated step returns `NONCE_REPLAY` | — |
| **Double settlement** | SQLite claim registry checked under a lock; on-chain `DailyAttestation` PDA = (profile, mission, day, claim index) can be created once; the reward transfer is in the same transaction, so it inherits that guard | — |
| **Client tampering** | Client never reports results; server recomputes hashes, measures time, evaluates policy | A modified client can still *fake process signals* (taps, foreground). See below. |
| **Fake / compressed evidence** | Hash chain recomputed server-side; checkpoint cadence and total duration use server receive times | Real-time scripted input on a real device |
| **Device farming** | One claim per SGT mint per mission per day (production) | Dev mode keys claims by wallet instead |
| **Session theft** | Every checkpoint and the root are signed by a per-session Android Keystore key whose fingerprint the wallet signed | Not hardware attestation; a rooted device can extract keys from software keystores |
| **Wrong-wallet SGT** | SGT check runs on the wallet that signed the SIWS message, never on a client-supplied address | — |
| **Witness collusion** | N/A: P3 not implemented | — |
| **Privacy leakage** | Counts only, no location/sensors; only a 32-byte root on-chain | Wallet address ↔ daily activity is public on-chain by design |
| **Fake sponsor deposits** | `/sponsor/deposit` reads the transaction from chain and credits only the REWARD_MINT that actually moved into the pool account; each signature credits once | — |
| **Unfunded rewards** | Rewards are reserved from the mission's deposited pool when a run is verified; an empty pool means the run is still attested, but no tokens are paid (`funding: UNFUNDED`) | — |
| **Rogue attestations** | Program `has_one = attestor`; day restricted to today/yesterday | Attestor key compromise. Keep it in a KMS/HSM in production. |
| **Auth token exfiltration** | MWA token in app-private prefs; `allowBackup=false`, backup/transfer exclusions | Rooted devices |
| **Cleartext traffic** | Cleartext allowed only in the **debug** build's network security config | Release builds need an HTTPS `presence.backendUrl` |

## Automation heuristics

Each window's presence check ("Still here?") appears at a random moment 1.5–6 s into the window. The app records
how long it was on screen before it was answered (`response_ms`), and that value is inside the signed,
hash-chained checkpoint. `anomaly.assess` (statistics, not machine learning) scores the answers:

- answers under 150 ms, faster than human reaction to an unexpected prompt
- answer times that barely vary (spread under 15 ms is treated as certain, under 40 ms as suspicious)

A risk score ≥ 0.9 rejects the run with `AUTOMATION_DETECTED`. This catches naive scripts. **A script that
injects human-like random delays defeats it.** It raises the cost of farming; it does not prevent it.

## Honest limitations

- P2 process signals (foreground state, answers, answer timing) can be produced by a modified app or an automation
  framework that runs in real time on a real device. P2 plus the heuristics makes farming slower and per-device (SGT),
  not impossible. PRESENCE does not claim Sybil resistance beyond one claim per SGT.
- Missions do not prove location. No GPS is collected.
- There is no Play Integrity / key attestation check yet (that is what P4 would add).
- The ATTEST server is a single process with one lock and SQLite. That's fine for a pilot; it is not horizontally scalable.
- The attestor key is a file on disk.

## Logging

`service.event()` writes one JSON line per stage (`session_id`, `mission_id`, stage, result, reason, ts). Keys,
signatures, auth tokens and evidence payloads are never logged. The Android client logs only stage + reason.
