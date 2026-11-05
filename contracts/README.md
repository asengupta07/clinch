# Clinch contracts

Foundry project. See the repository README for the design and guarantees.

```bash
forge build
forge test                          # unit, property, differential (FFI -> ../research) and regression tests
FOUNDRY_PROFILE=ci forge test       # 2,000 fuzz runs per property
```

- `src/libraries/ClinchEngine.sol` - discretized adaptive clinching engine (one-sided and two-sided)
- `src/ClinchHook.sol` - Uniswap v4 batch-auction hook
- `src/ClinchLaunch.sol`, `src/ClinchLaunchFactory.sol` - token launch that seeds a Clinch pool
- `script/DeployLocal.s.sol`, `script/SeedDemo.s.sol` - local anvil demo; `script/DeployTestnet.s.sol` - existing PoolManager
- `script/export-abis.sh` - copies ABIs and the local deployment into `../app`
