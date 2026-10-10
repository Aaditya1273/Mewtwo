"""ATTEST engine: the only component that decides PASS/FAIL, owns nonces, claims and rewards.

State machine (invalid transitions fail):
  CREATED --authorize--> ACTIVE --evidence--> SUBMITTED --verify--> VERIFIED --settle--> SETTLED
                                                                 \\-> REJECTED
"""

import base64
import json
import logging
import secrets
import sqlite3
import threading
import time
import uuid
from collections.abc import Callable

from . import evidence, identity
from .errors import AttestError, Reason
from .evidence import CheckpointData
from .policy import MissionPolicy, ObservedCheckpoint, evaluate
from .reputation import Profile, league_for, utc_day
from .settlement import AttestationRecord, Attestor

log = logging.getLogger("attest")

EXPLORER = {"devnet": "?cluster=devnet", "mainnet": "",
            "localnet": "?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899"}


def event(stage: str, session_id: str | None, **fields) -> None:
    """Structured log line. Never pass keys, signatures, tokens or raw evidence here."""
    log.info(json.dumps({"stage": stage, "session_id": session_id, "ts": time.time(), **fields}))


class Attest:
    def __init__(self, db: sqlite3.Connection, missions: dict[str, MissionPolicy],
                 sgt: identity.SgtVerifier, attestor: Attestor, *, domain: str, chain_id: str,
                 dev_mode: bool, network: str, ttl_seconds: int = 300,
                 clock: Callable[[], float] = time.time):
        self.db, self.missions, self.sgt, self.attestor = db, missions, sgt, attestor
        self.domain, self.chain_id, self.dev_mode, self.network = domain, chain_id, dev_mode, network
        self.ttl, self.clock = ttl_seconds, clock
        # ponytail: one lock serializes every state transition; per-session locks if throughput matters.
        self.lock = threading.Lock()
        self.settling: set[str] = set()

    # ---------- helpers ----------

    def _session(self, session_id: str) -> sqlite3.Row:
        row = self.db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if row is None:
            raise AttestError(Reason.SESSION_NOT_FOUND)
        return row

    def _live(self, row: sqlite3.Row) -> None:
        if self.clock() > row["expires_at"]:
            raise AttestError(Reason.SESSION_EXPIRED)

    @staticmethod
    def _expect(row: sqlite3.Row, state: str) -> None:
        if row["state"] != state:
            # A session (and its nonce) is single-use: any attempt to run a step again is a replay.
            done = {"CREATED": 0, "ACTIVE": 1, "SUBMITTED": 2, "VERIFIED": 3, "SETTLED": 4, "REJECTED": 4}
            reason = Reason.NONCE_REPLAY if done[row["state"]] > done[state] else Reason.INVALID_STATE
            raise AttestError(reason, f"session is {row['state']}, expected {state}")

    def _mission(self, mission_id: str) -> MissionPolicy:
        if mission_id not in self.missions:
            raise AttestError(Reason.UNKNOWN_MISSION, mission_id)
        return self.missions[mission_id]

    def _profile(self, wallet: str) -> Profile:
        row = self.db.execute("SELECT * FROM profiles WHERE wallet=?", (wallet,)).fetchone()
        return Profile(**dict(row)) if row else Profile(wallet=wallet)

    def _save_profile(self, p: Profile) -> None:
        self.db.execute(
            "INSERT INTO profiles VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET "
            "xp=excluded.xp, verified_count=excluded.verified_count, rejected_count=excluded.rejected_count, "
            "reputation=excluded.reputation, current_streak=excluded.current_streak, "
            "best_streak=excluded.best_streak, last_day=excluded.last_day",
            (p.wallet, p.xp, p.verified_count, p.rejected_count, p.reputation,
             p.current_streak, p.best_streak, p.last_day))

    def _rank(self, xp: int) -> int:
        return 1 + self.db.execute("SELECT COUNT(*) FROM profiles WHERE xp > ?", (xp,)).fetchone()[0]

    @staticmethod
    def _identity_key(row: sqlite3.Row) -> str:
        return row["sgt_mint"] or f"dev:{row['wallet']}"

    def _claims_today(self, identity_key: str, mission_id: str, day: int) -> int:
        return self.db.execute(
            "SELECT COUNT(*) FROM claims WHERE identity_key=? AND mission_id=? AND day=?",
            (identity_key, mission_id, day)).fetchone()[0]

    def _reject(self, row: sqlite3.Row, err: AttestError) -> None:
        p = self._profile(row["wallet"])
        p.rejected_count += 1
        with self.db:
            self._save_profile(p)
            self.db.execute("UPDATE sessions SET state='REJECTED', receipt=? WHERE id=?",
                            (json.dumps({"status": "REJECTED", "reason": err.reason, "detail": err.detail,
                                         "stake_forfeited": self._held_stake(row["id"]) / 10 ** self._decimals()}),
                             row["id"]))
            self.db.execute("UPDATE stakes SET status='FORFEITED' WHERE session_id=? AND status='HELD'", (row["id"],))
        event("rejected", row["id"], mission_id=row["mission_id"], reason=err.reason)

    # ---------- protocol steps ----------

    def create_session(self, wallet: str, mission_id: str, ephemeral_pubkey: str) -> dict:
        policy = self._mission(mission_id)
        identity.decode_wallet(wallet)
        identity.load_ephemeral_key(ephemeral_pubkey)
        now = self.clock()
        ttl = policy.duration_seconds + self.ttl  # the whole process must fit, plus slack to start it
        session_id, nonce = str(uuid.uuid4()), secrets.token_hex(16)
        message = identity.siws_message(
            domain=self.domain, wallet=wallet, chain_id=self.chain_id, nonce=nonce,
            session_id=session_id, mission_name=policy.name, ephemeral_pubkey_b64=ephemeral_pubkey,
            issued_at=now, expires_at=now + ttl)
        stake_base, stake_tx = self._stake_base(policy), None
        if stake_base:
            try:
                stake_tx = self.attestor.build_stake_tx(wallet, stake_base)
            except Exception as e:  # network / RPC
                raise AttestError(Reason.NETWORK_ERROR, f"could not build stake transaction: {e}") from e
        with self.lock, self.db:
            self.db.execute(
                "INSERT INTO sessions (id, nonce, mission_id, wallet, ephemeral_pubkey, siws_message, state, "
                "created_at, expires_at, chain_head) VALUES (?,?,?,?,?,?,'CREATED',?,?,?)",
                (session_id, nonce, mission_id, wallet, ephemeral_pubkey, message, now, now + ttl,
                 evidence.genesis(session_id, nonce)))
            if stake_tx:
                self.db.execute("INSERT INTO stakes VALUES (?,?,?,?,?,NULL,'ISSUED')",
                                (session_id, wallet, mission_id, stake_base, stake_tx))
        event("session_created", session_id, mission_id=mission_id, staked=bool(stake_tx))
        stake = ({"amount": stake_base / 10 ** self._decimals(), "symbol": self.symbol(policy),
                  "transaction": base64.b64encode(stake_tx).decode()} if stake_tx else None)
        return {"session_id": session_id, "nonce": nonce, "siws_message": message,
                "expires_at": now + ttl, "policy": policy.public(), "stake": stake,
                "mode": "development" if self.dev_mode else "production"}

    def authorize(self, session_id: str, wallet_signature_b58: str, signed_stake_tx_b64: str | None = None) -> dict:
        with self.lock:
            row = self._session(session_id)
            self._expect(row, "CREATED")
            self._live(row)
            identity.verify_wallet_signature(row["wallet"], row["siws_message"], wallet_signature_b58)
            stake = self.db.execute("SELECT * FROM stakes WHERE session_id=?", (session_id,)).fetchone()
            if stake is not None and not signed_stake_tx_b64:
                raise AttestError(Reason.STAKE_REQUIRED, "this mission requires a signed stake transaction")
        # Network call outside the lock; state is re-checked before the transition below.
        elig = self.sgt.check(row["wallet"])
        if not elig.eligible:
            raise AttestError(Reason.SGT_NOT_ELIGIBLE, "wallet holds no Seeker Genesis Token")
        identity_key = elig.sgt_mint or f"dev:{row['wallet']}"
        policy = self._mission(row["mission_id"])
        with self.lock:
            if self._claims_today(identity_key, policy.mission_id, utc_day(self.clock())) \
                    >= policy.max_claims_per_identity_per_day:
                raise AttestError(Reason.ALREADY_CLAIMED, "daily claim limit reached for this device")
        stake_sig = None
        if stake is not None:  # network call outside the lock; the message must be exactly what we issued
            try:
                stake_sig = self.attestor.submit_stake(base64.b64decode(signed_stake_tx_b64), stake["unsigned_tx"])
            except Exception as e:
                raise AttestError(Reason.STAKE_FAILED, str(e)[:200]) from e
        with self.lock:
            # ponytail: a claim racing in between the checks would leave this stake HELD on a CREATED
            # session, which forfeits on expiry; refund on that race if it ever matters.
            self._expect(self._session(session_id), "CREATED")
            now = self.clock()
            with self.db:
                self.db.execute("UPDATE sessions SET state='ACTIVE', started_at=?, sgt_mint=?, "
                                "eligibility_mode=? WHERE id=?", (now, elig.sgt_mint, elig.mode, session_id))
                if stake_sig:
                    self.db.execute("UPDATE stakes SET status='HELD', signature=? WHERE session_id=?",
                                    (stake_sig, session_id))
        event("authorized", session_id, mission_id=row["mission_id"], eligibility=elig.mode)
        return {"state": "ACTIVE", "started_at": now, "eligibility": elig.mode, "sgt_mint": elig.sgt_mint,
                "stake_signature": stake_sig}

    def add_checkpoint(self, session_id: str, cp: CheckpointData, hash_hex: str, signature_b64: str) -> dict:
        with self.lock:
            row = self._session(session_id)
            self._expect(row, "ACTIVE")
            self._live(row)
            existing = self.db.execute("SELECT hash FROM checkpoints WHERE session_id=? AND idx=?",
                                       (session_id, cp.index)).fetchone()
            if existing is not None and existing["hash"].hex() == hash_hex:
                return {"accepted": True, "index": cp.index, "duplicate": True}  # idempotent retry
            count = self.db.execute("SELECT COUNT(*) FROM checkpoints WHERE session_id=?",
                                    (session_id,)).fetchone()[0]
            try:
                if cp.index != count:
                    raise AttestError(Reason.EVIDENCE_CHAIN_INVALID, f"expected checkpoint {count}, got {cp.index}")
                expected = evidence.checkpoint_hash(row["chain_head"], cp, row["nonce"])
                if expected.hex() != hash_hex:
                    raise AttestError(Reason.EVIDENCE_CHAIN_INVALID, f"checkpoint {cp.index} hash mismatch")
                identity.verify_ephemeral_signature(row["ephemeral_pubkey"], expected, signature_b64)
            except AttestError as e:
                self._reject(row, e)
                raise
            with self.db:
                self.db.execute("INSERT INTO checkpoints VALUES (?,?,?,?,?,?,?,?,?)",
                                (session_id, cp.index, cp.timestamp_ms, cp.elapsed_ms, int(cp.foreground),
                                 cp.interactions, cp.response_ms, expected, self.clock()))
                self.db.execute("UPDATE sessions SET chain_head=? WHERE id=?", (expected, session_id))
        event("checkpoint", session_id, index=cp.index)
        return {"accepted": True, "index": cp.index}

    def submit_evidence(self, session_id: str, root_hex: str, signature_b64: str) -> dict:
        with self.lock:
            row = self._session(session_id)
            self._expect(row, "ACTIVE")
            self._live(row)
            root = evidence.evidence_root(row["chain_head"])
            try:
                if root.hex() != root_hex:
                    raise AttestError(Reason.EVIDENCE_CHAIN_INVALID, "evidence root does not match checkpoints")
                identity.verify_ephemeral_signature(row["ephemeral_pubkey"], root, signature_b64)
            except AttestError as e:
                self._reject(row, e)
                raise
            with self.db:
                self.db.execute("UPDATE sessions SET state='SUBMITTED', submitted_at=?, evidence_root=? "
                                "WHERE id=?", (self.clock(), root, session_id))
        event("submitted", session_id)
        return {"state": "SUBMITTED", "evidence_root": root_hex}

    def verify(self, session_id: str) -> dict:
        with self.lock:
            row = self._session(session_id)
            self._expect(row, "SUBMITTED")
            policy = self._mission(row["mission_id"])
            cps = [ObservedCheckpoint(r["idx"], r["received_at"], bool(r["foreground"]), r["interactions"],
                                      r["response_ms"])
                   for r in self.db.execute("SELECT * FROM checkpoints WHERE session_id=? ORDER BY idx",
                                            (session_id,))]
            # P1 = wallet signature + device eligibility (authorize); P2 = + continuous process evidence
            # whose root matched (submit). P3/P4 need witnesses/hardware attestation: not implemented.
            achieved = 2
            day = utc_day(self.clock())
            seq = self._claims_today(self._identity_key(row), policy.mission_id, day)
            try:
                evaluate(policy, row["started_at"], row["submitted_at"], cps, achieved)
                if seq >= policy.max_claims_per_identity_per_day:
                    raise AttestError(Reason.ALREADY_CLAIMED, "daily claim limit reached for this device")
            except AttestError as e:
                self._reject(row, e)
                return {"verified": False, "assurance": policy.required_assurance,
                        "mission_id": policy.mission_id, "reason": e.reason, "detail": e.detail}

            profile = self._profile(row["wallet"])
            league_before, rank_before = league_for(profile.xp), self._rank(profile.xp)
            # Reserve the token reward from the sponsor's pool; unfunded missions still attest, unpaid.
            reward_base = self._reward_base(policy)
            pool = self._pool_remaining(policy.mission_id)
            funded = reward_base > 0 and pool >= reward_base
            reserved = reward_base if funded else 0
            # Finishers earn a bonus on their stake, paid from the pool that quitters' stakes feed.
            stake_base = self._held_stake(session_id)
            bonus = min(round(stake_base * policy.bonus_rate), max(pool - reserved, 0))
            profile.apply_verified(day, achieved, policy.reward_xp)
            receipt = {
                "status": "VERIFIED",
                "mode": "development" if self.dev_mode else "production",
                "session_id": session_id,
                "mission_id": policy.mission_id,
                "mission_name": policy.name,
                "assurance": f"P{achieved}",
                "duration_seconds": round(row["submitted_at"] - row["started_at"], 1),
                "checkpoint_count": len(cps),
                "evidence_root": row["evidence_root"].hex(),
                "checks": {
                    "wallet_signature": "PASSED",
                    "seeker_eligibility": "PASSED" if row["eligibility_mode"] == "SGT_VERIFIED" else "DEV_BYPASS",
                    "session_nonce": "PASSED",
                    "evidence_chain": "PASSED",
                    "mission_policy": "PASSED",
                    "replay": "PASSED",
                },
                "reward": {"xp": policy.reward_xp, "token": reserved / 10 ** self._decimals(),
                           "symbol": self.symbol(policy),
                           "funding": "RESERVED" if funded else "UNFUNDED" if reward_base else "NONE",
                           "stake": stake_base / 10 ** self._decimals(), "bonus": bonus / 10 ** self._decimals()},
                "league_before": league_before,
                "rank_before": rank_before,
                "day": day,
                "verified_at": self.clock(),
                "settlement": {"status": "PENDING"},
            }
            with self.db:
                self.db.execute("INSERT INTO claims VALUES (?,?,?,?,?,?)",
                                (session_id, self._identity_key(row), policy.mission_id, day, seq, reserved + bonus))
                self._save_profile(profile)
                receipt.update(league_after=league_for(profile.xp), rank_after=self._rank(profile.xp),
                               streak=profile.current_streak, total_xp=profile.xp)
                self.db.execute("UPDATE sessions SET state='VERIFIED', receipt=? WHERE id=?",
                                (json.dumps(receipt), session_id))
        event("verified", session_id, mission_id=policy.mission_id, assurance=f"P{achieved}")
        receipt["settlement"] = self.settle(session_id)
        return {"verified": True, "assurance": f"P{achieved}", "mission_id": policy.mission_id,
                "evidence_root": receipt["evidence_root"], "reason": None, "receipt": receipt}

    def settle(self, session_id: str) -> dict:
        """Anchor a VERIFIED session on-chain. Safe to retry; the chain also rejects a 2nd write per day."""
        with self.lock:
            row = self._session(session_id)
            self._expect(row, "VERIFIED")
            if session_id in self.settling:
                raise AttestError(Reason.INVALID_STATE, "settlement already in progress")
            self.settling.add(session_id)
            receipt = json.loads(row["receipt"])
            claim = self.db.execute("SELECT seq, reward_base FROM claims WHERE session_id=?", (session_id,)).fetchone()
        try:
            result = self.attestor.settle(AttestationRecord(
                wallet=row["wallet"], day=receipt["day"], mission_id=row["mission_id"],
                evidence_root=row["evidence_root"], assurance_level=int(receipt["assurance"][1:]),
                sgt_mint=row["sgt_mint"], seq=claim["seq"],
                reward_base=claim["reward_base"] + self._held_stake(session_id)))
        finally:
            with self.lock:
                self.settling.discard(session_id)
        settlement = {"status": result.status, "signature": result.signature,
                      "network": result.network, "detail": result.detail,
                      "reward_token": result.reward_base / 10 ** self._decimals(),
                      "reward_symbol": self.symbol(self._mission(row["mission_id"])),
                      "reward_mint": result.reward_mint}
        if result.signature and result.network in EXPLORER:
            settlement["explorer_url"] = f"https://explorer.solana.com/tx/{result.signature}{EXPLORER[result.network]}"
        receipt["settlement"] = settlement
        state = "SETTLED" if result.status == "CONFIRMED" else "VERIFIED"
        with self.lock, self.db:
            self.db.execute("UPDATE sessions SET state=?, receipt=? WHERE id=?",
                            (state, json.dumps(receipt), session_id))
            if state == "SETTLED":
                self.db.execute("UPDATE stakes SET status='RETURNED' WHERE session_id=? AND status='HELD'",
                                (session_id,))
        event("settlement", session_id, status=result.status)
        return settlement

    # ---------- sponsor pools ----------

    def symbol(self, policy: MissionPolicy) -> str:
        """Off mainnet the reward mint is a test token; never let a receipt call it SKR."""
        return policy.reward_symbol if self.network == "mainnet" else f"{policy.reward_symbol}-TEST"

    def _decimals(self) -> int:
        return getattr(self.attestor, "reward_decimals", 0) or 0

    def _reward_base(self, policy: MissionPolicy) -> int:
        if not getattr(self.attestor, "reward_mint", None):
            return 0
        return round(policy.reward_token * 10 ** self._decimals())

    def _stake_base(self, policy: MissionPolicy) -> int:
        if not getattr(self.attestor, "reward_mint", None):
            return 0
        return round(policy.stake_token * 10 ** self._decimals())

    def _held_stake(self, session_id: str) -> int:
        row = self.db.execute("SELECT amount_base FROM stakes WHERE session_id=? AND status='HELD'",
                              (session_id,)).fetchone()
        return row[0] if row else 0

    def _forfeited(self, mission_id: str) -> int:
        """Stakes lost to the pool: rejected sessions, plus held stakes whose session expired unfinished."""
        return self.db.execute(
            "SELECT COALESCE(SUM(k.amount_base),0) FROM stakes k JOIN sessions s ON s.id = k.session_id "
            "WHERE k.mission_id=? AND (k.status='FORFEITED' OR (k.status='HELD' AND s.expires_at < ? "
            "AND s.state IN ('CREATED','ACTIVE','SUBMITTED')))", (mission_id, self.clock())).fetchone()[0]

    def _pool_remaining(self, mission_id: str) -> int:
        deposited = self.db.execute("SELECT COALESCE(SUM(amount_base),0) FROM sponsor_deposits WHERE mission_id=?",
                                    (mission_id,)).fetchone()[0]
        reserved = self.db.execute("SELECT COALESCE(SUM(reward_base),0) FROM claims WHERE mission_id=?",
                                   (mission_id,)).fetchone()[0]
        return deposited + self._forfeited(mission_id) - reserved

    def sponsor_deposit(self, mission_id: str, signature: str) -> dict:
        """Credit a mission's pool with a confirmed on-chain transfer into the attestor's pool account."""
        self._mission(mission_id)
        try:
            dep = self.attestor.verify_deposit(signature)
        except RuntimeError as e:
            raise AttestError(Reason.INVALID_STATE, str(e)) from e
        try:
            with self.lock, self.db:
                self.db.execute("INSERT INTO sponsor_deposits VALUES (?,?,?,?,?)",
                                (signature, mission_id, dep.amount_base, dep.depositor, self.clock()))
        except sqlite3.IntegrityError as e:
            raise AttestError(Reason.NONCE_REPLAY, "deposit transaction already credited") from e
        event("sponsor_deposit", None, mission_id=mission_id, amount_base=dep.amount_base)
        return {"mission_id": mission_id, "credited": dep.amount_base / 10 ** self._decimals(),
                "depositor": dep.depositor, **self.pools()[mission_id]}

    def pools(self) -> dict:
        d = 10 ** self._decimals() if self._decimals() else 1
        out = {}
        for m in self.missions.values():
            deposited = self.db.execute("SELECT COALESCE(SUM(amount_base),0) FROM sponsor_deposits WHERE mission_id=?",
                                        (m.mission_id,)).fetchone()[0]
            remaining = self._pool_remaining(m.mission_id)
            out[m.mission_id] = {"symbol": self.symbol(m), "sponsor": m.sponsor,
                                 "deposited": deposited / d, "forfeited": self._forfeited(m.mission_id) / d,
                                 "remaining": remaining / d,
                                 "reward_per_claim": m.reward_token,
                                 "claims_funded": int(remaining // max(self._reward_base(m), 1)) if self._reward_base(m) else 0}
        return out

    def faucet(self, wallet: str) -> dict:
        """DEVELOPMENT ONLY: one grant of fee SOL + test tokens per wallet; never on mainnet."""
        if self.network == "mainnet":
            raise AttestError(Reason.INVALID_STATE, "no faucet on mainnet")
        identity.decode_wallet(wallet)
        with self.lock:
            if self.db.execute("SELECT 1 FROM faucet_grants WHERE wallet=?", (wallet,)).fetchone():
                return {"granted": False, "detail": "already funded"}
        try:
            sig = self.attestor.faucet(wallet, 10_000_000, 50 * 10 ** self._decimals())  # 0.01 SOL, 50 test tokens
        except Exception as e:
            raise AttestError(Reason.NETWORK_ERROR, str(e)[:200]) from e
        with self.lock, self.db:
            self.db.execute("INSERT OR IGNORE INTO faucet_grants VALUES (?,?,?)", (wallet, sig, self.clock()))
        event("faucet", None)
        return {"granted": True, "signature": sig, "sol": 0.01, "tokens": 50}

    # ---------- reads ----------

    def receipt(self, session_id: str) -> dict:
        row = self._session(session_id)
        if row["receipt"] is None:
            raise AttestError(Reason.INVALID_STATE, f"no receipt while session is {row['state']}")
        return {"state": row["state"], **json.loads(row["receipt"])}

    def profile(self, wallet: str) -> dict:
        identity.decode_wallet(wallet)
        p = self._profile(wallet)
        today = utc_day(self.clock())
        claims = dict(self.db.execute(
            "SELECT c.mission_id, COUNT(*) FROM claims c JOIN sessions s ON s.id = c.session_id "
            "WHERE s.wallet=? AND c.day=? GROUP BY c.mission_id", (wallet, today)).fetchall())
        return {**p.view(today, self._rank(p.xp) if p.verified_count else None), "claims_today": claims}
