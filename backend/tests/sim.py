"""A reference client doing exactly what the Android app does, for tests and local demos."""

import base64
import random

import base58
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from attest import evidence
from attest.evidence import CheckpointData


class SimDevice:
    def __init__(self):
        self.wallet_key = Ed25519PrivateKey.generate()
        self.ephemeral = ec.generate_private_key(ec.SECP256R1())

    @property
    def wallet(self) -> str:
        raw = self.wallet_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        return base58.b58encode(raw).decode()

    @property
    def ephemeral_pubkey(self) -> str:
        der = self.ephemeral.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        return base64.b64encode(der).decode()

    def sign_wallet(self, message: str) -> str:
        return base58.b58encode(self.wallet_key.sign(message.encode())).decode()

    def sign_transaction(self, tx_b64: str) -> str:
        """Sign an issued Solana transaction as a wallet would (same ed25519 key as the wallet address)."""
        from solders.keypair import Keypair
        from solders.transaction import Transaction
        seed = self.wallet_key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                             serialization.NoEncryption())
        tx = Transaction.from_bytes(base64.b64decode(tx_b64))
        signed = Transaction([Keypair.from_seed(seed)], tx.message, tx.message.recent_blockhash)
        return base64.b64encode(bytes(signed)).decode()

    def sign_ephemeral(self, data: bytes) -> str:
        return base64.b64encode(self.ephemeral.sign(data, ec.ECDSA(hashes.SHA256()))).decode()


class SimSession:
    """Builds the evidence chain locally, like EvidenceChain.kt."""

    def __init__(self, device: SimDevice, session_id: str, nonce: str):
        self.device, self.session_id, self.nonce = device, session_id, nonce
        self.head = evidence.genesis(session_id, nonce)
        self.index = 0

    def next_checkpoint(self, t_ms: int, interactions: int = 2, foreground: bool = True,
                        response_ms: int | None = None) -> dict:
        # Human-like by default: answers to an unpredictable prompt take ~0.4–1.8 s and vary.
        rt = response_ms if response_ms is not None else (random.randint(400, 1800) if interactions else -1)
        cp = CheckpointData(self.index, t_ms, (self.index + 1) * 10_000, foreground, interactions, rt)
        self.head = evidence.checkpoint_hash(self.head, cp, self.nonce)
        self.index += 1
        return {"index": cp.index, "timestamp_ms": cp.timestamp_ms, "elapsed_ms": cp.elapsed_ms,
                "foreground": cp.foreground, "interactions": cp.interactions, "response_ms": cp.response_ms,
                "hash": self.head.hex(), "signature": self.device.sign_ephemeral(self.head)}

    def evidence(self) -> dict:
        root = evidence.evidence_root(self.head)
        return {"evidence_root": root.hex(), "signature": self.device.sign_ephemeral(root)}


def main(base: str = "http://127.0.0.1:8787", fast: bool = False) -> None:
    """Real-time run against a live ATTEST server: `uv run python -m tests.sim [URL] [--fast]`.
    --fast compresses the process to show that the server's clock rejects it."""
    import time

    import httpx

    dev = SimDevice()
    c = httpx.Client(base_url=base, timeout=60)

    def ok(r):
        if r.status_code >= 400:
            raise SystemExit(f"{r.request.url.path}: {r.status_code} {r.text}")
        return r.json()

    mission = ok(c.get("/missions"))[0]
    if mission.get("stake", {}).get("token"):
        print("faucet:", ok(c.post("/dev/faucet", json={"wallet": dev.wallet})))
    s = ok(c.post("/session", json={"wallet": dev.wallet, "mission_id": mission["mission_id"],
                                    "ephemeral_pubkey": dev.ephemeral_pubkey}))
    print(f"session {s['session_id']} mode={s['mode']} wallet={dev.wallet} stake={s.get('stake') and s['stake']['amount']}")
    auth = {"signature": dev.sign_wallet(s["siws_message"])}
    if s.get("stake"):
        auth["stake_transaction"] = dev.sign_transaction(s["stake"]["transaction"])
    print(ok(c.post(f"/session/{s['session_id']}/authorize", json=auth)))
    sess = SimSession(dev, s["session_id"], s["nonce"])
    interval = 0.5 if fast else mission["checkpoint_interval_seconds"]
    for i in range(mission["required_checkpoints"]):
        time.sleep(interval)
        ok(c.post(f"/session/{sess.session_id}/checkpoint", json=sess.next_checkpoint(int(time.time() * 1000))))
        print(f"checkpoint {i + 1}/{mission['required_checkpoints']}")
    ok(c.post(f"/session/{sess.session_id}/evidence", json=sess.evidence()))
    result = ok(c.post("/verify", json={"session_id": sess.session_id}))
    print(json.dumps(result, indent=2))
    replay = c.post("/verify", json={"session_id": sess.session_id})
    print(f"replay attempt -> {replay.status_code} {replay.json()}")


if __name__ == "__main__":
    import json
    import sys

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(*(args[:1]), fast="--fast" in sys.argv)
