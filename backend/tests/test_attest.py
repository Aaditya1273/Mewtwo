"""Critical-path tests: session, evidence, replay, policy, identity, attestation."""

from dataclasses import replace

import pytest

from attest import evidence, identity
from attest.errors import AttestError, Reason
from attest.evidence import CheckpointData
from attest.policy import ObservedCheckpoint, evaluate

from .conftest import MISSION, run_process, start, submit_and_verify
from .sim import SimDevice


def test_happy_path_produces_receipt_profile_and_settlement(api, clock, device, attestor):
    sess = start(api, device)
    run_process(api, sess, clock)
    r = submit_and_verify(api, sess)
    body = r.json()
    assert r.status_code == 200 and body["verified"] is True and body["reason"] is None
    rc = body["receipt"]
    assert rc["assurance"] == "P2" and rc["checkpoint_count"] == 6
    assert rc["duration_seconds"] == 60.0
    assert rc["checks"]["seeker_eligibility"] == "DEV_BYPASS"  # never claims SGT in dev mode
    assert rc["mode"] == "development"
    assert rc["reward"] == {"xp": 180} and rc["streak"] == 1
    assert rc["settlement"]["status"] == "CONFIRMED"
    assert attestor.records[0].evidence_root.hex() == rc["evidence_root"]
    assert api.get(f"/session/{sess.session_id}/receipt").json()["state"] == "SETTLED"
    p = api.get(f"/profile/{device.wallet}").json()
    assert (p["xp"], p["streak"], p["league"], p["rank"], p["reputation"]) == (180, 1, "BRONZE", 1, 2)


def test_nonces_are_unique(api, device):
    nonces = {api.post("/session", json={"wallet": device.wallet, "mission_id": MISSION,
                                         "ephemeral_pubkey": device.ephemeral_pubkey}).json()["nonce"]
              for _ in range(20)}
    assert len(nonces) == 20


def test_expired_session_fails(api, clock, device):
    body = api.post("/session", json={"wallet": device.wallet, "mission_id": MISSION,
                                      "ephemeral_pubkey": device.ephemeral_pubkey}).json()
    clock.advance(301)
    r = api.post(f"/session/{body['session_id']}/authorize",
                 json={"signature": device.sign_wallet(body["siws_message"])})
    assert r.status_code == 410 and r.json()["error"] == "SESSION_EXPIRED"


def test_modified_checkpoint_rejects_session(api, clock, device):
    sess = start(api, device)
    clock.advance(10)
    cp = sess.next_checkpoint(int(clock.t * 1000))
    cp["interactions"] += 5  # tamper after hashing
    r = api.post(f"/session/{sess.session_id}/checkpoint", json=cp)
    assert r.status_code == 400 and r.json()["error"] == "EVIDENCE_CHAIN_INVALID"
    assert api.get(f"/session/{sess.session_id}/receipt").json()["state"] == "REJECTED"


def test_incorrect_root_fails(api, clock, device):
    sess = start(api, device)
    run_process(api, sess, clock)
    bad = sess.evidence()
    bad["evidence_root"] = "00" * 32
    r = api.post(f"/session/{sess.session_id}/evidence", json=bad)
    assert r.json()["error"] == "EVIDENCE_CHAIN_INVALID"


def test_replay_second_claim_fails(api, clock, device):
    sess = start(api, device)
    run_process(api, sess, clock)
    assert submit_and_verify(api, sess).json()["verified"] is True
    r = api.post("/verify", json={"session_id": sess.session_id})
    assert r.status_code == 409 and r.json()["error"] == "NONCE_REPLAY"
    # A fresh session from the same identity on the same day is a second claim.
    body = api.post("/session", json={"wallet": device.wallet, "mission_id": MISSION,
                                      "ephemeral_pubkey": device.ephemeral_pubkey}).json()
    r = api.post(f"/session/{body['session_id']}/authorize",
                 json={"signature": device.sign_wallet(body["siws_message"])})
    assert r.status_code == 409 and r.json()["error"] == "ALREADY_CLAIMED"


def test_authorize_twice_is_replay(api, device):
    body = api.post("/session", json={"wallet": device.wallet, "mission_id": MISSION,
                                      "ephemeral_pubkey": device.ephemeral_pubkey}).json()
    sig = device.sign_wallet(body["siws_message"])
    assert api.post(f"/session/{body['session_id']}/authorize", json={"signature": sig}).status_code == 200
    r = api.post(f"/session/{body['session_id']}/authorize", json={"signature": sig})
    assert r.json()["error"] == "NONCE_REPLAY"


