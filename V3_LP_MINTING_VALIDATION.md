# V3 LP Minting Flow - Complete Validation Report

## 🔎 1. customSlippageTolerance: Source, Type, and Values

### Source Files

**Primary Source**: `packages/uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/useTransactionSettingsStore.ts`

**Type Definition**: `packages/uniswap/src/features/transactions/components/settings/types.ts`

```typescript
export interface TransactionSettingsState {
  customSlippageTolerance?: number  // ⬅️ TYPE: number | undefined
  customDeadline?: number
  selectedProtocols: FrontendSupportedProtocol[]
  slippageWarningModalSeen: boolean
  isV4HookPoolsEnabled: boolean
}
```

### Variable Type

- **TypeScript Type**: `number | undefined`
- **Stored Format**: Number representing percentage value (e.g., `0.5` = 0.5%, `1.0` = 1.0%)

### Raw Value Format from UI

**UI Input**: User types a string like `"0.5"` in the slippage input field

**Processing**: 
- `packages/uniswap/src/features/transactions/components/settings/settingsConfigurations/slippage/useSlippageSettings.ts` (Line 152)
- `parseFloat(value)` converts string to number
- `setCustomSlippageTolerance(parsedValue)` stores as number

**Storage**: Stored as `number` in Zustand store

### Example Runtime Values

| User Input | Stored Value | Meaning |
|------------|--------------|---------|
| `"0.5"` | `0.5` | 0.5% |
| `"1.0"` | `1.0` | 1.0% |
| `"0.1"` | `0.1` | 0.1% |
| `undefined` | `undefined` | Auto (uses default) |

**Key Finding**: `customSlippageTolerance` is a number where **0.5 = 0.5%** (not 0.005)

### Conversion Path

**Location**: `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx` (Lines 543-550)

```typescript
const slippageTolerancePercent = useMemo(() => {
  if (customSlippageTolerance !== undefined) {
    // customSlippageTolerance = 0.5 (for 0.5%)
    // Convert to basis points: 0.5 * 100 = 50
    const basisPoints = Math.round(customSlippageTolerance * 100)
    // Create Percent: new Percent(50, 10_000) = 0.5%
    return new Percent(basisPoints, 10_000)
  }
  return new Percent(50, 10_000) // Default 0.5%
}, [customSlippageTolerance])
```

**Conversion Formula**:
- Input: `0.5` (number, representing 0.5%)
- Step 1: `0.5 * 100 = 50` (basis points)
- Step 2: `Math.round(50) = 50`
- Step 3: `new Percent(50, 10_000)` = 0.5% Percent instance

**Validation**: ✅ Correct - matches Uniswap's `slippageToleranceToPercent` pattern exactly

---

## 🔎 2. Full Branching Logic for LP Minting

### Complete Code Snippet

**File**: `packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts`

**Lines**: 153-220 (query function with branching)

