# Comprehensive On-Chain Debug Implementation

## Overview
This document describes the comprehensive debug logging and fixes implemented for on-chain-only swaps on Base Sepolia (chainId 84532), ensuring all price math is correct and auditable.

## Debug Gate Utility

**File:** `packages/uniswap/src/features/transactions/swap/utils/isOnChainDebug.ts`

### Functions:
- `isOnChainDebug(chainId?: number): boolean` - Gates all debug logs
- `makeOnChainDebugId(prefix: string): string` - Generates correlation ID
- `debugOnChain(chainId, payload)` - Emits structured JSON logs

### Usage:
```typescript
const isDebug = isOnChainDebug(chainId)
if (isDebug) {
  const debugId = makeOnChainDebugId('quote')
  debugOnChain(chainId, { header: { debugId, ... }, ... })
}
```

## Comprehensive Debug Bundle Structure

When `NEXT_PUBLIC_ONCHAIN_DEBUG=1` and `chainId === 84532`, a single structured JSON bundle is emitted per quote/tx-build cycle.

### Bundle Sections:

#### 1. Header
```json
{
  "header": {
    "debugId": "quote-<timestamp>-<random>",
    "chainId": 84532,
    "mode": "onchain-only",
    "timestamp": 1234567890
  }
}
```

#### 2. Inputs
- `tokenIn`: { address, symbol, decimals }
- `tokenOut`: { address, symbol, decimals }
- `isExactIn`: true
- `amountSpecified`: { raw, exact }
- `slippageToleranceBps`: number or "unavailable"
- `slippageSource`: "auto" | "user" | "unavailable"

#### 3. Pool
- `poolAddress`: string
- `fee`: number
- `token0`: { address, decimals, symbol }
- `token1`: { address, decimals, symbol }
- `tokenInIsToken0`: boolean
- `slot0`: { sqrtPriceX96, tick }
- `liquidity`: string

#### 4. Prices (ALL in tokenOut per tokenIn)
- `midPrice_sdk`: via `pool.priceOf(tokenIn)` (PRIMARY)
- `midPrice_fromSqrtPriceX96`: manual calculation (cross-check)
- `executionPrice`: from amounts
- `executionPriceRaw`: numerator/denominator
- `executionPrice_inverse`: inverse price
- `midPrice_inverse`: inverse price
- `direction`: "tokenOut per tokenIn"

#### 5. Quote Outputs
- `amountInRaw`, `amountOutRaw`
- `amountInExact`, `amountOutExact`
- `quotedRoute`: route description
- `routerAddress`: router contract address

#### 6. Price Impact
- `priceImpactFloat`: decimal value
- `priceImpactBpsRounded`: basis points (clamped >= 0)
- `priceImpactSign`: "positive" | "negative" | "zero"
- `crossCheck`: {
    `impactBps_inverse`: computed using inverse prices
    `differenceBps`: difference between methods
    `crossCheckPassed`: boolean (must match within 1 bps)
  }

#### 7. Slippage
- `minAmountOutRaw`: minimum output with slippage
- `minAmountOutExact`: formatted minimum
- `bufferRaw`: slippage buffer (quoted - minimum)
- `wouldRevertIfActualOutBelowMin`: explanation string

#### 8. Simulation / Ground Truth
- `simulatedAmountOutRaw`: from Quoter contract call
- `diffVsComputedQuote`: difference vs computed quote
- Note: Quoter simulation provides authoritative cross-check

#### 9. Tx Payload
- `txTo`: router address
- `txDataLen`: transaction data length
- `txValue`: ETH value (usually "0")
- `txDeadlineSeconds`: deadline timestamp
- `txAmountOutMinimumRaw`: minimum output in tx
- `txGasLimit`: gas limit if set

#### 10. Network Cost
- `approvalTx`: { estimateGas, feeData, costWei } (if approval needed)
- `swapTx`: { estimateGas, feeData, costWei } (if balance sufficient)
- `networkCostDisplayed`: "approval" | "swap" | "none"

## Key Fixes

### 1. Price Direction Fix
**Problem:** Mixed token0/token1 direction causing incorrect price impact.

**Solution:**
- Created `getMidPriceTokenOutPerTokenIn()` helper
- Always uses `pool.priceOf(tokenIn.wrapped)` which returns `tokenOut per tokenIn`
- Matches `executionPrice` direction (from Price constructor)
- Added assertions to detect direction mismatches

### 2. "Same Value Both Sides" Symptom Fix
**Problem:** When tokens are flipped, execution price should invert but sometimes shows same value.

**Solution:**
- Added `direction_suspicion_warning` check
- Compares execution price to its inverse
- If identical within rounding, logs warning with both raw ratios
- Ensures price inverts correctly when tokens are swapped

