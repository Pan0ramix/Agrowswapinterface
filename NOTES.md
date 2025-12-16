# On-Chain Swap Details Implementation Notes

## Overview
This document describes the implementation of on-chain-only swap details computation for Base Sepolia (chainId 84532), eliminating Trading API dependencies and fixing execution price calculation.

## Debug Logging

### Debug Gate Utility
**File:** `packages/uniswap/src/features/transactions/swap/utils/isOnChainDebug.ts`

A utility function that gates all debug logging:
- Returns `true` only when `chainId === 84532` AND `NEXT_PUBLIC_ONCHAIN_DEBUG === '1'` (or 'true')
- Use this to prevent console spam in production

### Comprehensive Structured Logging
**File:** `packages/uniswap/src/features/transactions/swap/utils/getOnChainSwapDetails.ts`

When `isOnChainDebug(chainId)` returns true, logs a single structured bundle per computation cycle:

1. **Inputs**: chainId, tokens (address/symbol/decimals), amounts (raw/exact), slippage params
2. **Pool State**: slot0 (sqrtPriceX96, tick), liquidity, token0/token1 ordering, fee
3. **Mid Price Calculations**: 
   - Via `pool.priceOf(tokenIn)` (primary method)
   - Via sqrtPriceX96 manual calculation (cross-check)
   - Via tick using TickMath (cross-check)
   - All methods log both raw ratios and human-adjusted ratios
4. **Execution Price**: Raw quotients, formatted price, inverse price
5. **Price Impact**: Mid/exec numeric values, impact fraction, bps (raw and clamped), sanity check with inverse prices
6. **Slippage**: slippageToleranceBps, amountOutQuotedRaw, amountOutMinimumRaw, slippage buffer, "would revert if" note
7. **Network Cost**: Approval vs swap step, gasLimit, fee params, final ETH cost

## A) Trading API Queries Disabled

### Files Modified

1. **`packages/uniswap/src/data/apiClients/tradingApi/useWalletCheckDelegationQuery.ts`**
   - Added gating: `hasOnChainOnlyChain` check
   - Query disabled when any chainId in params is on-chain-only
   - Uses `isOnChainOnlyChain` helper

2. **`packages/wallet/src/features/smartWallet/delegation/utils.ts`**
   - `getAccountDelegationDetails`: Early return for on-chain-only chains
   - Prevents `checkWalletDelegation` call for chainId 84532

3. **`packages/uniswap/src/features/smartWallet/delegation/createTradingApiDelegationRepository.ts`**
   - Filters out on-chain-only chains before API call
   - Returns null for on-chain-only chains in result

4. **`packages/wallet/src/features/smartWallet/WalletDelegationProvider.tsx`**
   - Filters chainIds to exclude on-chain-only chains
   - Prevents delegation query from running for chainId 84532

5. **`packages/uniswap/src/data/apiClients/tradingApi/TradingApiClient.ts`**
   - `checkWalletDelegation`: Filters out on-chain-only chains after EVM filtering
   - Returns empty response if all chains filtered out

6. **`packages/uniswap/src/data/apiClients/tradingApi/useTradingApiSwappableTokensQuery.ts`**
   - Already had gating via `isTradingApiEnabled`
   - Enhanced `usePrefetchSwappableTokens` to check chainId before prefetching
   - Ensures `tokenInChainId` is not defaulted to 1

### Result
- Zero Trading API requests for chainId 84532
- No CORS/401 errors in console
- `swappable_tokens?tokenInChainId=1` never happens (uses active chainId or disabled)

## B) Execution Price Computation Fix (Already Fixed)

Execution price computation was already fixed in previous iteration. The fix:
- Guards against undefined/null quotients
- Uses SDK Price constructor with raw quotients (no double-decimal scaling)
- Example: `amountInRaw=1000`, `amountOutRaw=763` → correctly displays `0.763 EURC per USDC`

## C) Mid Price Calculation Fix

### File: `packages/uniswap/src/features/transactions/swap/utils/getOnChainSwapDetails.ts`

### Problem
- `Cannot convert undefined to a BigInt` errors
- Double-decimal scaling: showing `0.000000763` instead of `0.763` for USDC(6)->EURC(6)

### Solution

**Guarded Inputs:**
```typescript
function computeExecutionPrice(
  amountIn: CurrencyAmount<Currency>,
  amountOut: CurrencyAmount<Currency>,
): Price<Currency, Currency> | null {
  // Guard: ensure both amounts exist
  if (!amountIn || !amountOut) return null
  
  // Guard: check quotients are defined and non-zero
  const amountInQuotient = amountIn.quotient
  const amountOutQuotient = amountOut.quotient
  
  if (amountInQuotient === undefined || amountInQuotient === null || amountInQuotient === 0n) {
    return null
  }
  if (amountOutQuotient === undefined || amountOutQuotient === null) {
    return null
  }
  
  // Guard: ensure currencies exist
  if (!amountIn.currency || !amountOut.currency) {
    return null
  }
  
  // Use SDK Price constructor with raw quotients
  // This correctly handles decimals internally (no double-scaling)
  return new Price(
    amountIn.currency,      // baseCurrency
    amountOut.currency,     // quoteCurrency
    amountInQuotient,       // baseAmount (raw)
    amountOutQuotient,      // quoteAmount (raw)
  )
}
```

