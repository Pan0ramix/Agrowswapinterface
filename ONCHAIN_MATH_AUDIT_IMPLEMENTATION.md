# On-Chain Math Audit Implementation

## Overview
Comprehensive math audit system for on-chain swaps with deterministic cross-checks, invariant assertions, and a single structured JSON bundle per quote cycle.

## How to Enable

Set environment variable:
```bash
NEXT_PUBLIC_ONCHAIN_DEBUG=1
```

## Where to Find Audit Logs

With debug enabled, you'll see a **single structured JSON bundle** tagged `[ONCHAIN-MATH-AUDIT]` in the browser console for each quote computation on Base Sepolia (chainId 84532).

### Console Output Format:
```json
{
  "tag": "[ONCHAIN-MATH-AUDIT]",
  "id": "OCAUDIT-<timestamp>-<random>",
  "meta": { ... },
  "tokens": { ... },
  "amounts": { ... },
  "pool": { ... },
  "prices": { ... },
  "impact": { ... },
  "feeModel": { ... },
  "slippage": { ... },
  "quoter": { ... },
  "simulate": { ... },
  "tx": { ... },
  "networkCost": { ... },
  "invariants": { ... }
}
```

## Audit Bundle Structure

### 1. Meta
- `chainId`: 84532
- `auditId`: Correlation ID (OCAUDIT-<timestamp>-<random>)
- `timestamp`: Unix timestamp
- `isExactIn`: true
- `feeTier`: Selected fee tier (should be 10000 for 1% pool)
- `poolAddress`: Selected pool address

### 2. Tokens
- `tokenIn`: { address, symbol, decimals }
- `tokenOut`: { address, symbol, decimals }
- `decimals`: { tokenIn, tokenOut }
- `addresses`: { tokenIn, tokenOut }

### 3. Amounts (Raw-First)
- `amountInRaw`: Raw input amount (smallest units)
- `amountInExact`: Formatted input amount
- `quoteOutRaw`: Raw quoted output (smallest units)
- `quoteOutExact`: Formatted quoted output

### 4. Pool
- `token0`: { address, decimals, symbol }
- `token1`: { address, decimals, symbol }
- `token0Decimals`, `token1Decimals`
- `slot0`: { sqrtPriceX96, tick, observationCardinality, observationCardinalityNext }
- `liquidity`: Pool liquidity
- `tickSpacing`: Pool tick spacing
- `poolAddress`: Pool contract address
- `fee`: Pool fee tier
- `poolSelection`: {
    `feeTiersChecked`: [500, 3000, 10000],
    `firstFoundPool`: First pool address found,
    `finalSelectedPool`: Selected pool address,
    `finalSelectedFeeTier`: Selected fee tier,
    `expectedFeeTier`: 10000,
    `poolSelectionCorrect`: true/false
  }

### 5. Prices (Both Directions Explicitly)
- `mid_outPerIn`: {
    `rawFraction`: "numerator/denominator",
    `exact`: Formatted price,
    `derivedBy`: "pool.priceOf(tokenIn)"
  }
- `mid_inPerOut`: {
    `rawFraction`: "denominator/numerator",
    `exact`: Inverse price,
    `derivedBy`: "inverse(mid_outPerIn)"
  }
- `mid_from_sqrtPriceX96`: Manual calculation from sqrtPriceX96 (cross-check)
- `mid_from_tick`: Manual calculation from tick (cross-check)
- `exec_outPerIn`: {
    `rawFraction`: "numerator/denominator",
    `rawFraction_fromAmounts`: "quoteOutRaw/amountInRaw",
    `rawFractionScale`: Decimal adjustment factor,
    `exact`: Formatted price,
    `derivedBy`: "quoteOutRaw/amountInRaw (scaled by SDK)"
  }
- `exec_inPerOut`: {
    `rawFraction`: "denominator/numerator",
    `rawFraction_fromAmounts`: "amountInRaw/quoteOutRaw",
    `exact`: Inverse price,
    `derivedBy`: "inverse(exec_outPerIn)"
  }

### 6. Impact
- `formula`: "(mid_outPerIn - exec_outPerIn) / mid_outPerIn"
- `priceImpactBps`: Price impact in basis points
- `crossCheckBpsUsingInverse`: Cross-check using inverse prices
- `crossCheckDeltaBps`: Difference between methods (should be <= 1 bps)

### 7. Fee Model
- `feeTierBps`: Fee tier in basis points (100 for 1%)
- `feeTierUniswap`: Fee tier in Uniswap units (10000 for 1%)
- `notes`: Explanation
- `poolSelection`: Pool selection details (see Pool section)

### 8. Slippage
- `toleranceBps`: Slippage tolerance in basis points
- `amountOutMinimumRaw`: Minimum output with slippage (raw)
- `amountOutMinimumExact`: Minimum output (formatted)
- `bufferRaw`: Slippage buffer (quoted - minimum)
- `wouldRevertIfOutLtMin`: true/false

### 9. Quoter (Cross-Check)
- `quoteExactInputSingle`: {
    `success`: true/false,
    `outRaw`: Quoter output (raw),
    `outExact`: Quoter output (formatted),
    `error`: null or error message
  }
- `matchesDisplayedQuote`: true if within tolerance (<= 1 unit)
- `diffRaw`: Difference between Quoter and displayed quote

