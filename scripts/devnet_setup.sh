#!/usr/bin/env bash
# One-time devnet setup after `solana program deploy` of target/deploy/presence.so:
#   attestor key (funded from your CLI wallet) -> program Config -> SKR_TEST reward mint (6 decimals,
#   like SKR) -> sponsor wallet holding SKR_TEST -> .devnet/attest.env
# Then start ATTEST with that env and fund mission pools with scripts/fund_pool.sh (printed below).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/toolchain.env"
STATE="$ROOT/.devnet"
mkdir -p "$STATE"
URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
PROGRAM_ID="$(solana-keygen pubkey "$ROOT/target/deploy/presence-keypair.json")"
KEY="$STATE/attestor.json" SPONSOR_KEY="$STATE/sponsor.json"
[ -f "$KEY" ] || solana-keygen new --no-bip39-passphrase -s -o "$KEY" >/dev/null
[ -f "$SPONSOR_KEY" ] || solana-keygen new --no-bip39-passphrase -s -o "$SPONSOR_KEY" >/dev/null
ATTESTOR="$(solana-keygen pubkey "$KEY")" SPONSOR="$(solana-keygen pubkey "$SPONSOR_KEY")"
if [ "$(solana balance -u devnet "$ATTESTOR" | cut -d' ' -f1 | cut -d. -f1)" = "0" ]; then
  solana transfer -u devnet --allow-unfunded-recipient "$ATTESTOR" 0.5 >/dev/null
fi
echo "attestor $ATTESTOR: $(solana balance -u devnet "$ATTESTOR")"

cd "$ROOT/backend"
export SOLANA_NETWORK=devnet SOLANA_RPC_URL="$URL" PROGRAM_ID ATTESTOR_KEYPAIR="$KEY"
uv run python -m attest.bootstrap 2>/dev/null || echo "config already initialized"

spl() { spl-token -u devnet --fee-payer "$KEY" --output json "$@"; }
MINT="$(spl create-token --decimals 6 --mint-authority "$ATTESTOR" | python3 -c 'import json,sys; print(json.load(sys.stdin)["commandOutput"]["address"])')"
spl create-account "$MINT" --owner "$SPONSOR" >/dev/null
spl mint "$MINT" 10000 --recipient-owner "$SPONSOR" --mint-authority "$KEY" >/dev/null
echo "SKR_TEST mint $MINT; sponsor $SPONSOR holds 10000"

rm -f "$STATE/attest.db"*
cat > "$STATE/attest.env" <<ENV
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=$URL
PROGRAM_ID=$PROGRAM_ID
ATTESTOR_KEYPAIR=$KEY
REWARD_MINT=$MINT
REWARD_DECIMALS=6
ATTEST_DB=$STATE/attest.db
ENV
echo "wrote $STATE/attest.env"
echo "run:   cd backend && set -a && . ../.devnet/attest.env && set +a && ATTEST_DEV_MODE=true uv run python -m attest.app"
echo "fund:  scripts/fund_pool.sh devnet $KEY $SPONSOR_KEY $MINT http://localhost:8787 quick-clock-in=20 deep-focus-25=50"
