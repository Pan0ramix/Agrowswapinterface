# On-Chain Router Implementation Summary

## Overview

A complete on-chain routing system for Uniswap-fork interface with Carbon token support. The system performs all routing, quoting, and transaction building on-chain without relying on Trading API.

## Architecture

### Package Structure

```
packages/uniswap/src/features/transactions/swap/services/onchainRouter/
├── getCounterpartToken.ts      # Carbon Registry counterpart token detection
├── generateCandidateRoutes.ts  # Route generation for all 4 cases
├── validateRouteWithQuoter.ts  # QuoterV2 route validation
├── chooseBestRoute.ts          # Best route selection
├── buildSwapTx.ts              # Transaction building with path encoding
├── findRoute.ts                # Main orchestrator
└── index.ts                    # Public exports

packages/uniswap/src/features/transactions/swap/hooks/
└── useOnChainSwapQuote.ts      # Swap quote hook

packages/uniswap/src/features/transactions/liquidity/hooks/
├── useOnChainLpApproval.ts     # LP approval check hook
└── useOnChainMintPosition.ts   # LP mint position hook
```

## Features

### 1. Carbon Token Detection

- **Function**: `getCarbonCounterpartToken(carbonToken, chainId, publicClient)`
- **Location**: `getCounterpartToken.ts`
- **Behavior**:
  - Queries Carbon Registry contract: `counterpartOf(address carbonToken) returns (address)`
  - Fetches ERC20 metadata (symbol, decimals, name) for counterpart token
  - Caches results for performance
  - Returns `Token` instance or `null`

**⚠️ Configuration Required**: Update Carbon Registry addresses in `getCounterpartToken.ts`:
```typescript
const registryAddresses: Record<number, string> = {
  84532: '0x...', // Base Sepolia - REPLACE
  8453: '0x...',  // Base - REPLACE
  137: '0x...',   // Polygon - REPLACE
}
```

### 2. Routing Rules

The system supports 4 routing cases:

#### Case 1: Normal Tokens (neither is Carbon)
- Direct pool: `tokenIn → tokenOut`
- Two-hop via WETH: `tokenIn → WETH → tokenOut`

#### Case 2: Swapping TO a Carbon Token
- Primary: `tokenIn → counterpart(CARBON) → CARBON`
- Fallback: `tokenIn → WETH → counterpart(CARBON) → CARBON`

#### Case 3: Swapping FROM a Carbon Token
- Primary: `CARBON → counterpart(CARBON) → tokenOut`
- Fallback: `CARBON → counterpart(CARBON) → WETH → tokenOut`

#### Case 4: Carbon-to-Carbon Swaps
Three routing tiers:

**Tier 1 (Preferred)**: Full carbon ecosystem
- `CARBON_A → CounterA → CounterB → CARBON_B`
- Only if all pools exist

**Tier 2**: Partial carbon + Uniswap fallback
- `CARBON_A → CounterA → WETH → CounterB → CARBON_B`
- If CounterA → CounterB doesn't exist but individual pools do

**Tier 3**: Full fallback
- Direct: `CARBON_A → CARBON_B`
- Two-hop: `CARBON_A → WETH → CARBON_B`
- Multihop combinations

### 3. Quoting System

- **Function**: `validateRouteWithQuoter(route, amountIn, tokenOut, chainId, publicClient)`
- **Location**: `validateRouteWithQuoter.ts`
- **Behavior**:
  - Uses QuoterV2 `quoteExactInputSingle` for single hops
  - Uses QuoterV2 `quoteExactInput` for multi-hop routes
  - Discards routes that revert
  - Returns validated route with `amountOut`, gas estimate, etc.

### 4. Swap Transaction Builder

- **Function**: `buildSwapTx(params)`
- **Location**: `buildSwapTx.ts`
- **Behavior**:
  - Single hop → `exactInputSingle`
  - Multi-hop → `exactInput` with encoded path
  - Path encoding: `address | fee | address | fee | address`
  - Uses viem's `encodeFunctionData`

### 5. LP Actions

#### Approval Check
- **Hook**: `useOnChainLpApproval(params)`
- **Location**: `useOnChainLpApproval.ts`
- **Behavior**:
  - Checks ERC20 allowance for both tokens
  - Returns approval state for token0 and token1
  - Uses on-chain data only (wagmi `useReadContract`)

#### Mint Position
- **Hook**: `useOnChainMintPosition(params)`
- **Location**: `useOnChainMintPosition.ts`
- **Behavior**:
  - Wrapper around existing `useV3MintPosition`
  - Ensures on-chain router is enabled
  - Uses `calculatePositionAmounts` and `mintAmountsWithSlippage`

