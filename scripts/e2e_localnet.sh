#!/usr/bin/env bash
# End-to-end on a throwaway local validator: deploy program, bootstrap config, settle a real attestation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/toolchain.env"
PROGRAM_ID="$(solana-keygen pubkey "$ROOT/target/deploy/presence-keypair.json")"
WORK="$(mktemp -d)"
trap 'kill $VALIDATOR 2>/dev/null || true; rm -rf "$WORK"' EXIT

[ -f "$ROOT/target/deploy/presence.so" ] || (cd "$ROOT" && anchor build)

solana-test-validator --reset --quiet --ledger "$WORK/ledger" \
  --bpf-program "$PROGRAM_ID" "$ROOT/target/deploy/presence.so" &
VALIDATOR=$!
until solana -u localhost cluster-version >/dev/null 2>&1; do sleep 0.5; done

solana-keygen new --no-bip39-passphrase -s -o "$WORK/attestor.json" >/dev/null
solana -u localhost airdrop 10 "$WORK/attestor.json" >/dev/null

cd "$ROOT/backend"
export SOLANA_NETWORK=localnet SOLANA_RPC_URL=http://127.0.0.1:8899 PROGRAM_ID ATTESTOR_KEYPAIR="$WORK/attestor.json"
uv run python -m attest.bootstrap
# SKR_TEST: 6 decimals like real SKR. A sponsor funds the attestor's pool by an ordinary transfer.
spl() { spl-token -u localhost --fee-payer "$WORK/attestor.json" --output json "$@"; }
ATTESTOR="$(solana-keygen pubkey "$WORK/attestor.json")"
solana-keygen new --no-bip39-passphrase -s -o "$WORK/sponsor.json" >/dev/null
SPONSOR="$(solana-keygen pubkey "$WORK/sponsor.json")"
export REWARD_MINT="$(spl create-token --decimals 6 --mint-authority "$ATTESTOR" | python3 -c 'import json,sys; print(json.load(sys.stdin)["commandOutput"]["address"])')"
spl create-account "$REWARD_MINT" --owner "$SPONSOR" >/dev/null
spl create-account "$REWARD_MINT" --owner "$ATTESTOR" >/dev/null
spl mint "$REWARD_MINT" 1000 --recipient-owner "$SPONSOR" --mint-authority "$WORK/attestor.json" >/dev/null
export DEPOSIT_SIG="$(spl transfer "$REWARD_MINT" 500 "$ATTESTOR" --owner "$WORK/sponsor.json" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["signature"])')"
ATTESTED_OUT="$WORK/attested.json" LOCALNET_ATTESTOR="$WORK/attestor.json" uv run pytest -q -m localnet
cd "$ROOT/sdk/verify-presence" && [ -d node_modules ] || npm install --silent
ATTESTED_OUT="$WORK/attested.json" node --test "test/*.test.ts"
