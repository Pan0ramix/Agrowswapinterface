# V3 LP Mock Pool Fix - Aligned with Upstream Uniswap

## Summary

Removed the hardcoded 1:1 price assumption and replaced it with **exact upstream Uniswap behavior** for creating mock V3 pools when `poolOrPair` is undefined.

## Upstream Reference

The implementation now matches **exactly** the logic in:
- `apps/web/src/state/mint/v3/hooks.tsx` lines 232-240 (`useV3DerivedMintInfo`)
- `apps/web/src/components/Liquidity/utils/priceRangeInfo.ts` lines 121-150 (`createMockV3Pool`)

## Changes Made

### 1. `useDepositInfo.tsx`

**Removed:**
- Hardcoded 1:1 price creation
- Fixed default price assumption

**Added:**
- Uses `price` from context (passed as prop)
- Wraps price to match sorted token order (same as `createMockV3Pool`)
- Uses same validation logic as upstream (`encodeSqrtRatioX96`, `TickMath.MIN_SQRT_RATIO`, `TickMath.MAX_SQRT_RATIO`)
- Uses same mock pool construction: `new V3Pool(tokenA, tokenB, feeAmount, currentSqrt, JSBI.BigInt(0), currentTick, [])`

**Key Logic (lines 129-151):**
```typescript
if (protocolVersion === ProtocolVersion.V3 && !poolForPosition && state.feeAmount && token0 && token1 && state.price) {
  // Sort tokens (tokenA < tokenB by address)
  const tokenA = token0Wrapped.sortsBefore(token1Wrapped) ? token0Wrapped : token1Wrapped
  const tokenB = token0Wrapped.sortsBefore(token1Wrapped) ? token1Wrapped : token0Wrapped
  
  // Wrap price to match sorted token order (same as createMockV3Pool)
  const wrappedPrice = new Price(tokenA, tokenB, state.price.denominator, state.price.numerator)
  
  // Validate price (same as upstream)
  const sqrtRatioX96 = encodeSqrtRatioX96(wrappedPrice.numerator, wrappedPrice.denominator)
  const invalidPrice = !(JSBI.greaterThanOrEqual(sqrtRatioX96, TickMath.MIN_SQRT_RATIO) && ...)
  
  // Create mock pool (same as upstream useV3DerivedMintInfo lines 232-240)
  if (!invalidPrice) {
    const currentTick = priceToClosestTick(wrappedPrice)
    const currentSqrt = TickMath.getSqrtRatioAtTick(currentTick)
    poolForPosition = new V3Pool(tokenA, tokenB, state.feeAmount, currentSqrt, JSBI.BigInt(0), currentTick, [])
  }
}
```

### 2. `CreatePositionTxContext.tsx`

**Added:**
- Extracts `price` from `useCreateLiquidityContext()`
- Passes `price` to `useDepositInfo` for V3 protocol

**Key Change (line 363, 388):**
```typescript
const { ..., price } = useCreateLiquidityContext()
// ...
price: protocolVersion === ProtocolVersion.V3 ? price : undefined,
```

## Price Source

The `price` comes from `CreateLiquidityContextProvider` which derives it from:
- `getV3PriceRangeInfo` → `getInitialPrice` (when `creatingPoolOrPair` is true)
- `getV3PriceRangeInfo` → `getPrice` (when pool exists)

This matches upstream Uniswap's price derivation in `useV3DerivedMintInfo` (lines 200-216).

## Behavior

- **No hardcoded 1:1 price** - uses actual price from context
- **Matches upstream exactly** - same validation, same pool construction
- **Uses same helpers** - `priceToClosestTick`, `TickMath.getSqrtRatioAtTick`, `encodeSqrtRatioX96`
- **Returns `undefined` if price is invalid or missing** - same as upstream

## Expected Results

For user input: 0.01 USDC, 0.009999 EURC with initial price ~1.0:
- `amount0Desired = 10000` (0.01 USDC with 6 decimals) ✅
- `amount1Desired = 9999` (0.009999 EURC with 6 decimals) ✅
- `amount0Min < amount0Desired` (after slippage) ✅
- `amount1Min < amount1Desired` (after slippage) ✅

The dependent amount calculation now uses the actual price from context (derived from `initialPrice` or pool price), matching upstream Uniswap's behavior exactly.


