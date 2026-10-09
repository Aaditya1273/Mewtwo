"""Automation heuristics over presence-check response times.

This is statistics, not machine learning, and it is a fraud *signal*: it flags naive scripts
(instant or metronome-steady answers). A script that injects human-like random delays defeats it.

The presence check appears at an unpredictable moment in each window. Human simple reaction
time to an unexpected stimulus is rarely under ~150 ms, and it varies from answer to answer.
"""

from dataclasses import dataclass
from statistics import pstdev

MIN_SAMPLES = 3
HUMAN_FLOOR_MS = 150
STEADY_STDEV_MS = 15     # near-identical answers every window
SUSPICIOUS_STDEV_MS = 40
THRESHOLD = 0.9


@dataclass(frozen=True)
class Assessment:
    risk: float
    reasons: tuple[str, ...]


def assess(response_ms: list[int]) -> Assessment:
    answered = [r for r in response_ms if r >= 0]
    if len(answered) < MIN_SAMPLES:
        return Assessment(0.0, ("not enough answered checks to assess",))
    fast = sum(r < HUMAN_FLOOR_MS for r in answered) / len(answered)
    spread = pstdev(answered)
    steady = 1.0 if spread < STEADY_STDEV_MS else 0.6 if spread < SUSPICIOUS_STDEV_MS else 0.0
    risk = 1 - (1 - fast) * (1 - steady)
    reasons = []
    if fast:
        reasons.append(f"{fast:.0%} of answers under {HUMAN_FLOOR_MS} ms")
    if steady:
        reasons.append(f"answer times vary by only {spread:.0f} ms")
    return Assessment(round(risk, 2), tuple(reasons))
