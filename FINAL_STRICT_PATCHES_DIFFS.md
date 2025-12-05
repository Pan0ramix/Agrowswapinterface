# Final Strict Patches - Complete Diffs

## Summary

All fixes have been applied with the strictest possible approach. This document shows the exact diffs.

---

## File 1: `packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts`

### Complete Diff

```diff
export function useV3MintPosition(params: UseV3MintPositionParams): UseV3MintPositionReturn {
  const {
    token0,
    token1,
    fee,
    tickLower: rawTickLower,
    tickUpper: rawTickUpper,
    amount0Desired,
    amount1Desired,
    slippageTolerance,
    chainId,
    recipient,
    enabled = true,
  } = params

+  // Create a stable Percent instance immediately after destructuring
+  // This ensures we have a fresh Percent that won't lose its prototype in closures
+  const stableSlippage = useMemo(() => {
+    if (!(slippageTolerance instanceof Percent)) {
+      throw new Error(
+        `useV3MintPosition: slippageTolerance must be a Percent at hook entry, got: ${typeof slippageTolerance}`,
+      )
+    }
+
+    // Re-wrap into a fresh Percent using its numeric values
+    // This creates a new Percent instance that's guaranteed to have the prototype
+    const n = slippageTolerance.numerator
+    const d = slippageTolerance.denominator
+    return new Percent(n, d)
+  }, [slippageTolerance.numerator.toString(), slippageTolerance.denominator.toString()])
+
+  // Extract numerator and denominator as JSBI for safe closure capture
+  // Only capture JSBI values (not Percent object) to prevent prototype loss
+  const slippageNumerator = useMemo(() => stableSlippage.numerator, [stableSlippage.numerator.toString()])
+  const slippageDenominator = useMemo(() => stableSlippage.denominator, [stableSlippage.denominator.toString()])

  // Get viem public client
  const publicClient = useMemo(() => {
    // ... existing code ...
  }, [chainId])

  // Get nearest usable ticks
  const { tickLower, tickUpper } = useMemo(() => {
    // ... existing code ...
  }, [fee, rawTickLower, rawTickUpper])

  // Build query key - use slippage numerator/denominator instead of Percent object
  const queryKey = useMemo(
    () => [
      V3_MINT_POSITION_CACHE_KEY,
      chainId,
      token0?.symbol,
      token1?.symbol,
      fee,
      tickLower,
      tickUpper,
      amount0Desired?.quotient.toString(),
      amount1Desired?.quotient.toString(),
-      slippageTolerance.toFixed(),
+      slippageNumerator.toString(),
+      slippageDenominator.toString(),
      recipient,
    ],
    [
      chainId,
      token0?.symbol,
      token1?.symbol,
      fee,
      tickLower,
      tickUpper,
      amount0Desired?.quotient.toString(),
      amount1Desired?.quotient.toString(),
-      slippageTolerance,
+      slippageNumerator.toString(),
+      slippageDenominator.toString(),
      recipient,
    ],
  )

  // Query function
  const queryFn = useMemo(() => {
    if (
      !token0 ||
      !token1 ||
      !fee ||
      tickLower === undefined ||
      tickUpper === undefined ||
      !chainId ||
      !recipient ||
      !publicClient ||
      (!amount0Desired && !amount1Desired)
    ) {
      return skipToken
    }

    return async (): Promise<V3MintPositionResult> => {
      try {
-        // Ensure slippageTolerance is a Percent instance (runtime check)
-        if (!(slippageTolerance instanceof Percent)) {
-          throw new Error(`slippageTolerance must be a Percent instance, got: ${typeof slippageTolerance}`)
-        }
+        // Recreate Percent from extracted numerator/denominator to prevent prototype loss
+        // React Query may serialize/restore closures, causing Percent objects to lose prototype
+        // Recreating from JSBI values ensures we always have a working Percent instance
+        const slippage = new Percent(slippageNumerator, slippageDenominator)

        // Step 1: Try to fetch pool state (may not exist for new pools)
        let poolState = await fetchV3PoolState({
          // ... existing code ...
        })

        // ... position amounts calculation ...

        if (poolState) {
          // Pool exists - calculate position amounts from pool state
          const positionResult = calculatePositionAmounts(
            poolState.pool,
            tickLower,
            tickUpper,
            amount0Desired,
            amount1Desired,
          )
          // ... existing code ...

          // Use Position.mintAmountsWithSlippage() - Uniswap's standard pattern
-          const { amount0: min0, amount1: min1 } = positionResult.position.mintAmountsWithSlippage(slippageTolerance)
+          const { amount0: min0, amount1: min1 } = positionResult.position.mintAmountsWithSlippage(slippage)
          amount0Min = min0
          amount1Min = min1
        } else {
          // Pool doesn't exist yet - use desired amounts directly
          // ... existing code ...

          // For new pools, apply slippage directly using Percent.complement()
-          // Ensure slippageTolerance is Percent before calling .complement()
-          const slippageComplement = slippageTolerance.complement()
+          // Use recreated slippage to ensure .complement() always works
+          const slippageComplement = slippage.complement()
          amount0Min = amount0Desired.multiply(slippageComplement)
          amount1Min = amount1Desired.multiply(slippageComplement)
        }

        // ... build transaction ...
      } catch (error) {
        // ... error handling ...
      }
    }
  }, [
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
-    slippageTolerance,
-    slippageNumerator,
-    slippageDenominator,
+    slippageNumerator, // JSBI value, safe for closure
+    slippageDenominator, // JSBI value, safe for closure
    chainId,
    recipient,
    publicClient,
  ])

  // ... rest of hook ...
}
```

