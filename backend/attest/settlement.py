"""On-chain settlement: the ATTEST attestor key writes DailyAttestation via the presence program,
and pays the reward from the sponsor-funded pool in the same transaction.

Rewards are TRANSFERRED, never minted: real SKR (SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3,
classic SPL Token, 6 decimals) has its own mint authority. Sponsors fund the pool, which is the
attestor's associated token account for REWARD_MINT.
"""

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

TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
SKR_MAINNET_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3"


@dataclass(frozen=True)
class Settlement:
    status: str  # "CONFIRMED" | "NOT_CONFIGURED" | "FAILED"
    signature: str | None = None
    network: str | None = None
    detail: str | None = None
    reward_base: int = 0
    reward_mint: str | None = None


@dataclass(frozen=True)
class AttestationRecord:
    wallet: str
    day: int
    mission_id: str
    evidence_root: bytes
    assurance_level: int
    sgt_mint: str | None
    seq: int = 0
    reward_base: int = 0  # already reserved from the sponsor pool by ATTEST


@dataclass(frozen=True)
class Deposit:
    amount_base: int
    depositor: str | None


class Attestor(Protocol):
    reward_mint: Pubkey | None
    reward_decimals: int

    def settle(self, rec: AttestationRecord) -> Settlement: ...
    def verify_deposit(self, signature: str) -> Deposit: ...
    def build_stake_tx(self, wallet: str, amount_base: int) -> bytes: ...
    def submit_stake(self, signed_tx: bytes, unsigned_tx: bytes) -> str: ...
    def faucet(self, wallet: str, lamports: int, amount_base: int) -> str: ...


class UnconfiguredAttestor:
    """No attestor key/program configured: verification still happens, nothing is written on-chain."""
    reward_mint = None
    reward_decimals = 0

    def settle(self, rec: AttestationRecord) -> Settlement:
        return Settlement(status="NOT_CONFIGURED", detail="set ATTESTOR_KEYPAIR and PROGRAM_ID to anchor on-chain")

    def verify_deposit(self, signature: str) -> Deposit:
        raise RuntimeError("no reward pool configured")

    def build_stake_tx(self, wallet: str, amount_base: int) -> bytes:
        raise RuntimeError("no reward pool configured")

    def submit_stake(self, signed_tx: bytes, unsigned_tx: bytes) -> str:
        raise RuntimeError("no reward pool configured")

    def faucet(self, wallet: str, lamports: int, amount_base: int) -> str:
        raise RuntimeError("no reward pool configured")


def _discriminator(name: str) -> bytes:
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]


def mission_hash(mission_id: str) -> bytes:
    return hashlib.sha256(mission_id.encode()).digest()


def pdas(program_id: Pubkey, wallet: Pubkey, mission_id: str, day: int, seq: int = 0) -> tuple[Pubkey, Pubkey, Pubkey]:
    config = Pubkey.find_program_address([b"config"], program_id)[0]
    profile = Pubkey.find_program_address([b"profile", bytes(wallet)], program_id)[0]
    attestation = Pubkey.find_program_address(
        [b"attestation", bytes(profile), mission_hash(mission_id), struct.pack("<q", day), bytes([seq])],
        program_id)[0]
    return config, profile, attestation


