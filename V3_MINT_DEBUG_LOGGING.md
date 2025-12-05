# V3 Mint Flow Debug Logging - Complete Pipeline Trace

## Overview

Comprehensive diagnostic logging has been added throughout the V3 mint pipeline to trace where user-provided amounts are transformed. **NO logic changes** - only diagnostic logs.

## Logging Points Added

### 1. Input Parsing (`tryParseCurrencyAmount.ts`)

**Location**: `apps/web/src/lib/utils/tryParseCurrencyAmount.ts`

**Logs**:
- Input string value
- Truncated value (after decimal truncation)
- Decimals used
- Raw parsed value (on-chain units)
- Human-readable result
- Currency symbol and address

**Example Output**:
```javascript
[tryParseCurrencyAmount] Input → Raw conversion {
  input: "0.01",
  truncated: "0.01",
  decimals: 6,
  raw: "10000",
  human: "0.01",
  currency: "USDC",
  currencyAddress: "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
}
```

### 2. Dependent Amount Calculation (`useDepositInfo.tsx`)

**Location**: `apps/web/src/components/Liquidity/Create/hooks/useDepositInfo.tsx`

**Logs**:
- Parsed amounts from user input (independent + other)
- Pool state (exists, mock pool details)
- Tick range (tickLower, tickUpper)
- Dependent amount calculation result
- Final parsed amounts mapping (TOKEN0/TOKEN1)

**Key Logs**:
- `[useDepositInfo] Parsed amounts from user input` - After parsing
- `[useDepositInfo] Dependent amount calculation` - During dependent amount derivation
- `[useDepositInfo] Final parsed amounts mapping` - Final TOKEN0/TOKEN1 mapping

### 3. Position Calculation (`getDependentAmount.ts`)

**Location**: `apps/web/src/components/Liquidity/utils/getDependentAmount.ts`

**Logs**:
- Independent amount (raw, human, currency, decimals)
- Pool details (token0, token1, fee, sqrtPriceX96, tickCurrent, liquidity)
- Tick range
- Token ordering (independentTokenIsFirstToken)
- Position calculation method (fromAmount0 vs fromAmount1)
- Position result (amount0, amount1, liquidity)
- Dependent amount result

**Key Logs**:
- `[getDependentAmountFromV3Position] Position calculation` - Inputs
- `[getDependentAmountFromV3Position] Position calculation result` - Outputs

### 4. Currency Amounts Received (`CreatePositionTxContext.tsx`)

**Location**: `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx`

**Logs**:
- currencyAmounts received from `useDepositInfo`
- TOKEN0 and TOKEN1 amounts (raw, human, currency, address, decimals)
- Formatted amounts
- USD values

**Key Log**: `[CreatePositionTxContext] currencyAmounts received from useDepositInfo`

### 5. Approval State (`useOnChainLpApproval.ts`)

**Location**: `packages/uniswap/src/features/transactions/liquidity/hooks/useOnChainLpApproval.ts`

**Logs**:
- Token0/Token1 amounts (raw, human, currency, address, decimals)
- Allowances (raw, human, isMaxUint256)
- Spender address
- Needs approval boolean

**Key Logs**:
- `[useOnChainLpApproval] Token0 approval check`
- `[useOnChainLpApproval] Token1 approval check`

### 6. Position Amounts Calculation (`useV3MintPosition.ts`)

**Location**: `packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts`

**Logs**:
- Pool diagnostics (existence, initialization, slot0)
- Input amounts BEFORE processing
- Position amounts calculation (pool exists path)
- Input vs calculated comparison
- Slippage application
- Amounts passed to `buildMintPositionTx`

**Key Logs**:
- `[useV3MintPosition] pool diagnostics`
- `[useV3MintPosition] Pool exists - calculating position amounts`
- `[useV3MintPosition] Position amounts calculated (pool exists)`
- `[useV3MintPosition] Slippage applied (pool exists)`
- `[useV3MintPosition] Calling buildMintPositionTx with`

### 7. Token Sorting (`buildMintPositionTx` in `v3LpOnChain.ts`)

**Location**: `packages/uniswap/src/features/transactions/liquidity/services/v3OnChain/v3LpOnChain.ts`

**Logs**:
- Input tokens (address, symbol, decimals)
- Token sorting (tokensNeedSwap)
- Input amounts (amount0Desired, amount1Desired, amount0Min, amount1Min)
- Final tokens after sorting
- Final amounts after sorting

**Key Log**: `[buildMintPositionTx] Token sorting and amount mapping`

