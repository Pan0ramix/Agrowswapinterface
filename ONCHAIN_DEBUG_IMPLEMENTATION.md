# On-Chain Swap Debug Implementation

## Overview
This document describes the comprehensive debug logging and fixes implemented for on-chain-only swaps on Base Sepolia (chainId 84532).

## Debug Gate Utility

**File:** `packages/uniswap/src/features/transactions/swap/utils/isOnChainDebug.ts`

```typescript
export function isOnChainDebug(chainId: number | undefined): boolean {
  if (chainId !== 84532) return false
  const debugEnv = process.env.NEXT_PUBLIC_ONCHAIN_DEBUG || process.env.ONCHAIN_DEBUG
  return debugEnv === '1' || debugEnv === 'true'
}
```

**Usage:** Gate all debug logs with `isOnChainDebug(chainId)` to prevent console spam.

## Comprehensive Structured Logging

**File:** `packages/uniswap/src/features/transactions/swap/utils/getOnChainSwapDetails.ts`

When `NEXT_PUBLIC_ONCHAIN_DEBUG=1` and `chainId === 84532`, logs a single structured bundle per computation:

### 1. Inputs Section
- `chainId`
- `tokenIn`: address, symbol, decimals
- `tokenOut`: address, symbol, decimals
- `amountInRaw`, `amountInExact`
- `amountOutRaw`, `amountOutExact`
- `slippageToleranceBps` (if available)
- `amountOutQuotedRaw` (if available)
- `amountOutMinimumRaw` (if available)
- `pool.fee` (if available)

### 2. Pool State Section
- `poolAddress`
- `sqrtPriceX96` (as string)
- `tick`
- `liquidity`
- `fee`
- `token0`: address, symbol, decimals
- `token1`: address, symbol, decimals
- `isTokenInToken0`: whether tokenIn is token0
- `token0Price`: formatted price (token1 per token0)
- `token1Price`: formatted price (token0 per token1)
- `midPrice_viaPriceOf`: price using `pool.priceOf(tokenIn)` (PRIMARY METHOD)
- `midPrice_direction`: "tokenOut per tokenIn"

### 3. Mid Price Cross-Checks
- **sqrtPriceX96_calculation**: Manual calculation from sqrtPriceX96
  - Formula: `price = (sqrtPriceX96^2) / (2^192)`
  - Logs both raw ratio and adjusted ratio based on token ordering
- **tick_calculation**: Calculation from tick using TickMath
  - Uses `TickMath.getSqrtRatioAtTick(tick)`
  - Logs both raw ratio and adjusted ratio

### 4. Execution Price Section
- `executionPrice`: formatted (6 significant digits)
- `executionPriceRaw`: numerator/denominator fraction
- `executionPrice_inverse`: inverse price
- `direction`: "tokenOut per tokenIn"

### 5. Mid Price Summary
- `midPrice`: formatted (6 significant digits)
- `midPrice_inverse`: inverse price
- `direction`: "tokenOut per tokenIn"
- `matches_execution_direction`: boolean check that both prices are in same direction

### 6. Price Impact Section
- `midPrice_numeric`: full precision (18 significant digits)
- `executionPrice_numeric`: full precision
- `priceDiff_numeric`: difference
- `impactFraction_numeric`: fraction as numerator/denominator
- `impactBps_raw`: raw basis points (can be negative)
- `impactBps_clamped`: clamped to >= 0
- `impactPercent`: formatted percentage
- `signConvention`: explanation of sign meaning
- **sanityCheck_inverse**: Impact computed using inverse prices (should match within 1 bps)

### 7. Slippage Section
- `slippageToleranceBps`: tolerance in basis points
- `amountOutQuotedRaw`: quoted output amount
- `amountOutMinimumRaw`: minimum output amount (with slippage)
- `slippageBuffer`: difference (quoted - minimum)
- `slippageBufferPercent`: buffer as percentage
- `minEqualsQuoted`: whether rounding caused no buffer
- `wouldRevertIf`: "actualOut < amountOutMinimumRaw"
- `note`: "Price impact does not imply failure. Slippage tolerance protects against execution price worse than quoted."

### 8. Network Cost Sections
- **networkCost_approval**: (if approval needed)
  - `step`: "approve"
  - `gasLimit`, `maxFeePerGas`, `maxPriorityFeePerGas`
  - `gasFeeWei`: total cost in wei
  - `hasError`: boolean
  - `error`: error message if any
- **networkCost_swap**: (if balance sufficient)
  - Same structure as approval
- **networkCost_final**: Which cost is displayed and why

## Key Fixes

### 1. Mid Price Calculation
**Problem:** Used `pool.token0Price` or `pool.token1Price` which could be in wrong direction.

**Fix:** Use `pool.priceOf(tokenIn.wrapped)` which automatically returns price in direction `tokenOut per tokenIn`, matching `executionPrice` direction.

**Why This Matters:**
- Price impact calculation requires both prices in same direction
- `executionPrice` is `tokenOut per tokenIn` (from Price constructor)
- `midPrice` must also be `tokenOut per tokenIn` for correct impact calculation

