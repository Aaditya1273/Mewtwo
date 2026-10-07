#!/usr/bin/env bash
# Local development stack: solana-test-validator + presence program + ATTEST (DEVELOPMENT MODE).
# The Android emulator reaches it at http://10.0.2.2:8787 (the app's default BACKEND_URL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/toolchain.env"
STATE="$ROOT/.dev"
mkdir -p "$STATE"
PROGRAM_ID="$(solana-keygen pubkey "$ROOT/target/deploy/presence-keypair.json")"
[ -f "$ROOT/target/deploy/presence.so" ] || (cd "$ROOT" && anchor build)
[ -f "$STATE/attestor.json" ] || solana-keygen new --no-bip39-passphrase -s -o "$STATE/attestor.json" >/dev/null

solana-test-validator --reset --quiet --ledger "$STATE/ledger" \
  --bpf-program "$PROGRAM_ID" "$ROOT/target/deploy/presence.so" &
VALIDATOR=$!
trap 'kill $VALIDATOR 2>/dev/null || true' EXIT
until solana -u localhost cluster-version >/dev/null 2>&1; do sleep 0.5; done
solana -u localhost airdrop 100 "$STATE/attestor.json" >/dev/null

cd "$ROOT/backend"
export ATTEST_DEV_MODE=true SOLANA_NETWORK=localnet SOLANA_RPC_URL=http://127.0.0.1:8899 \
       PROGRAM_ID ATTESTOR_KEYPAIR="$STATE/attestor.json" ATTEST_DB="$STATE/attest.db"
rm -f "$STATE/attest.db"*  # the validator was reset, so reset off-chain state with it
uv run python -m attest.bootstrap
export REWARD_MINT="$(spl-token create-token -u localhost --decimals 0 --fee-payer "$STATE/attestor.json" \
  --mint-authority "$(solana-keygen pubkey "$STATE/attestor.json")" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["commandOutput"]["address"])')"
echo "ATTEST (DEVELOPMENT MODE) on :8787, program $PROGRAM_ID on localnet"
uv run python -m attest.app