### 8. Final Calldata Encoding (`buildMintPositionTx` in `v3LpOnChain.ts`)

**Location**: `packages/uniswap/src/features/transactions/liquidity/services/v3OnChain/v3LpOnChain.ts`

**Logs**:
- Final mintParams BEFORE encoding
- Validation (amount0Min < amount0Desired, amount1Min < amount1Desired)
- Final calldata AFTER encoding
- Calldata length
- Summary of all amounts

**Key Logs**:
- `[buildMintPositionTx] Final mintParams BEFORE encoding`
- `[buildMintPositionTx] Final calldata AFTER encoding`

## Trading API Interference Check

**Location**: `packages/uniswap/src/features/transactions/swap/services/tradeService/transformations/buildQuoteRequest.ts`

**Behavior**: 
- Checks if chain is on-chain enabled
- Returns `undefined` to skip Trading API query
- Logs warning: `[buildQuoteRequest] Skipping Trading API for on-chain enabled chain: <chainId>`

**Verification**: Check console for this log on Base Sepolia (84532) - should see the skip message.

## Expected Log Flow

For user input: **0.01 TOKEN0, 0.01 TOKEN1** on Base Sepolia:

1. **Input Parsing**:
   ```
   [tryParseCurrencyAmount] Input → Raw conversion
   - Input: "0.01"
   - Decimals: 6
   - Raw: "10000"
   ```

2. **Dependent Amount Calculation**:
   ```
   [useDepositInfo] Parsed amounts from user input
   [getDependentAmountFromV3Position] Position calculation
   [getDependentAmountFromV3Position] Position calculation result
   [useDepositInfo] Dependent amount calculation
   [useDepositInfo] Final parsed amounts mapping
   ```

3. **Context Receipt**:
   ```
   [CreatePositionTxContext] currencyAmounts received from useDepositInfo
   - TOKEN0: { raw: "10000", human: "0.01", ... }
   - TOKEN1: { raw: "10000", human: "0.01", ... }
   ```

4. **Approval Check**:
   ```
   [useOnChainLpApproval] Token0 approval check
   [useOnChainLpApproval] Token1 approval check
   ```

5. **Position Calculation**:
   ```
   [useV3MintPosition] pool diagnostics
   [useV3MintPosition] Pool exists - calculating position amounts
   [useV3MintPosition] Position amounts calculated (pool exists)
   [useV3MintPosition] Slippage applied (pool exists)
   ```

6. **Token Sorting**:
   ```
   [buildMintPositionTx] Token sorting and amount mapping
   - tokensNeedSwap: false/true
   - Final amounts after sorting
   ```

7. **Final Encoding**:
   ```
   [buildMintPositionTx] Final mintParams BEFORE encoding
   [buildMintPositionTx] Final calldata AFTER encoding
   ```

## What to Look For

### 1. Amount Transformations
- Check each log for `raw` values - they should match expected on-chain units
- For 0.01 with 6 decimals: expect `"10000"` (not `"625"` or other values)

### 2. Token Ordering
- Check `[buildMintPositionTx] Token sorting and amount mapping`
- Verify `tokensNeedSwap` and final token/amount mapping

### 3. Dependent Amount Calculation
- Check `[getDependentAmountFromV3Position]` logs
- Verify pool state (exists, initialized, sqrtPriceX96)
- Check if dependent amount matches user input or is calculated from pool

### 4. Slippage Application
- Check `[useV3MintPosition] Slippage applied`
- Verify `amount0Min < amount0Desired` and `amount1Min < amount1Desired`

### 5. Trading API Interference
- Check for `[buildQuoteRequest] Skipping Trading API` log
- Verify no Trading API calls are made for Base Sepolia (84532)

### 6. Approval State
- Check `[useOnChainLpApproval]` logs
- Verify allowances are checked correctly
- Check if `isMaxUint256` is true for approved tokens

## Debugging Checklist

- [ ] All logs appear in console (dev mode only)
- [ ] Input parsing produces correct raw values
- [ ] Dependent amount calculation uses correct pool state
- [ ] Token ordering is correct (token0 < token1 by address)
- [ ] Slippage produces valid min amounts (min < desired)
- [ ] Final calldata amounts match expected values
- [ ] Trading API is skipped for Base Sepolia
- [ ] Approval state is correct

## Next Steps

1. **Reproduce the issue** with 0.01 TOKEN0 and 0.01 TOKEN1 on Base Sepolia
2. **Collect all logs** from console
3. **Identify the step** where amounts diverge from user input
4. **Compare with upstream Uniswap** behavior at that step
5. **Propose minimal fix** if divergence is found



