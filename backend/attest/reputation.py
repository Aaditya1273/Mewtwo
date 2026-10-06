"""Deterministic, explainable participation state. No hidden scores.

reputation = sum of assurance levels of verified attestations (P1=1, P2=2, ...).
The on-chain PresenceProfile applies the same rule, so both can be cross-checked.
"""

from dataclasses import dataclass

SECONDS_PER_DAY = 86_400

# League is derived from XP earned through verified actions only.
LEAGUES = [("ELITE", 5_000), ("GOLD", 1_500), ("SILVER", 500), ("BRONZE", 0)]


def utc_day(ts: float) -> int:
    return int(ts // SECONDS_PER_DAY)


def league_for(xp: int) -> str:
    return next(name for name, floor in LEAGUES if xp >= floor)


def next_streak(current: int, last_day: int | None, day: int) -> int:
    if last_day == day:
        return current
    if last_day == day - 1:
        return current + 1
    return 1


def live_streak(current: int, last_day: int | None, today: int) -> int:
    """Streak as displayed today: it survives until the end of the day after the last proof."""
    return current if last_day is not None and today - last_day <= 1 else 0


@dataclass
class Profile:
    wallet: str
    xp: int = 0
    verified_count: int = 0
    rejected_count: int = 0
    reputation: int = 0
    current_streak: int = 0
    best_streak: int = 0
    last_day: int | None = None

    def apply_verified(self, day: int, assurance_level: int, xp: int) -> None:
        self.current_streak = next_streak(self.current_streak, self.last_day, day)
        self.best_streak = max(self.best_streak, self.current_streak)
        self.last_day = day
        self.verified_count += 1
        self.reputation += assurance_level
        self.xp += xp

    def view(self, today: int, rank: int | None) -> dict:
        return {
            "wallet": self.wallet,
            "xp": self.xp,
            "league": league_for(self.xp),
            "rank": rank,
            "streak": live_streak(self.current_streak, self.last_day, today),
            "best_streak": self.best_streak,
            "verified_count": self.verified_count,
            "rejected_count": self.rejected_count,
            "reputation": self.reputation,
            "proved_today": self.last_day == today,
        }