### 2. Price Impact Calculation
**Formula:** `impact = (midPrice - executionPrice) / midPrice`

**Key Points:**
- Both prices must be in same direction (now ensured by using `pool.priceOf()`)
- Sanity check: Compute impact using inverse prices - should match within 1 bps
- Sign convention: Positive = worse execution, Negative = better execution
- UI shows clamped to >= 0 (better execution shown as 0%)

### 3. Network Cost Display
**Problem:** Showed "—" when approval was required because swap gas estimation was gated.

**Fix:**
- Estimate approval gas when approval is needed
- Estimate swap gas when balance is sufficient
- Return approval cost when approval is required
- `SwapDetails` converts `OnChainNetworkCost` to `GasFeeResult` format
- Network cost row now shows approval cost instead of "—"

### 4. Trading API Silence
**Problem:** Still seeing Trading API calls with `tokenInChainId=1` causing 401 errors.

**Fix:**
- Enhanced `SwapFormScreenStoreContextProvider` to use `isOnChainOnlyChain` and `isTradingApiEnabled`
- Added debug logging when Trading API is prevented
- Gated bridging hooks for on-chain-only chains
- All Trading API queries now properly disabled for chainId 84532

## Usage

### Enable Debug Logging
Set environment variable:
```bash
NEXT_PUBLIC_ONCHAIN_DEBUG=1
```

Or:
```bash
ONCHAIN_DEBUG=1
```

### Expected Output
With debug enabled, you'll see a single structured log bundle in console:
```
[ONCHAIN-DEBUG] Complete swap details computation
{
  inputs: { ... },
  executionPrice: { ... },
  midPrice: { ... },
  priceImpact: { ... },
  slippage: { ... },
  networkCost_approval: { ... },
  networkCost_swap: { ... },
  networkCost_final: { ... }
}
```

### Verification Steps

1. **Mid Price Correctness:**
   - Check `midPrice_viaPriceOf` matches expected value
   - Verify `sqrtPriceX96_calculation.priceToken1PerToken0_adjusted` matches (if tokenIn is token0)
   - Verify `tick_calculation` matches `sqrtPriceX96_calculation`
   - Verify `matches_execution_direction` is `true`

2. **Price Impact Correctness:**
   - Check `sanityCheck_inverse.matches` is `true` (within 1 bps)
   - Verify `impactBps_clamped` matches UI display
   - For example: executionPrice=0.763, midPrice=0.841 → impact should be ~9.3%

3. **Slippage Verification:**
   - Check `slippageBufferPercent` matches expected slippage tolerance
   - Verify `wouldRevertIf` condition is correct
   - Note: Price impact does NOT imply failure

4. **Network Cost:**
   - When approval required: `networkCost_final.step` should be "approve"
   - When balance sufficient: `networkCost_final.step` should be "swap"
   - `gasFeeWei` should be a valid BigInt string

## Expected Behavior for Example Swap

Given on-chain swap receipt:
- `amount0: +1000` (USDC raw, 6 decimals = 0.001 USDC)
- `amount1: -763` (EURC raw, 6 decimals = 0.000763 EURC)
- `sqrtPriceX96: 66622016397286108115200232060`
- `tick: -3467`
- `liquidity: 9999`

**Expected Logs:**
- `executionPrice`: ~0.763 EURC per USDC
- `midPrice`: Should match pool's sqrtPriceX96-derived price
- `priceImpact`: Should reflect difference (may be high if liquidity is low)
- `slippageToleranceBps`: 1 or 10 (0.01% or 0.1%)
- `amountOutMinimumRaw`: Should be <= `amountOutQuotedRaw`
- `networkCost`: Should show approval cost if approval needed, swap cost otherwise

## Files Modified

1. `packages/uniswap/src/features/transactions/swap/utils/isOnChainDebug.ts` (NEW)
2. `packages/uniswap/src/features/transactions/swap/utils/getOnChainSwapDetails.ts` (MODIFIED)
3. `packages/uniswap/src/features/transactions/swap/hooks/useOnChainSwapDetails.ts` (MODIFIED)
4. `packages/uniswap/src/features/transactions/swap/review/SwapDetails/SwapDetails.tsx` (MODIFIED)
5. `packages/uniswap/src/features/transactions/swap/form/stores/swapFormScreenStore/SwapFormScreenStoreContextProvider.tsx` (MODIFIED)
6. `packages/uniswap/src/features/bridging/hooks/tokens.ts` (MODIFIED)

## Acceptance Criteria

✅ With `NEXT_PUBLIC_ONCHAIN_DEBUG=1` and `chainId=84532`:
- Console shows single structured log bundle per quote/update
- All sections logged: inputs, pool state, mid price (multiple methods), execution price, price impact (with sanity check), slippage params, network fee
- Price impact math is confirmed correct (or fixed if bugs found)
- Network cost row shows value (approval and/or swap), not "—"
- No Trading API calls occur for on-chain-only chains (no CORS/401 noise)



