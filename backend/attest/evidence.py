"""Evidence hash chain. Must stay byte-for-byte identical to the Android EvidenceChain.kt.

genesis      = SHA256("PRESENCE/genesis/v1" | session_id | nonce)
checkpoint_i = SHA256("PRESENCE/cp/v2" | prev_hash | payload_i | nonce)
payload_i    = "{index}|{timestamp_ms}|{elapsed_ms}|{foreground 0/1}|{interactions}|{response_ms}"
root         = SHA256("PRESENCE/root/v1" | last_checkpoint_hash | witness_root)

response_ms is how long the presence check was on screen before it was answered (-1 = not answered).

`|` is the literal byte 0x7C; hashes are raw 32-byte digests. witness_root is 32 zero
bytes when no witnesses participated (P3 is not implemented).
"""

import hashlib
from dataclasses import dataclass

NO_WITNESSES = bytes(32)


@dataclass(frozen=True)
class CheckpointData:
    index: int
    timestamp_ms: int
    elapsed_ms: int
    foreground: bool
    interactions: int
    response_ms: int = -1

    def payload(self) -> bytes:
        fg = 1 if self.foreground else 0
        return f"{self.index}|{self.timestamp_ms}|{self.elapsed_ms}|{fg}|{self.interactions}|{self.response_ms}".encode()


def _h(*parts: bytes) -> bytes:
    return hashlib.sha256(b"|".join(parts)).digest()


def genesis(session_id: str, nonce: str) -> bytes:
    return _h(b"PRESENCE/genesis/v1", session_id.encode(), nonce.encode())


def checkpoint_hash(prev: bytes, data: CheckpointData, nonce: str) -> bytes:
    return _h(b"PRESENCE/cp/v2", prev, data.payload(), nonce.encode())


def evidence_root(last: bytes, witness_root: bytes = NO_WITNESSES) -> bytes:
    return _h(b"PRESENCE/root/v1", last, witness_root)


def chain(session_id: str, nonce: str, checkpoints: list[CheckpointData]) -> list[bytes]:
    """Recompute every checkpoint hash from scratch (used by tests and audits)."""
    prev, out = genesis(session_id, nonce), []
    for cp in checkpoints:
        prev = checkpoint_hash(prev, cp, nonce)
        out.append(prev)
    return out