def record_attestation_ix(program_id: Pubkey, attestor: Pubkey, rec: AttestationRecord) -> Instruction:
    wallet = Pubkey.from_string(rec.wallet)
    config, profile, attestation = pdas(program_id, wallet, rec.mission_id, rec.day, rec.seq)
    sgt = Pubkey.from_string(rec.sgt_mint) if rec.sgt_mint else Pubkey.default()
    data = (_discriminator("record_attestation")
            + struct.pack("<q", rec.day)
            + mission_hash(rec.mission_id)
            + rec.evidence_root
            + bytes([rec.assurance_level])
            + bytes(sgt)
            + bytes([rec.seq]))
    return Instruction(program_id, data, [
        AccountMeta(config, is_signer=False, is_writable=False),
        AccountMeta(attestor, is_signer=True, is_writable=True),
        AccountMeta(wallet, is_signer=False, is_writable=False),
        AccountMeta(profile, is_signer=False, is_writable=True),
        AccountMeta(attestation, is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ])


def associated_token_address(owner: Pubkey, mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([bytes(owner), bytes(TOKEN_PROGRAM), bytes(mint)], ATA_PROGRAM)[0]


def reward_ixs(pool_owner: Pubkey, user: Pubkey, mint: Pubkey, amount: int, decimals: int) -> list[Instruction]:
    """Create the user's token account if missing (idempotent), then pay the reward out of the pool."""
    pool, ata = associated_token_address(pool_owner, mint), associated_token_address(user, mint)
    create = Instruction(ATA_PROGRAM, bytes([1]), [
        AccountMeta(pool_owner, is_signer=True, is_writable=True),
        AccountMeta(ata, is_signer=False, is_writable=True),
        AccountMeta(user, is_signer=False, is_writable=False),
        AccountMeta(mint, is_signer=False, is_writable=False),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(TOKEN_PROGRAM, is_signer=False, is_writable=False),
    ])
    transfer = Instruction(TOKEN_PROGRAM, bytes([12]) + struct.pack("<Q", amount) + bytes([decimals]), [
        AccountMeta(pool, is_signer=False, is_writable=True),
        AccountMeta(mint, is_signer=False, is_writable=False),
        AccountMeta(ata, is_signer=False, is_writable=True),
        AccountMeta(pool_owner, is_signer=True, is_writable=False),
    ])
    return [create, transfer]


def transfer_checked_ix(source: Pubkey, mint: Pubkey, dest: Pubkey, owner: Pubkey,
                        amount: int, decimals: int) -> Instruction:
    return Instruction(TOKEN_PROGRAM, bytes([12]) + struct.pack("<Q", amount) + bytes([decimals]), [
        AccountMeta(source, is_signer=False, is_writable=True),
        AccountMeta(mint, is_signer=False, is_writable=False),
        AccountMeta(dest, is_signer=False, is_writable=True),
        AccountMeta(owner, is_signer=True, is_writable=False),
    ])


def initialize_config_ix(program_id: Pubkey, admin: Pubkey, attestor: Pubkey) -> Instruction:
    config = Pubkey.find_program_address([b"config"], program_id)[0]
    return Instruction(program_id, _discriminator("initialize_config") + bytes(attestor), [
        AccountMeta(admin, is_signer=True, is_writable=True),
        AccountMeta(config, is_signer=False, is_writable=True),
        AccountMeta(SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
    ])


class SolanaAttestor:
    def __init__(self, rpc_url: str, network: str, program_id: str, keypair_path: Path, timeout: float = 30,
                 reward_mint: str | None = None, reward_decimals: int = 6):
        self.rpc_url, self.network, self.timeout = rpc_url, network, timeout
        self.program_id = Pubkey.from_string(program_id)
        self.reward_mint = Pubkey.from_string(reward_mint) if reward_mint else None
        self.reward_decimals = reward_decimals
        self.keypair = Keypair.from_bytes(bytes(json.loads(Path(keypair_path).read_text())))

    @property
    def pool(self) -> Pubkey | None:
        return associated_token_address(self.keypair.pubkey(), self.reward_mint) if self.reward_mint else None

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
        amount = rec.reward_base if self.reward_mint else 0
        if amount:  # same transaction: the reward cannot land without the attestation, or twice
            ixs += reward_ixs(me, Pubkey.from_string(rec.wallet), self.reward_mint, amount, self.reward_decimals)
        try:
            sig = self.send(*ixs)
            self.confirm(sig)
            return Settlement(status="CONFIRMED", signature=sig, network=self.network, reward_base=amount,
                              reward_mint=str(self.reward_mint) if amount else None)
        except (httpx.HTTPError, RuntimeError, KeyError, ValueError) as e:
            return Settlement(status="FAILED", network=self.network, detail=str(e)[:300])

    def _blockhash(self) -> Hash:
        return Hash.from_string(self._rpc("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]["blockhash"])

    def build_stake_tx(self, wallet: str, amount_base: int) -> bytes:
        """Unsigned SPL transfer of the stake from the user to the pool. The user pays its fee and signs
        it in their wallet; ATTEST only submits it if it is byte-for-byte the message built here."""
        user = Pubkey.from_string(wallet)
        ix = transfer_checked_ix(associated_token_address(user, self.reward_mint), self.reward_mint, self.pool,
                                 user, amount_base, self.reward_decimals)
        return bytes(Transaction.new_unsigned(Message.new_with_blockhash([ix], user, self._blockhash())))

    def submit_stake(self, signed_tx: bytes, unsigned_tx: bytes) -> str:
        tx, issued = Transaction.from_bytes(signed_tx), Transaction.from_bytes(unsigned_tx)
        if tx.message != issued.message:
            raise ValueError("signed transaction differs from the stake transaction ATTEST issued")
        tx.verify()  # raises if the user's signature is missing or invalid
        sig = self._rpc("sendTransaction", [base64.b64encode(bytes(tx)).decode(),
                                            {"encoding": "base64", "preflightCommitment": "confirmed"}])
        self.confirm(sig)
        return sig

    def faucet(self, wallet: str, lamports: int, amount_base: int) -> str:
        """DEVELOPMENT ONLY: fund a test wallet with a little SOL (fees) and test tokens.
        Works only while the attestor is the mint authority, i.e. never for real SKR."""
        me, user = self.keypair.pubkey(), Pubkey.from_string(wallet)
        ata = associated_token_address(user, self.reward_mint)
        sol = Instruction(SYSTEM_PROGRAM_ID, struct.pack("<IQ", 2, lamports), [
            AccountMeta(me, is_signer=True, is_writable=True), AccountMeta(user, is_signer=False, is_writable=True)])
        create = reward_ixs(me, user, self.reward_mint, 0, self.reward_decimals)[0]
        mint_to = Instruction(TOKEN_PROGRAM, bytes([7]) + struct.pack("<Q", amount_base), [
            AccountMeta(self.reward_mint, is_signer=False, is_writable=True),
            AccountMeta(ata, is_signer=False, is_writable=True),
            AccountMeta(me, is_signer=True, is_writable=False)])
        sig = self.send(sol, create, mint_to)
        self.confirm(sig)
        return sig

    def verify_deposit(self, signature: str) -> Deposit:
        """Read a confirmed transaction and return how much REWARD_MINT it moved into the pool."""
        if not self.reward_mint:
            raise RuntimeError("REWARD_MINT is not configured")
        tx = self._rpc("getTransaction", [signature, {"encoding": "jsonParsed", "commitment": "confirmed",
                                                      "maxSupportedTransactionVersion": 0}])
        if tx is None or tx["meta"]["err"] is not None:
            raise RuntimeError("transaction not found or failed")
        me, mint = str(self.keypair.pubkey()), str(self.reward_mint)

        def balances(key: str) -> dict[str, int]:
            return {b["owner"]: int(b["uiTokenAmount"]["amount"]) for b in tx["meta"].get(key) or []
                    if b["mint"] == mint}
        pre, post = balances("preTokenBalances"), balances("postTokenBalances")
        amount = post.get(me, 0) - pre.get(me, 0)
        if amount <= 0:
            raise RuntimeError("transaction did not move REWARD_MINT into the pool")
        depositor = next((o for o in post if o != me and post[o] < pre.get(o, 0)), None)
        return Deposit(amount_base=amount, depositor=depositor)