### 3. Price Impact Cross-Check
**Formula:** `impact = (midPrice - executionPrice) / midPrice`

**Verification:**
- Computes impact using forward prices
- Computes impact using inverse prices
- Both must match within 1 bps
- Logs `crossCheckPassed: true/false`

### 4. Network Cost Display
**Problem:** Showed "—" when approval was required.

**Solution:**
- Estimates both approval and swap costs
- Returns approval cost when approval needed
- `SwapDetails` converts `OnChainNetworkCost` to `GasFeeResult`
- Network cost row now always shows a value

### 5. Trading API Silence
**Problem:** Still seeing `swappable_tokens?...tokenInChainId=1 401` errors.

**Solution:**
- Enhanced `useTradingApiSwappableTokensQuery` with `isOnChainOnlyChain` check
- Prevents `tokenInChainId=1` calls (hardcoded mainnet)
- Disables `refetchOnWindowFocus` for on-chain-only chains
- Added debug logging when queries are prevented

### 6. NativeCurrency.onChain Fix
**Problem:** `TypeError: NativeCurrency.onChain is not a function`

**Solution:**
- Use `nativeOnChain(chainId)` helper instead of `NativeCurrency.onChain()`
- Added fallback chain with error handling
- Added debug logging for currency resolution

## Usage

### Enable Debug Logging
```bash
NEXT_PUBLIC_ONCHAIN_DEBUG=1
```

### Expected Output
Single structured JSON bundle in console:
```json
{
  "header": { "debugId": "...", "chainId": 84532, ... },
  "inputs": { ... },
  "pool": { ... },
  "prices": { ... },
  "quoteOutputs": { ... },
  "priceImpact": { ... },
  "slippage": { ... },
  "simulation": { ... },
  "txPayload": { ... },
  "networkCost": { ... }
}
```

### Verification Checklist

1. **Price Direction:**
   - ✅ `prices.direction` = "tokenOut per tokenIn"
   - ✅ `executionPrice_direction_warning` not present
   - ✅ `price_direction_mismatch_warning` not present
   - ✅ `matches_execution_direction` = true

2. **Price Impact:**
   - ✅ `priceImpact.crossCheck.crossCheckPassed` = true
   - ✅ `priceImpact.differenceBps` <= 1
   - ✅ `priceImpact.priceImpactBpsRounded` matches UI display

3. **Slippage:**
   - ✅ `slippage.minAmountOutRaw` matches tx payload
   - ✅ `slippage.wouldRevertIfActualOutBelowMin` is clear

4. **Network Cost:**
   - ✅ `networkCost.networkCostDisplayed` = "approval" or "swap" (not "none")
   - ✅ Network cost row shows value in UI

5. **Trading API:**
   - ✅ No network requests to trading-api-labs...
   - ✅ Debug logs show queries prevented

6. **No Runtime Errors:**
   - ✅ No `NativeCurrency.onChain is not a function`
   - ✅ No other runtime errors

## Files Modified

1. `packages/uniswap/src/features/transactions/swap/utils/isOnChainDebug.ts` (ENHANCED)
2. `packages/uniswap/src/features/transactions/swap/utils/getOnChainSwapDetails.ts` (COMPREHENSIVE)
3. `packages/uniswap/src/features/transactions/swap/hooks/useOnChainSwapDetails.ts` (UPDATED)
4. `packages/uniswap/src/features/transactions/swap/hooks/useOnChainSwapQuote.ts` (UPDATED)
5. `packages/uniswap/src/features/transactions/swap/review/SwapDetails/SwapDetails.tsx` (UPDATED)
6. `packages/uniswap/src/data/apiClients/tradingApi/useTradingApiSwappableTokensQuery.ts` (FIXED)
7. `packages/uniswap/src/features/portfolio/portfolioUpdates/rest/fetchOnChainBalancesRest.ts` (FIXED)
8. `packages/uniswap/src/features/transactions/swap/form/stores/swapFormScreenStore/SwapFormScreenStoreContextProvider.tsx` (FIXED)

## Acceptance Criteria

✅ With `NEXT_PUBLIC_ONCHAIN_DEBUG=1` and `chainId=84532`:
- Single structured JSON bundle per quote/tx-build cycle
- All required sections present: inputs, pool, prices, quoteOutputs, priceImpact, slippage, simulation, txPayload, networkCost
- Price direction correct for both swap directions (USDC→EURC and EURC→USDC)
- Price impact cross-check passes (within 1 bps)
- No "same value both sides" after flipping tokens
- Network cost row shows value (approval or swap)
- Zero Trading API calls (no 401 errors)
- No `NativeCurrency.onChain` runtime error
