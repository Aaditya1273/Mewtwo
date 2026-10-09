# Mission policy

Policies live in `backend/missions.json` and are validated by `policy.build_policy` into the typed `MissionPolicy`.
All rules are evaluated in one function, `policy.evaluate`. The app renders whatever `/missions` returns.

## Shipped missions

| Mission | What it attests | Claims/day | Reward |
|---|---|---|---|
| `asha-village-visit` | An attended 60-second check-in at the start of a field visit | 1 per device | 180 XP + 0.5 SKR from the sponsor pool |
| `cold-chain-cargo` | An attended 60-second stop with the consignment at a handover | 3 per device | 250 XP + 1 SKR per handover |

Sponsors shown in the app are **illustrative examples**, not partners. **Neither mission proves location.** PRESENCE
collects no GPS by design. They prove that one Seeker device ran an attended, server-timed 60-second process.
Binding a check-in to a place (a rotating code displayed at the site) and temperature-logger hashes as a checkpoint
field are planned, not built.

```json
{
  "mission_id": "cold-chain-cargo",
  "name": "Cold-Chain Handover",
  "description": "A driver attests an attended 60-second stop with the consignment at a handover. Up to 3 handovers a day.",
  "steps": ["Open PRESENCE at the handover point", "..."],
  "required_assurance": "P2",
  "duration_seconds": 60,
  "required_checkpoints": 6,
  "checkpoint_interval_seconds": 10,
  "min_interactions_per_checkpoint": 1,
  "witness_required": false,
  "max_claims_per_identity_per_day": 3,
  "reward": { "xp": 250, "token": 1.0, "symbol": "SKR" },
  "sponsor": "Example sponsor: pharma logistics partner (illustrative)",
  "why": "..."
}
```

## Rules enforced

| Rule | Measured by | Failure |
|---|---|---|
| achieved assurance ≥ `required_assurance` | service | `POLICY_NOT_SATISFIED` |
| checkpoint count ≥ `required_checkpoints` | server | `POLICY_NOT_SATISFIED` |
| `submitted_at - started_at ≥ duration_seconds - tolerance` | server clock | `POLICY_NOT_SATISFIED` |
| each checkpoint arrives ≥ `interval - tolerance` after the previous | server clock | `POLICY_NOT_SATISFIED` |
| every window stayed in the foreground | evidence | `POLICY_NOT_SATISFIED` |
| interactions per window ≥ minimum | evidence | `POLICY_NOT_SATISFIED` |
| presence-check answer times look human ([security.md](security.md#automation-heuristics)) | evidence | `AUTOMATION_DETECTED` |
| claims today for this identity < max | claim registry | `ALREADY_CLAIMED` |

`timing_tolerance_seconds` defaults to 3. Every violated rule is listed in `detail`.

## Load-time validation (`build_policy`)

- unknown assurance level, or `witness_required: true` (P3 not implemented): refused
- `duration_seconds` must equal `required_checkpoints × checkpoint_interval_seconds`, interval ≥ 5 s
- `max_claims_per_identity_per_day` in 1..255 (it is the on-chain claim index, a `u8`)
- no negative rewards

## Drafting missions from plain language

`POST /missions/generate {"prompt": "ASHA worker must stay 2 minutes with 12 checks, 0.5 SKR"}` returns a
**draft for review**, never installed automatically.
- **Default:** a deterministic parser (`mission_generator.parse`), with no network and the same output every time.
- **Optional:** with `OPENAI_API_KEY` set, an LLM drafts the JSON instead. The LLM path is untested here because no key was available.
- **Either way:** the draft must pass `build_policy`, so a generated policy can't ask for something the engine wouldn't enforce.
