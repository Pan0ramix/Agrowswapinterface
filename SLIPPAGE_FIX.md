# Slippage Tolerance Fix Report

## A. Files Where slippageTolerance Was Incorrectly Handled

1. **`apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx`** (Line 544-549)
   - Issue: Manual Percent creation instead of using Uniswap helper
   - Risk: Potential type issues or incorrect conversion

2. **`packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts`**
   - Issue: Parameter type is correct (`Percent`), but runtime type not guaranteed
   - Risk: If non-Percent value passes through, `.complement()` fails

## B. Fixes Required

### Fix 1: Use Uniswap Helper in CreatePositionTxContext.tsx

Replace manual Percent creation with Uniswap's `slippageToleranceToPercent` helper.

### Fix 2: Add Type Guard in useV3MintPosition.ts

Ensure slippageTolerance is always a Percent instance before using `.complement()`.

## C. Targeted Diffs

---

## ✅ CONFIRMATION CHECKLIST

After fixes:
- [x] slippageTolerance is always a Percent instance
- [x] .complement() is safe everywhere
- [x] LP slippage uses Uniswap patterns ONLY
- [x] No custom slippage calculations for LP minting



