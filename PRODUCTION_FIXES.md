# Production Fixes for V3 LP Minting Flow

## ❗ ISSUE 1: slippageTolerance.complement is not a function

### Root Cause Analysis

The `Percent` instance is losing its prototype chain when captured in the `queryFn` closure. React Query may serialize/cache closures, causing the Percent object to become a plain object.

**Problem Location**: `useV3MintPosition.ts:217` - `slippageTolerance.complement()` fails because slippageTolerance is not a Percent instance at runtime.

**Root Cause**: The `queryFn` closure captures `slippageTolerance` directly. When React Query caches or restores the query function, the Percent prototype is lost.

### Fix Strategy

1. **Extract slippage values** instead of keeping Percent in closure
2. **Recreate Percent** inside queryFn from extracted values
3. **Add defensive rehydration** before use

### Patch

**File**: `packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts`

---

## ❗ ISSUE 2: Trading API Still Being Called

### Root Cause Analysis

Even with `enabled: false`, React Query may still execute queries if:
- `params` changes and triggers refetch
- `refetchInterval` is set
- Automatic refetching on mount/focus

### Fix Strategy

1. Pass `undefined` for params when `useOnChainV3` is true
2. Ensure `refetchInterval` is disabled
3. Prevent any refetch calls

### Patch

**File**: `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx`

---

## ❗ ISSUE 3: Approval Query

### Status

Already properly guarded with `params: useOnChainV3 ? undefined : addLiquidityApprovalParams` - no fix needed.



