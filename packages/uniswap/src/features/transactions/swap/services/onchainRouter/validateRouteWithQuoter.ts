/**
 * Route Validation with QuoterV2
 *
 * Validates candidate routes by calling QuoterV2 contract.
 * Routes that revert are discarded, only successful quotes are kept.
 */

import { Currency, CurrencyAmount, QUOTER_ADDRESSES, Token } from '@uniswap/sdk-core'
import { Pool } from '@uniswap/v3-sdk'
import { Interface } from 'ethers/lib/utils'
import JSBI from 'jsbi'
import { AGROSWAP_QUOTER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { getQuoterV2Address, getV3FactoryAddress } from 'uniswap/src/constants/v3Addresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { decodeQuoterRevert } from 'uniswap/src/features/transactions/swap/utils/decodeQuoterRevert'
import { logger } from 'utilities/src/logger/logger'
import { Address, PublicClient } from 'viem'
import { CandidateRoute } from 'uniswap/src/features/transactions/swap/services/onchainRouter/generateCandidateRoutes'

// ABI for checking token restrictions (ERC20Restricted from OpenZeppelin)
const RESTRICTION_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'isUserAllowed',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

/**
 * Validated route with quote result
 * Supports both exact input (amountOut) and exact output (amountIn)
 */
export interface ValidatedRoute {
  route: CandidateRoute
  amountIn?: string // Raw amount in from quote (for exact output)
  amountInCurrency?: CurrencyAmount<Currency> // Parsed amount in (for exact output)
  amountOut?: string // Raw amount out from quote (for exact input)
  amountOutCurrency?: CurrencyAmount<Currency> // Parsed amount out (for exact input)
  sqrtPriceX96After?: string
  initializedTicksCrossed?: number
  gasEstimate?: string
}

/**
 * QuoterV2 ABI
 */
const QUOTER_V2_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct IQuoterV2.QuoteExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      { internalType: 'uint160', name: 'sqrtPriceX96After', type: 'uint160' },
      { internalType: 'uint32', name: 'initializedTicksCrossed', type: 'uint32' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: 'path',
        type: 'bytes',
      },
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
    ],
    name: 'quoteExactInput',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      { internalType: 'uint160[]', name: 'sqrtPriceX96AfterList', type: 'uint160[]' },
      { internalType: 'uint32[]', name: 'initializedTicksCrossedList', type: 'uint32[]' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct IQuoterV2.QuoteExactOutputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactOutputSingle',
    outputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint160', name: 'sqrtPriceX96After', type: 'uint160' },
      { internalType: 'uint32', name: 'initializedTicksCrossed', type: 'uint32' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const V3_FACTORY_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
    ],
    name: 'getPool',
    outputs: [{ internalType: 'address', name: 'pool', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const V3_POOL_ABI = [
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
      { internalType: 'int24', name: 'tick', type: 'int24' },
      { internalType: 'uint16', name: 'observationIndex', type: 'uint16' },
      { internalType: 'uint16', name: 'observationCardinality', type: 'uint16' },
      { internalType: 'uint16', name: 'observationCardinalityNext', type: 'uint16' },
      { internalType: 'uint8', name: 'feeProtocol', type: 'uint8' },
      { internalType: 'bool', name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'fee',
    outputs: [{ internalType: 'uint24', name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tickSpacing',
    outputs: [{ internalType: 'int24', name: '', type: 'int24' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

async function getPoolAddress(
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fee: number,
): Promise<`0x${string}` | null> {
  const factory = getV3FactoryAddress(chainId)
  if (!factory) {
    return null
  }
  try {
    const pool = (await publicClient.readContract({
      address: factory as `0x${string}`,
      abi: V3_FACTORY_ABI as any,
      functionName: 'getPool',
      args: [tokenIn, tokenOut, BigInt(fee)],
    })) as `0x${string}`

    if (!pool || pool === '0x0000000000000000000000000000000000000000') {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('validateRouteWithQuoter', 'getPoolAddress', 'No pool for pair/fee', {
          tokenIn,
          tokenOut,
          fee,
          chainId,
        })
      }
      return null
    }
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'getPoolAddress', 'Found pool', {
        tokenIn,
        tokenOut,
        fee,
        chainId,
        pool,
      })
    }
    return pool
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'getPoolAddress', 'Error reading pool', {
        tokenIn,
        tokenOut,
        fee,
        chainId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  }
}

/**
 * Get Quoter contract address
 */
function getQuoterAddress(chainId: EVMUniverseChainId): string {
  // Try Agroswap addresses first
  if (chainId === 84532) {
    const agroswapAddress = AGROSWAP_QUOTER_ADDRESSES[chainId as keyof typeof AGROSWAP_QUOTER_ADDRESSES]
    if (agroswapAddress) {
      return agroswapAddress
    }
  }

  // Try V3 addresses override
  const v3Address = getQuoterV2Address(chainId)
  if (v3Address) {
    return v3Address
  }

  // Fall back to SDK addresses
  const sdkAddress = QUOTER_ADDRESSES[chainId as keyof typeof QUOTER_ADDRESSES]
  if (!sdkAddress) {
    throw new Error(`Quoter address not found for chain ${chainId}`)
  }
  return sdkAddress
}

/**
 * Encode path for multi-hop quote
 * Format: address | fee | address | fee | address
 */
function encodePath(hops: CandidateRoute['hops']): `0x${string}` {
  let path = '0x'
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i]
    if (!hop) continue

    // Remove '0x' prefix and pad to 40 characters (20 bytes)
    const address = hop.tokenIn.address.slice(2).toLowerCase().padStart(40, '0')
    path += address

    // Add fee (3 bytes = 6 hex chars)
    const feeHex = hop.fee.toString(16).padStart(6, '0')
    path += feeHex

    // Add last token address
    if (i === hops.length - 1) {
      const lastAddress = hop.tokenOut.address.slice(2).toLowerCase().padStart(40, '0')
      path += lastAddress
    }
  }
  return path as `0x${string}`
}

/**
 * Quote a single hop
 */
async function quoteSingleHop(
  hop: CandidateRoute['hops'][0],
  amountIn: CurrencyAmount<Currency>,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  rpcLabel?: string,
  rpcOrigin?: string,
  quoterAllowed?: boolean, // If false, skip quoter call for restricted tokens
): Promise<{
  amountOut: string
  sqrtPriceX96After: string
  initializedTicksCrossed: number
  gasEstimate: string
} | null> {
  // Pre-check pool existence to avoid quoter reverts for non-existent fee tiers
  const pool = await getPoolAddress(
    chainId,
    publicClient,
    hop.tokenIn.address as `0x${string}`,
    hop.tokenOut.address as `0x${string}`,
    hop.fee,
  )
  if (!pool) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'Skipped: pool does not exist', {
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
      })
    }
    return null
  }

  // Step C: Verify pool is actually quoteable (on-chain reads)
  // Read all pool state before attempting quote
  let poolState: {
    token0: string
    token1: string
    fee: number
    tickSpacing: number | undefined
    liquidity: string
    sqrtPriceX96: string
    tick: number
  } | null = null

  try {
    const poolInterface = new Interface(V3_POOL_ABI)
    const [slot0Data, liquidityData, token0Data, token1Data, feeData, tickSpacingData] = await Promise.all([
      publicClient.call({
        to: pool,
        data: poolInterface.encodeFunctionData('slot0') as `0x${string}`,
      }),
      publicClient.call({
        to: pool,
        data: poolInterface.encodeFunctionData('liquidity') as `0x${string}`,
      }),
      publicClient.call({
        to: pool,
        data: poolInterface.encodeFunctionData('token0') as `0x${string}`,
      }),
      publicClient.call({
        to: pool,
        data: poolInterface.encodeFunctionData('token1') as `0x${string}`,
      }),
      publicClient.call({
        to: pool,
        data: poolInterface.encodeFunctionData('fee') as `0x${string}`,
      }),
      publicClient
        .call({
          to: pool,
          data: poolInterface.encodeFunctionData('tickSpacing') as `0x${string}`,
        })
        .catch(() => ({ data: null })),
    ])

    if (slot0Data.data && liquidityData.data && token0Data.data && token1Data.data && feeData.data) {
      const slot0 = poolInterface.decodeFunctionResult('slot0', slot0Data.data)
      const liquidity = poolInterface.decodeFunctionResult('liquidity', liquidityData.data)[0]
      const token0 = poolInterface.decodeFunctionResult('token0', token0Data.data)[0] as string
      const token1 = poolInterface.decodeFunctionResult('token1', token1Data.data)[0] as string
      const poolFee = Number(poolInterface.decodeFunctionResult('fee', feeData.data)[0])
      const tickSpacing = tickSpacingData.data
        ? Number(poolInterface.decodeFunctionResult('tickSpacing', tickSpacingData.data)[0])
        : undefined

      poolState = {
        token0: token0.toLowerCase(),
        token1: token1.toLowerCase(),
        fee: poolFee,
        tickSpacing,
        liquidity: liquidity.toString(),
        sqrtPriceX96: slot0.sqrtPriceX96.toString(),
        tick: Number(slot0.tick),
      }

      // Step C: Log all pool state values
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        console.log('[QUOTER-DIAG] Step C: Pool state verified (on-chain reads)', {
          chainId,
          poolAddress: pool,
          computedPoolAddress: pool,
          token0: poolState.token0,
          token1: poolState.token1,
          fee: poolState.fee,
          expectedFee: hop.fee,
          feeMatch: poolState.fee === hop.fee,
          tickSpacing: poolState.tickSpacing,
          sqrtPriceX96: poolState.sqrtPriceX96,
          liquidity: poolState.liquidity,
          tick: poolState.tick,
          tokenOrdering: {
            tokenInIsToken0: hop.tokenIn.address.toLowerCase() === poolState.token0,
            tokenOutIsToken1: hop.tokenOut.address.toLowerCase() === poolState.token1,
            expectedOrder: `${poolState.token0} < ${poolState.token1}`,
            actualOrder: `${hop.tokenIn.address.toLowerCase()} -> ${hop.tokenOut.address.toLowerCase()}`,
          },
          poolInitialized: poolState.sqrtPriceX96 !== '0' && poolState.liquidity !== '0',
        })
      }

      // Check if pool is initialized and has liquidity
      if (poolState.sqrtPriceX96 === '0' || poolState.liquidity === '0') {
        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          console.warn('[QUOTER-DIAG] Step C: Pool not initialized / no liquidity', {
            fee: hop.fee,
            tokenIn: hop.tokenIn.symbol,
            tokenOut: hop.tokenOut.symbol,
            pool,
            sqrtPriceX96: poolState.sqrtPriceX96,
            liquidity: poolState.liquidity,
          })
          logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'Skipped: pool has no liquidity', {
            fee: hop.fee,
            tokenIn: hop.tokenIn.symbol,
            tokenOut: hop.tokenOut.symbol,
            tokenInAddress: hop.tokenIn.address,
            tokenOutAddress: hop.tokenOut.address,
            chainId,
            pool,
            sqrtPriceX96: poolState.sqrtPriceX96,
            liquidity: poolState.liquidity,
          })
        }
        return null
      }

      // Verify token ordering matches
      const tokenInLower = hop.tokenIn.address.toLowerCase()
      const tokenOutLower = hop.tokenOut.address.toLowerCase()
      const isTokenInToken0 = tokenInLower === poolState.token0
      const isTokenOutToken1 = tokenOutLower === poolState.token1

      if (
        !isTokenInToken0 &&
        !isTokenOutToken1 &&
        tokenInLower !== poolState.token1 &&
        tokenOutLower !== poolState.token0
      ) {
        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          console.error('[QUOTER-DIAG] Step C: Token ordering mismatch', {
            poolToken0: poolState.token0,
            poolToken1: poolState.token1,
            tokenIn: tokenInLower,
            tokenOut: tokenOutLower,
            isTokenInToken0,
            isTokenOutToken1,
          })
        }
      }

      // Verify fee matches
      if (poolState.fee !== hop.fee) {
        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          console.error('[QUOTER-DIAG] Step C: Fee mismatch', {
            poolFee: poolState.fee,
            expectedFee: hop.fee,
            pool,
          })
        }
      }
    }
  } catch (error) {
    // If we can't check pool state, proceed with quote attempt anyway
    // The quoter will fail if there's an issue
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      console.warn('[QUOTER-DIAG] Step C: Failed to read pool state, proceeding with quote', {
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        pool,
        error: error instanceof Error ? error.message : String(error),
        fullError: error,
      })
      logger.debug(
        'validateRouteWithQuoter',
        'quoteSingleHop',
        'Failed to check pool liquidity, proceeding with quote',
        {
          fee: hop.fee,
          tokenIn: hop.tokenIn.symbol,
          tokenOut: hop.tokenOut.symbol,
          pool,
          error: error instanceof Error ? error.message : String(error),
        },
      )
    }
  }

  if (JSBI.lessThanOrEqual(amountIn.quotient, JSBI.BigInt(0))) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'Skipped zero amountIn', {
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
      })
    }
    return null
  }

  // Step A: Log the exact quote call (before call) - comprehensive logging
  const quoterAddress = getQuoterAddress(chainId) as `0x${string}`
  const amountInRaw = BigInt(amountIn.quotient.toString())
  const quoteParams = {
    tokenIn: hop.tokenIn.address as `0x${string}`,
    tokenOut: hop.tokenOut.address as `0x${string}`,
    amountIn: amountInRaw,
    fee: BigInt(hop.fee),
    sqrtPriceLimitX96: BigInt(0),
  }

  // Get pool code length and compute pool address for verification
  let poolCodeLength: number | undefined
  let computedPoolAddress: string | undefined
  try {
    if (pool) {
      const poolCode = await publicClient.getBytecode({ address: pool })
      poolCodeLength = poolCode ? poolCode.length : 0
      computedPoolAddress = pool
    }
  } catch {
    poolCodeLength = 0
  }

  // C) Gate quoter calls - check if quoter is allowlisted for restricted tokens

  // If quoterAllowed is explicitly false, skip the quoter call
  if (quoterAllowed === false) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      console.log('[QUOTER-DIAG] Skipping quoter: not allowlisted for restricted token', {
        restrictedToken: hop.tokenOut.address, // tokenOut is likely the restricted token (CPRV1)
        quoterAddress,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        fee: hop.fee,
        chainId,
      })
      logger.debug('validateRouteWithQuoter', 'quoteSingleHop', '[QUOTER-DIAG] Skipping quoter: not allowlisted', {
        restrictedToken: hop.tokenOut.address,
        quoterAddress,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        fee: hop.fee,
        chainId,
      })
    }
    return null // Return null to indicate quote unavailable (will be treated as invalid route)
  }

  // If quoterAllowed is undefined, check directly if either token is restricted and quoter is not allowed
  // This is a fallback check in case quoterAllowed wasn't passed
  if (quoterAllowed === undefined && quoterAddress) {
    try {
      // Check if tokenOut is restricted (most common case - CPRV1 as output)
      const tokenOutIsAllowed = await publicClient
        .readContract({
          address: hop.tokenOut.address as Address,
          abi: RESTRICTION_ABI,
          functionName: 'isUserAllowed',
          args: [quoterAddress as Address],
        })
        .catch(() => true) // If call fails, assume not restricted or allowed

      if (tokenOutIsAllowed === false) {
        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          console.log('[QUOTER-DIAG] Skipping quoter: not allowlisted for restricted token (direct check)', {
            restrictedToken: hop.tokenOut.address,
            quoterAddress,
            tokenIn: hop.tokenIn.symbol,
            tokenOut: hop.tokenOut.symbol,
            fee: hop.fee,
            chainId,
          })
          logger.debug(
            'validateRouteWithQuoter',
            'quoteSingleHop',
            '[QUOTER-DIAG] Skipping quoter: not allowlisted (direct check)',
            {
              restrictedToken: hop.tokenOut.address,
              quoterAddress,
              tokenIn: hop.tokenIn.symbol,
              tokenOut: hop.tokenOut.symbol,
              fee: hop.fee,
              chainId,
            },
          )
        }
        return null
      }

      // Also check tokenIn if it might be restricted
      const tokenInIsAllowed = await publicClient
        .readContract({
          address: hop.tokenIn.address as Address,
          abi: RESTRICTION_ABI,
          functionName: 'isUserAllowed',
          args: [quoterAddress as Address],
        })
        .catch(() => true)

      if (tokenInIsAllowed === false) {
        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          console.log('[QUOTER-DIAG] Skipping quoter: not allowlisted for restricted token (direct check)', {
            restrictedToken: hop.tokenIn.address,
            quoterAddress,
            tokenIn: hop.tokenIn.symbol,
            tokenOut: hop.tokenOut.symbol,
            fee: hop.fee,
            chainId,
          })
          logger.debug(
            'validateRouteWithQuoter',
            'quoteSingleHop',
            '[QUOTER-DIAG] Skipping quoter: not allowlisted (direct check)',
            {
              restrictedToken: hop.tokenIn.address,
              quoterAddress,
              tokenIn: hop.tokenIn.symbol,
              tokenOut: hop.tokenOut.symbol,
              fee: hop.fee,
              chainId,
            },
          )
        }
        return null
      }
    } catch (error) {
      // If check fails, proceed with quote attempt (might not be restricted token)
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'Could not check quoter allowlist, proceeding', {
          error: error instanceof Error ? error.message : String(error),
          tokenIn: hop.tokenIn.address,
          tokenOut: hop.tokenOut.address,
        })
      }
    }
  }

  const quoterInterface = new Interface(QUOTER_V2_ABI)
  const callData = quoterInterface.encodeFunctionData('quoteExactInputSingle', [quoteParams]) as `0x${string}`
  const callDataSelector = callData.slice(0, 10) as `0x${string}`

  if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
    console.log('[QUOTER-DIAG] Step A: Exact quote call (before call)', {
      chainId,
      quoterAddress,
      methodName: 'quoteExactInputSingle',
      tokenIn: {
        address: hop.tokenIn.address,
        symbol: hop.tokenIn.symbol,
        decimals: hop.tokenIn.decimals,
      },
      tokenOut: {
        address: hop.tokenOut.address,
        symbol: hop.tokenOut.symbol,
        decimals: hop.tokenOut.decimals,
      },
      fee: hop.fee,
      amountIn: {
        raw: amountInRaw.toString(),
        exact: amountIn.toExact(),
        decimals: amountIn.currency.decimals,
      },
      sqrtPriceLimitX96: '0',
      computedPoolAddress: pool,
      poolCodeLength,
      encodedCalldata: {
        selector: callDataSelector,
        fullData: callData,
        dataLength: callData.length - 2, // Subtract '0x'
      },
      quoterABI: 'QuoterV2',
      quoterFunction: 'quoteExactInputSingle',
      quoterFunctionSignature: 'quoteExactInputSingle((address,address,uint256,uint24,uint160))',
      rpcMethod: 'eth_call',
      rpcLabel,
      rpcOrigin,
    })

    logger.debug('validateRouteWithQuoter', 'quoteSingleHop', '[QUOTER-DIAG] Calling QuoterV2', {
      chainId,
      quoterAddress,
      poolAddress: pool,
      functionName: 'quoteExactInputSingle',
      callParams: {
        tokenIn: hop.tokenIn.address,
        tokenOut: hop.tokenOut.address,
        tokenInSymbol: hop.tokenIn.symbol,
        tokenOutSymbol: hop.tokenOut.symbol,
        amountIn: amountInRaw.toString(),
        amountInExact: amountIn.toExact(),
        fee: hop.fee,
        sqrtPriceLimitX96: '0',
      },
      callData,
      callDataSelector,
      poolCodeLength,
      rpcMethod: 'call',
      rpcLabel,
      rpcOrigin,
    })
  }

  try {
    // Use publicClient.call() instead of readContract to get better error information
    // readContract may not expose revert data in the same way
    // callData was already computed above for logging
    const result = await publicClient.call({
      to: quoterAddress,
      data: callData,
    })

    if (!result.data) {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        console.error('[QUOTER-DIAG] Quoter returned no data', {
          chainId,
          quoterAddress,
          poolAddress: pool,
          callData,
          result,
        })
        logger.debug('validateRouteWithQuoter', 'quoteSingleHop', '[QUOTER-DIAG] Quoter returned no data', {
          chainId,
          quoterAddress,
          poolAddress: pool,
          callData,
        })
      }
      return null
    }

    const decoded = quoterInterface.decodeFunctionResult('quoteExactInputSingle', result.data)
    const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = decoded as any

    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHop', '[QUOTER-DIAG] Single-hop quote succeeded', {
        chainId,
        quoterAddress,
        poolAddress: pool,
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        amountOut: amountOut?.toString?.(),
        sqrtPriceX96After: sqrtPriceX96After?.toString?.(),
        initializedTicksCrossed: Number(initializedTicksCrossed),
        gasEstimate: gasEstimate?.toString?.(),
      })
    }

    return {
      amountOut: amountOut.toString(),
      sqrtPriceX96After: sqrtPriceX96After.toString(),
      initializedTicksCrossed: Number(initializedTicksCrossed),
      gasEstimate: gasEstimate.toString(),
    }
  } catch (error) {
    // Step B: Decode revert data properly (after revert)
    const revertInfo = decodeQuoterRevert(error, {
      chainId,
      quoterAddress,
      poolAddress: pool || undefined,
      tokenIn: hop.tokenIn.address,
      tokenOut: hop.tokenOut.address,
    })

    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      // Step B: Log decoded revert info
      const rawDataLength = revertInfo.rawData ? revertInfo.rawData.length - 2 : 0 // Subtract '0x'
      const rawDataPreview = revertInfo.rawData
        ? `${revertInfo.rawData.slice(0, 66)}${revertInfo.rawData.length > 66 ? '...' : ''}`
        : 'null'

      const isSTF = revertInfo.decoded.includes('STF') || revertInfo.decoded.includes('Safe transfer from failed')
      const isTransferError = isSTF || revertInfo.decoded.includes('TF') || revertInfo.decoded.includes('Transfer')

      console.error('[QUOTER-DIAG] Step B: Decoded revert data', {
        chainId,
        quoterAddress,
        poolAddress: pool,
        functionName: 'quoteExactInputSingle',
        callParams: quoteParams,
        callData,
        callDataSelector,
        revertDecoded: revertInfo.decoded,
        revertSelector: revertInfo.selector,
        isPanic: revertInfo.isPanic,
        isErrorString: revertInfo.isErrorString,
        rawRevertData: {
          preview: rawDataPreview,
          length: rawDataLength,
          full: revertInfo.rawData,
        },
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        rpcLabel,
        rpcOrigin,
        fullError: error,
        // Extract revert data from various error formats
        errorData: (error as any)?.data,
        errorCauseData: (error as any)?.cause?.data,
        errorInfoData: (error as any)?.info?.error?.data,
        errorShortMessage: (error as any)?.shortMessage,
        // STF/Transfer error diagnostics
        isTransferError,
        transferErrorDiagnosis: isTransferError
          ? {
              warning: '⚠️ Transfer error detected in Quoter call - this is abnormal',
              explanation: 'Quoter should NOT perform token transfers. This suggests:',
              possibleCauses: [
                'Wrong Quoter contract (using SwapRouter instead of Quoter?)',
                'Wrong ABI/function signature (calling swap function instead of quote?)',
                'Token restriction hook blocking even view calls',
                'Pool contract has non-standard behavior',
              ],
              quoterAddress,
              expectedQuoterAddress: '0x9B988c0B5720c3ab8a60a04e7C17126519AF64e4',
              quoterAddressMatch:
                quoterAddress.toLowerCase() === '0x9B988c0B5720c3ab8a60a04e7C17126519AF64e4'.toLowerCase(),
              functionName: 'quoteExactInputSingle',
              expectedFunctionSignature: 'quoteExactInputSingle((address,address,uint256,uint24,uint160))',
              callDataSelector,
            }
          : undefined,
      })

      // Also log to console for immediate visibility
      console.error('[QUOTER-DIAG] QuoterV2 reverted', {
        chainId,
        quoterAddress,
        poolAddress: pool,
        functionName: 'quoteExactInputSingle',
        callParams: quoteParams,
        revertDecoded: revertInfo.decoded,
        revertSelector: revertInfo.selector,
        isPanic: revertInfo.isPanic,
        isErrorString: revertInfo.isErrorString,
        rawRevertData: revertInfo.rawData,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        rpcLabel,
        rpcOrigin,
        fullError: error,
      })

      logger.error(error, {
        tags: { file: 'validateRouteWithQuoter', function: 'quoteSingleHop' },
        extra: {
          message: '[QUOTER-DIAG] QuoterV2 reverted',
          chainId,
          quoterAddress,
          poolAddress: pool,
          functionName: 'quoteExactInputSingle',
          callParams: quoteParams,
          revertDecoded: revertInfo.decoded,
          revertSelector: revertInfo.selector,
          isPanic: revertInfo.isPanic,
          isErrorString: revertInfo.isErrorString,
          rawRevertData: revertInfo.rawData,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          rpcLabel,
          rpcOrigin,
        },
      })
    }

    // Step 3: Determine if we should try SDK fallback
    // Only fallback if:
    // - Pool exists and has liquidity (already validated above)
    // - Revert is NOT a real execution failure (STF, TF, transfer restrictions)
    // - Revert is NOT a panic
    const shouldTrySDKFallback =
      pool !== null &&
      !revertInfo.decoded.includes('STF') &&
      !revertInfo.decoded.includes('TF') &&
      !revertInfo.decoded.includes('Transfer') &&
      !revertInfo.decoded.includes('UserNotAllowed') &&
      !revertInfo.decoded.includes('TransferRestricted') &&
      !revertInfo.isPanic

    if (shouldTrySDKFallback) {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('validateRouteWithQuoter', 'quoteSingleHop', '[QUOTER-DIAG] Trying SDK fallback', {
          chainId,
          quoterAddress,
          poolAddress: pool,
          fee: hop.fee,
          tokenIn: hop.tokenIn.symbol,
          tokenOut: hop.tokenOut.symbol,
          revertReason: revertInfo.decoded,
        })
      }

      // Fallback: Calculate quote using SDK Pool class directly from pool state
      try {
        const poolInterface = new Interface(V3_POOL_ABI)
        const [slot0Data, liquidityData] = await Promise.all([
          publicClient.call({
            to: pool!,
            data: poolInterface.encodeFunctionData('slot0') as `0x${string}`,
          }),
          publicClient.call({
            to: pool!,
            data: poolInterface.encodeFunctionData('liquidity') as `0x${string}`,
          }),
        ])

        if (slot0Data.data && liquidityData.data) {
          const slot0 = poolInterface.decodeFunctionResult('slot0', slot0Data.data)
          const liquidity = poolInterface.decodeFunctionResult('liquidity', liquidityData.data)[0]
          const sqrtPriceX96 = slot0.sqrtPriceX96
          const tick = Number(slot0.tick)

          // Check if pool has liquidity (using JSBI comparison for sqrtPriceX96)
          const sqrtPriceX96Zero = sqrtPriceX96 === BigInt(0)
          const liquidityZero = liquidity === BigInt(0)
          if (sqrtPriceX96Zero || liquidityZero) {
            if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
              logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'SDK fallback: pool has no liquidity', {
                fee: hop.fee,
                tokenIn: hop.tokenIn.symbol,
                tokenOut: hop.tokenOut.symbol,
                pool,
              })
            }
            return null
          }

          // Build Pool instance and calculate quote using SDK
          const tokenInWrapped = hop.tokenIn.wrapped as Token
          const tokenOutWrapped = hop.tokenOut.wrapped as Token
          const sdkPool = new Pool(
            tokenInWrapped,
            tokenOutWrapped,
            hop.fee,
            sqrtPriceX96.toString(),
            liquidity.toString(),
            tick,
          )

          // Calculate output amount using SDK Pool.getOutputAmount
          // Note: TypeScript types may indicate Promise, but SDK method is synchronous
          const amountInWrapped = CurrencyAmount.fromRawAmount(
            tokenInWrapped,
            amountIn.quotient.toString(),
          ) as CurrencyAmount<Token>

          // Call getOutputAmount - SDK method returns [CurrencyAmount, Pool] tuple synchronously
          // getOutputAmount returns [CurrencyAmount<Token>, Pool] tuple
          const outputResult = sdkPool.getOutputAmount(amountInWrapped)
          const amountOut = Array.isArray(outputResult) ? outputResult[0] : (outputResult as any)[0]

          if (!amountOut || !amountOut.quotient) {
            throw new Error(`SDK getOutputAmount returned invalid result: ${JSON.stringify(outputResult)}`)
          }

          if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
            logger.debug('validateRouteWithQuoter', 'quoteSingleHop', 'SDK fallback quote succeeded', {
              fee: hop.fee,
              tokenIn: hop.tokenIn.symbol,
              tokenOut: hop.tokenOut.symbol,
              amountInRaw: amountIn.quotient.toString(),
              amountOutRaw: amountOut.quotient.toString(),
              pool,
            })
          }

          // Return quote result in same format as quoter
          // Mark as estimated since it's from SDK, not Quoter
          if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
            logger.debug(
              'validateRouteWithQuoter',
              'quoteSingleHop',
              '[QUOTER-DIAG] SDK fallback quote succeeded (ESTIMATED)',
              {
                chainId,
                quoterAddress,
                poolAddress: pool,
                fee: hop.fee,
                tokenIn: hop.tokenIn.symbol,
                tokenOut: hop.tokenOut.symbol,
                amountInRaw: amountIn.quotient.toString(),
                amountOutRaw: amountOut.quotient.toString(),
                note: 'This is an estimated quote from SDK, not from Quoter contract',
              },
            )
          }

          return {
            amountOut: amountOut.quotient.toString(),
            sqrtPriceX96After: sqrtPriceX96.toString(), // Approximate - SDK doesn't give us the after price
            initializedTicksCrossed: 0, // SDK doesn't provide this
            gasEstimate: '0', // SDK doesn't provide gas estimate
          }
        }
      } catch (fallbackError) {
        // SDK fallback also failed
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)

        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          console.error('[QUOTER-DIAG] SDK fallback also failed', {
            chainId,
            quoterAddress,
            poolAddress: pool,
            fee: hop.fee,
            tokenIn: hop.tokenIn.symbol,
            tokenOut: hop.tokenOut.symbol,
            quoterRevert: revertInfo.decoded,
            quoterRevertSelector: revertInfo.selector,
            quoterRawRevertData: revertInfo.rawData,
            fallbackError: fallbackErrorMessage,
            fallbackErrorStack: fallbackError instanceof Error ? fallbackError.stack : undefined,
            fullFallbackError: fallbackError,
          })

          logger.error(fallbackError, {
            tags: { file: 'validateRouteWithQuoter', function: 'quoteSingleHop' },
            extra: {
              message: '[QUOTER-DIAG] SDK fallback also failed',
              chainId,
              quoterAddress,
              poolAddress: pool,
              fee: hop.fee,
              tokenIn: hop.tokenIn.symbol,
              tokenOut: hop.tokenOut.symbol,
              quoterRevert: revertInfo.decoded,
              quoterRevertSelector: revertInfo.selector,
              quoterRawRevertData: revertInfo.rawData,
              fallbackError: fallbackErrorMessage,
              fallbackErrorStack: fallbackError instanceof Error ? fallbackError.stack : undefined,
            },
          })
        }
      }
    }

    // Both quoter and SDK fallback failed (or fallback was not attempted)
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      console.error('[QUOTER-DIAG] Single-hop quote failed (no valid fallback)', {
        chainId,
        quoterAddress,
        poolAddress: pool,
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        revertDecoded: revertInfo.decoded,
        revertSelector: revertInfo.selector,
        isPanic: revertInfo.isPanic,
        isErrorString: revertInfo.isErrorString,
        rawRevertData: revertInfo.rawData,
        shouldTrySDKFallback,
        rpcLabel,
        rpcOrigin,
        fullError: error,
      })

      logger.error(error, {
        tags: { file: 'validateRouteWithQuoter', function: 'quoteSingleHop' },
        extra: {
          message: '[QUOTER-DIAG] Single-hop quote failed (no valid fallback)',
          chainId,
          quoterAddress,
          poolAddress: pool,
          fee: hop.fee,
          tokenIn: hop.tokenIn.symbol,
          tokenOut: hop.tokenOut.symbol,
          tokenInAddress: hop.tokenIn.address,
          tokenOutAddress: hop.tokenOut.address,
          amountInRaw: amountIn.quotient.toString(),
          amountInExact: amountIn.toExact(),
          revertDecoded: revertInfo.decoded,
          revertSelector: revertInfo.selector,
          isPanic: revertInfo.isPanic,
          isErrorString: revertInfo.isErrorString,
          rawRevertData: revertInfo.rawData,
          shouldTrySDKFallback,
          rpcLabel,
          rpcOrigin,
        },
      })
    }
    return null
  }
}

