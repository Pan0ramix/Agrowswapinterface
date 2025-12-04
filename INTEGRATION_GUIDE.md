# V3 On-Chain Integration Guide

This guide explains how to integrate the new on-chain V3 services into the existing swap and LP flows.

## ✅ What's Been Completed

### Core Services (100% Complete)
1. ✅ V3 Pool State Service (`v3PoolOnChain.ts`)
2. ✅ V3 Quoter Service (`v3Quoter.ts`)
3. ✅ V3 Swap Transaction Builder (`v3SwapTxBuilder.ts`)
4. ✅ V3 LP Services (`v3LpOnChain.ts`)
5. ✅ Production React Hook (`useV3OnChainSwapQuote.ts`)

### Files Created
- `packages/uniswap/src/features/transactions/swap/services/v3OnChain/` - All swap services
- `packages/uniswap/src/features/transactions/swap/hooks/useV3OnChainSwapQuote.ts` - Production hook
- `packages/uniswap/src/features/transactions/liquidity/services/v3OnChain/` - All LP services

## 🔧 Integration Steps

### Step 1: Integrate Swap Quote Hook

#### Update `useDerivedSwapInfo.ts`

The hook should conditionally use on-chain quotes for single-pool V3 swaps:

```typescript
// In packages/uniswap/src/features/transactions/swap/stores/swapFormStore/hooks/useDerivedSwapInfo.ts

import { useV3OnChainSwapQuote } from 'uniswap/src/features/transactions/swap/hooks/useV3OnChainSwapQuote'

export function useDerivedSwapInfo({ ... }) {
  // ... existing code ...
  
  const isSinglePoolV3Swap = useMemo(() => {
    // Check if this is a single-pool V3 swap (not multi-hop, not UniswapX, etc.)
    return chainId === UniverseChainId.BaseSepolia && // or use feature flag
           tradeType === TradeType.EXACT_INPUT &&
           // Add other conditions to determine if we should use on-chain
  }, [chainId, tradeType])

  // Use on-chain quote for single-pool V3 swaps
  const onChainQuote = useV3OnChainSwapQuote({
    tokenIn: currencyIn,
    tokenOut: currencyOut,
    amountIn: amountSpecified,
    fee: FeeAmount.MEDIUM, // Or determine from pool
    slippageTolerance: customSlippageTolerance || defaultSlippage,
    chainId,
    recipient: account?.address,
    enabled: isSinglePoolV3Swap && !!amountSpecified && !!currencyIn && !!currencyOut,
  })

  // Use existing useTrade hook as fallback
  const trade = useTrade({
    // ... existing params ...
    enabled: !isSinglePoolV3Swap, // Skip if using on-chain
  })

  // Merge results
  const finalTrade = useMemo(() => {
    if (isSinglePoolV3Swap && onChainQuote.txPayload) {
      // Return a trade-like object using on-chain data
      return {
        trade: {
          inputAmount: amountSpecified,
          outputAmount: onChainQuote.quoteAmountOut,
          executionPrice: onChainQuote.quoteAmountOut?.divide(amountSpecified),
          priceImpact: onChainQuote.priceImpact,
          route: { pools: [onChainQuote.pool], path: [tokenIn, tokenOut] },
          // ... other required fields
        },
        txPayload: onChainQuote.txPayload,
      }
    }
    return trade
  }, [isSinglePoolV3Swap, onChainQuote, trade, amountSpecified, tokenIn, tokenOut])
}
```

#### Update Transaction Request Building

In `useTransactionRequestInfo.ts`, use the on-chain transaction payload:

```typescript
// In packages/uniswap/src/features/transactions/swap/stores/swapTxStore/hooks/useTransactionRequestInfo.ts

// If we have on-chain txPayload, use it directly
if (derivedSwapInfo.onChainTxPayload) {
  return {
    // Convert on-chain payload to TransactionRequest format
    to: derivedSwapInfo.onChainTxPayload.to,
    data: derivedSwapInfo.onChainTxPayload.data,
    value: derivedSwapInfo.onChainTxPayload.value,
    // ... other fields
  }
}

// Otherwise, use existing Trading API flow
// ... existing code ...
```

### Step 2: Create LP Hooks

Create hooks similar to the swap hook:

#### `useV3MintPosition.ts`

