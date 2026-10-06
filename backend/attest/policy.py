"""Typed mission policy and the single place where policy is evaluated."""

import json
from dataclasses import dataclass, field
from pathlib import Path

from .errors import AttestError, Reason

ASSURANCE_LEVELS = {"P1": 1, "P2": 2, "P3": 3, "P4": 4}


@dataclass(frozen=True)
class MissionPolicy:
    mission_id: str
    name: str
    steps: list[str]
    required_assurance: str
    duration_seconds: int
    required_checkpoints: int
    checkpoint_interval_seconds: int
    min_interactions_per_checkpoint: int
    witness_required: bool
    max_claims_per_identity_per_day: int
    reward_xp: int
    timing_tolerance_seconds: int = 3
    extra: dict = field(default_factory=dict)

    @property
    def assurance_level(self) -> int:
        return ASSURANCE_LEVELS[self.required_assurance]

    def public(self) -> dict:
        return {
            "mission_id": self.mission_id,
            "name": self.name,
            "steps": self.steps,
            "required_assurance": self.required_assurance,
            "duration_seconds": self.duration_seconds,
            "required_checkpoints": self.required_checkpoints,
            "checkpoint_interval_seconds": self.checkpoint_interval_seconds,
            "min_interactions_per_checkpoint": self.min_interactions_per_checkpoint,
            "witness_required": self.witness_required,
            "reward": {"xp": self.reward_xp},
        }


def load_missions(path: Path) -> dict[str, MissionPolicy]:
    raw = json.loads(path.read_text())
    missions = {}
    for m in raw:
        reward = m.pop("reward")
        p = MissionPolicy(reward_xp=reward["xp"], **m)
        if p.required_assurance not in ASSURANCE_LEVELS:
            raise ValueError(f"{p.mission_id}: unknown assurance {p.required_assurance}")
        if p.witness_required:
            # P3 witness flow is not implemented; refuse to load a policy we cannot enforce.
            raise ValueError(f"{p.mission_id}: witness_required is not supported yet")
        missions[p.mission_id] = p
    return missions


@dataclass(frozen=True)
class ObservedCheckpoint:
    index: int
    received_at: float  # server clock
    foreground: bool
    interactions: int


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