### 10. Simulate (Swap CallStatic)
- `swapCallStatic`: {
    `success`: true/false,
    `outRaw`: null (would need to decode),
    `errorReason`: Revert reason if failed
  }

### 11. Tx
- `to`: Router address
- `dataLen`: Transaction data length
- `value`: ETH value
- `deadline`: Deadline timestamp
- `recipient`: Recipient address (if decodable)
- `amountOutMinimum`: Minimum output in tx

### 12. Network Cost
- `approvalRequired`: true/false
- `approvalTx`: { gasLimit, maxFeePerGas, maxPriorityFeePerGas, estimatedWei, estimatedEth }
- `swapTx`: { gasLimit, maxFeePerGas, maxPriorityFeePerGas, estimatedWei, estimatedEth }
- `displayed`: "approval" | "swap" | "none"

### 13. Invariants (Hard Assertions)
- `decimalsConsistent`: true (always, no double-scaling)
- `directionConsistent`: true if mid and exec prices in same direction
- `quoteMatchesQuoterWithinTolerance`: true if Quoter matches displayed quote (<= 1 unit)
- `midMatchesAltDerivationsWithinTolerance`: true if mid price matches sqrtPriceX96/tick derivations
- `warnings`: Array of warning messages
- `poolSelectionCorrect`: true if fee tier is 10000 (1%)

## Key Features

### 1. Invariant Checks
- **Price Direction Consistency**: Detects "same value both sides" bug
- **Inverse Price Check**: Ensures `price * inverse ≈ 1`
- **Direction Matching**: Ensures mid and exec prices in same direction
- **Quoter Cross-Check**: Compares displayed quote with Quoter contract
- **Pool Selection**: Verifies 1% pool (fee tier 10000) is selected

### 2. Raw-First Math
All prices are computed from raw amounts first, then formatted:
- `exec_outPerIn` includes `rawFraction_fromAmounts` showing raw ratio
- `rawFractionScale` shows decimal adjustment factor
- Cross-checks verify no double-scaling

### 3. Comprehensive Cross-Checks
- **Mid Price**: SDK vs sqrtPriceX96 vs tick calculations
- **Price Impact**: Forward vs inverse price calculations
- **Quoter**: Displayed quote vs Quoter contract call
- **Simulation**: Swap callStatic to detect revert reasons

### 4. Pool Selection Visibility
- Logs which fee tiers were checked
- Shows first found pool
- Shows final selected pool and fee tier
- Flags if wrong fee tier selected

## How to Reproduce

1. **Set environment variable:**
   ```bash
   NEXT_PUBLIC_ONCHAIN_DEBUG=1
   ```

2. **Perform swap in both directions:**
   - USDC → EURC with 0.001 USDC
   - EURC → USDC with 0.001 EURC

3. **Open browser console and filter for:**
   ```
   [ONCHAIN-MATH-AUDIT]
   ```

4. **Copy the single JSON bundle** for each direction

5. **Verify:**
   - `invariants.directionConsistent` = true
   - `invariants.quoteMatchesQuoterWithinTolerance` = true
   - `invariants.midMatchesAltDerivationsWithinTolerance` = true
   - `invariants.poolSelectionCorrect` = true
   - `invariants.warnings` = [] (empty)
   - `prices.mid_outPerIn.exact` is inverse of opposite direction's `prices.mid_inPerOut.exact`
   - `prices.exec_outPerIn.exact` is inverse of opposite direction's `prices.exec_inPerOut.exact`
   - No "same value both sides" (unless price is truly 1.0)

## Files Modified

1. **Debug Utilities:**
   - `packages/uniswap/src/features/transactions/swap/utils/isOnChainDebug.ts` - Added `debugOnChainMathAudit`

2. **Core Logic:**
   - `packages/uniswap/src/features/transactions/swap/utils/getOnChainSwapDetails.ts` - Comprehensive audit bundle
   - `packages/uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain.ts` - Enhanced to fetch tickSpacing and observationCardinality

3. **Trading API:**
   - `packages/uniswap/src/data/apiClients/tradingApi/useTradingApiSwappableTokensQuery.ts` - Hard gating (already done)
   - `packages/uniswap/src/features/transactions/swap/form/stores/swapFormScreenStore/SwapFormScreenStoreContextProvider.tsx` - Prefetch gating (already done)

## Acceptance Criteria

✅ For USDC→EURC and EURC→USDC:
- `mid_outPerIn` is inverse of opposite direction within tolerance
- `exec_outPerIn` is inverse of opposite direction within tolerance
- No "same value both sides" unless price is truly 1.0
- `quoter.matchesDisplayedQuote` = true (within <= 1 unit)
- `slippage.amountOutMinimumRaw` matches `tx.amountOutMinimum`
- `simulate.swapCallStatic.success` indicates whether swap would revert
- `feeModel.poolSelection.poolSelectionCorrect` = true (fee tier 10000)
- One audit bundle per quote cycle with correlation ID
- Zero Trading API calls on 84532

## Key Fixes

1. **Price Direction**: Uses `pool.priceOf(tokenIn)` helper, ensures consistent direction
2. **Invariant Checks**: Detects "same value both sides" and direction mismatches
3. **Raw-First Math**: All prices computed from raw amounts, explicit decimal scaling
4. **Quoter Cross-Check**: Compares displayed quote with Quoter contract
5. **Swap Simulation**: callStatic to detect revert reasons
6. **Pool Selection**: Logs and verifies 1% pool selection
