"""Typed mission policy and the single place where policy is evaluated."""

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import anomaly
from .errors import AttestError, Reason

ASSURANCE_LEVELS = {"P1": 1, "P2": 2, "P3": 3, "P4": 4}


@dataclass(frozen=True)
class MissionPolicy:
    mission_id: str
    name: str
    description: str
    steps: list[str]
    required_assurance: str
    duration_seconds: int
    required_checkpoints: int
    checkpoint_interval_seconds: int
    min_interactions_per_checkpoint: int
    witness_required: bool
    max_claims_per_identity_per_day: int
    reward_xp: int
    reward_token: float = 0.0  # paid from the sponsor's pool in REWARD_MINT units (UI amount)
    reward_symbol: str = "SKR"
    sponsor: str = ""
    why: str = ""
    timing_tolerance_seconds: int = 3
    extra: dict = field(default_factory=dict)

    @property
    def assurance_level(self) -> int:
        return ASSURANCE_LEVELS[self.required_assurance]

    def public(self) -> dict:
        return {
            "mission_id": self.mission_id,
            "name": self.name,
            "description": self.description,
            "steps": self.steps,
            "required_assurance": self.required_assurance,
            "duration_seconds": self.duration_seconds,
            "required_checkpoints": self.required_checkpoints,
            "checkpoint_interval_seconds": self.checkpoint_interval_seconds,
            "min_interactions_per_checkpoint": self.min_interactions_per_checkpoint,
            "witness_required": self.witness_required,
            "max_claims_per_identity_per_day": self.max_claims_per_identity_per_day,
            "reward": {"xp": self.reward_xp, "token": self.reward_token, "symbol": self.reward_symbol},
            "sponsor": self.sponsor,
            "why": self.why,
        }


def load_missions(path: Path) -> dict[str, MissionPolicy]:
    raw = json.loads(path.read_text())
    missions = {}
    for m in raw:
        missions[m["mission_id"]] = build_policy(m)
    return missions


def build_policy(m: dict) -> MissionPolicy:
    """Validate one mission definition. Used for missions.json and for generated drafts."""
    m = dict(m)
    reward = m.pop("reward")
    p = MissionPolicy(reward_xp=int(reward["xp"]), reward_token=float(reward.get("token", 0)),
                      reward_symbol=reward.get("symbol", "SKR"), **m)
    if p.required_assurance not in ASSURANCE_LEVELS:
        raise ValueError(f"{p.mission_id}: unknown assurance {p.required_assurance}")
    if p.witness_required:
        # P3 witness flow is not implemented; refuse to load a policy we cannot enforce.
        raise ValueError(f"{p.mission_id}: witness_required is not supported yet")
    if p.required_checkpoints < 1 or p.checkpoint_interval_seconds < 5:
        raise ValueError(f"{p.mission_id}: need >= 1 checkpoint and >= 5 s between checkpoints")
    if p.required_checkpoints * p.checkpoint_interval_seconds != p.duration_seconds:
        raise ValueError(f"{p.mission_id}: duration must equal checkpoints x interval")
    if not 1 <= p.max_claims_per_identity_per_day <= 255:
        raise ValueError(f"{p.mission_id}: max claims per day must be 1..255 (on-chain claim index is a u8)")
    if p.reward_token < 0 or p.reward_xp < 0:
        raise ValueError(f"{p.mission_id}: rewards cannot be negative")
    return p


@dataclass(frozen=True)
class ObservedCheckpoint:
    index: int
    received_at: float  # server clock
    foreground: bool
    interactions: int
    response_ms: int = -1


def evaluate(policy: MissionPolicy, started_at: float, submitted_at: float,
             checkpoints: list[ObservedCheckpoint], achieved_assurance: int) -> None:
    """Raise POLICY_NOT_SATISFIED with every violated rule; return None on pass.

    All timing uses the server clock (authorize -> each checkpoint receipt -> submit),
    so a client cannot compress or backdate the process.
    """
    problems = []
    tol = policy.timing_tolerance_seconds

    if achieved_assurance < policy.assurance_level:
        problems.append(f"assurance P{achieved_assurance} < required {policy.required_assurance}")
    if len(checkpoints) < policy.required_checkpoints:
        problems.append(f"{len(checkpoints)}/{policy.required_checkpoints} checkpoints")
    if submitted_at - started_at < policy.duration_seconds - tol:
        problems.append(f"duration {submitted_at - started_at:.1f}s < {policy.duration_seconds}s")

    prev = started_at
    for cp in checkpoints:
        gap = cp.received_at - prev
        if gap < policy.checkpoint_interval_seconds - tol:
            problems.append(f"checkpoint {cp.index} arrived after {gap:.1f}s")
        if not cp.foreground:
            problems.append(f"checkpoint {cp.index}: session left foreground")
        if cp.interactions < policy.min_interactions_per_checkpoint:
            problems.append(f"checkpoint {cp.index}: {cp.interactions} interactions")
        prev = cp.received_at

    if problems:
        raise AttestError(Reason.POLICY_NOT_SATISFIED, "; ".join(problems))

    a = anomaly.assess([cp.response_ms for cp in checkpoints])
    if a.risk >= anomaly.THRESHOLD:
        raise AttestError(Reason.AUTOMATION_DETECTED, f"risk {a.risk}: " + "; ".join(a.reasons))
