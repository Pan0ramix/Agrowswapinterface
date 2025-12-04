/**
 * V3 LP On-Chain Service
 * 
 * Services for V3 concentrated liquidity position math and transaction building.
 * Uses @uniswap/v3-sdk for position calculations and builds transaction calldata
 * directly for NonfungiblePositionManager operations.
 */

import { Currency, CurrencyAmount, Percent, Token } from '@uniswap/sdk-core'
import { FeeAmount, Position, tickToPrice, nearestUsableTick, TICK_SPACINGS, Pool } from '@uniswap/v3-sdk'
import { Interface } from 'ethers/lib/utils'
import { PublicClient, type Address } from 'viem'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from '@uniswap/sdk-core'
import { getPositionManagerAddress } from 'uniswap/src/constants/v3Addresses'
import { AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { fetchV3PoolState } from 'uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain'
import { simulateTransaction } from '../utils/decodeRevertReason'
import { logger } from 'utilities/src/logger/logger'
import JSBI from 'jsbi'

/**
 * Transaction payload for LP operations
 */
export interface LpTransactionPayload {
  to: string
  data: string
  value: string // '0x0' for ERC20, or amount in wei for native token
  // Optional metadata for debugging/analytics (dev-only logging)
  callSequence?: string[]
  sqrtPriceX96?: string
}

/**
 * Parameters for minting a new position
 */
export interface BuildMintPositionParams {
  token0: Currency
  token1: Currency
  fee: FeeAmount
  tickLower: number
  tickUpper: number
  amount0Desired: CurrencyAmount<Currency>
  amount1Desired: CurrencyAmount<Currency>
  amount0Min: CurrencyAmount<Currency>
  amount1Min: CurrencyAmount<Currency>
  recipient: string // Will be cast to Address when encoding
  deadline: number
  chainId: EVMUniverseChainId
  pool?: Pool // Optional - will be fetched if not provided
  // When true, prepend createAndInitializePoolIfNecessary to the call sequence.
  createPool?: boolean
  // Required when createPool is true. Expected to be a decimal string.
  sqrtPriceX96?: string
}

/**
 * Parameters for increasing liquidity in an existing position
 */
export interface BuildIncreaseLiquidityParams {
  tokenId: number | string
  amount0Desired: CurrencyAmount<Currency>
  amount1Desired: CurrencyAmount<Currency>
  amount0Min: CurrencyAmount<Currency>
  amount1Min: CurrencyAmount<Currency>
  deadline: number
  chainId: EVMUniverseChainId
}

/**
 * Parameters for decreasing liquidity in a position
 */
export interface BuildDecreaseLiquidityParams {
  tokenId: number | string
  liquidity: string // Raw liquidity amount
  amount0Min: CurrencyAmount<Currency>
  amount1Min: CurrencyAmount<Currency>
  deadline: number
  chainId: EVMUniverseChainId
}

/**
 * Parameters for collecting fees from a position
 */
export interface BuildCollectFeesParams {
  tokenId: number | string
  recipient: string
  amount0Max?: string // '0xffffffffffffffffffffffffffffffff' for max
  amount1Max?: string // '0xffffffffffffffffffffffffffffffff' for max
  chainId: EVMUniverseChainId
}

/**
 * Get Position Manager address
 */
function getPositionManagerContractAddress(chainId: EVMUniverseChainId): string {
  // Try Agroswap addresses first
  if (chainId === 84532) {
    const address = AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId as keyof typeof AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES]
    if (address) {
      return address
    }
  }

  // Try v3Addresses override
  const v3Address = getPositionManagerAddress(chainId)
  if (v3Address) {
    return v3Address
  }

  // Fall back to SDK addresses
  const sdkAddress = NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId as keyof typeof NONFUNGIBLE_POSITION_MANAGER_ADDRESSES]
  if (!sdkAddress) {
    throw new Error(`Position Manager address not found for chain ${chainId}`)
  }
  return sdkAddress
}

/**
 * NonfungiblePositionManager ABI
 * Based on @uniswap/v3-periphery contracts
 */
