# V3 On-Chain Quick Reference Guide

## 🚀 Quick Start

The V3 on-chain implementation is **ready to use** for Base Sepolia testnet. It automatically activates for eligible swaps and LP operations.

---

## 📍 Where It's Used

### Swaps
- **File**: `packages/uniswap/src/features/transactions/swap/stores/swapFormStore/hooks/useDerivedSwapInfo.ts`
- **Condition**: Base Sepolia (84532), V3, single-pool, ERC20 tokens
- **Automatic**: No code changes needed - it's already integrated!

### Liquidity Positions
- **File**: `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx`
- **Condition**: Base Sepolia (84532), V3 protocol
- **Automatic**: No code changes needed - it's already integrated!

---

## 🔧 Key Functions & Hooks

### For Swaps

#### `useV3OnChainSwapQuote`
```typescript
import { useV3OnChainSwapQuote } from 'uniswap/src/features/transactions/swap/hooks/useV3OnChainSwapQuote'

const { 
  quoteAmountOut,    // CurrencyAmount<Currency>
  txPayload,         // { to, data, value }
  pool,              // Pool from @uniswap/v3-sdk
  priceImpact,       // Percent
  isLoading,         // boolean
  error              // Error | null
} = useV3OnChainSwapQuote({
  tokenIn: Currency,
  tokenOut: Currency,
  amountIn: CurrencyAmount<Currency>,
  fee: FeeAmount,
  slippageTolerance: Percent,
  chainId: EVMUniverseChainId,
  recipient?: string,
  enabled: boolean
})
```

#### Core Services
```typescript
// Fetch pool state
import { fetchV3PoolState } from 'uniswap/src/features/transactions/swap/services/v3OnChain'

const poolState = await fetchV3PoolState({
  tokenIn: Currency,
  tokenOut: Currency,
  fee: FeeAmount,
  chainId: number,
  publicClient: PublicClient
})

// Get quote
import { quoteExactInputSingle } from 'uniswap/src/features/transactions/swap/services/v3OnChain'

const quote = await quoteExactInputSingle({
  tokenIn: Currency,
  tokenOut: Currency,
  fee: FeeAmount,
  amountIn: CurrencyAmount<Currency>,
  chainId: number,
  publicClient: PublicClient
})

// Build transaction
import { buildExactInputSingleSwapTx } from 'uniswap/src/features/transactions/swap/services/v3OnChain'

const txPayload = buildExactInputSingleSwapTx({
  tokenIn: Currency,
  tokenOut: Currency,
  fee: FeeAmount,
  amountIn: CurrencyAmount<Currency>,
  amountOutMinimum: CurrencyAmount<Currency>,
  recipient: string,
  deadline: number,
  chainId: number
})
```

### For Liquidity Positions

#### `useV3MintPosition`
```typescript
import { useV3MintPosition } from 'uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition'

const {
  txPayload,         // { to, data, value }
  isLoading,         // boolean
  error              // Error | null
} = useV3MintPosition({
  token0: Currency,
  token1: Currency,
  fee: FeeAmount,
  tickLower: number,
  tickUpper: number,
  amount0Desired: CurrencyAmount<Currency>,
  amount1Desired: CurrencyAmount<Currency>,
  slippageTolerance: Percent,
  chainId: EVMUniverseChainId,
  recipient?: string,
  enabled: boolean
})
```

#### Core Services
```typescript
// Build mint transaction
import { buildMintPositionTx } from 'uniswap/src/features/transactions/liquidity/services/v3OnChain'

const txPayload = buildMintPositionTx({
  token0: Currency,
  token1: Currency,
  fee: FeeAmount,
  tickLower: number,
  tickUpper: number,
  amount0Desired: CurrencyAmount<Currency>,
  amount1Desired: CurrencyAmount<Currency>,
  amount0Min: CurrencyAmount<Currency>,
  amount1Min: CurrencyAmount<Currency>,
  recipient: string,
  deadline: number,
  chainId: number
})
```