### 6. Feature Flag

- **Function**: `isOnChainRouterEnabled(chainId)`
- **Location**: `findRoute.ts`
- **Enabled Chains**: `[84532, 8453, 137]` (Base Sepolia, Base, Polygon)

## Usage

### Swap Quote

```typescript
import { useOnChainSwapQuote } from 'uniswap/src/features/transactions/swap/hooks/useOnChainSwapQuote'

const { data, isLoading, isError } = useOnChainSwapQuote({
  tokenIn: USDC,
  tokenOut: WETH,
  amountIn: CurrencyAmount.fromRawAmount(USDC, '1000000'),
  slippageTolerance: new Percent(5, 1000), // 0.5%
  chainId: 84532,
  recipient: account.address,
  enabled: true,
})

if (data) {
  console.log('Quote:', data.quoteAmountOut.toExact())
  console.log('TX Payload:', data.txPayload)
}
```

### LP Approval

```typescript
import { useOnChainLpApproval } from 'uniswap/src/features/transactions/liquidity/hooks/useOnChainLpApproval'

const { approvalState0, approvalState1, needsApproval0, needsApproval1 } = useOnChainLpApproval({
  amount0: CurrencyAmount.fromRawAmount(USDC, '1000000'),
  amount1: CurrencyAmount.fromRawAmount(WETH, '1000000000000000000'),
  chainId: 84532,
  owner: account.address,
})
```

### LP Mint Position

```typescript
import { useOnChainMintPosition } from 'uniswap/src/features/transactions/liquidity/hooks/useOnChainMintPosition'

const { txPayload, positionAmounts, isLoading } = useOnChainMintPosition({
  token0: USDC,
  token1: WETH,
  fee: FeeAmount.MEDIUM,
  tickLower: -1000,
  tickUpper: 1000,
  amount0Desired: CurrencyAmount.fromRawAmount(USDC, '1000000'),
  amount1Desired: CurrencyAmount.fromRawAmount(WETH, '1000000000000000000'),
  slippageTolerance: new Percent(5, 1000),
  chainId: 84532,
  recipient: account.address,
})
```

## Configuration

### Required Setup

1. **Carbon Registry Addresses**: Update in `getCounterpartToken.ts`
   ```typescript
   const registryAddresses: Record<number, string> = {
     84532: '0x...', // Your Carbon Registry address
     8453: '0x...',
     137: '0x...',
   }
   ```

2. **Feature Flag**: Chains are already configured in `findRoute.ts`
   ```typescript
   const enabledChains = [84532, 8453, 137]
   ```

### Optional Configuration

- **Fee Tiers**: Default is `[FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH]`
- **Cache TTL**: Counterpart token cache is in-memory (cleared on page refresh)

## Constraints

✅ **DO**:
- Use QuoterV2 for all quotes
- Query Carbon Registry for counterpart tokens
- Use Uniswap SDK for pool calculations
- Encode paths exactly: `address | fee | address | fee | address`
- Cache counterpart token lookups

❌ **DON'T**:
- Call Trading API
- Call external routing APIs
- Hardcode routing tokens
- Hardcode counterpart tokens

## Integration Points

The hooks are designed to match existing Uniswap hook shapes, so UI components can use them as drop-in replacements:

- `useOnChainSwapQuote` → Similar to `useV3OnChainSwapQuote`
- `useOnChainLpApproval` → Similar to existing approval hooks
- `useOnChainMintPosition` → Wrapper around `useV3MintPosition`

## Testing

To test the implementation:

1. **Carbon Token Detection**:
   ```typescript
   const counterpart = await getCarbonCounterpartToken(carbonToken, 84532, publicClient)
   ```

2. **Route Generation**:
   ```typescript
   const routes = await generateCandidateRoutes(tokenIn, tokenOut, 84532, publicClient)
   ```

3. **Route Validation**:
   ```typescript
   const validated = await validateRouteWithQuoter(route, amountIn, tokenOut, 84532, publicClient)
   ```

4. **Full Route Finding**:
   ```typescript
   const result = await findRoute(tokenIn, tokenOut, amountIn, 84532, publicClient)
   ```

## Notes

- All counterpart tokens are fetched on-chain from Carbon Registry
- No hardcoded routing tokens (uses WETH from chain config)
- Supports up to 3 hops for route exploration
- Parallel route validation for performance
- Automatic fallback routing for Carbon tokens

## Next Steps

1. Configure Carbon Registry addresses
2. Test with actual Carbon tokens on enabled chains
3. Monitor gas usage and optimize if needed
4. Add additional chains to feature flag as needed



