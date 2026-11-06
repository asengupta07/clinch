#!/usr/bin/env bash
# Copies contract ABIs into the frontend. Run from repo root after `forge build`.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=../app/src/abi
mkdir -p "$OUT"
for c in ClinchHook ClinchLaunch ClinchLaunchFactory MockERC20; do
  jq '.abi' "out/$c.sol/$c.json" > "$OUT/$c.json"
done
cp deployments/local.json "$OUT/../deployments.local.json" 2>/dev/null || true
echo "exported ABIs to $OUT"