/**
 * Quote a single hop with exact output (mirrors quoteSingleHop but for exact output)
 */
async function quoteSingleHopExactOutput(
  hop: CandidateRoute['hops'][0],
  amountOut: CurrencyAmount<Currency>,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  rpcLabel?: string,
  rpcOrigin?: string,
  quoterAllowed?: boolean,
): Promise<{
  amountIn: string
  sqrtPriceX96After?: string
  initializedTicksCrossed?: number
  gasEstimate?: string
} | null> {
  // Same validation as quoteSingleHop but for exact output
  const pool = await getPoolAddress(
    chainId,
    publicClient,
    hop.tokenIn.address as `0x${string}`,
    hop.tokenOut.address as `0x${string}`,
    hop.fee,
  )

  if (!pool) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHopExactOutput', 'Skipped: pool does not exist', {
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        chainId,
      })
    }
    return null
  }

  // Check pool liquidity (same as exact input)
  try {
    const poolState = await getPoolState(chainId, publicClient, pool)
    if (!poolState || !poolState.hasLiquidity) {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('validateRouteWithQuoter', 'quoteSingleHopExactOutput', 'Skipped: pool has no liquidity', {
          fee: hop.fee,
          tokenIn: hop.tokenIn.symbol,
          tokenOut: hop.tokenOut.symbol,
          tokenInAddress: hop.tokenIn.address,
          tokenOutAddress: hop.tokenOut.address,
          pool,
          chainId,
        })
      }
      return null
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug(
        'validateRouteWithQuoter',
        'quoteSingleHopExactOutput',
        'Failed to check pool liquidity, proceeding with quote',
        {
          fee: hop.fee,
          tokenIn: hop.tokenIn.symbol,
          tokenOut: hop.tokenOut.symbol,
          pool,
          error: error instanceof Error ? error.message : String(error),
          chainId,
        },
      )
    }
  }

  // Validate amountOut
  if (JSBI.lessThanOrEqual(amountOut.quotient, JSBI.BigInt(0))) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHopExactOutput', 'Skipped zero amountOut', {
        fee: hop.fee,
        tokenIn: hop.tokenIn.symbol,
        tokenOut: hop.tokenOut.symbol,
        tokenInAddress: hop.tokenIn.address,
        tokenOutAddress: hop.tokenOut.address,
        amountOutRaw: amountOut.quotient.toString(),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
      })
    }
    return null
  }

  const quoterAddress = getQuoterAddress(chainId) as `0x${string}`
  const amountOutRaw = BigInt(amountOut.quotient.toString())
  const quoteParams = {
    tokenIn: hop.tokenIn.address as `0x${string}`,
    tokenOut: hop.tokenOut.address as `0x${string}`,
    amountOut: amountOutRaw,
    fee: BigInt(hop.fee),
    sqrtPriceLimitX96: BigInt(0),
  }

  // Check quoter allowlist (same as exact input)
  if (quoterAllowed === false) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug(
        'validateRouteWithQuoter',
        'quoteSingleHopExactOutput',
        '[QUOTER-DIAG] Skipping quoter: not allowlisted',
        {
          restrictedToken: hop.tokenOut.address,
          quoterAddress,
          tokenIn: hop.tokenIn.symbol,
          tokenOut: hop.tokenOut.symbol,
          fee: hop.fee,
          chainId,
        },
      )
    }
    return null
  }

  const quoterInterface = new Interface(QUOTER_V2_ABI)
  const callData = quoterInterface.encodeFunctionData('quoteExactOutputSingle', [quoteParams]) as `0x${string}`

  if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
    logger.debug(
      'validateRouteWithQuoter',
      'quoteSingleHopExactOutput',
      '[QUOTER-DIAG] Calling QuoterV2 (exact output)',
      {
        chainId,
        quoterAddress,
        poolAddress: pool,
        functionName: 'quoteExactOutputSingle',
        callParams: {
          tokenIn: hop.tokenIn.address,
          tokenOut: hop.tokenOut.address,
          tokenInSymbol: hop.tokenIn.symbol,
          tokenOutSymbol: hop.tokenOut.symbol,
          amountOut: amountOutRaw.toString(),
          amountOutExact: amountOut.toExact(),
          fee: hop.fee,
          sqrtPriceLimitX96: '0',
        },
        callData,
        rpcMethod: 'call',
        rpcLabel,
        rpcOrigin,
      },
    )
  }

  try {
    const result = await publicClient.call({
      to: quoterAddress,
      data: callData,
    })

    if (!result.data) {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('validateRouteWithQuoter', 'quoteSingleHopExactOutput', '[QUOTER-DIAG] Quoter returned no data', {
          chainId,
          quoterAddress,
          poolAddress: pool,
          callData,
        })
      }
      return null
    }

    const decoded = quoterInterface.decodeFunctionResult('quoteExactOutputSingle', result.data)
    const [amountIn, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = decoded as any

    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug(
        'validateRouteWithQuoter',
        'quoteSingleHopExactOutput',
        '[QUOTER-DIAG] Single-hop exact output quote succeeded',
        {
          chainId,
          quoterAddress,
          poolAddress: pool,
          fee: hop.fee,
          tokenIn: hop.tokenIn.symbol,
          tokenOut: hop.tokenOut.symbol,
          amountOutRaw: amountOut.quotient.toString(),
          amountOutExact: amountOut.toExact(),
          amountIn: amountIn?.toString?.(),
          sqrtPriceX96After: sqrtPriceX96After?.toString?.(),
          initializedTicksCrossed: Number(initializedTicksCrossed),
          gasEstimate: gasEstimate?.toString?.(),
        },
      )
    }

    return {
      amountIn: amountIn.toString(),
      sqrtPriceX96After: sqrtPriceX96After?.toString(),
      initializedTicksCrossed: Number(initializedTicksCrossed),
      gasEstimate: gasEstimate?.toString(),
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteSingleHopExactOutput', '[QUOTER-DIAG] QuoterV2 call failed', {
        chainId,
        quoterAddress,
        poolAddress: pool,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  }
}