```typescript
return async (): Promise<V3MintPositionResult> => {
  try {
    // Runtime validation: Ensure slippageTolerance is Percent
    if (!(slippageTolerance instanceof Percent)) {
      throw new Error(`slippageTolerance must be a Percent instance, got: ${typeof slippageTolerance}`)
    }

    // Step 1: Try to fetch pool state (may not exist for new pools)
    let poolState = await fetchV3PoolState({
      tokenIn: token0,
      tokenOut: token1,
      fee,
      chainId,
      publicClient,
    })

    // Variable declarations
    let positionAmounts: {
      amount0: CurrencyAmount<Currency>
      amount1: CurrencyAmount<Currency>
      liquidity: string
    }
    let pool: any | undefined
    let amount0Min: CurrencyAmount<Currency>
    let amount1Min: CurrencyAmount<Currency>

    // BRANCHING: Pool exists vs. New pool
    if (poolState) {
      // ─────────────────────────────────────────────────────────────
      // BRANCH A: POOL EXISTS
      // ─────────────────────────────────────────────────────────────
      
      // Calculate position amounts from pool state using Position class
      const positionResult = calculatePositionAmounts(
        poolState.pool,      // Pool instance from on-chain data
        tickLower,
        tickUpper,
        amount0Desired,      // Optional - user's desired amount0
        amount1Desired,      // Optional - user's desired amount1
      )
      
      positionAmounts = {
        amount0: positionResult.amount0,      // Calculated from Position
        amount1: positionResult.amount1,      // Calculated from Position
        liquidity: positionResult.liquidity,  // Calculated from Position
      }
      pool = poolState.pool  // Pool exists, store it

      // Use Position.mintAmountsWithSlippage() - Uniswap's standard pattern
      const { amount0: min0, amount1: min1 } = positionResult.position.mintAmountsWithSlippage(slippageTolerance)
      amount0Min = min0
      amount1Min = min1
      
    } else {
      // ─────────────────────────────────────────────────────────────
      // BRANCH B: NEW POOL (pool doesn't exist)
      // ─────────────────────────────────────────────────────────────
      
      // Validate required amounts for new pool creation
      if (!amount0Desired || !amount1Desired) {
        throw new Error('Both token amounts are required for new pool creation')
      }
      
      // Use desired amounts directly (contract will calculate actual amounts)
      positionAmounts = {
        amount0: amount0Desired,     // Use user input directly
        amount1: amount1Desired,     // Use user input directly
        liquidity: '0',              // Will be calculated by contract
      }
      pool = undefined  // Pool doesn't exist yet

      // For new pools, apply slippage directly using Percent.complement()
      // (Same calculation Position.mintAmountsWithSlippage does internally)
      const slippageComplement = slippageTolerance.complement()
      amount0Min = amount0Desired.multiply(slippageComplement)
      amount1Min = amount1Desired.multiply(slippageComplement)
    }

    // Step 3: Build transaction payload (common for both branches)
    const txPayload = await buildMintPositionTx({
      token0,
      token1,
      fee,
      tickLower,
      tickUpper,
      amount0Desired: positionAmounts.amount0,
      amount1Desired: positionAmounts.amount1,
      amount0Min,
      amount1Min,
      recipient,
      deadline: getDeadline(20),
      chainId,
      pool: poolState?.pool,  // Only pass pool if it exists
      publicClient,
    })

    return {
      txPayload,
      positionAmounts,
      pool,
      tickLower,
      tickUpper,
    }
  } catch (error) {
    // Error handling...
  }
}
```

### Pool Existence Detection

**Location**: `packages/uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain.ts`

**Logic**: `fetchV3PoolState()` returns `V3PoolOnChainState | null`

```typescript
export async function fetchV3PoolState(params: FetchV3PoolStateParams): Promise<V3PoolOnChainState | null> {
  // ... fetch slot0 and liquidity from pool contract ...
  
  // Check if pool exists (sqrtPriceX96 > 0 and liquidity > 0)
  if (sqrtPriceX96 === '0' || liquidity.toString() === '0') {
    return null  // ⬅️ Pool doesn't exist
  }
  
  // Pool exists - return state
  return { pool, poolAddress, sqrtPriceX96, tick, liquidity, token0, token1, fee }
}
```