---

## 🎯 Eligibility Check

### Swaps
```typescript
import { shouldUseV3OnChainQuote } from 'uniswap/src/features/transactions/swap/utils/v3OnChainTradeAdapter'

const eligible = shouldUseV3OnChainQuote({
  chainId: 84532,              // Base Sepolia
  tokenIn: Currency,
  tokenOut: Currency,
  amountIn: CurrencyAmount<Currency>
})
```

### LP Operations
```typescript
import { shouldUseV3OnChainLp } from 'uniswap/src/features/transactions/liquidity/utils/v3OnChainIntegration'

const eligible = shouldUseV3OnChainLp({
  chainId: 84532,              // Base Sepolia
  protocolVersion: 'V3'
})
```

---

## 🔍 Current Limitations

### ✅ Supported
- Base Sepolia (84532) testnet
- Single-pool V3 swaps (exact input)
- V3 LP operations (mint, increase, decrease, collect)
- ERC20 tokens

### ❌ Not Yet Supported
- Base mainnet (8453)
- Other chains (Polygon, etc.)
- Multi-hop swaps
- Native token (ETH/WETH) swaps
- Feature flag integration (defaults to `true`)

---

## 🐛 Troubleshooting

### Issue: On-chain quote not being used
**Check**:
1. Is it Base Sepolia (chainId === 84532)?
2. Is it a V3 pool?
3. Are both tokens ERC20 (not native)?
4. Is it a single-pool swap (not multi-hop)?

### Issue: Transaction fails
**Check**:
1. Pool has sufficient liquidity?
2. Slippage tolerance is reasonable?
3. User has sufficient token balance?
4. Transaction deadline hasn't passed?

### Issue: Pool not found
**Check**:
1. Pool exists for the token pair + fee tier?
2. Correct fee tier selected (500, 3000, 10000)?
3. Chain ID is correct?

---

## 📚 Documentation Files

- **`TRADING_API_MAPPING.md`** - Trading API usage mapping
- **`V3_ONCHAIN_IMPLEMENTATION.md`** - Technical implementation details
- **`INTEGRATION_GUIDE.md`** - Integration instructions
- **`IMPLEMENTATION_STATUS.md`** - Current status and TODOs
- **`FINAL_COMPLETION_SUMMARY.md`** - Complete summary
- **`QUICK_REFERENCE.md`** - This file

---

## 🧪 Testing

### Manual Testing Checklist
- [ ] Swap on Base Sepolia with V3 tokens
- [ ] Create V3 LP position on Base Sepolia
- [ ] Increase liquidity in existing position
- [ ] Decrease liquidity from position
- [ ] Collect fees from position
- [ ] Verify error handling (insufficient liquidity, etc.)
- [ ] Verify fallback to Trading API for non-eligible operations

### Test Scenarios
1. **Valid Swap**: Base Sepolia, V3 tokens, sufficient liquidity
2. **Invalid Pool**: Token pair with no V3 pool
3. **Insufficient Liquidity**: Swap amount exceeds pool liquidity
4. **Invalid Range**: LP position with invalid tick range
5. **Non-Eligible**: Mainnet swap (should use Trading API)

---

## 🚀 Next Steps

1. **Test on Base Sepolia testnet**
   - Deploy to testnet
   - Test all flows
   - Verify error handling

2. **Add feature flag**
   - Create `FeatureFlags.V3OnChainEnabled`
   - Integrate into eligibility checks
   - Enable gradual rollout

3. **Expand scope**
   - Add Base mainnet support
   - Add other chains
   - Add native token support

---

## 💡 Tips

- The on-chain implementation **automatically activates** for eligible operations
- Trading API is used as **fallback** for non-eligible operations
- All transaction payloads are **ready to send** directly to wallets
- Error messages are **user-friendly** and actionable
- React Query handles **caching and refetching** automatically

---

**Status**: ✅ Ready for Testing
**Chain**: Base Sepolia (84532)
**Protocol**: V3 only