**Why This Works:**
- SDK `Price` constructor accepts raw quotients (BigInt) and handles decimal conversion internally
- Example: `amountInRaw=1000` (0.001 USDC, 6 decimals), `amountOutRaw=763` (0.000763 EURC, 6 decimals)
- Price = `new Price(USDC, EURC, 1000n, 763n)` → correctly computes `0.763 EURC per USDC`
- No manual decimal division needed - SDK handles it

**Debug Logging:**
- Logs raw quotients, decimals, and formatted execution price
- Helps diagnose calculation issues

### Key Fix: Use `pool.priceOf(tokenIn)`

**Problem:** Previous implementation used `pool.token0Price` or `pool.token1Price` based on token ordering, which could give price in wrong direction.

**Solution:** Use `pool.priceOf(tokenIn.wrapped)` which automatically:
- Returns price in direction `tokenOut per tokenIn`
- Matches `executionPrice` direction
- Ensures price impact calculation is consistent

**Implementation:**
```typescript
const midPrice = pool.priceOf(tokenIn.wrapped)
// This gives us tokenOut per tokenIn, matching executionPrice direction
```

**Cross-checks logged:**
- Manual calculation from sqrtPriceX96: `(sqrtPriceX96^2 / 2^192)`
- Calculation from tick using TickMath
- Both raw and decimals-adjusted ratios
- Explicit logging of which token is token0/token1

## D) Price Impact Calculation Fix

**Formula:** `impact = (midPrice - executionPrice) / midPrice`

**Key Points:**
- Both prices must be in same direction: `tokenOut per tokenIn`
- `executionPrice` is already in correct direction (from Price constructor)
- `midPrice` is now in correct direction (from `pool.priceOf(tokenIn)`)
- Sanity check: Compute impact using inverse prices - should match within 1 bps

**Sign Convention:**
- Positive impact = worse execution (less output than mid price)
- Negative impact = better execution (more output than mid price)
- UI shows clamped to >= 0 (better execution shown as 0%)

## E) Slippage Logging

**Logged Values:**
- `slippageToleranceBps`: Slippage tolerance in basis points
- `amountOutQuotedRaw`: Quoted output amount (from quote)
- `amountOutMinimumRaw`: Minimum output amount (with slippage applied)
- `slippageBuffer`: Difference between quoted and minimum
- `minEqualsQuoted`: Whether rounding caused no slippage buffer
- `wouldRevertIf`: "actualOut < amountOutMinimumRaw"

**Note:** Price impact does NOT imply failure. Slippage tolerance protects against execution price worse than quoted.

## F) Network Cost Display Fix

**Problem:** Network cost showed "—" when approval was required because swap gas estimation was gated.

**Solution:**
1. Estimate approval gas when approval is needed
2. Estimate swap gas when balance is sufficient
3. Display approval cost when approval is required
4. Override `gasFee` prop in `SwapDetails` with `onChainDetails.networkCost` when available

**Implementation:**
- `getOnChainSwapDetails` now estimates both approval and swap costs
- Returns approval cost when approval is needed
- `SwapDetails` converts `OnChainNetworkCost` to `GasFeeResult` format
- Network cost row now shows approval cost instead of "—"

## G) Trading API Silence

**Files Modified:**
1. `useWalletCheckDelegationQuery.ts` - Gates query when any chainId is on-chain-only
2. `delegation/utils.ts` - Early return for on-chain-only chains
3. `createTradingApiDelegationRepository.ts` - Filters on-chain-only chains
4. `WalletDelegationProvider.tsx` - Filters chainIds before query
5. `TradingApiClient.ts` - Filters on-chain-only chains in `checkWalletDelegation`
6. `useTradingApiSwappableTokensQuery.ts` - Already had gating, enhanced prefetch
7. `SwapFormScreenStoreContextProvider.tsx` - Uses `isOnChainOnlyChain` and `isTradingApiEnabled` for prefetch
8. `bridging/hooks/tokens.ts` - Gates queries for on-chain-only chains

**Debug Logging:**
- When Trading API call is prevented, logs call site and parameters (debug mode only)

**Note:** Bridging hooks in `chains.ts` use hardcoded `tokenInChainId: TradingApi.ChainId._1` for global bridging queries. These are only called in bridging contexts, not swap flows, so they should not cause issues.

## H) SwapDetails Direct On-Chain Rendering

### File: `packages/uniswap/src/features/transactions/swap/review/SwapDetails/SwapDetails.tsx`

### Changes

1. **Rate Display:**
   - For on-chain-only swaps: Uses `onChainDetails.rate.forward/inverse` directly
   - Toggle between forward/inverse rates on click
   - Falls back to `SwapRateRatio` for non-on-chain swaps

2. **Price Impact Display:**
   - For on-chain-only swaps: Uses `onChainDetails.priceImpactBps` directly
   - Formats using `formatPriceImpact` utility
   - Shows "—" when `priceImpactBps === null`

