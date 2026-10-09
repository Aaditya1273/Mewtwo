#!/usr/bin/env bash
# Sponsor flow: a sponsor wallet transfers REWARD_MINT into the attestor's pool on-chain, then
# registers each transfer with ATTEST (/sponsor/deposit), which reads it back from chain before crediting.
#   fund_pool.sh <cluster-url> <attestor.json> <sponsor.json> <mint> <attest-url> <mission>=<amount> ...
set -euo pipefail
URL=$1 ATTESTOR_KEY=$2 SPONSOR_KEY=$3 MINT=$4 ATTEST=$5; shift 5
ATTESTOR="$(solana-keygen pubkey "$ATTESTOR_KEY")"
for pair in "$@"; do
  mission=${pair%%=*} amount=${pair#*=}
  sig="$(spl-token -u "$URL" --output json --fee-payer "$ATTESTOR_KEY" transfer "$MINT" "$amount" "$ATTESTOR" \
    --owner "$SPONSOR_KEY" --fund-recipient | python3 -c 'import json,sys; print(json.load(sys.stdin)["signature"])')"
  curl -sf "$ATTEST/sponsor/deposit" -H 'content-type: application/json' \
    -d "{\"mission_id\":\"$mission\",\"signature\":\"$sig\"}" >/dev/null
  echo "sponsor deposited $amount into $mission pool (tx $sig)"
done
