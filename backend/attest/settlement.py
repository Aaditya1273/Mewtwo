"""On-chain settlement: the ATTEST attestor key writes DailyAttestation via the presence program."""

import base64
import hashlib
import json
import struct
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction


@dataclass(frozen=True)
class Settlement:
    status: str  # "CONFIRMED" | "NOT_CONFIGURED" | "FAILED"
    signature: str | None = None
    network: str | None = None
    detail: str | None = None
    reward_tokens: int = 0
    reward_mint: str | None = None


@dataclass(frozen=True)
class AttestationRecord:
    wallet: str
    day: int
    mission_id: str
    evidence_root: bytes
    assurance_level: int
    sgt_mint: str | None
    reward_tokens: int = 0


class Attestor(Protocol):
    def settle(self, rec: AttestationRecord) -> Settlement: ...


class UnconfiguredAttestor:
    """No attestor key/program configured: verification still happens, nothing is written on-chain."""

    def settle(self, rec: AttestationRecord) -> Settlement:
        return Settlement(status="NOT_CONFIGURED", detail="set ATTESTOR_KEYPAIR and PROGRAM_ID to anchor on-chain")


def _discriminator(name: str) -> bytes:
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]


def pdas(program_id: Pubkey, wallet: Pubkey, day: int) -> tuple[Pubkey, Pubkey, Pubkey]:
    config = Pubkey.find_program_address([b"config"], program_id)[0]
    profile = Pubkey.find_program_address([b"profile", bytes(wallet)], program_id)[0]
    attestation = Pubkey.find_program_address(
        [b"attestation", bytes(profile), struct.pack("<q", day)], program_id)[0]
    return config, profile, attestation


def record_attestation_ix(program_id: Pubkey, attestor: Pubkey, rec: AttestationRecord) -> Instruction:
    wallet = Pubkey.from_string(rec.wallet)
    config, profile, attestation = pdas(program_id, wallet, rec.day)
    sgt = Pubkey.from_string(rec.sgt_mint) if rec.sgt_mint else Pubkey.default()
    data = (_discriminator("record_attestation")
            + struct.pack("<q", rec.day)
            + hashlib.sha256(rec.mission_id.encode()).digest()
            + rec.evidence_root
            + bytes([rec.assurance_level])
            + bytes(sgt))
    return Instruction(program_id, data, [
        AccountMeta(config, is_signer=False, is_writable=False),
        AccountMeta(attestor, is_signer=True, is_writable=True),
        AccountMeta(wallet, is_signer=False, is_writable=False),
        AccountMeta(profile, is_signer=False, is_writable=True),
        AccountMeta(attestation, is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ])


TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")


def associated_token_address(owner: Pubkey, mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([bytes(owner), bytes(TOKEN_PROGRAM), bytes(mint)], ATA_PROGRAM)[0]


def reward_ixs(payer: Pubkey, owner: Pubkey, mint: Pubkey, amount: int) -> list[Instruction]:
    """Create the user's token account if missing (idempotent), then mint the reward to it."""
    ata = associated_token_address(owner, mint)
    create = Instruction(ATA_PROGRAM, bytes([1]), [
        AccountMeta(payer, is_signer=True, is_writable=True),
        AccountMeta(ata, is_signer=False, is_writable=True),
        AccountMeta(owner, is_signer=False, is_writable=False),
        AccountMeta(mint, is_signer=False, is_writable=False),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(TOKEN_PROGRAM, is_signer=False, is_writable=False),
    ])
    mint_to = Instruction(TOKEN_PROGRAM, bytes([7]) + struct.pack("<Q", amount), [
        AccountMeta(mint, is_signer=False, is_writable=True),
        AccountMeta(ata, is_signer=False, is_writable=True),
        AccountMeta(payer, is_signer=True, is_writable=False),  # attestor is the mint authority
    ])
    return [create, mint_to]


def initialize_config_ix(program_id: Pubkey, admin: Pubkey, attestor: Pubkey) -> Instruction:
    config = Pubkey.find_program_address([b"config"], program_id)[0]
    return Instruction(program_id, _discriminator("initialize_config") + bytes(attestor), [
        AccountMeta(admin, is_signer=True, is_writable=True),
        AccountMeta(config, is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ])


class SolanaAttestor:
    def __init__(self, rpc_url: str, network: str, program_id: str, keypair_path: Path, timeout: float = 30,
                 reward_mint: str | None = None):
        self.rpc_url, self.network, self.timeout = rpc_url, network, timeout
        self.program_id = Pubkey.from_string(program_id)
        self.reward_mint = Pubkey.from_string(reward_mint) if reward_mint else None
        self.keypair = Keypair.from_bytes(bytes(json.loads(Path(keypair_path).read_text())))

    def _rpc(self, method: str, params: list):
        r = httpx.post(self.rpc_url, timeout=self.timeout,
                       json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        r.raise_for_status()
        body = r.json()
        if "error" in body:
            raise RuntimeError(body["error"].get("message", str(body["error"])))
        return body["result"]

    def send(self, *ixs: Instruction) -> str:
        blockhash = Hash.from_string(
            self._rpc("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]["blockhash"])
        tx = Transaction([self.keypair], Message(list(ixs), self.keypair.pubkey()), blockhash)
        return self._rpc("sendTransaction", [base64.b64encode(bytes(tx)).decode(),
                                             {"encoding": "base64", "preflightCommitment": "confirmed"}])

    def confirm(self, sig: str, attempts: int = 40, interval: float = 0.5) -> None:
        for _ in range(attempts):
            status = self._rpc("getSignatureStatuses", [[sig]])["value"][0]
            if status and status.get("err"):
                raise RuntimeError(f"transaction failed: {status['err']}")
            if status and status.get("confirmationStatus") in ("confirmed", "finalized"):
                return
            time.sleep(interval)
        raise RuntimeError("transaction not confirmed in time")

    def settle(self, rec: AttestationRecord) -> Settlement:
        me = self.keypair.pubkey()
        ixs = [record_attestation_ix(self.program_id, me, rec)]
        tokens = rec.reward_tokens if self.reward_mint else 0
        if tokens:  # same transaction: the reward cannot land without the attestation, or twice
            ixs += reward_ixs(me, Pubkey.from_string(rec.wallet), self.reward_mint, tokens)
        try:
            sig = self.send(*ixs)
            self.confirm(sig)
            return Settlement(status="CONFIRMED", signature=sig, network=self.network, reward_tokens=tokens,
                              reward_mint=str(self.reward_mint) if tokens else None)
        except (httpx.HTTPError, RuntimeError, KeyError, ValueError) as e:
            return Settlement(status="FAILED", network=self.network, detail=str(e)[:300])
