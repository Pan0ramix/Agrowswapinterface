# Goldsky Subgraph Setup

This document describes how to set up and maintain the Goldsky subgraph for Agroswap.

## ABI Management

The ABIs in `abis/` are automatically synced from the contracts repository to prevent ABI drift.

### Syncing ABIs

To sync ABIs from the contracts repo, run:

```bash
CONTRACTS_REPO=/absolute/path/to/DexAgroswapSmartContracts/Agroswap pnpm sync:abis
```

**Important:** Always use an absolute path for `CONTRACTS_REPO`.

### What Gets Synced

The sync script extracts ABIs from Hardhat artifacts in the contracts repo:

- **UniswapV3Factory** - From `packages/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json`
- **UniswapV3Pool** - From `packages/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json`
- **NonfungiblePositionManager** - From `packages/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json`
- **UniswapV3Staker** - From `packages/v3-periphery/artifacts/contracts/UniswapV3Staker.sol/UniswapV3Staker.json`
- **ERC20** - Extracted from token contracts in `packages/tokens/` (or uses minimal fallback)

### ABI Format

The sync script extracts **only the ABI array** from Hardhat artifacts. Each output file contains a JSON array of ABI items:

```json
[
  {
    "type": "event",
    "name": "PoolCreated",
    "inputs": [...]
  },
  ...
]
```

This format is Goldsky-friendly and contains only the ABI definitions, not the full Hardhat artifact metadata.

### Validation

The sync script validates that required events exist in each ABI:

- **Factory**: Must have `PoolCreated(address,address,uint24,int24,address)`
- **Pool**: Must have `Swap`, `Mint`, `Burn`, `Collect` events
- **NFPM**: Must have `IncreaseLiquidity`, `DecreaseLiquidity`, `Collect`, `Transfer` events
- **Staker**: Validates that events exist (no specific requirements)
- **ERC20**: Must have `Transfer` and `Approval` events

If validation fails, the script exits with an error and does not overwrite any files.

### When to Sync

Sync ABIs whenever:
- Contracts are updated in the contracts repo
- New contracts are deployed
- You want to ensure ABIs are up-to-date before deploying the subgraph

### Prerequisites

1. The contracts repo must be compiled (artifacts must exist)
2. You must have read access to the contracts repo
3. Node.js must be installed (the script uses Node.js built-in modules only)

### Troubleshooting

**Error: CONTRACTS_REPO environment variable is required**
- Make sure you're setting the environment variable: `CONTRACTS_REPO=/path/to/contracts pnpm sync:abis`

**Error: Invalid CONTRACTS_REPO path**
- Verify the path exists and is a directory
- Use an absolute path, not a relative path

**Error: Could not find [Contract].json**
- The contracts repo may not be compiled. Run `npx hardhat compile` in the relevant package directory
- Check that the artifact file exists in the expected location

**Error: [Contract] is missing required events**
- The ABI may be incomplete or from a different contract version
- Verify the contract source matches what you expect
- Check that the artifact file is correct

### Manual Override

If you need to manually update an ABI (not recommended), you can edit the files directly in `abis/`. However, these changes will be overwritten the next time you run `sync:abis`.

---

**Last Updated:** December 17, 2025