3. **Routing Label:**
   - Already handled by `RoutingLabel` component (shows "On-chain" for on-chain-only)
   - `RoutingInfo` shows fallback message when routes empty

4. **Network Cost:**
   - Uses existing `gasFee` prop from `swapTxContext`
   - Gas estimation gated (approval vs swap) in `useTransactionRequestInfo`
   - Shows "—" when estimation fails (no STF spam)

### Key Implementation:
```typescript
// Rate row - direct on-chain display
{isOnChainOnly && onChainDetails?.rate?.forward ? (
  <TouchableArea onPress={() => setShowInverseRate(!showInverseRate)}>
    <Text>{showInverseRate ? onChainDetails.rate.inverse : onChainDetails.rate.forward}</Text>
  </TouchableArea>
) : (
  <SwapRateRatio trade={trade} ... />
)}

// Price Impact row - direct on-chain display
{isOnChainOnly && onChainDetails ? (
  <Text>
    {onChainDetails.priceImpactBps !== null 
      ? formatPriceImpact(new Percent(onChainDetails.priceImpactBps, 10000), formatPercent)
      : '—'}
  </Text>
) : (
  <PriceImpactRow derivedSwapInfo={acceptedDerivedSwapInfo} />
)}
```

## D) React DOM Prop Warnings

### Status
- **`onDisabledPress`**: Already handled correctly by Button component
  - Extracted from props before spreading
  - Passed explicitly to `CustomButtonFrame` which handles it as a custom prop
  - Not spread to DOM

- **`forwardedRef`**: Used correctly in `CurrencyInputPanelInput`
  - Used with `useImperativeHandle` to expose imperative API
  - Not spread to DOM

### No Changes Needed
The Button component architecture already prevents these props from reaching DOM elements.

## Summary

### Trading API Disabled
- ✅ `checkWalletDelegation` queries filtered
- ✅ `swappable_tokens` queries gated
- ✅ Prefetch queries gated
- ✅ No default chainId=1 fallback

### Execution Price Fixed
- ✅ Guards against undefined/null quotients
- ✅ Uses SDK Price constructor (no double-decimal scaling)
- ✅ Correct display: `0.763 EURC per USDC` (not `0.000000763`)

### SwapDetails Direct Rendering
- ✅ Rate from `onChainDetails.rate`
- ✅ Price Impact from `onChainDetails.priceImpactBps`
- ✅ Routing label shows "On-chain"
- ✅ Network cost from existing gasFee pipeline

### Debug Logging
- Comprehensive, gated by `isOnChainDebug(chainId)` (requires `NEXT_PUBLIC_ONCHAIN_DEBUG=1`)
- Single structured log bundle per computation cycle
- Logs: inputs, pool state, mid price (multiple methods), execution price, price impact (with sanity checks), slippage params, network cost (approval + swap)

## Summary of Latest Changes (Debug Logging + Fixes)

### A) Debug Gate Utility
- Created `isOnChainDebug.ts` - gates all debug logs by chainId and env var
- Prevents console spam in production

### B) Comprehensive Structured Logging
- Added detailed logging to `getOnChainSwapDetails.ts`:
  - Inputs: tokens, amounts, slippage params
  - Pool state: slot0, tick, liquidity, token ordering
  - Mid price: via `pool.priceOf()`, sqrtPriceX96 manual calc, tick calc
  - Execution price: raw quotients, formatted, inverse
  - Price impact: numeric values, formula, sanity check with inverse
  - Slippage: tolerance, quoted, minimum, buffer, "would revert if"
  - Network cost: approval vs swap, gas params, final cost

### C) Mid Price Calculation Fix
- **Key Fix**: Changed from `pool.token0Price`/`pool.token1Price` to `pool.priceOf(tokenIn.wrapped)`
- Ensures price direction matches executionPrice: `tokenOut per tokenIn`
- Cross-checks logged: sqrtPriceX96 manual calc, tick calc
- Explicit logging of token ordering and price direction

### D) Price Impact Calculation Fix
- Both prices now in same direction: `tokenOut per tokenIn`
- Formula: `impact = (midPrice - executionPrice) / midPrice`
- Sanity check: Compute impact using inverse prices (should match within 1 bps)
- Sign convention documented: positive = worse execution, negative = better execution

### E) Slippage Logging
- Logs slippage tolerance, quoted amount, minimum amount, buffer
- Notes that price impact does not imply failure
- Documents "would revert if" condition

### F) Network Cost Display Fix
- Estimates both approval and swap costs
- Returns approval cost when approval is required
- `SwapDetails` converts `OnChainNetworkCost` to `GasFeeResult` format
- Network cost row now shows approval cost instead of "—"

### G) Trading API Silence
- Enhanced gating in `SwapFormScreenStoreContextProvider.tsx`
- Uses `isOnChainOnlyChain` and `isTradingApiEnabled` for prefetch
- Added debug logging when Trading API is prevented
- Gated bridging hooks for on-chain-only chains
- All Trading API queries now properly disabled for chainId 84532



