# Mission policy

Policies live in `backend/missions.json` and load into the typed `MissionPolicy` (`backend/attest/policy.py`).
All rules are evaluated in one function, `policy.evaluate`. Nothing mission-specific lives in the app; the app renders
whatever `/missions` returns.

```json
{
  "mission_id": "daily-focus",
  "name": "Daily Focus Proof",
  "steps": ["Stay in the session for 60 seconds", "..."],
  "required_assurance": "P2",
  "duration_seconds": 60,
  "required_checkpoints": 6,
  "checkpoint_interval_seconds": 10,
  "min_interactions_per_checkpoint": 1,
  "witness_required": false,
  "max_claims_per_identity_per_day": 1,
  "reward": { "xp": 180 }
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
| claims today for this identity < max | claim registry | `ALREADY_CLAIMED` |

`timing_tolerance_seconds` defaults to 3. Every violated rule is listed in `detail`.

## Load-time guards

- Unknown assurance level → refuse to start.
- `witness_required: true` → refuse to start (P3 is not implemented, so it cannot be enforced).

## Status

Implemented: the rules above. Planned: sponsor-defined policies, per-policy assurance pricing, witness quorums.
