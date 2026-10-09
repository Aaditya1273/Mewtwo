"""Sponsor pools, multi-claim missions, automation heuristics, mission generator."""

import pytest

from attest import anomaly, mission_generator
from attest.policy import build_policy

from .conftest import CARGO, MISSION, run_process, start, submit_and_verify


def deposit(api, attestor, sig, amount_base, mission=MISSION):
    attestor.deposits[sig] = amount_base
    return api.post("/sponsor/deposit", json={"mission_id": mission, "signature": sig})


def test_reward_paid_only_from_funded_pool(api, clock, device, attestor):
    r = deposit(api, attestor, "dep1", 1_000_000)  # 1.0 SKR = two ASHA rewards of 0.5
    assert r.status_code == 200 and r.json()["credited"] == 1.0 and r.json()["claims_funded"] == 2
    sess = start(api, device)
    run_process(api, sess, clock)
    rc = submit_and_verify(api, sess).json()["receipt"]
    assert rc["reward"] == {"xp": 180, "token": 0.5, "symbol": "SKR-TEST", "funding": "RESERVED"}
    assert rc["settlement"]["reward_token"] == 0.5 and rc["settlement"]["reward_symbol"] == "SKR-TEST"
    assert attestor.records[-1].reward_base == 500_000 and attestor.records[-1].seq == 0
    assert api.get("/sponsor/pools").json()["missions"][MISSION]["remaining"] == 0.5


def test_deposit_cannot_be_credited_twice_or_faked(api, attestor):
    assert deposit(api, attestor, "dep1", 1_000_000).status_code == 200
    r = api.post("/sponsor/deposit", json={"mission_id": MISSION, "signature": "dep1"})
    assert r.status_code == 409 and r.json()["error"] == "NONCE_REPLAY"
    r = api.post("/sponsor/deposit", json={"mission_id": MISSION, "signature": "not-a-deposit"})
    assert r.status_code == 409 and "did not move" in r.json()["detail"]


def test_cargo_allows_three_claims_a_day_with_distinct_claim_index(api, clock, device, attestor):
    for expected_seq in range(3):
        sess = start(api, device, CARGO)
        run_process(api, sess, clock)
        assert submit_and_verify(api, sess).json()["verified"] is True
        assert attestor.records[-1].seq == expected_seq
    body = api.post("/session", json={"wallet": device.wallet, "mission_id": CARGO,
                                      "ephemeral_pubkey": device.ephemeral_pubkey}).json()
    r = api.post(f"/session/{body['session_id']}/authorize",
                 json={"signature": device.sign_wallet(body["siws_message"])})
    assert r.json()["error"] == "ALREADY_CLAIMED"
    assert api.get(f"/profile/{device.wallet}").json()["claims_today"] == {CARGO: 3}


def test_metronome_answers_are_flagged_as_automation(api, clock, device):
    sess = start(api, device)
    run_process(api, sess, clock, response_ms=300)  # identical answer time every window
    body = submit_and_verify(api, sess).json()
    assert body["verified"] is False and body["reason"] == "AUTOMATION_DETECTED"


def test_human_answer_times_pass_and_bot_patterns_score_high():
    assert anomaly.assess([700, 1200, 450, 900, 1600, 800]).risk < anomaly.THRESHOLD
    assert anomaly.assess([300, 302, 301, 299, 300, 301]).risk >= anomaly.THRESHOLD
    assert anomaly.assess([40, 60, 30, 50, 45, 55]).risk >= anomaly.THRESHOLD
    assert anomaly.assess([300, 300]).risk == 0  # too few samples to judge


def test_generator_drafts_an_enforceable_policy(api):
    r = api.post("/missions/generate",
                 json={"prompt": "ASHA worker must stay 2 minutes at the village with 12 checks, 2 visits per day, 0.5 SKR"})
    body = r.json()
    assert r.status_code == 200 and body["status"] == "DRAFT_FOR_REVIEW" and body["source"] == "rules"
    m = body["mission"]
    assert (m["duration_seconds"], m["required_checkpoints"], m["checkpoint_interval_seconds"]) == (120, 12, 10)
    assert m["max_claims_per_identity_per_day"] == 2 and m["reward"]["token"] == 0.5
    build_policy(m)


def test_policies_the_engine_cannot_enforce_are_rejected():
    m = mission_generator.parse("event attendance for 1 minute")
    with pytest.raises(ValueError):
        build_policy({**m, "witness_required": True})
    with pytest.raises(ValueError):
        build_policy({**m, "duration_seconds": m["duration_seconds"] + 7})