/**
 * Quote a multi-hop route
 */
async function quoteMultiHop(
  route: CandidateRoute,
  amountIn: CurrencyAmount<Currency>,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  rpcLabel?: string,
  rpcOrigin?: string,
): Promise<{
  amountOut: string
  sqrtPriceX96AfterList: string[]
  initializedTicksCrossedList: number[]
  gasEstimate: string
} | null> {
  // Verify all hops have pools; bail early if any hop is missing
  for (const hop of route.hops) {
    const pool = await getPoolAddress(
      chainId,
      publicClient,
      hop.tokenIn.address as `0x${string}`,
      hop.tokenOut.address as `0x${string}`,
      hop.fee,
    )
    if (!pool) {
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('validateRouteWithQuoter', 'quoteMultiHop', 'Skipped: pool does not exist', {
          tokenIn: hop.tokenIn.symbol,
          tokenOut: hop.tokenOut.symbol,
          tokenInAddress: hop.tokenIn.address,
          tokenOutAddress: hop.tokenOut.address,
          fee: hop.fee,
          chainId,
          rpcLabel,
          rpcUrl: rpcOrigin,
          rpcOrigin,
        })
      }
      return null
    }
  }

  if (JSBI.lessThanOrEqual(amountIn.quotient, JSBI.BigInt(0))) {
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteMultiHop', 'Skipped zero amountIn', {
        tokenIn: route.hops[0]?.tokenIn.symbol,
        tokenOut: route.hops[route.hops.length - 1]?.tokenOut.symbol,
        tokenInAddress: route.hops[0]?.tokenIn.address,
        tokenOutAddress: route.hops[route.hops.length - 1]?.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        hopCount: route.hops.length,
        fees: route.hops.map((h) => h.fee),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
      })
    }
    return null
  }

  try {
    const quoterAddress = getQuoterAddress(chainId) as `0x${string}`
    const quoterInterface = new Interface(QUOTER_V2_ABI)

    const path = encodePath(route.hops)
    const amountInRaw = BigInt(amountIn.quotient.toString())

    const callData = quoterInterface.encodeFunctionData('quoteExactInput', [path, amountInRaw]) as `0x${string}`
    const callDataSelector = callData.slice(0, 10) as `0x${string}`

    // Step 1: Log the exact quote call (before call) - path-based
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      console.log('[QUOTER-DIAG] Step 1: Exact quote call (before call) - Multi-hop', {
        chainId,
        quoterAddress,
        methodName: 'quoteExactInput',
        tokenIn: {
          address: route.hops[0]?.tokenIn.address,
          symbol: route.hops[0]?.tokenIn.symbol,
          decimals: route.hops[0]?.tokenIn.decimals,
        },
        tokenOut: {
          address: route.hops[route.hops.length - 1]?.tokenOut.address,
          symbol: route.hops[route.hops.length - 1]?.tokenOut.symbol,
          decimals: route.hops[route.hops.length - 1]?.tokenOut.decimals,
        },
        hopCount: route.hops.length,
        fees: route.hops.map((h) => h.fee),
        amountIn: {
          raw: amountInRaw.toString(),
          exact: amountIn.toExact(),
          decimals: amountIn.currency.decimals,
        },
        sqrtPriceLimitX96: 'N/A (path-based)',
        encodedPath: path,
        pathLength: path.length - 2, // Subtract '0x'
        encodedCalldata: {
          selector: callDataSelector,
          fullData: callData,
          dataLength: callData.length - 2,
        },
        quoterABI: 'QuoterV2',
        quoterFunction: 'quoteExactInput',
        quoterFunctionSignature: 'quoteExactInput(bytes,uint256)',
        rpcMethod: 'readContract',
        rpcLabel,
        rpcOrigin,
      })
    }

    // Prefer viem readContract for consistent encoding/decoding
    const result = await publicClient.readContract({
      address: quoterAddress,
      abi: QUOTER_V2_ABI as any,
      functionName: 'quoteExactInput',
      args: [path, amountInRaw],
    })

    if (!result) {
      return null
    }

    const [amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate] = result as any

    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteMultiHop', 'Multi-hop quote succeeded', {
        tokenIn: route.hops[0]?.tokenIn.symbol,
        tokenOut: route.hops[route.hops.length - 1]?.tokenOut.symbol,
        fees: route.hops.map((h) => h.fee),
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        amountOut: amountOut?.toString?.(),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
        quoterAddress: getQuoterAddress(chainId),
      })
    }

    return {
      amountOut: amountOut.toString(),
      sqrtPriceX96AfterList: (sqrtPriceX96AfterList as bigint[]).map((p) => p.toString()),
      initializedTicksCrossedList: (initializedTicksCrossedList as bigint[]).map((t) => Number(t)),
      gasEstimate: gasEstimate.toString(),
    }
  } catch (error) {
    // Route doesn't exist or has insufficient liquidity
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('validateRouteWithQuoter', 'quoteMultiHop', 'Multi-hop quote reverted', {
        tokenIn: route.hops[0]?.tokenIn.symbol,
        tokenOut: route.hops[route.hops.length - 1]?.tokenOut.symbol,
        tokenInAddress: route.hops[0]?.tokenIn.address,
        tokenOutAddress: route.hops[route.hops.length - 1]?.tokenOut.address,
        amountInRaw: amountIn.quotient.toString(),
        amountInExact: amountIn.toExact(),
        hopCount: route.hops.length,
        fees: route.hops.map((h) => h.fee),
        chainId,
        rpcLabel,
        rpcUrl: rpcOrigin,
        rpcOrigin,
        quoterAddress: getQuoterAddress(chainId),
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  }
}

/**
 * Validate a route with QuoterV2
 * Returns null if route reverts or fails
 * Supports both exact input (amountIn) and exact output (amountOut)
 */
export async function validateRouteWithQuoter(
  route: CandidateRoute,
  amountIn: CurrencyAmount<Currency> | undefined,
  amountOut: CurrencyAmount<Currency> | undefined,
  tokenIn: Currency,
  tokenOut: Currency,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
  rpcLabel?: string,
  rpcOrigin?: string,
  quoterAllowed?: boolean,
): Promise<ValidatedRoute | null> {
  const isExactOut = !!amountOut && !amountIn

  try {
    // Single hop route
    if (route.hops.length === 1) {
      const firstHop = route.hops[0]
      if (!firstHop) {
        return null
      }

      if (isExactOut && amountOut) {
        // Exact output: quote how much input is needed for desired output
        const quoteResult = await quoteSingleHopExactOutput(
          firstHop,
          amountOut,
          chainId,
          publicClient,
          rpcLabel,
          rpcOrigin,
          quoterAllowed,
        )
        if (!quoteResult) {
          return null
        }

        const amountInCurrency = CurrencyAmount.fromRawAmount(tokenIn, quoteResult.amountIn)

        return {
          route,
          amountIn: quoteResult.amountIn,
          amountInCurrency,
          amountOut: amountOut.quotient.toString(),
          amountOutCurrency: amountOut,
          sqrtPriceX96After: quoteResult.sqrtPriceX96After,
          initializedTicksCrossed: quoteResult.initializedTicksCrossed,
          gasEstimate: quoteResult.gasEstimate,
        }
      } else if (amountIn) {
        // Exact input: quote how much output we get for given input
        const quoteResult = await quoteSingleHop(
          firstHop,
          amountIn,
          chainId,
          publicClient,
          rpcLabel,
          rpcOrigin,
          quoterAllowed,
        )
        if (!quoteResult) {
          return null
        }

        const amountOutCurrency = CurrencyAmount.fromRawAmount(tokenOut, quoteResult.amountOut)

        return {
          route,
          amountOut: quoteResult.amountOut,
          amountOutCurrency,
          sqrtPriceX96After: quoteResult.sqrtPriceX96After,
          initializedTicksCrossed: quoteResult.initializedTicksCrossed,
          gasEstimate: quoteResult.gasEstimate,
        }
      }

      return null
    }

    // Multi-hop route (only supports exact input for now)
    if (isExactOut) {
      // Multi-hop exact output not yet implemented - return null
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('validateRouteWithQuoter', 'validateRouteWithQuoter', 'Multi-hop exact output not supported', {
          chainId,
          tokenIn: tokenIn.symbol,
          tokenOut: tokenOut.symbol,
        })
      }
      return null
    }

    if (!amountIn) {
      return null
    }

    const quoteResult = await quoteMultiHop(route, amountIn, chainId, publicClient, rpcLabel, rpcOrigin)
    if (!quoteResult) {
      return null
    }

    const amountOutCurrency = CurrencyAmount.fromRawAmount(tokenOut, quoteResult.amountOut)

    return {
      route,
      amountOut: quoteResult.amountOut,
      amountOutCurrency,
      sqrtPriceX96After: quoteResult.sqrtPriceX96AfterList[quoteResult.sqrtPriceX96AfterList.length - 1],
      initializedTicksCrossed: quoteResult.initializedTicksCrossedList.reduce((a, b) => a + b, 0),
      gasEstimate: quoteResult.gasEstimate,
    }
  } catch (error) {
    // Route validation failed
    return null
  }
}