const NONFUNGIBLE_POSITION_MANAGER_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'token0', type: 'address' },
      { internalType: 'address', name: 'token1', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
      { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
    ],
    name: 'createAndInitializePoolIfNecessary',
    outputs: [{ internalType: 'address', name: 'pool', type: 'address' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'token0', type: 'address' },
          { internalType: 'address', name: 'token1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickLower', type: 'int24' },
          { internalType: 'int24', name: 'tickUpper', type: 'int24' },
          { internalType: 'uint256', name: 'amount0Desired', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Desired', type: 'uint256' },
          { internalType: 'uint256', name: 'amount0Min', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Min', type: 'uint256' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
        ],
        internalType: 'struct INonfungiblePositionManager.MintParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'mint',
    outputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
          { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
          { internalType: 'uint256', name: 'amount0Min', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Min', type: 'uint256' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
        ],
        internalType: 'struct INonfungiblePositionManager.IncreaseLiquidityParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'increaseLiquidity',
    outputs: [
      { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
          { internalType: 'uint128', name: 'liquidity', type: 'uint128' },
          { internalType: 'uint256', name: 'amount0Min', type: 'uint256' },
          { internalType: 'uint256', name: 'amount1Min', type: 'uint256' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
        ],
        internalType: 'struct INonfungiblePositionManager.DecreaseLiquidityParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'decreaseLiquidity',
    outputs: [
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint128', name: 'amount0Max', type: 'uint128' },
          { internalType: 'uint128', name: 'amount1Max', type: 'uint128' },
        ],
        internalType: 'struct INonfungiblePositionManager.CollectParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'collect',
    outputs: [
      { internalType: 'uint256', name: 'amount0', type: 'uint256' },
      { internalType: 'uint256', name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes[]',
        name: 'data',
        type: 'bytes[]',
      },
    ],
    name: 'multicall',
    outputs: [
      {
        internalType: 'bytes[]',
        name: 'results',
        type: 'bytes[]',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
]

/**
 * Validate mint parameters before building transaction
 */
function validateMintParams(params: BuildMintPositionParams): void {
  const { token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min } = params

  // Validate amounts are positive
  if (amount0Desired.quotient <= 0n || amount1Desired.quotient <= 0n) {
    throw new Error('amount0Desired and amount1Desired must be greater than 0')
  }

  // Validate minimum amounts are non-negative
  if (amount0Min.quotient < 0n || amount1Min.quotient < 0n) {
    throw new Error('amount0Min and amount1Min must be non-negative')
  }

  // Validate tick range
  if (tickLower >= tickUpper) {
    throw new Error(`Invalid tick range: tickLower (${tickLower}) must be less than tickUpper (${tickUpper})`)
  }

  // Validate tick spacing
  const tickSpacing = TICK_SPACINGS[fee]
  if (!tickSpacing) {
    throw new Error(`Invalid fee tier: ${fee}. Supported fees: 100, 500, 3000, 10000`)
  }
  // Ticks must be multiples of tickSpacing
  // Use Math.abs to handle negative ticks correctly (tickLower can be negative)
  if (Math.abs(tickLower) % tickSpacing !== 0 || Math.abs(tickUpper) % tickSpacing !== 0) {
    throw new Error(
      `Invalid tick spacing: ticks must be multiples of ${tickSpacing} for fee tier ${fee}. tickLower: ${tickLower}, tickUpper: ${tickUpper}`,
    )
  }

  // Validate tokens are different
  if (token0.wrapped.address.toLowerCase() === token1.wrapped.address.toLowerCase()) {
    throw new Error('token0 and token1 must be different')
  }

  // Validate amounts are not swapped (token order should match)
  // This is handled by token sorting below, but we check here for clarity
}

export async function buildMintPositionTx(
  params: BuildMintPositionParams & { publicClient: PublicClient },
): Promise<LpTransactionPayload> {
  const {
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min,
    amount1Min,
    recipient,
    deadline,
    chainId,
    pool,
    publicClient,
    createPool,
    sqrtPriceX96,
  } = params

  // Validate all parameters before proceeding
  validateMintParams(params)

  const positionManagerAddress = getPositionManagerContractAddress(chainId) as Address
  const positionManagerInterface = new Interface(NONFUNGIBLE_POSITION_MANAGER_ABI)

  // Get or fetch pool to ensure tokens are ordered correctly
  // Note: For new pools, pool may be undefined - that's OK, the contract will create it
  let poolState = pool
  if (!poolState) {
    const fetched = await fetchV3PoolState({
      tokenIn: token0,
      tokenOut: token1,
      fee,
      chainId,
      publicClient,
    })
    poolState = fetched?.pool
  }

  // Ensure tokens are in correct order (token0 < token1 by address)
  const token0Wrapped = token0.wrapped
  const token1Wrapped = token1.wrapped
  const tokensNeedSwap = !token0Wrapped.sortsBefore(token1Wrapped)
  const [finalToken0, finalToken1, finalAmount0, finalAmount1, finalAmount0Min, finalAmount1Min] =
    tokensNeedSwap
      ? [token1Wrapped, token0Wrapped, amount1Desired, amount0Desired, amount1Min, amount0Min]
      : [token0Wrapped, token1Wrapped, amount0Desired, amount1Desired, amount0Min, amount1Min]

  // Dev-only: log token sorting and amount mapping
  if (process.env.NODE_ENV !== 'production') {
    console.log('[buildMintPositionTx] Token sorting and amount mapping', {
      inputToken0: {
        address: token0.address,
        symbol: token0.symbol,
        decimals: token0.decimals,
      },
      inputToken1: {
        address: token1.address,
        symbol: token1.symbol,
        decimals: token1.decimals,
      },
      tokensNeedSwap,
      inputAmount0Desired: {
        raw: amount0Desired.quotient.toString(),
        human: amount0Desired.toExact(),
        currency: amount0Desired.currency.symbol,
      },
      inputAmount1Desired: {
        raw: amount1Desired.quotient.toString(),
        human: amount1Desired.toExact(),
        currency: amount1Desired.currency.symbol,
      },
      inputAmount0Min: {
        raw: amount0Min.quotient.toString(),
        human: amount0Min.toExact(),
        currency: amount0Min.currency.symbol,
      },
      inputAmount1Min: {
        raw: amount1Min.quotient.toString(),
        human: amount1Min.toExact(),
        currency: amount1Min.currency.symbol,
      },
      finalToken0: {
        address: finalToken0.address,
        symbol: finalToken0.symbol,
        decimals: finalToken0.decimals,
      },
      finalToken1: {
        address: finalToken1.address,
        symbol: finalToken1.symbol,
        decimals: finalToken1.decimals,
      },
      finalAmount0Desired: {
        raw: finalAmount0.quotient.toString(),
        human: finalAmount0.toExact(),
        currency: finalAmount0.currency.symbol,
      },
      finalAmount1Desired: {
        raw: finalAmount1.quotient.toString(),
        human: finalAmount1.toExact(),
        currency: finalAmount1.currency.symbol,
      },
      finalAmount0Min: {
        raw: finalAmount0Min.quotient.toString(),
        human: finalAmount0Min.toExact(),
        currency: finalAmount0Min.currency.symbol,
      },
      finalAmount1Min: {
        raw: finalAmount1Min.quotient.toString(),
        human: finalAmount1Min.toExact(),
        currency: finalAmount1Min.currency.symbol,
      },
    })
  }

  // Validate pool exists OR we're creating a new pool via createAndInitializePoolIfNecessary
  // For create path, mint will be wrapped in multicall with create/initialize first
  if (poolState) {
    // Pool exists - validate it matches our tokens and fee
    if (
      poolState.token0.address.toLowerCase() !== finalToken0.address.toLowerCase() ||
      poolState.token1.address.toLowerCase() !== finalToken1.address.toLowerCase() ||
      poolState.fee !== fee
    ) {
      throw new Error('Pool state does not match provided tokens and fee')
    }
  }

  // Build mint params
  const mintParams = {
    token0: finalToken0.address as Address,
    token1: finalToken1.address as Address,
    fee,
    tickLower,
    tickUpper,
    amount0Desired: finalAmount0.quotient.toString(),
    amount1Desired: finalAmount1.quotient.toString(),
    amount0Min: finalAmount0Min.quotient.toString(),
    amount1Min: finalAmount1Min.quotient.toString(),
    recipient: recipient as Address,
    deadline,
  }

  // Dev-only: log final mint params before encoding
  if (process.env.NODE_ENV !== 'production') {
    console.log('[buildMintPositionTx] Final MintParams (before encoding)', {
      token0: mintParams.token0,
      token1: mintParams.token1,
      fee: mintParams.fee,
      tickLower: mintParams.tickLower,
      tickUpper: mintParams.tickUpper,
      amount0Desired: mintParams.amount0Desired,
      amount1Desired: mintParams.amount1Desired,
      amount0Min: mintParams.amount0Min,
      amount1Min: mintParams.amount1Min,
      recipient: mintParams.recipient,
      deadline: mintParams.deadline,
      validation: {
        amount0MinLessThanDesired: BigInt(mintParams.amount0Min) <= BigInt(mintParams.amount0Desired),
        amount1MinLessThanDesired: BigInt(mintParams.amount1Min) <= BigInt(mintParams.amount1Desired),
        amount0DesiredGTZero: BigInt(mintParams.amount0Desired) > 0n,
        amount1DesiredGTZero: BigInt(mintParams.amount1Desired) > 0n,
      },
    })
  }

  // Encode function call(s)
  const mintCalldata = positionManagerInterface.encodeFunctionData('mint', [mintParams]) as `0x${string}`

  let data: `0x${string}`
  const callSequence: string[] = []

  // When creating a new pool, prepend createAndInitializePoolIfNecessary via multicall
  if (createPool) {
    if (!sqrtPriceX96) {
      throw new Error('sqrtPriceX96 is required when createPool is true')
    }

    const createCalldata = positionManagerInterface.encodeFunctionData('createAndInitializePoolIfNecessary', [
      finalToken0.address,
      finalToken1.address,
      fee,
      BigInt(sqrtPriceX96),
    ]) as `0x${string}`

    data = positionManagerInterface.encodeFunctionData('multicall', [[createCalldata, mintCalldata]]) as `0x${string}`
    callSequence.push('createAndInitializePoolIfNecessary', 'mint')
  } else {
    data = mintCalldata
    callSequence.push('mint')
  }

  // Dev-only: log final calldata AFTER encoding
  if (process.env.NODE_ENV !== 'production') {
    console.log('[buildMintPositionTx] Final calldata AFTER encoding', {
      calldata: data,
      calldataLength: data.length,
      functionName: 'mint',
      mintParams: {
        token0: mintParams.token0,
        token1: mintParams.token1,
        fee: mintParams.fee,
        tickLower: mintParams.tickLower,
        tickUpper: mintParams.tickUpper,
        amount0Desired: mintParams.amount0Desired.toString(),
        amount1Desired: mintParams.amount1Desired.toString(),
        amount0Min: mintParams.amount0Min.toString(),
        amount1Min: mintParams.amount1Min.toString(),
        recipient: mintParams.recipient,
        deadline: mintParams.deadline.toString(),
      },
      summary: {
        'amount0Desired (raw)': mintParams.amount0Desired.toString(),
        'amount1Desired (raw)': mintParams.amount1Desired.toString(),
        'amount0Min (raw)': mintParams.amount0Min.toString(),
        'amount1Min (raw)': mintParams.amount1Min.toString(),
        'amount0Min < amount0Desired': BigInt(mintParams.amount0Min) <= BigInt(mintParams.amount0Desired),
        'amount1Min < amount1Desired': BigInt(mintParams.amount1Min) <= BigInt(mintParams.amount1Desired),
      },
    })
  }

  // Determine value (native token amount if either token is native)
  // For native tokens, the value should be the amount being sent
  // Note: We use finalAmount0/finalAmount1 which are already sorted correctly
  const value =
    finalToken0.isNative || finalToken1.isNative
      ? BigInt(finalToken0.isNative ? finalAmount0.quotient.toString() : finalAmount1.quotient.toString())
      : 0n

  const txPayload: LpTransactionPayload = {
    to: positionManagerAddress,
    data,
    value: value !== 0n ? `0x${value.toString(16)}` : '0x0',
    callSequence,
    sqrtPriceX96: createPool ? sqrtPriceX96 : undefined,
  }

  // Additional validation: ensure deadline is in the future
  const currentTimestamp = Math.floor(Date.now() / 1000)
  if (deadline <= currentTimestamp) {
    throw new Error(`Deadline must be in the future. Current: ${currentTimestamp}, Deadline: ${deadline}`)
  }

  // Log mint parameters for debugging (development only)
  if (process.env.NODE_ENV !== 'production') {
    const deadlineDiff = deadline - currentTimestamp
    logger.info('buildMintPositionTx', 'buildMintPositionTx', 'Built mint transaction', {
      extra: {
        token0: finalToken0.symbol,
        token1: finalToken1.symbol,
        fee,
        tickLower,
        tickUpper,
        amount0Desired: finalAmount0.quotient.toString(),
        amount1Desired: finalAmount1.quotient.toString(),
        amount0Min: finalAmount0Min.quotient.toString(),
        amount1Min: finalAmount1Min.quotient.toString(),
        recipient,
        deadline,
        currentTimestamp,
        deadlineDiff,
        poolExists: !!poolState,
        value: value.toString(),
      },
    })
  }

  return txPayload
}

/**
 * Build increase liquidity transaction payload
 */
export function buildIncreaseLiquidityTx(
  params: BuildIncreaseLiquidityParams,
): LpTransactionPayload {
  const { tokenId, amount0Desired, amount1Desired, amount0Min, amount1Min, deadline, chainId } =
    params

  const positionManagerAddress = getPositionManagerContractAddress(chainId) as `0x${string}`
  const positionManagerInterface = new Interface(NONFUNGIBLE_POSITION_MANAGER_ABI)

  // Calculate liquidity from amounts (this is simplified - in practice you'd use Position SDK methods)
  // For now, we'll need to pass liquidity separately or calculate it from the position
  // This is a placeholder - actual implementation would fetch position details first
  const liquidity = '0' // Would be calculated from position

  const increaseParams = {
    tokenId: BigInt(tokenId).toString(),
    liquidity,
    amount0Min: amount0Min.quotient.toString(),
    amount1Min: amount1Min.quotient.toString(),
    deadline,
  }

  const data = positionManagerInterface.encodeFunctionData('increaseLiquidity', [
    increaseParams,
  ]) as `0x${string}`

  // Value is typically 0 for increase liquidity unless native token is involved
  const value = '0x0'

  return {
    to: positionManagerAddress,
    data,
    value,
  }
}

/**
 * Build decrease liquidity transaction payload
 */
export function buildDecreaseLiquidityTx(
  params: BuildDecreaseLiquidityParams,
): LpTransactionPayload {
  const { tokenId, liquidity, amount0Min, amount1Min, deadline, chainId } = params

  const positionManagerAddress = getPositionManagerContractAddress(chainId) as `0x${string}`
  const positionManagerInterface = new Interface(NONFUNGIBLE_POSITION_MANAGER_ABI)

  const decreaseParams = {
    tokenId: BigInt(tokenId).toString(),
    liquidity,
    amount0Min: amount0Min.quotient.toString(),
    amount1Min: amount1Min.quotient.toString(),
    deadline,
  }

  const data = positionManagerInterface.encodeFunctionData('decreaseLiquidity', [
    decreaseParams,
  ]) as `0x${string}`

  return {
    to: positionManagerAddress,
    data,
    value: '0x0',
  }
}

/**
 * Build collect fees transaction payload
 */
export function buildCollectFeesTx(params: BuildCollectFeesParams): LpTransactionPayload {
  const {
    tokenId,
    recipient,
    amount0Max = '0xffffffffffffffffffffffffffffffff', // Max uint128
    amount1Max = '0xffffffffffffffffffffffffffffffff', // Max uint128
    chainId,
  } = params

  const positionManagerAddress = getPositionManagerContractAddress(chainId) as `0x${string}`
  const positionManagerInterface = new Interface(NONFUNGIBLE_POSITION_MANAGER_ABI)

  const collectParams = {
    tokenId: BigInt(tokenId).toString(),
    recipient: recipient as `0x${string}`,
    amount0Max,
    amount1Max,
  }

  const data = positionManagerInterface.encodeFunctionData('collect', [collectParams]) as `0x${string}`

  return {
    to: positionManagerAddress,
    data,
    value: '0x0',
  }
}

/**
 * Helper to calculate position amounts from price range
 * Uses V3 SDK Position class for accurate calculations
 * Returns Position instance for slippage calculations
 */
export function calculatePositionAmounts(
  pool: Pool,
  tickLower: number,
  tickUpper: number,
  amount0Desired?: CurrencyAmount<Currency>,
  amount1Desired?: CurrencyAmount<Currency>,
): {
  amount0: CurrencyAmount<Currency>
  amount1: CurrencyAmount<Currency>
  liquidity: string
  position: Position
} {
  // Create a Position instance
  const position = amount0Desired
    ? Position.fromAmount0({
        pool,
        tickLower,
        tickUpper,
        amount0: amount0Desired,
        useFullPrecision: true,
      })
    : amount1Desired
      ? Position.fromAmount1({
          pool,
          tickLower,
          tickUpper,
          amount1: amount1Desired,
          useFullPrecision: true,
        })
      : null

  if (!position) {
    throw new Error('Either amount0Desired or amount1Desired must be provided')
  }

  return {
    amount0: position.amount0,
    amount1: position.amount1,
    liquidity: position.liquidity.toString(),
    position,
  }
}

/**
 * Helper to get nearest usable ticks based on tick spacing
 */
export function getNearestUsableTicks(
  tickLower: number,
  tickUpper: number,
  fee: FeeAmount,
): { tickLower: number; tickUpper: number } {
  const tickSpacing = TICK_SPACINGS[fee]
  return {
    tickLower: nearestUsableTick(tickLower, tickSpacing),
    tickUpper: nearestUsableTick(tickUpper, tickSpacing),
  }
}

