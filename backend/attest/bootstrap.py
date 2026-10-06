"""One-time: point the presence program's Config at the ATTEST attestor key.

    uv run python -m attest.bootstrap   (reads SOLANA_RPC_URL, SOLANA_NETWORK, PROGRAM_ID, ATTESTOR_KEYPAIR)

The attestor key acts as admin and attestor here; use a separate admin key in production.
"""

from pathlib import Path

from .config import Settings
from .settlement import SolanaAttestor, initialize_config_ix


def main() -> None:
    s = Settings.from_env()
    if not (s.program_id and s.attestor_keypair):
        raise SystemExit("PROGRAM_ID and ATTESTOR_KEYPAIR are required")
    a = SolanaAttestor(s.solana_rpc_url, s.network, s.program_id, Path(s.attestor_keypair))
    me = a.keypair.pubkey()
    sig = a.send(initialize_config_ix(a.program_id, me, me))
    a.confirm(sig)
    print(f"config initialized on {s.network}: attestor={me} tx={sig}")


if __name__ == "__main__":
    main()
