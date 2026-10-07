#!/usr/bin/env bash
# One-time devnet setup after `solana program deploy` of target/deploy/presence.so:
# attestor key -> funded from your CLI wallet -> program Config -> reward test-token mint -> .devnet/attest.env
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/toolchain.env"
STATE="$ROOT/.devnet"
mkdir -p "$STATE"
PROGRAM_ID="$(solana-keygen pubkey "$ROOT/target/deploy/presence-keypair.json")"
KEY="$STATE/attestor.json"
[ -f "$KEY" ] || solana-keygen new --no-bip39-passphrase -s -o "$KEY" >/dev/null
ATTESTOR="$(solana-keygen pubkey "$KEY")"
solana transfer -u devnet --allow-unfunded-recipient "$ATTESTOR" 0.5 >/dev/null
echo "attestor $ATTESTOR funded: $(solana balance -u devnet "$ATTESTOR")"

cd "$ROOT/backend"
export SOLANA_NETWORK=devnet SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}" PROGRAM_ID ATTESTOR_KEYPAIR="$KEY"
uv run python -m attest.bootstrap
MINT="$(spl-token create-token -u devnet --decimals 0 --fee-payer "$KEY" --mint-authority "$ATTESTOR" --output json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["commandOutput"]["address"])')"

cat > "$STATE/attest.env" <<ENV
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=$SOLANA_RPC_URL
PROGRAM_ID=$PROGRAM_ID
ATTESTOR_KEYPAIR=$KEY
REWARD_MINT=$MINT
ATTEST_DB=$STATE/attest.db
ENV
echo "wrote $STATE/attest.env (reward mint $MINT)"
echo "run:  cd backend && set -a && . ../.devnet/attest.env && set +a && ATTEST_DEV_MODE=true uv run python -m attest.app"
