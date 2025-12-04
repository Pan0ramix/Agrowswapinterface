# V3 LP Mint Amounts Debugging

## Problem
- User inputs: 0.01 USDC and 0.01 EURC
- On-chain: `amount0Desired = 625`, `amount0Min = 9950`
- Expected: For 6-decimal tokens, 0.01 should be `10,000` (1e4), not `625`
- Issue: `amount0Min > amount0Desired` causing revert

## Pipeline Overview

1. **UI Input** → User types "0.01" in input field
2. **useDepositInfo** → `tryParseCurrencyAmount("0.01", token)` → `parseUnits("0.01", decimals)`
3. **CreatePositionTxContext** → `currencyAmounts.TOKEN0` / `currencyAmounts.TOKEN1` → passed to `useV3MintPosition`
4. **useV3MintPosition** → Receives `amount0Desired`, `amount1Desired` → Applies slippage → `amount0Min`, `amount1Min`
5. **buildMintPositionTx** → Sorts tokens by address → Swaps amounts if needed → Encodes MintParams

## Key Files

- `apps/web/src/lib/utils/tryParseCurrencyAmount.ts` - Parses user input with decimals
- `apps/web/src/components/Liquidity/Create/hooks/useDepositInfo.tsx` - Converts to CurrencyAmount
- `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx` - Passes amounts to hook
- `packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts` - Computes amounts with slippage
- `packages/uniswap/src/features/transactions/liquidity/services/v3OnChain/v3LpOnChain.ts` - Sorts tokens and encodes

## Token Addresses (Base Sepolia)
- token0: 0x036cbd53842c5426634e7929541ec2318f3dcf7e (USDC-like, 6 decimals)
- token1: 0x808456652fdb597867f38412077a9182bf77359f (EURC-like, 6 decimals)

## Expected Values
- 0.01 USDC (6 decimals) = `parseUnits("0.01", 6)` = `10000` (1e4)
- 0.01 EURC (6 decimals) = `parseUnits("0.01", 6)` = `10000` (1e4)
- With 0.5% slippage: `amount0Min = 10000 * 0.995 = 9950`

## Actual Values (from transaction)
- `amount0Desired = 625` ❌ (should be 10000)
- `amount0Min = 9950` ❌ (should be 9950, but > amount0Desired)

## Potential Issues
1. Wrong decimals used in `tryParseCurrencyAmount` (using 18 instead of 6)
2. Token ordering mismatch (amounts swapped incorrectly)
3. Amount transformation applied twice
4. Slippage calculation using wrong base amount