```typescript
import { useQuery } from '@tanstack/react-query'
import { buildMintPositionTx, calculatePositionAmounts, fetchV3PoolState } from '../services/v3OnChain'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'

export function useV3MintPosition(params: {
  token0: Currency
  token1: Currency
  fee: FeeAmount
  tickLower: number
  tickUpper: number
  amount0Desired?: CurrencyAmount<Currency>
  amount1Desired?: CurrencyAmount<Currency>
  slippageTolerance: Percent
  chainId: EVMUniverseChainId
  recipient: string
  enabled?: boolean
}) {
  const publicClient = useMemo(() => createViemClient({ chainId: params.chainId }), [params.chainId])
  
  return useQuery({
    queryKey: ['v3MintPosition', params],
    queryFn: async () => {
      // Fetch pool state
      const poolState = await fetchV3PoolState({
        tokenIn: params.token0,
        tokenOut: params.token1,
        fee: params.fee,
        chainId: params.chainId,
        publicClient: publicClient!,
      })
      
      if (!poolState) {
        throw new Error('Pool does not exist')
      }
      
      // Calculate position amounts
      const positionAmounts = calculatePositionAmounts(
        poolState.pool,
        params.tickLower,
        params.tickUpper,
        params.amount0Desired,
        params.amount1Desired,
      )
      
      // Apply slippage
      const amount0Min = calculateAmountOutMinimum(positionAmounts.amount0, params.slippageTolerance)
      const amount1Min = calculateAmountOutMinimum(positionAmounts.amount1, params.slippageTolerance)
      
      // Build transaction
      const txPayload = await buildMintPositionTx({
        ...params,
        amount0Desired: positionAmounts.amount0,
        amount1Desired: positionAmounts.amount1,
        amount0Min,
        amount1Min,
        deadline: getDeadline(20),
        publicClient: publicClient!,
      })
      
      return {
        txPayload,
        positionAmounts,
        pool: poolState.pool,
      }
    },
    enabled: params.enabled && !!publicClient,
  })
}
```

### Step 3: Wire LP UI

#### Update `CreatePositionTxContext.tsx`

```typescript
// In apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx

import { useV3MintPosition } from 'uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition'

// Replace Trading API call with on-chain hook
const { data: mintData, isLoading, error } = useV3MintPosition({
  token0: displayCurrencies.TOKEN0,
  token1: displayCurrencies.TOKEN1,
  fee: positionState.fee,
  tickLower: ticks[0],
  tickUpper: ticks[1],
  amount0Desired: currencyAmounts.TOKEN0,
  amount1Desired: currencyAmounts.TOKEN1,
  slippageTolerance: slippageTolerance || defaultSlippage,
  chainId,
  recipient: account.address,
  enabled: !!currencyAmounts.TOKEN0 && !!currencyAmounts.TOKEN1,
})

// Use mintData.txPayload instead of Trading API response
```

### Step 4: Feature Flag

Add a feature flag to enable/disable on-chain mode:

```typescript
// Use feature flag to control when to use on-chain vs Trading API
const useV3OnChainEnabled = useFeatureFlag(FeatureFlags.V3OnChainEnabled)

const isSinglePoolV3Swap = useMemo(() => {
  return useV3OnChainEnabled &&
         chainId === UniverseChainId.BaseSepolia &&
         // ... other conditions
}, [useV3OnChainEnabled, chainId, ...])
```

### Step 5: Error Handling

Update error messages to be user-friendly:

```typescript
// In swap components, handle on-chain errors
if (onChainQuote.isError) {
  const errorMessage = onChainQuote.error?.message || 'Failed to get quote'
  
  // Show user-friendly error
  if (errorMessage.includes('Pool does not exist')) {
    showError('This trading pair is not available')
  } else if (errorMessage.includes('Insufficient liquidity')) {
    showError('Not enough liquidity in pool for this swap')
  } else {
    showError(errorMessage)
  }
}
```

## 🧪 Testing Checklist

### Swap Flow
- [ ] Single-pool V3 swap works end-to-end
- [ ] Quote is fetched from on-chain
- [ ] Transaction is built correctly
- [ ] Review button enables when quote is ready
- [ ] Transaction submits successfully
- [ ] Error messages are user-friendly

### LP Flow
- [ ] Create position works end-to-end
- [ ] Position amounts are calculated correctly
- [ ] Transaction is built correctly
- [ ] Increase liquidity works
- [ ] Decrease liquidity works
- [ ] Collect fees works

### Edge Cases
- [ ] Pool doesn't exist
- [ ] Insufficient liquidity
- [ ] Invalid price range
- [ ] Network errors
- [ ] User switches chains during quote

## 📝 Notes

1. **Gradual Rollout**: Start with Base Sepolia only, then expand
2. **Fallback**: Keep Trading API as fallback for multi-hop or complex routes
3. **Monitoring**: Add analytics to track on-chain vs API usage
4. **Performance**: On-chain calls may be slower than API - consider caching

## 🚀 Quick Start

1. Import the hook in your swap component
2. Add conditional logic to use on-chain for single-pool V3 swaps
3. Test on Base Sepolia testnet
4. Monitor errors and performance
5. Gradually expand to other chains

## 📚 Reference

- Swap Hook: `packages/uniswap/src/features/transactions/swap/hooks/useV3OnChainSwapQuote.ts`
- Swap Services: `packages/uniswap/src/features/transactions/swap/services/v3OnChain/`
- LP Services: `packages/uniswap/src/features/transactions/liquidity/services/v3OnChain/`