---

## File 2: `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx`

### Complete Diff

```diff
  // Hard guard: completely disable Trading API when using on-chain path
  const disableTradingApi = useOnChainV3

  // Use Trading API query (fallback or for non-V3)
  const {
    data: createCalldata,
    error: createError,
    refetch: createRefetch,
  } = useCreateLpPositionCalldataQuery({
-    params: createCalldataQueryParams,
-    deadlineInMinutes: customDeadline,
-    refetchInterval: transactionError ? false : 5 * ONE_SECOND_MS,
-    retry: false,
-    enabled: isQueryEnabled && !useOnChainV3, // Skip Trading API if using on-chain
+    params: disableTradingApi ? undefined : createCalldataQueryParams,
+    deadlineInMinutes: disableTradingApi ? undefined : customDeadline,
+    enabled: isQueryEnabled && !disableTradingApi,
+    refetchInterval: false, // Always disable refetch interval
+    retry: false,
+    refetchOnMount: false,
+    refetchOnWindowFocus: false,
  })

  // ... merge logic ...

  // Hard guard: prevent refetch from triggering Trading API when on-chain is active
  useEffect(() => {
    if (useOnChainV3) {
      setRefetch(undefined)
      return
    }

    setRefetch(() =>
      approvalError ? approvalRefetch : finalCreateError ? createRefetch : undefined,
    )
  }, [
    useOnChainV3, // Check useOnChainV3 first
    approvalError,
    approvalRefetch,
    finalCreateError,
    createRefetch,
    setRefetch,
  ])
```

---

## Verification Checklist

### Slippage Fix ✅

- [x] `stableSlippage` created immediately after destructuring
- [x] `slippageNumerator` and `slippageDenominator` extracted as JSBI
- [x] Percent recreated inside queryFn from JSBI values
- [x] No calls to `slippageTolerance.complement()` anywhere
- [x] All `.complement()` calls use recreated `slippage` Percent
- [x] QueryKey uses JSBI strings, not Percent object

### Trading API Fix ✅

- [x] Hard guard `disableTradingApi = useOnChainV3`
- [x] `params: undefined` when disabled
- [x] `deadlineInMinutes: undefined` when disabled
- [x] `enabled: false` when disabled
- [x] `refetchInterval: false` always
- [x] `refetchOnMount: false`
- [x] `refetchOnWindowFocus: false`
- [x] `setRefetch(undefined)` when on-chain active

---

## Expected Results

After these patches:

1. ✅ `slippage.complement()` always works - Percent is recreated from JSBI inside queryFn
2. ✅ No Trading API calls for `/v1/lp/create` when `useOnChainV3 = true`
3. ✅ All refetch mechanisms are disabled
4. ✅ Create Position flow uses only on-chain data

---

## Files Modified

1. ✅ `packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts`
2. ✅ `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx`




