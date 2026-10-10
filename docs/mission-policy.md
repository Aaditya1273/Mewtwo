# Mission policy

Policies live in `backend/missions.json` and are validated by `policy.build_policy` into the typed `MissionPolicy`.
All rules are evaluated in one function, `policy.evaluate`. The app renders whatever `/missions` returns.

## Shipped missions

| Mission | Session | Checks | Claims/day | Stake | Finish |
|---|---|---|---|---|---|
| `quick-clock-in` | 2 min | 4 (one per 30 s window) | 3 per device | 1 SKR | stake back + 20% from the pool, 60 XP |
| `deep-focus-25` | 25 min | 5 (one per 5 min window) | 1 per device | 5 SKR | stake back + 20% from the pool, 300 XP |

Each window's presence check appears at a random moment 15–60% into the window. The phone buzzes, and the user
taps *I'm here*. Missing a check, leaving the app, or a run the automation heuristics flag forfeits the stake to
the mission pool. The bonus is `stake × bonus_rate`, capped by what the pool holds (forfeits plus sponsor top-ups).

```json
{
  "mission_id": "quick-clock-in",
  "duration_seconds": 120, "required_checkpoints": 4, "checkpoint_interval_seconds": 30,
  "min_interactions_per_checkpoint": 1, "max_claims_per_identity_per_day": 3,
  "reward": { "xp": 60, "token": 0, "symbol": "SKR" },
  "stake": { "token": 1.0, "bonus_rate": 0.2 }
}
```

Sessions expire `duration + 300 s` after creation; an unfinished staked session is forfeited at expiry.

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
- `bonus_rate` in 0..1; no negative rewards or stakes

## Drafting missions from plain language

`POST /missions/generate {"prompt": "ASHA worker must stay 2 minutes with 12 checks, 0.5 SKR"}` returns a
**draft for review**, never installed automatically.
- **Default:** a deterministic parser (`mission_generator.parse`), with no network and the same output every time.
- **Optional:** with `OPENAI_API_KEY` set, an LLM drafts the JSON instead. The LLM path is untested here because no key was available.
- **Either way:** the draft must pass `build_policy`, so a generated policy can't ask for something the engine wouldn't enforce.
