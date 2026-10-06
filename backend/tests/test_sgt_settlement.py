import json
import os
import struct
from pathlib import Path

import pytest
from solders.pubkey import Pubkey

from attest import identity
from attest.settlement import AttestationRecord, SolanaAttestor, pdas, record_attestation_ix

from .sim import SimDevice

PROGRAM_ID = "CFZsFPtvwo5KDenV3qgorroaRmT7NuYsfPnd4avFS2cT"


def sgt_mint_account(authority=identity.SGT_MINT_AUTHORITY, group=identity.SGT_GROUP_MINT):
    return {"owner": identity.TOKEN_2022_PROGRAM, "data": {"parsed": {"info": {
        "mintAuthority": authority,
        "extensions": [
            {"extension": "metadataPointer",
             "state": {"authority": identity.SGT_MINT_AUTHORITY, "metadataAddress": identity.SGT_METADATA_ADDRESS}},
            {"extension": "tokenGroupMember", "state": {"group": group, "memberNumber": 7}},
        ]}}}}


def test_sgt_requires_every_property():
    assert identity.is_sgt_mint(sgt_mint_account())
    assert not identity.is_sgt_mint(sgt_mint_account(authority="11111111111111111111111111111111"))
    assert not identity.is_sgt_mint(sgt_mint_account(group="11111111111111111111111111111111"))
    assert not identity.is_sgt_mint({**sgt_mint_account(), "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"})


def test_rpc_verifier_returns_mint(monkeypatch):
    v = identity.RpcSgtVerifier("http://unused")
    token_acc = lambda mint, amount: {"account": {"data": {"parsed": {"info": {  # noqa: E731
        "mint": mint, "tokenAmount": {"amount": amount}}}}}}
    answers = {
        "getTokenAccountsByOwner": {"value": [token_acc("EmptyMint", "0"), token_acc("Other", "1"),
                                              token_acc("SgtMint", "1")]},
        "getMultipleAccounts": {"value": [None, sgt_mint_account()]},
    }
    calls = []
    monkeypatch.setattr(v, "_rpc", lambda m, p: calls.append((m, p)) or answers[m])
    e = v.check("Wallet")
    assert (e.eligible, e.sgt_mint, e.mode) == (True, "SgtMint", "SGT_VERIFIED")
    assert calls[1][1][0] == ["Other", "SgtMint"]  # zero-balance accounts are not considered


def test_record_attestation_ix_matches_program_layout():
    wallet = SimDevice().wallet
    rec = AttestationRecord(wallet=wallet, day=20_000, mission_id="daily-focus",
                            evidence_root=bytes(range(32)), assurance_level=2, sgt_mint=None)
    pid, attestor = Pubkey.from_string(PROGRAM_ID), Pubkey.new_unique()
    ix = record_attestation_ix(pid, attestor, rec)
    data = bytes(ix.data)
    assert list(data[:8]) == [148, 43, 225, 77, 15, 134, 217, 54]  # from target/idl/presence.json
    assert struct.unpack("<q", data[8:16])[0] == 20_000
    assert data[48:80] == bytes(range(32)) and data[80] == 2 and data[81:] == bytes(32)
    config, profile, attestation = pdas(pid, Pubkey.from_string(wallet), 20_000)
    assert [a.pubkey for a in ix.accounts][:5] == [config, attestor, Pubkey.from_string(wallet), profile, attestation]
    assert ix.accounts[1].is_signer and not ix.accounts[2].is_signer


@pytest.mark.localnet
@pytest.mark.skipif("LOCALNET_ATTESTOR" not in os.environ, reason="run via scripts/e2e_localnet.sh")
def test_localnet_settlement_writes_and_blocks_second_write():
    a = SolanaAttestor(os.environ.get("SOLANA_RPC_URL", "http://127.0.0.1:8899"), "localnet",
                       os.environ.get("PROGRAM_ID", PROGRAM_ID), Path(os.environ["LOCALNET_ATTESTOR"]))
    day = int(a._rpc("getBlockTime", [a._rpc("getSlot", [])]) // 86_400)
    rec = AttestationRecord(wallet=SimDevice().wallet, day=day, mission_id="daily-focus",
                            evidence_root=bytes(32), assurance_level=2, sgt_mint=None)
    first = a.settle(rec)
    assert first.status == "CONFIRMED", first.detail
    _, _, att = pdas(a.program_id, Pubkey.from_string(rec.wallet), day)
    info = a._rpc("getAccountInfo", [str(att), {"encoding": "base64", "commitment": "confirmed"}])["value"]
    assert info is not None and info["owner"] == str(a.program_id)
    assert a.settle(rec).status == "FAILED"  # on-chain double-settlement guard


def test_settings_default_is_not_dev_mode(monkeypatch):
    from attest.config import Settings
    monkeypatch.delenv("ATTEST_DEV_MODE", raising=False)
    assert Settings.from_env().dev_mode is False
    assert json.dumps(Settings.from_env().chain_id) == '"solana:mainnet"'