def test_insufficient_checkpoints_fail(api, clock, device):
    sess = start(api, device)
    run_process(api, sess, clock, checkpoints=5, interval=12)
    body = submit_and_verify(api, sess).json()
    assert body["verified"] is False and body["reason"] == "POLICY_NOT_SATISFIED"
    assert "5/6 checkpoints" in body["detail"]


def test_insufficient_duration_fails(api, clock, device):
    sess = start(api, device)
    run_process(api, sess, clock, interval=2)  # a script racing through the process
    body = submit_and_verify(api, sess).json()
    assert body["verified"] is False and "duration" in body["detail"]


def test_missing_interaction_and_background_fail(api, clock, device):
    sess = start(api, device)
    run_process(api, sess, clock, interactions=0, foreground=False)
    body = submit_and_verify(api, sess).json()
    assert body["verified"] is False
    assert "left foreground" in body["detail"] and "0 interactions" in body["detail"]


def test_wrong_assurance_fails(svc):
    policy = svc.missions[MISSION]
    cps = [ObservedCheckpoint(i, 10.0 * (i + 1), True, 1) for i in range(6)]
    with pytest.raises(AttestError) as e:
        evaluate(policy, 0, 60, cps, achieved_assurance=1)
    assert e.value.reason == Reason.POLICY_NOT_SATISFIED
    with pytest.raises(AttestError):
        evaluate(replace(policy, required_assurance="P3"), 0, 60, cps, achieved_assurance=2)
    evaluate(policy, 0, 60, cps, achieved_assurance=2)  # passes


def test_signature_from_other_wallet_fails(api, device):
    body = api.post("/session", json={"wallet": device.wallet, "mission_id": MISSION,
                                      "ephemeral_pubkey": device.ephemeral_pubkey}).json()
    r = api.post(f"/session/{body['session_id']}/authorize",
                 json={"signature": SimDevice().sign_wallet(body["siws_message"])})
    assert r.status_code == 401 and r.json()["error"] == "INVALID_SIGNATURE"


def test_invalid_wallet_fails(api, device):
    r = api.post("/session", json={"wallet": "not-a-key", "mission_id": MISSION,
                                   "ephemeral_pubkey": device.ephemeral_pubkey})
    assert r.json()["error"] == "INVALID_IDENTITY"


def test_stolen_session_without_ephemeral_key_fails(api, clock, device):
    sess = start(api, device)
    sess.device = SimDevice()  # attacker knows session id + nonce but not the device's ephemeral key
    clock.advance(10)
    r = api.post(f"/session/{sess.session_id}/checkpoint", json=sess.next_checkpoint(int(clock.t * 1000)))
    assert r.json()["error"] == "INVALID_SIGNATURE"


def test_siws_message_binds_nonce_and_ephemeral_key(api, device):
    body = api.post("/session", json={"wallet": device.wallet, "mission_id": MISSION,
                                      "ephemeral_pubkey": device.ephemeral_pubkey}).json()
    msg = body["siws_message"]
    assert msg.startswith("presence.test wants you to sign in with your Solana account:\n" + device.wallet)
    assert f"Nonce: {body['nonce']}" in msg
    assert identity.ephemeral_fingerprint(device.ephemeral_pubkey) in msg


def test_evidence_chain_golden_vector():
    """Shared with Android EvidenceChainTest.kt: both implementations must produce these bytes."""
    cps = [CheckpointData(i, 1_700_000_000_000 + i * 10_000, (i + 1) * 10_000, True, 2) for i in range(6)]
    hashes = evidence.chain("session-1", "nonce-1", cps)
    assert evidence.genesis("session-1", "nonce-1").hex() == GOLDEN_GENESIS
    assert hashes[0].hex() == GOLDEN_CP0
    assert evidence.evidence_root(hashes[-1]).hex() == GOLDEN_ROOT


GOLDEN_GENESIS = "c52244702ffcfcac1b4198db2c0c1f086640a36441c9bd265217dec3fae9a5ef"
GOLDEN_CP0 = "fa53672bbd67a8cee32e5769089f97240abf6f0b1fd45597d24c02b1bb65a733"
GOLDEN_ROOT = "adbe64d6fa439e4d9853f97738b9266e1fbaa6ff6d13b67f798d4a8ce0ad6385"
