"""Draft a mission policy from a sponsor's plain-language request.

Default: a deterministic parser (no network, always the same answer). If OPENAI_API_KEY is set,
an LLM drafts the JSON instead. Either way the draft goes through policy.build_policy, so an LLM
can never produce a policy the engine would not enforce. Drafts are returned for human review;
nothing is installed automatically.
"""

import json
import os
import re

import httpx

from .policy import build_policy

DEFAULTS = {
    "required_assurance": "P2",
    "min_interactions_per_checkpoint": 1,
    "witness_required": False,
    "max_claims_per_identity_per_day": 1,
}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "custom-mission"


def parse(prompt: str) -> dict:
    t = prompt.lower()
    seconds = 60
    if m := re.search(r"(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b", t):
        seconds = int(float(m[1]) * 3600)
    elif m := re.search(r"(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)\b", t):
        seconds = int(float(m[1]) * 60)
    elif m := re.search(r"(\d+)\s*(seconds?|secs?|s)\b", t):
        seconds = int(m[1])
    checks = int(m[1]) if (m := re.search(r"(\d+)\s*(checks?|checkpoints?|check-ins?|pulses?)", t)) else max(1, seconds // 10)
    interval = max(5, round(seconds / checks))
    per_day = int(m[1]) if (m := re.search(r"(\d+)\s*(?:times|claims|visits|runs|handovers)?\s*(?:a|per)\s*day", t)) else 1
    xp = int(m[1]) if (m := re.search(r"(\d+)\s*xp", t)) else 3 * checks * interval // 2
    token = float(m[1]) if (m := re.search(r"(\d+(?:\.\d+)?)\s*skr", t)) else 0.0
    name = next((label for key, label in [
        ("asha", "ASHA Visit"), ("cold chain", "Cold-Chain Handover"), ("cargo", "Cargo Handover"),
        ("event", "Event Attendance"), ("class", "Class Attendance"), ("shift", "Shift Check-in"),
    ] if key in t), "Custom Mission")
    return {
        **DEFAULTS,
        "mission_id": _slug(name),
        "name": name,
        "description": prompt.strip()[:280],
        "steps": [
            f"Stay in the session for {checks * interval} seconds",
            f"Answer the presence check in each {interval}-second window ({checks} total)",
            "Keep PRESENCE in the foreground until the final checkpoint",
        ],
        "duration_seconds": checks * interval,
        "required_checkpoints": checks,
        "checkpoint_interval_seconds": interval,
        "max_claims_per_identity_per_day": per_day,
        "reward": {"xp": xp, "token": token, "symbol": "SKR"},
        "sponsor": "",
        "why": "",
    }


def _llm(prompt: str) -> dict:
    schema_hint = json.dumps(parse("ASHA worker must stay 2 minutes with 12 checks, 0.5 SKR"), indent=1)
    r = httpx.post(
        "https://api.openai.com/v1/chat/completions", timeout=30,
        headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
        json={"model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
              "response_format": {"type": "json_object"},
              "messages": [
                  {"role": "system", "content": "Draft a PRESENCE mission policy as JSON with exactly these keys "
                   "and types. duration_seconds must equal required_checkpoints * checkpoint_interval_seconds, "
                   "interval >= 5, witness_required false, required_assurance P2. Example:\n" + schema_hint},
                  {"role": "user", "content": prompt}]})
    r.raise_for_status()
    return json.loads(r.json()["choices"][0]["message"]["content"])


def generate(prompt: str) -> dict:
    source, draft = "rules", parse(prompt)
    if os.environ.get("OPENAI_API_KEY"):
        try:
            candidate = _llm(prompt)
            build_policy(candidate)
            source, draft = "llm", candidate
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            pass  # fall back to the deterministic draft
    build_policy(draft)  # raises ValueError if the draft is not enforceable
    return {"source": source, "status": "DRAFT_FOR_REVIEW", "mission": draft}
