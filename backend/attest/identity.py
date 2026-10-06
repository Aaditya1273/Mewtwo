"""Wallet identity (SIWS-format message + ed25519), ephemeral session key, and SGT eligibility."""

import base64
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

import base58
import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_der_public_key

from .errors import AttestError, Reason

# Official Seeker Genesis Token constants (docs.solanamobile.com). All checks must hold.
SGT_MINT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4"
SGT_METADATA_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te"
SGT_GROUP_MINT = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te"
TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS5EtLqyNKqvBbTFqHGb3d3"


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def decode_wallet(wallet: str) -> bytes:
    try:
        raw = base58.b58decode(wallet)
    except ValueError:
        raw = b""
    if len(raw) != 32:
        raise AttestError(Reason.INVALID_IDENTITY, "wallet is not a 32-byte base58 public key")
    return raw


def ephemeral_fingerprint(ephemeral_pubkey_b64: str) -> str:
    return hashlib.sha256(base64.b64decode(ephemeral_pubkey_b64)).hexdigest()


def siws_message(*, domain: str, wallet: str, chain_id: str, nonce: str, session_id: str,
                 mission_name: str, ephemeral_pubkey_b64: str, issued_at: float, expires_at: float) -> str:
    """Sign-In-With-Solana formatted message. The server stores it and verifies the exact bytes."""
    return (
        f"{domain} wants you to sign in with your Solana account:\n"
        f"{wallet}\n\n"
        f"Start PRESENCE mission: {mission_name}\n\n"
        f"URI: https://{domain}\n"
        f"Version: 1\n"
        f"Chain ID: {chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {_iso(issued_at)}\n"
        f"Expiration Time: {_iso(expires_at)}\n"
        f"Request ID: {session_id}\n"
        f"Resources:\n"
        f"- presence:ephemeral-key:{ephemeral_fingerprint(ephemeral_pubkey_b64)}"
    )


def verify_wallet_signature(wallet: str, message: str, signature_b58: str) -> None:
    try:
        sig = base58.b58decode(signature_b58)
        Ed25519PublicKey.from_public_bytes(decode_wallet(wallet)).verify(sig, message.encode())
    except (InvalidSignature, ValueError) as e:
        raise AttestError(Reason.INVALID_SIGNATURE, "wallet signature does not match SIWS message") from e


def load_ephemeral_key(ephemeral_pubkey_b64: str) -> ec.EllipticCurvePublicKey:
    """Android Keystore EC P-256 key, X.509 SubjectPublicKeyInfo DER, base64."""
    try:
        key = load_der_public_key(base64.b64decode(ephemeral_pubkey_b64))
    except ValueError as e:
        raise AttestError(Reason.INVALID_IDENTITY, "ephemeral key is not a DER public key") from e
    if not isinstance(key, ec.EllipticCurvePublicKey) or key.curve.name != "secp256r1":
        raise AttestError(Reason.INVALID_IDENTITY, "ephemeral key must be EC P-256")
    return key


def verify_ephemeral_signature(ephemeral_pubkey_b64: str, data: bytes, signature_b64: str) -> None:
    try:
        load_ephemeral_key(ephemeral_pubkey_b64).verify(
            base64.b64decode(signature_b64), data, ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError) as e:
        raise AttestError(Reason.INVALID_SIGNATURE, "ephemeral key signature invalid") from e


@dataclass(frozen=True)
class Eligibility:
    eligible: bool
    sgt_mint: str | None
    mode: str  # "SGT_VERIFIED" | "DEV_BYPASS"


class SgtVerifier(Protocol):
    def check(self, wallet: str) -> Eligibility: ...


class DevSgtVerifier:
    """DEVELOPMENT ONLY. Emulators cannot hold an SGT, so eligibility is bypassed and labeled."""

    def check(self, wallet: str) -> Eligibility:
        return Eligibility(eligible=True, sgt_mint=None, mode="DEV_BYPASS")


class RpcSgtVerifier:
    """Checks the signed wallet for a Token-2022 mint matching all SGT properties (mainnet)."""

    def __init__(self, rpc_url: str, timeout: float = 10.0):
        self.rpc_url = rpc_url
        self.timeout = timeout

    def _rpc(self, method: str, params: list):
        try:
            r = httpx.post(self.rpc_url, timeout=self.timeout,
                           json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            r.raise_for_status()
            body = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise AttestError(Reason.NETWORK_ERROR, f"SGT RPC {method} failed") from e
        if "error" in body:
            raise AttestError(Reason.NETWORK_ERROR, f"SGT RPC {method}: {body['error']}")
        return body["result"]

    def check(self, wallet: str) -> Eligibility:
        accounts = self._rpc("getTokenAccountsByOwner", [
            wallet, {"programId": TOKEN_2022_PROGRAM}, {"encoding": "jsonParsed"}])["value"]
        mints = [a["account"]["data"]["parsed"]["info"]["mint"] for a in accounts
                 if a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"] == "1"]
        for i in range(0, len(mints), 100):
            batch = mints[i:i + 100]
            infos = self._rpc("getMultipleAccounts", [batch, {"encoding": "jsonParsed"}])["value"]
            for mint, info in zip(batch, infos):
                if info and is_sgt_mint(info):
                    return Eligibility(eligible=True, sgt_mint=mint, mode="SGT_VERIFIED")
        return Eligibility(eligible=False, sgt_mint=None, mode="SGT_VERIFIED")


def is_sgt_mint(account_info: dict) -> bool:
    if account_info.get("owner") != TOKEN_2022_PROGRAM:
        return False
    parsed = account_info.get("data", {})
    if not isinstance(parsed, dict):
        return False
    info = parsed.get("parsed", {}).get("info", {})
    ext = {e.get("extension"): e.get("state", {}) for e in info.get("extensions", [])}
    pointer = ext.get("metadataPointer", {})
    member = ext.get("tokenGroupMember", {})
    return (info.get("mintAuthority") == SGT_MINT_AUTHORITY
            and pointer.get("authority") == SGT_MINT_AUTHORITY
            and pointer.get("metadataAddress") == SGT_METADATA_ADDRESS
            and member.get("group") == SGT_GROUP_MINT)
