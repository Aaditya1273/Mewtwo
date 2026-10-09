import pytest
from fastapi.testclient import TestClient

from attest import identity, store
from attest.app import create_app
from attest.config import BACKEND_DIR
from attest.policy import load_missions
from attest.service import Attest
from attest.settlement import Deposit, Settlement

from .sim import SimDevice, SimSession

MISSION = "asha-village-visit"
CARGO = "cold-chain-cargo"


class Clock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


class RecordingAttestor:
    """Stands in for SolanaAttestor: records settlements, accepts deposits registered in `deposits`."""
    reward_mint = "SKRtest1111111111111111111111111111111111"
    reward_decimals = 6

    def __init__(self):
        self.records = []
        self.deposits = {}

    def settle(self, rec):
        self.records.append(rec)
        return Settlement(status="CONFIRMED", signature=f"sig{len(self.records)}", network="localnet",
                          reward_base=rec.reward_base, reward_mint=self.reward_mint if rec.reward_base else None)

    def verify_deposit(self, signature):
        if signature not in self.deposits:
            raise RuntimeError("transaction did not move REWARD_MINT into the pool")
        return Deposit(amount_base=self.deposits[signature], depositor="Sponsor111")


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def attestor():
    return RecordingAttestor()


@pytest.fixture
def svc(clock, attestor):
    return Attest(store.connect(":memory:"), load_missions(BACKEND_DIR / "missions.json"),
                  identity.DevSgtVerifier(), attestor, domain="presence.test",
                  chain_id="solana:localnet", dev_mode=True, network="localnet", clock=clock)


@pytest.fixture
def api(svc):
    return TestClient(create_app(svc))


@pytest.fixture
def device():
    return SimDevice()


def start(api, device, mission=MISSION) -> SimSession:
    r = api.post("/session", json={"wallet": device.wallet, "mission_id": mission,
                                   "ephemeral_pubkey": device.ephemeral_pubkey})
    assert r.status_code == 200, r.text
    body = r.json()
    r = api.post(f"/session/{body['session_id']}/authorize",
                 json={"signature": device.sign_wallet(body["siws_message"])})
    assert r.status_code == 200, r.text
    return SimSession(device, body["session_id"], body["nonce"])


def run_process(api, sess: SimSession, clock: Clock, checkpoints=6, interval=10.0, **cp_kwargs):
    for _ in range(checkpoints):
        clock.advance(interval)
        r = api.post(f"/session/{sess.session_id}/checkpoint",
                     json=sess.next_checkpoint(int(clock.t * 1000), **cp_kwargs))
        assert r.status_code == 200, r.text


def submit_and_verify(api, sess: SimSession):
    r = api.post(f"/session/{sess.session_id}/evidence", json=sess.evidence())
    assert r.status_code == 200, r.text
    return api.post("/verify", json={"session_id": sess.session_id})
