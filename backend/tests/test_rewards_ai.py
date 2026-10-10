"""Stakes, forfeits and pool bonuses; sponsor deposits; multi-claim; automation heuristics; mission drafting."""

import base64

import pytest

from attest import anomaly, mission_generator
from attest.policy import build_policy

from .conftest import MISSION, run_process, start, submit_and_verify
from .sim import SimDevice


def deposit(api, attestor, sig, amount_base, mission=MISSION):
    attestor.deposits[sig] = amount_base
    return api.post("/sponsor/deposit", json={"mission_id": mission, "signature": sig})


def pool(api, mission=MISSION):
    return api.get("/sponsor/pools").json()["missions"][mission]


def test_finisher_gets_stake_back_plus_pool_bonus(api, clock, device, attestor):
    assert deposit(api, attestor, "seed", 1_000_000).status_code == 200  # sponsor seeds the pool with 1 SKR
    sess = start(api, device)
    assert len(attestor.stakes) == 1  # the 1 SKR stake was submitted at authorize
    run_process(api, sess, clock)
    rc = submit_and_verify(api, sess).json()["receipt"]
    assert (rc["reward"]["stake"], rc["reward"]["bonus"]) == (1.0, 0.2)
    assert attestor.records[-1].reward_base == 1_200_000  # one transfer: stake + 20% bonus
    assert rc["settlement"]["reward_token"] == 1.2
    assert pool(api)["remaining"] == 0.8


def test_bonus_is_capped_by_the_pool_but_stake_always_returns(api, clock, device, attestor):
    sess = start(api, device)
    run_process(api, sess, clock)
    rc = submit_and_verify(api, sess).json()["receipt"]
    assert (rc["reward"]["stake"], rc["reward"]["bonus"]) == (1.0, 0.0)
    assert attestor.records[-1].reward_base == 1_000_000


def test_quitter_forfeits_stake_which_funds_the_next_finisher(api, clock, attestor):
    quitter, finisher = SimDevice(), SimDevice()
    q = start(api, quitter)
    run_process(api, q, clock, foreground=False)  # switched apps during the session
    body = submit_and_verify(api, q).json()
    assert body["verified"] is False
    assert api.get(f"/session/{q.session_id}/receipt").json()["stake_forfeited"] == 1.0
    assert pool(api)["forfeited"] == 1.0
    f = start(api, finisher)
    run_process(api, f, clock)
    rc = submit_and_verify(api, f).json()["receipt"]
    assert rc["reward"]["bonus"] == 0.2  # paid out of the quitter's stake
    assert attestor.records[-1].wallet == finisher.wallet


def test_unfinished_session_forfeits_on_expiry(api, clock, device):
    start(api, device)  # stake held, then the user walks away
    assert pool(api)["forfeited"] == 0.0
    clock.advance(120 + 301)
    assert pool(api)["forfeited"] == 1.0


def test_stake_is_required_and_must_be_the_issued_transaction(api, device):
    body = api.post("/session", json={"wallet": device.wallet, "mission_id": MISSION,
                                      "ephemeral_pubkey": device.ephemeral_pubkey}).json()
    assert body["stake"]["amount"] == 1.0 and body["stake"]["symbol"] == "SKR-TEST"
    sig = device.sign_wallet(body["siws_message"])
    r = api.post(f"/session/{body['session_id']}/authorize", json={"signature": sig})
    assert r.status_code == 402 and r.json()["error"] == "STAKE_REQUIRED"
    forged = base64.b64encode(b"signed:stake:attacker:1").decode()  # a different transaction
    r = api.post(f"/session/{body['session_id']}/authorize", json={"signature": sig, "stake_transaction": forged})
    assert r.status_code == 402 and r.json()["error"] == "STAKE_FAILED"


def test_deposit_cannot_be_credited_twice_or_faked(api, attestor):
    assert deposit(api, attestor, "dep1", 1_000_000).status_code == 200
    r = api.post("/sponsor/deposit", json={"mission_id": MISSION, "signature": "dep1"})
    assert r.status_code == 409 and r.json()["error"] == "NONCE_REPLAY"
    r = api.post("/sponsor/deposit", json={"mission_id": MISSION, "signature": "not-a-deposit"})
    assert r.status_code == 409 and "did not move" in r.json()["detail"]


def test_three_clock_ins_a_day_each_with_its_own_claim_index(api, clock, device, attestor):
    for expected_seq in range(3):
        sess = start(api, device)
        run_process(api, sess, clock)
        assert submit_and_verify(api, sess).json()["verified"] is True
        assert attestor.records[-1].seq == expected_seq
    body = api.post("/session", json={"wallet": device.wallet, "mission_id": MISSION,
                                      "ephemeral_pubkey": device.ephemeral_pubkey}).json()
    import tests.conftest as c
    r = api.post(f"/session/{body['session_id']}/authorize", json=c.authorize_body(device, body))
    assert r.json()["error"] == "ALREADY_CLAIMED"
    assert api.get(f"/profile/{device.wallet}").json()["claims_today"] == {MISSION: 3}


def test_dev_faucet_grants_once(api, device):
    assert api.post("/dev/faucet", json={"wallet": device.wallet}).json()["granted"] is True
    assert api.post("/dev/faucet", json={"wallet": device.wallet}).json()["granted"] is False


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
                 json={"prompt": "Study session: stay 2 minutes with 12 checks, 2 times per day, 0.5 SKR"})
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
    with pytest.raises(ValueError):
        build_policy({**m, "stake": {"token": 1, "bonus_rate": 2}})
