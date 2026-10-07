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
export REWARD_MINT="$(spl-token create-token -u localhost --decimals 0 --fee-payer "$WORK/attestor.json" \
  --mint-authority "$(solana-keygen pubkey "$WORK/attestor.json")" --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)["commandOutput"]["address"])')"
LOCALNET_ATTESTOR="$WORK/attestor.json" uv run pytest -q -m localnet
