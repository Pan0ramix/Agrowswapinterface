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
import { PublicClient } from 'viem'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from '@uniswap/sdk-core'
import { getPositionManagerAddress } from 'uniswap/src/constants/v3Addresses'
import { AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { fetchV3PoolState } from 'uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain'
import JSBI from 'jsbi'

/**
 * Transaction payload for LP operations
 */
export interface LpTransactionPayload {
  to: string
  data: string
  value: string // '0x0' for ERC20, or amount in wei for native token
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
  recipient: string
  deadline: number
  chainId: EVMUniverseChainId
  pool?: Pool // Optional - will be fetched if not provided
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
]

/**
 * Build mint position transaction payload
 */
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
  } = params

  const positionManagerAddress = getPositionManagerContractAddress(chainId) as `0x${string}`
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
    // If pool doesn't exist, that's OK - NonfungiblePositionManager.mint will create it
    // We'll just use the tokens as-is for ordering
    poolState = fetched?.pool
  }

  // Ensure tokens are in correct order
  const token0Wrapped = token0.wrapped
  const token1Wrapped = token1.wrapped
  const [finalToken0, finalToken1, finalAmount0, finalAmount1, finalAmount0Min, finalAmount1Min] =
    token0Wrapped.sortsBefore(token1Wrapped)
      ? [token0Wrapped, token1Wrapped, amount0Desired, amount1Desired, amount0Min, amount1Min]
      : [token1Wrapped, token0Wrapped, amount1Desired, amount0Desired, amount1Min, amount0Min]

  // Build mint params
  const mintParams = {
    token0: finalToken0.address as `0x${string}`,
    token1: finalToken1.address as `0x${string}`,
    fee,
    tickLower,
    tickUpper,
    amount0Desired: finalAmount0.quotient.toString(),
    amount1Desired: finalAmount1.quotient.toString(),
    amount0Min: finalAmount0Min.quotient.toString(),
    amount1Min: finalAmount1Min.quotient.toString(),
    recipient: recipient as `0x${string}`,
    deadline,
  }

  // Encode function call
  const data = positionManagerInterface.encodeFunctionData('mint', [mintParams]) as `0x${string}`

  // Determine value (native token amount if either token is native)
  const value =
    token0.isNative || token1.isNative
      ? (token0.isNative ? amount0Desired.quotient.toString() : amount1Desired.quotient.toString())
      : '0'

  return {
    to: positionManagerAddress,
    data,
    value: value !== '0' ? `0x${BigInt(value).toString(16)}` : '0x0',
  }
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

