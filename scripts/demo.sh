#!/usr/bin/env bash
# One command local demo: fresh anvil chain, deploy, seed, export ABIs, run the app.
#   ./scripts/demo.sh            # launch ends 15 min after deploy
#   LAUNCH_SECONDS=300 ./scripts/demo.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC=http://127.0.0.1:8545

if cast chain-id --rpc-url $RPC >/dev/null 2>&1; then
  echo "anvil already running on 8545 - stop it first for a fresh demo (pkill anvil)"; exit 1
fi
echo "starting anvil (2s blocks)"
anvil --silent --block-time 2 --port 8545 &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.3; done

cd "$ROOT/contracts"
forge build >/dev/null
forge script script/DeployLocal.s.sol --rpc-url $RPC --broadcast >/dev/null
forge script script/SeedDemo.s.sol --rpc-url $RPC --broadcast >/dev/null
./script/export-abis.sh
echo "deployed: $(jq -c '{hook,launch,factory}' deployments/local.json)"

cd "$ROOT/app"
[ -d node_modules ] || npm install
echo "app on http://localhost:5173  (keeper: cd app && npm run keeper)"
npm run dev
