# V3 On-Chain Implementation Guide

This document outlines the implementation status and remaining work to migrate from Trading API to pure on-chain V3 operations.

## ✅ Completed

### 1. Trading API Mapping
- **File**: `TRADING_API_MAPPING.md`
- Mapped all Trading API usage including:
  - Quote endpoints (`/v1/quote`)
  - Swap endpoints (`/v1/swap`, `/v1/swap_5792`, `/v1/swap_7702`)
  - LP endpoints (`/v1/lp/create`, `/v1/lp/increase`, `/v1/lp/decrease`, `/v1/lp/claim`)
  - Environment variables

### 2. V3 Pool On-Chain Service
- **File**: `packages/uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain.ts`
- **Features**:
  - Fetches pool state (slot0, liquidity) directly from V3 pool contracts
  - Computes pool addresses using factory + tokens + fee
  - Builds `Pool` instances from V3 SDK
  - Supports fetching by pool address or by token pair

### 3. V3 Quoter Service
- **File**: `packages/uniswap/src/features/transactions/swap/services/v3OnChain/v3Quoter.ts`
- **Features**:
  - Quotes exact input single swaps using QuoterV2 or legacy Quoter contracts
  - Returns amountOut, sqrtPriceX96After, ticks crossed, and gas estimates
  - User-friendly error parsing for common failures
  - Supports price limits

### 4. V3 Swap Transaction Builder
- **File**: `packages/uniswap/src/features/transactions/swap/services/v3OnChain/v3SwapTxBuilder.ts`
- **Features**:
  - Builds transaction payloads (calldata) for SwapRouter.exactInputSingle
  - Calculates minimum amounts with slippage tolerance
  - Handles native token swaps (ETH value)
  - Generates deadlines

## 🔨 In Progress / Next Steps

### 5. React Hook for On-Chain Swap Quotes

**Create**: `packages/uniswap/src/features/transactions/swap/hooks/useV3OnChainSwapQuote.ts`

This hook should:
- Accept: `tokenIn`, `tokenOut`, `amountIn`, `fee`, `slippage`, `chainId`, `account`
- Fetch pool state using `fetchV3PoolState`
- Get quote using `quoteExactInputSingle`
- Build transaction payload using `buildExactInputSingleSwapTx`
- Return: `{ quoteAmountOut, priceImpact, txPayload, error, isLoading }`

**Integration Points**:
- Replace `useTrade` hook usage in swap components (for V3 pools)
- Update `useDerivedSwapInfo` to use on-chain quote when available
- Enable "Review" button when `txPayload` is available

### 6. Wire Swap UI to New Hook

**Files to Update**:
- `packages/uniswap/src/features/transactions/swap/stores/swapFormStore/hooks/useDerivedSwapInfo.ts`
  - Add conditional logic to use `useV3OnChainSwapQuote` for V3 single-pool swaps
  - Fall back to existing `useTrade` for multi-hop or other routing

- `packages/uniswap/src/features/transactions/swap/stores/swapTxStore/hooks/useTransactionRequestInfo.ts`
  - Use transaction payload from on-chain hook instead of Trading API

- Swap review/confirmation components
  - Use on-chain transaction payload directly

### 7. V3 LP Services

**Create**: `packages/uniswap/src/features/transactions/liquidity/services/v3OnChain/v3LpOnChain.ts`

Services needed:
- **Position Math**: Use `@uniswap/v3-sdk` to calculate position amounts from price ranges
- **Mint Position**: Build `NonfungiblePositionManager.mint()` calldata
- **Increase Liquidity**: Build `increaseLiquidity()` calldata
- **Decrease Liquidity**: Build `decreaseLiquidity()` calldata
- **Collect Fees**: Build `collect()` calldata

**Key Functions**:
```typescript
// Build mint transaction
buildMintPositionTx({
  token0, token1, fee, tickLower, tickUpper,
  amount0Desired, amount1Desired,
  amount0Min, amount1Min,
  recipient, deadline
}): TransactionPayload

// Build increase liquidity transaction
buildIncreaseLiquidityTx({
  tokenId, amount0Desired, amount1Desired,
  amount0Min, amount1Min, deadline
}): TransactionPayload
```

### 8. V3 LP Hooks

**Create**: 
- `packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts`
- `packages/uniswap/src/features/transactions/liquidity/hooks/useV3IncreaseLiquidity.ts`
- `packages/uniswap/src/features/transactions/liquidity/hooks/useV3DecreaseLiquidity.ts`
- `packages/uniswap/src/features/transactions/liquidity/hooks/useV3CollectFees.ts`

Each hook should:
- Fetch pool state
- Calculate position amounts using V3 SDK
- Build transaction payload
- Return formatted data for UI

**Integration Points**:
- Replace `useCreateLpPositionCalldataQuery` calls
- Replace `useIncreaseLpPositionCalldataQuery` calls
- Update LP UI components to use new hooks

