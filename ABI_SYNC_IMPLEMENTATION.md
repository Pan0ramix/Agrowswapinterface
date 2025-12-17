# ABI Sync Implementation Summary

## Overview

An automated ABI sync workflow has been implemented to keep `agroswap-subgraph/abis/*.json` files in sync with the latest compiled ABIs from the contracts repository, preventing ABI drift.

## Files Created/Modified

### New Files

1. **`scripts/sync-goldsky-abis.mjs`**
   - Node.js ESM script that syncs ABIs from contracts repo
   - Uses only Node.js built-in modules (no dependencies)
   - Recursively searches for Hardhat artifacts
   - Extracts ABI arrays from artifacts
   - Validates required events
   - Writes Goldsky-friendly ABI files

2. **`agroswap-subgraph/GOLDSKY_SETUP.md`**
   - Documentation for ABI management
   - Instructions for running sync script
   - Troubleshooting guide

### Modified Files

1. **`package.json`**
   - Added `sync:abis` script: `"sync:abis": "node scripts/sync-goldsky-abis.mjs"`

2. **`GOLDSKY_SETUP.md`** (root)
   - Added ABI Management section with reference to sync process

## Usage

### Basic Usage

```bash
CONTRACTS_REPO=/absolute/path/to/DexAgroswapSmartContracts/Agroswap pnpm sync:abis
```

### Example

```bash
CONTRACTS_REPO=/Users/bernardo/Desktop/Agroswap/DexAgroswapSmartContracts/Agroswap pnpm sync:abis
```

## What Gets Synced

The script syncs the following ABIs:

| Contract | Source Location | Output File | Required Events |
|----------|----------------|-------------|----------------|
| UniswapV3Factory | `packages/v3-core/artifacts/...` | `UniswapV3Factory.json` | PoolCreated |
| UniswapV3Pool | `packages/v3-core/artifacts/...` | `UniswapV3Pool.json` | Swap, Mint, Burn, Collect |
| NonfungiblePositionManager | `packages/v3-periphery/artifacts/...` | `NonfungiblePositionManager.json` | IncreaseLiquidity, DecreaseLiquidity, Collect, Transfer |
| UniswapV3Staker | `packages/v3-periphery/artifacts/...` | `UniswapV3Staker.json` | (any events) |
| ERC20 | `packages/tokens/artifacts/...` or fallback | `ERC20.json` | Transfer, Approval |

## Features

### ✅ Safety Features

- **No silent deletions**: Only overwrites target ABI files
- **Explicit errors**: Fails with clear messages if paths are wrong or files missing
- **Validation**: Checks that required events exist before writing
- **Non-destructive**: Exits on error without overwriting files

### ✅ Robustness

- **Recursive search**: Finds artifacts even if directory structure changes
- **Multiple ERC20 sources**: Tries FakeEURO, FakeUSDT, CPRVerde01, or uses fallback
- **Path normalization**: Handles absolute/relative paths correctly
- **Error handling**: Graceful handling of permission errors, missing files, etc.

### ✅ Output Format

- **Goldsky-friendly**: Outputs only ABI array, not full Hardhat artifact
- **Formatted**: 2-space indentation, normalized line endings
- **Validated**: Ensures JSON is valid before writing

## Validation Rules

The script validates that each ABI contains required events:

- **Factory**: Must have `PoolCreated` event
- **Pool**: Must have `Swap`, `Mint`, `Burn`, `Collect` events
- **NFPM**: Must have `IncreaseLiquidity`, `DecreaseLiquidity`, `Collect`, `Transfer` events
- **Staker**: Must have at least one event (no specific requirements)
- **ERC20**: Must have `Transfer` and `Approval` events

If validation fails, the script exits with a non-zero code and lists missing events.

## Error Handling

The script handles various error conditions:

- Missing `CONTRACTS_REPO` env var → Clear error message
- Invalid path → Error with details
- Missing artifacts → Error listing what was searched
- Invalid artifacts → Error with file path
- Missing events → Error listing missing events
- Permission errors → Warning (continues searching)

## Output

The script provides:

1. **Progress logs**: Shows what's being searched and found
2. **Validation status**: ✅ for each contract
3. **Summary table**: Source path, output path, ABI item count, validation status

Example output:
```
Contracts repo: /path/to/contracts
Target ABI directory: /path/to/interface/agroswap-subgraph/abis

Searching for UniswapV3Factory.json...
  Found: /path/to/contracts/packages/v3-core/artifacts/.../UniswapV3Factory.json
  ✅ Written 246 ABI items to UniswapV3Factory.json

============================================================
Sync Summary
============================================================

UniswapV3Factory.json:
  Source: /path/to/contracts/packages/v3-core/artifacts/.../UniswapV3Factory.json
  Output: /path/to/interface/agroswap-subgraph/abis/UniswapV3Factory.json
  ABI Items: 246
  Validation: ✅

✅ All ABIs synced successfully!
```

## Dependencies

**None!** The script uses only Node.js built-in modules:
- `fs/promises` - File operations
- `path` - Path manipulation
- `url` - ESM module resolution

No additional npm packages required.

## Testing

To test the script:

1. Ensure contracts repo is compiled:
   ```bash
   cd /path/to/contracts/packages/v3-core && npx hardhat compile
   cd /path/to/contracts/packages/v3-periphery && npx hardhat compile
   cd /path/to/contracts/packages/tokens && npx hardhat compile
   ```

2. Run the sync:
   ```bash
   CONTRACTS_REPO=/path/to/contracts pnpm sync:abis
   ```

3. Verify output files in `agroswap-subgraph/abis/`:
   - Check that files are JSON arrays
   - Verify required events exist
   - Confirm file sizes are reasonable

## Maintenance

### When to Run

Run `sync:abis` whenever:
- Contracts are updated in the contracts repo
- New contracts are deployed
- Before deploying/updating the subgraph
- When you suspect ABI drift

### CI/CD Integration

Consider adding to CI/CD pipeline:
```yaml
- name: Sync ABIs
  run: |
    CONTRACTS_REPO=${{ github.workspace }}/../DexAgroswapSmartContracts/Agroswap \
    pnpm sync:abis
```

## Troubleshooting

See `agroswap-subgraph/GOLDSKY_SETUP.md` for detailed troubleshooting guide.

Common issues:
- **Path errors**: Always use absolute paths
- **Missing artifacts**: Compile contracts first
- **Validation failures**: Check contract versions match

---

**Implementation Date:** December 17, 2025  
**Status:** ✅ Complete and Ready for Use
