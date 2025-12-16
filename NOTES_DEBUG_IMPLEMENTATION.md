# On-Chain Debug Implementation - Quick Reference

## How to Enable Debug Logging

Set environment variable:
```bash
NEXT_PUBLIC_ONCHAIN_DEBUG=1
```

## Where to Find Debug Logs

With debug enabled, you'll see a **single structured JSON bundle** in the browser console for each quote/tx-build cycle on Base Sepolia (chainId 84532).

### Console Output Format:
```json
{
  "header": {
    "debugId": "quote-<timestamp>-<random>",
    "chainId": 84532,
    "mode": "onchain-only",
    "timestamp": 1234567890
  },
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

## Key Verification Points

### 1. Price Direction Correctness
Check these fields in the debug bundle:
- `prices.direction` = "tokenOut per tokenIn" (e.g., "EURC per USDC")
- `executionPrice_direction_warning` should NOT be present
- `price_direction_mismatch_warning` should NOT be present
- `midPrice_summary.matches_execution_direction` = true

### 2. Price Impact Math
- `priceImpact.crossCheck.crossCheckPassed` = true
- `priceImpact.crossCheck.differenceBps` <= 1
- `priceImpact.priceImpactBpsRounded` matches UI display

### 3. Slippage Verification
- `slippage.minAmountOutRaw` matches `txPayload.txAmountOutMinimumRaw`
- `slippage.wouldRevertIfActualOutBelowMin` explains revert condition

### 4. Network Cost Display
- `networkCost.networkCostDisplayed` = "approval" or "swap" (not "none")
- UI shows network cost value (not "—")

### 5. Trading API Silence
- No network requests to `trading-api-labs...` in Network tab
- Debug logs show `[TRADING-API] Prevented` messages when queries are blocked

## Files Modified

1. **Debug Utilities:**
   - `packages/uniswap/src/features/transactions/swap/utils/isOnChainDebug.ts` - Enhanced with correlation ID
   - `packages/uniswap/src/features/transactions/swap/utils/onChainDebugBundle.ts` - Bundle structure (reference)

2. **Core Logic:**
   - `packages/uniswap/src/features/transactions/swap/utils/getOnChainSwapDetails.ts` - Comprehensive debug bundle
   - `packages/uniswap/src/features/transactions/swap/hooks/useOnChainSwapQuote.ts` - Quote-level debug
   - `packages/uniswap/src/features/transactions/swap/hooks/useOnChainSwapDetails.ts` - Details-level debug

3. **UI:**
   - `packages/uniswap/src/features/transactions/swap/review/SwapDetails/SwapDetails.tsx` - Network cost override

4. **Trading API Fixes:**
   - `packages/uniswap/src/data/apiClients/tradingApi/useTradingApiSwappableTokensQuery.ts` - Hard gating
   - `packages/uniswap/src/features/transactions/swap/form/stores/swapFormScreenStore/SwapFormScreenStoreContextProvider.tsx` - Prefetch gating

5. **Bug Fixes:**
   - `packages/uniswap/src/features/portfolio/portfolioUpdates/rest/fetchOnChainBalancesRest.ts` - NativeCurrency.onChain fix

## Key Fixes Summary

1. **Price Direction:** Uses `pool.priceOf(tokenIn)` helper, ensures consistent direction
2. **Price Impact:** Cross-checked using inverse prices, must match within 1 bps
3. **Network Cost:** Always shows approval or swap cost (never "—")
4. **Trading API:** Fully gated, no calls for on-chain-only chains
5. **NativeCurrency:** Fixed runtime error with proper helper usage

## Testing Checklist

For both directions (USDC→EURC and EURC→USDC):

- [ ] Debug bundle shows correct price direction
- [ ] Price impact cross-check passes
- [ ] No "same value both sides" after flipping
- [ ] Network cost shows value (not "—")
- [ ] No Trading API calls (no 401 errors)
- [ ] No runtime errors



