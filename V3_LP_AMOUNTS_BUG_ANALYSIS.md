# V3 LP Amounts Bug Analysis

## Problem Summary
- User inputs: 0.01 USDC, 0.009999 EURC
- UI shows: "0.01 USDC → 3.00621 USDC" (WRONG!)
- Calldata: `amount0Desired = 625`, `amount1Desired = 9999`, `amount0Min = 9950` (WRONG!)

## Root Cause

The bug is in `useDepositInfo` - it requires `state.poolOrPair` to exist to calculate dependent amounts, but for NEW pools, `poolOrPair` can be `undefined` if:
1. No initial price is set by user (`state.initialPrice` is empty)
2. `getInitialPrice()` returns `undefined`
3. `createMockV3Pool()` returns `undefined` (because `price` is `undefined`)
4. `poolOrPair` passed to `useDepositInfo` is `undefined`
5. `useDepositInfo` line 117: `if (!state.poolOrPair || ...)` returns `undefined` for dependent amount
6. Dependent amount calculation is skipped, causing incorrect amounts

## Pipeline Trace

1. **User Input** → `useDepositInfo` receives `exactAmounts`
2. **Independent Amount** → `tryParseCurrencyAmount("0.01", USDC)` → `10000` (6 decimals) ✅
3. **Dependent Amount** → `getDependentAmountFromV3Position()` requires `pool` → **FAILS** if `poolOrPair` is `undefined` ❌
4. **Result** → `dependentAmount = undefined` → UI shows wrong values → Wrong amounts passed to `useV3MintPosition`

## Comparison with Upstream Uniswap

Upstream Uniswap's `useV3DerivedMintInfo` (in `apps/web/src/state/mint/v3/hooks.tsx`):
- Line 232-240: Creates `mockPool` when `noLiquidity` is true
- Line 243: Uses `poolForPosition = pool ?? mockPool`
- Line 365-383: Calculates dependent amounts using `poolForPosition` (which is never `undefined`)

Our fork's `useDepositInfo`:
- Line 117: Requires `state.poolOrPair` to exist
- No fallback to create mock pool
- Returns `undefined` for dependent amount when pool doesn't exist

## The Fix

`useDepositInfo` should create a mock pool when `poolOrPair` is `undefined`, using the same logic as `useV3DerivedMintInfo` or `getV3PriceRangeInfo`.

However, `useDepositInfo` doesn't have access to:
- `price` (from `useDefaultInitialPrice` or `getInitialPrice`)
- `feeAmount` (from `positionState`)

**Solution**: Pass `mockPool` from `CreateLiquidityContextProvider` to `useDepositInfo`, OR make `useDepositInfo` create its own mock pool using available data.

## Minimal Fix

The minimal fix is to ensure `poolOrPair` passed to `useDepositInfo` includes the `mockPool` when the real pool doesn't exist. This is already done in `CreateLiquidityContextProvider` line 221, but the `mockPool` might be `undefined` if no initial price is set.

**Better fix**: In `useDepositInfo`, when `poolOrPair` is `undefined` for V3, create a mock pool using a default 1:1 price if no price is available.