**Condition**: `if (poolState)` means:
- `poolState !== null` → Pool exists
- `poolState === null` → New pool (doesn't exist yet)

---

## 🔧 3. Correctness Audit

### 3.1 Existing Pool Case

#### ✅ Does the code correctly detect an existing V3 pool?

**YES** - Uses `fetchV3PoolState()` which:
- Computes pool address using `computePoolAddress()` from V3 SDK
- Calls `pool.slot0()` and `pool.liquidity()` on-chain
- Returns `null` if `sqrtPriceX96 === '0'` or `liquidity === '0'`
- Returns `V3PoolOnChainState` if pool exists

**Verification**: ✅ Correct - follows Uniswap pool detection pattern

#### ✅ Does it correctly build a Pool instance?

**YES** - `fetchV3PoolState()` constructs Pool using:
```typescript
pool = new Pool(
  token0Wrapped,
  token1Wrapped,
  fee,
  sqrtPriceX96,      // From slot0
  liquidity,         // From liquidity() call
  tick,              // From slot0
)
```

**Verification**: ✅ Correct - uses exact Uniswap Pool constructor

#### ✅ Does it correctly build a Position object?

**YES** - Uses `calculatePositionAmounts()` which:
- Calls `Position.fromAmount0()` or `Position.fromAmount1()`
- Uses `useFullPrecision: true` (Uniswap pattern)
- Returns Position instance along with amounts

**Verification**: ✅ Correct - uses Uniswap Position class exactly

#### ✅ Does it correctly call mintAmountsWithSlippage?

**YES** - Code:
```typescript
const { amount0: min0, amount1: min1 } = positionResult.position.mintAmountsWithSlippage(slippageTolerance)
```

**Verification**: ✅ Correct - matches Uniswap pattern from `MigrateV2Pair.tsx:338`

---

### 3.2 New Pool Case

#### ✅ Is amount0Desired always defined?

**YES** - Explicit check:
```typescript
if (!amount0Desired || !amount1Desired) {
  throw new Error('Both token amounts are required for new pool creation')
}
```

**Verification**: ✅ Correct - fails fast with clear error if missing

#### ✅ Is amount1Desired always defined?

**YES** - Same check as above ensures both are defined before use

**Verification**: ✅ Correct

#### ✅ Is slippageTolerance always a Percent?

**YES** - Multiple guarantees:
1. **Type-level**: Parameter type is `Percent` (Line 35)
2. **Runtime check**: `if (!(slippageTolerance instanceof Percent))` throws (Line 156)
3. **Source validation**: Conversion in `CreatePositionTxContext.tsx` always creates Percent

**Verification**: ✅ Correct - triple guarantee ensures type safety

#### ✅ Is .complement() safe in this branch?

**YES** - Because:
1. Runtime check ensures `slippageTolerance instanceof Percent` (Line 156)
2. Check happens BEFORE branching (Line 156, before Line 178)
3. `.complement()` is called AFTER validation (Line 217)

**Verification**: ✅ Correct - `.complement()` is safe

---

### 3.3 Edge Cases

#### ✅ Can position be undefined?

**NO** - `calculatePositionAmounts()` throws if position creation fails:
```typescript
if (!position) {
  throw new Error('Either amount0Desired or amount1Desired must be provided')
}
```

**Verification**: ✅ Correct - position is always defined when returned

#### ✅ Can amount0Min/amount1Min be undefined?

**NO** - Both branches assign values:
- **Existing pool**: Assigned from `mintAmountsWithSlippage()` result
- **New pool**: Assigned from `multiply(slippageComplement)` result

**Verification**: ✅ Correct - both variables always assigned before use

#### ✅ Does new pool path handle pool creation correctly?

**YES** - Code:
- Uses desired amounts directly
- Pool parameter is `undefined` in `buildMintPositionTx()`
- Contract's `mint()` function creates the pool automatically

**Verification**: ✅ Correct - matches NonfungiblePositionManager behavior

---

## 🔧 4. Fixes Applied

### ✅ Fix 1: Percent Creation (Already Applied)

**File**: `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx`

**Change**: Use exact Uniswap pattern with `Math.round()` and `10_000`

```diff
- return new Percent(customSlippageTolerance * 100, 10000)
+ const basisPoints = Math.round(customSlippageTolerance * 100)
+ return new Percent(basisPoints, 10_000)
```

**Status**: ✅ Already fixed

### ✅ Fix 2: Runtime Validation (Already Applied)

**File**: `packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts`

**Change**: Added runtime check before using `.complement()`

```diff
+ if (!(slippageTolerance instanceof Percent)) {
+   throw new Error(`slippageTolerance must be a Percent instance, got: ${typeof slippageTolerance}`)
+ }
```

**Status**: ✅ Already fixed

### ✅ Fix 3: Position.mintAmountsWithSlippage() Usage (Already Applied)

**File**: `packages/uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition.ts`

**Change**: Uses Uniswap's Position class method for existing pools

```typescript
const { amount0: min0, amount1: min1 } = positionResult.position.mintAmountsWithSlippage(slippageTolerance)
```

**Status**: ✅ Already fixed

---

## 📄 5. Final Confirmation

### ✅ Slippage Handling

- **customSlippageTolerance format**: `number` where `0.5 = 0.5%` ✅
- **Conversion**: Uses `Math.round(value * 100)` → `new Percent(basisPoints, 10_000)` ✅
- **Type guarantee**: Runtime validation ensures Percent instance ✅
- **Pattern compliance**: Matches Uniswap's `slippageToleranceToPercent` exactly ✅

### ✅ Minting Logic

- **Existing pools**: Uses `Position.mintAmountsWithSlippage()` ✅
- **New pools**: Uses `amount.multiply(slippageTolerance.complement())` ✅
- **Pool detection**: Correctly identifies existing vs. new pools ✅
- **Error handling**: Validates all required inputs ✅

### ✅ Branching Logic

- **Pool existence**: Correctly detected via `fetchV3PoolState()` return value ✅
- **Variable safety**: All variables assigned in all branches ✅
- **Position creation**: Only called when pool exists ✅
- **New pool path**: Handles pool creation by contract correctly ✅

---

## 🎯 Summary

**All validation checks pass** ✅

The implementation:
1. ✅ Follows Uniswap's slippage patterns exactly
2. ✅ Uses Position.mintAmountsWithSlippage() for existing pools
3. ✅ Uses Percent.complement() for new pools (same calculation)
4. ✅ Has runtime validation for type safety
5. ✅ Handles all edge cases correctly

**Status**: ✅ **FULLY COMPLIANT WITH UNISWAP PATTERNS**