### 9. Remove Trading API Dependencies

**Files to Update/Remove**:
- Remove Trading API client imports from swap flows
- Remove Trading API client imports from LP flows
- Remove environment variables:
  - `REACT_APP_TRADING_API_URL_OVERRIDE`
  - `REACT_APP_TRADING_API_KEY`
- Update config files to remove Trading API URLs

**Conditional Logic**:
- Add feature flag or chain-specific logic to use on-chain vs Trading API
- For now, only enable on-chain for Base Sepolia (or specific chains)
- Keep Trading API as fallback for other chains until fully migrated

## 📋 Implementation Checklist

### Swap Flow
- [x] Create V3 pool state fetching service
- [x] Create V3 quoter service
- [x] Create swap transaction builder
- [ ] Create `useV3OnChainSwapQuote` hook
- [ ] Update `useDerivedSwapInfo` to use on-chain quotes
- [ ] Update transaction request building to use on-chain payloads
- [ ] Update swap UI to enable Review button based on on-chain data
- [ ] Test single-pool swaps end-to-end

### LP Flow
- [ ] Create V3 LP position math service
- [ ] Create V3 LP transaction builders (mint, increase, decrease, collect)
- [ ] Create V3 LP hooks
- [ ] Update LP UI components to use new hooks
- [ ] Test LP operations end-to-end

### Cleanup
- [ ] Remove Trading API dependencies from swap flow
- [ ] Remove Trading API dependencies from LP flow
- [ ] Remove Trading API environment variables
- [ ] Update error handling to show on-chain errors
- [ ] Add feature flag for gradual rollout

## 🔧 Key Implementation Details

### Provider Interface
All services expect a provider with this interface:
```typescript
{
  call: (params: { to: string; data: string }) => Promise<string>
}
```

This works with:
- Ethers.js providers (via `provider.call()`)
- Viem public clients (via `publicClient.call()`)
- Web3.js providers (via `eth_call`)

### Contract Addresses
Services automatically use:
- Agroswap addresses for Base Sepolia (84532)
- SDK default addresses for other chains
- Override addresses from `v3Addresses.ts` and `agroswapAddresses.ts`

### Error Handling
- Pool state failures return `null` (pool doesn't exist)
- Quote failures throw errors with user-friendly messages
- Transaction building validates inputs before encoding

## 🚀 Usage Example

### Swap Quote Hook (To Be Implemented)
```typescript
const { quoteAmountOut, txPayload, error, isLoading } = useV3OnChainSwapQuote({
  tokenIn: USDT,
  tokenOut: CARBON_TOKEN,
  amountIn: CurrencyAmount.fromRawAmount(USDT, '1000000'),
  fee: FeeAmount.MEDIUM, // 0.3%
  slippageTolerance: new Percent(50, 10000), // 0.5%
  chainId: UniverseChainId.BaseSepolia,
  account: '0x...',
})
```

### LP Mint Hook (To Be Implemented)
```typescript
const { txPayload, error, isLoading } = useV3MintPosition({
  token0: USDT,
  token1: CARBON_TOKEN,
  fee: FeeAmount.MEDIUM,
  tickLower: -60,
  tickUpper: 60,
  amount0Desired: CurrencyAmount.fromRawAmount(USDT, '1000000'),
  amount1Desired: CurrencyAmount.fromRawAmount(CARBON_TOKEN, '500000'),
  slippageTolerance: new Percent(50, 10000),
  chainId: UniverseChainId.BaseSepolia,
  account: '0x...',
})
```

## 📝 Notes

1. **Single-Pool Only**: Current implementation supports single-pool swaps only. Multi-hop routing would require additional logic.

2. **Gas Estimation**: QuoterV2 returns gas estimates, but we may want to add `estimateGas` calls for more accurate estimates.

3. **Price Impact**: Calculate price impact by comparing quoted amount to mid-price from pool state.

4. **Slippage**: Always apply slippage tolerance when building transaction payloads.

5. **Deadlines**: Use reasonable deadlines (e.g., 20 minutes from now) to prevent stale transactions.

6. **Native Tokens**: Handle native token (ETH) swaps by including `value` in transaction payload.

## 🧪 Testing Strategy

1. **Unit Tests**: Test each service function independently
2. **Integration Tests**: Test hooks with mock providers
3. **E2E Tests**: Test full swap/LP flows on Base Sepolia testnet
4. **Error Cases**: Test pool not found, insufficient liquidity, etc.

## 🔗 Related Files

- Trading API Mapping: `TRADING_API_MAPPING.md`
- V3 Services: `packages/uniswap/src/features/transactions/swap/services/v3OnChain/`
- Contract Addresses: 
  - `packages/uniswap/src/constants/v3Addresses.ts`
  - `packages/uniswap/src/constants/agroswapAddresses.ts`


