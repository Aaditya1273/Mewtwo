"""Environment configuration. Development mode is never implied; it must be set explicitly."""

import os
from dataclasses import dataclass
from pathlib import Path

NETWORKS = {"localnet", "devnet", "mainnet"}
BACKEND_DIR = Path(__file__).resolve().parent.parent


def _bool(name: str) -> bool:
    return os.environ.get(name, "false").strip().lower() in {"1", "true", "yes"}


@dataclass(frozen=True)
class Settings:
    dev_mode: bool
    domain: str
    db_path: str
    missions_path: Path
    session_ttl_seconds: int
    sgt_rpc_url: str
    network: str
    solana_rpc_url: str
    program_id: str | None
    attestor_keypair: str | None
    reward_mint: str | None
    reward_decimals: int

    @property
    def chain_id(self) -> str:
        # SGTs exist only on mainnet, so a production SIWS signature is scoped to mainnet.
        return f"solana:{self.network}" if self.dev_mode else "solana:mainnet"

    @classmethod
    def from_env(cls) -> "Settings":
        network = os.environ.get("SOLANA_NETWORK", "localnet")
        if network not in NETWORKS:
            raise ValueError(f"SOLANA_NETWORK must be one of {sorted(NETWORKS)}")
        return cls(
            dev_mode=_bool("ATTEST_DEV_MODE"),
            domain=os.environ.get("ATTEST_DOMAIN", "presence.local"),
            db_path=os.environ.get("ATTEST_DB", str(BACKEND_DIR / "attest.db")),
            missions_path=Path(os.environ.get("ATTEST_MISSIONS", BACKEND_DIR / "missions.json")),
            session_ttl_seconds=int(os.environ.get("ATTEST_SESSION_TTL_SECONDS", "300")),
            sgt_rpc_url=os.environ.get("SGT_RPC_URL", "https://api.mainnet-beta.solana.com"),
            network=network,
            solana_rpc_url=os.environ.get("SOLANA_RPC_URL", "http://127.0.0.1:8899"),
            program_id=os.environ.get("PROGRAM_ID") or None,
            attestor_keypair=os.environ.get("ATTESTOR_KEYPAIR") or None,
            reward_mint=os.environ.get("REWARD_MINT") or None,
            reward_decimals=int(os.environ.get("REWARD_DECIMALS", "6")),
        )
