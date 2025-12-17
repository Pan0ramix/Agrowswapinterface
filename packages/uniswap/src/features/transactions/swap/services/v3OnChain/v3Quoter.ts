/**
 * V3 Quoter Service
 *
 * Gets quotes for V3 swaps using the Quoter or QuoterV2 contract on-chain.
 * This replaces Trading API quote endpoints.
 */

import { Currency, CurrencyAmount, QUOTER_ADDRESSES, Token } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { Interface } from 'ethers/lib/utils'
import { AGROSWAP_QUOTER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { getQuoterV2Address } from 'uniswap/src/constants/v3Addresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { fetchV3PoolState } from 'uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain'
import { decodeQuoterRevert } from 'uniswap/src/features/transactions/swap/utils/decodeQuoterRevert'
import { isValidHexString } from 'utilities/src/addresses/hex'
import { logger } from 'utilities/src/logger/logger'
import { PublicClient } from 'viem'

/**
 * Quote result from Quoter contract
 */
export interface V3QuoteResult {
  amountOut: string
  sqrtPriceX96After?: string
  initializedTicksCrossed?: number
  gasEstimate?: string
}

/**
 * Parameters for exact input single quote
 */
export interface QuoteExactInputSingleParams {
  tokenIn: Currency
  tokenOut: Currency
  fee: FeeAmount
  amountIn: CurrencyAmount<Currency>
  sqrtPriceLimitX96?: string // Optional price limit
  chainId: EVMUniverseChainId
  publicClient: PublicClient
}

/**
 * Get Quoter contract address for the given chain
 */
function getQuoterAddress(chainId: EVMUniverseChainId): string {
  // Try Agroswap addresses first for Base Sepolia
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
 * QuoterV2 ABI - supports quoteExactInputSingle with gas estimation
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
]

/**
 * Legacy Quoter ABI - fallback for chains without QuoterV2
 */
const QUOTER_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenIn', type: 'address' },
      { internalType: 'address', name: 'tokenOut', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' },
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    name: 'quoteExactInputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

/**
 * Validate pool state before quoting
 * Returns pool address and state, or throws if pool is invalid
 */
async function validatePoolBeforeQuote(
  tokenIn: Currency,
  tokenOut: Currency,
  fee: FeeAmount,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
): Promise<{
  poolAddress: string
  sqrtPriceX96: string
  liquidity: string
  tick: number
  token0: Token
  token1: Token
  tickSpacing?: number
}> {
  // Use fetchV3PoolState which handles factory address selection correctly
  // This also validates the pool exists and has liquidity
  const poolState = await fetchV3PoolState({
    tokenIn,
    tokenOut,
    fee,
    chainId,
    publicClient,
  })

  if (!poolState) {
    throw new Error(`Pool does not exist for ${tokenIn.symbol}/${tokenOut.symbol} with fee ${fee}`)
  }

  // Validate pool state
  if (poolState.sqrtPriceX96 === '0') {
    throw new Error(`Pool at ${poolState.poolAddress} has uninitialized price (sqrtPriceX96 = 0)`)
  }

  if (poolState.liquidity === '0') {
    throw new Error(`Pool at ${poolState.poolAddress} has no liquidity`)
  }

  return {
    poolAddress: poolState.poolAddress,
    sqrtPriceX96: poolState.sqrtPriceX96,
    liquidity: poolState.liquidity,
    tick: poolState.tick,
    token0: poolState.token0,
    token1: poolState.token1,
    tickSpacing: poolState.tickSpacing,
  }
}

/**
 * Quotes exact input single swap using QuoterV2 contract
 *
 * @param params - Quote parameters
 * @returns Quote result with amountOut and optional gas estimate
 */
export async function quoteExactInputSingle(params: QuoteExactInputSingleParams): Promise<V3QuoteResult> {
  const { tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96, chainId, publicClient } = params

  const quoterAddressRaw = getQuoterAddress(chainId)
  if (!isValidHexString(quoterAddressRaw)) {
    throw new Error(`Invalid quoter address: ${quoterAddressRaw}`)
  }
  const quoterAddress = quoterAddressRaw

  const tokenInAddressRaw = tokenIn.wrapped.address
  if (!isValidHexString(tokenInAddressRaw)) {
    throw new Error(`Invalid tokenIn address: ${tokenInAddressRaw}`)
  }
  const tokenInAddress = tokenInAddressRaw

  const tokenOutAddressRaw = tokenOut.wrapped.address
  if (!isValidHexString(tokenOutAddressRaw)) {
    throw new Error(`Invalid tokenOut address: ${tokenOutAddressRaw}`)
  }
  const tokenOutAddress = tokenOutAddressRaw
  const amountInRaw = amountIn.quotient.toString()
  const priceLimit = sqrtPriceLimitX96 || '0'

  // Step C: Verify pool is actually quoteable (on-chain reads)
  let poolState: Awaited<ReturnType<typeof validatePoolBeforeQuote>> | undefined
  let poolCodeLength: number | undefined
  let computedPoolAddress: string | undefined

  try {
    poolState = await validatePoolBeforeQuote(tokenIn, tokenOut, fee, chainId, publicClient)
    computedPoolAddress = poolState.poolAddress

    // Get pool code length to verify pool exists
    try {
      if (!isValidHexString(poolState.poolAddress)) {
        throw new Error(`Invalid pool address: ${poolState.poolAddress}`)
      }
      const poolCode = await publicClient.getBytecode({ address: poolState.poolAddress })
      poolCodeLength = poolCode ? poolCode.length : 0
    } catch {
      poolCodeLength = 0
    }

    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      // Step C: Log all pool state values
      console.log('[QUOTER-DIAG] Step C: Pool state verified (on-chain reads)', {
        chainId,
        poolAddress: poolState.poolAddress,
        computedPoolAddress: poolState.poolAddress,
        poolCodeLength,
        token0: poolState.token0.address,
        token1: poolState.token1.address,
        token0Symbol: poolState.token0.symbol,
        token1Symbol: poolState.token1.symbol,
        fee,
        tickSpacing: poolState.tickSpacing,
        sqrtPriceX96: poolState.sqrtPriceX96,
        liquidity: poolState.liquidity,
        tick: poolState.tick,
        tokenOrdering: {
          tokenInIsToken0: tokenInAddress.toLowerCase() === poolState.token0.address.toLowerCase(),
          tokenOutIsToken1: tokenOutAddress.toLowerCase() === poolState.token1.address.toLowerCase(),
          expectedOrder: `${poolState.token0.symbol} < ${poolState.token1.symbol}`,
        },
      })

      logger.debug('v3Quoter', 'quoteExactInputSingle', '[QUOTER-DIAG] Pool state validated', {
        chainId,
        quoterAddress,
        poolAddress: poolState.poolAddress,
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        tokenInAddress,
        tokenOutAddress,
        fee,
        sqrtPriceX96: poolState.sqrtPriceX96,
        liquidity: poolState.liquidity,
        tick: poolState.tick,
        token0: poolState.token0.address,
        token1: poolState.token1.address,
        poolCodeLength,
      })
    }
  } catch (poolError) {
    const poolErrorMessage = poolError instanceof Error ? poolError.message : String(poolError)
    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      console.error('[QUOTER-DIAG] Step C: Pool validation failed', {
        chainId,
        quoterAddress,
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        tokenInAddress,
        tokenOutAddress,
        fee,
        error: poolErrorMessage,
        fullError: poolError,
      })

      logger.error(poolError, {
        tags: { file: 'v3Quoter', function: 'quoteExactInputSingle' },
        extra: {
          message: '[QUOTER-DIAG] Pool validation failed',
          chainId,
          quoterAddress,
          tokenIn: tokenIn.symbol,
          tokenOut: tokenOut.symbol,
          tokenInAddress,
          tokenOutAddress,
          fee,
          error: poolErrorMessage,
        },
      })
    }
    throw poolError
  }

  // Step 2: Prepare quote call parameters
  const quoterV2Interface = new Interface(QUOTER_V2_ABI)
  const quoteParams = {
    tokenIn: tokenInAddress,
    tokenOut: tokenOutAddress,
    amountIn: amountInRaw,
    fee,
    sqrtPriceLimitX96: priceLimit,
  }

  const callDataRaw = quoterV2Interface.encodeFunctionData('quoteExactInputSingle', [quoteParams])
  if (!isValidHexString(callDataRaw)) {
    throw new Error(`Invalid callData: ${callDataRaw}`)
  }
  const callData = callDataRaw
  const callDataSelectorRaw = callData.slice(0, 10)
  if (!isValidHexString(callDataSelectorRaw)) {
    throw new Error(`Invalid callDataSelector: ${callDataSelectorRaw}`)
  }
  const callDataSelector = callDataSelectorRaw

  // Step A: Log the exact quote call (before call) - comprehensive logging
  if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
    console.log('[QUOTER-DIAG] Step A: Exact quote call (before call)', {
      chainId,
      quoterAddress,
      methodName: 'quoteExactInputSingle',
      tokenIn: {
        address: tokenInAddress,
        symbol: tokenIn.symbol,
        decimals: tokenIn.decimals,
      },
      tokenOut: {
        address: tokenOutAddress,
        symbol: tokenOut.symbol,
        decimals: tokenOut.decimals,
      },
      fee,
      amountIn: {
        raw: amountInRaw,
        exact: amountIn.toExact(),
        decimals: amountIn.currency.decimals,
      },
      sqrtPriceLimitX96: priceLimit,
      computedPoolAddress: poolState.poolAddress,
      poolCodeLength: poolState ? poolCodeLength : undefined,
      encodedCalldata: {
        selector: callDataSelector,
        fullData: callData,
        dataLength: callData.length - 2, // Subtract '0x'
      },
      quoterABI: 'QuoterV2',
      quoterFunction: 'quoteExactInputSingle',
      quoterFunctionSignature: 'quoteExactInputSingle((address,address,uint256,uint24,uint160))',
      poolState: poolState
        ? {
            token0: poolState.token0.address,
            token1: poolState.token1.address,
            sqrtPriceX96: poolState.sqrtPriceX96,
            liquidity: poolState.liquidity,
            tick: poolState.tick,
            tickSpacing: poolState.tickSpacing,
          }
        : undefined,
    })

    // Step D: Confirm correct quoter + ABI + function usage
    const expectedQuoterAddress = '0x9B988c0B5720c3ab8a60a04e7C17126519AF64e4' // Base Sepolia QuoterV2
    const expectedFunctionSignature = 'quoteExactInputSingle((address,address,uint256,uint24,uint160))'
    const expectedSelectorRaw = quoterV2Interface.getSighash('quoteExactInputSingle')
    if (!isValidHexString(expectedSelectorRaw)) {
      throw new Error(`Invalid expectedSelector: ${expectedSelectorRaw}`)
    }
    const expectedSelector = expectedSelectorRaw

    console.log('[QUOTER-DIAG] Step D: Quoter configuration verification', {
      chainId,
      quoterAddress,
      quoterVersion: 'V2',
      quoterABI: 'QuoterV2',
      quoterFunction: 'quoteExactInputSingle',
      quoterFunctionSignature: expectedFunctionSignature,
      expectedQuoterAddress,
      quoterAddressMatch: quoterAddress.toLowerCase() === expectedQuoterAddress.toLowerCase(),
      callDataSelector,
      expectedSelector,
      selectorMatch: callDataSelector.toLowerCase() === expectedSelector.toLowerCase(),
      pathEncoding: 'single-hop (quoteExactInputSingle)',
      paramsStructure: 'tuple (QuoteExactInputSingleParams)',
      params: {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountInRaw,
        fee,
        sqrtPriceLimitX96: priceLimit,
      },
    })

    logger.debug('v3Quoter', 'quoteExactInputSingle', '[QUOTER-DIAG] Calling QuoterV2', {
      chainId,
      quoterAddress,
      poolAddress: poolState.poolAddress,
      functionName: 'quoteExactInputSingle',
      callParams: {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountInRaw,
        amountInExact: amountIn.toExact(),
        fee,
        sqrtPriceLimitX96: priceLimit,
      },
      callData,
      callDataSelector,
      rpcMethod: 'eth_call',
      quoterFunctionSignature: 'quoteExactInputSingle((address,address,uint256,uint24,uint160))',
      quoterABI: 'QuoterV2',
      quoterVersion: 'V2',
      blockTag: 'latest',
    })
  }

  // Step 3: Try QuoterV2 first (has gas estimate)
  try {
    const result = await publicClient.call({
      to: quoterAddress,
      data: callData,
    })

    if (!result.data) {
      throw new Error('Quoter call returned no data')
    }

    const decoded = quoterV2Interface.decodeFunctionResult('quoteExactInputSingle', result.data)

    if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
      logger.debug('v3Quoter', 'quoteExactInputSingle', '[QUOTER-DIAG] QuoterV2 succeeded', {
        chainId,
        quoterAddress,
        poolAddress: poolState.poolAddress,
        amountOut: decoded.amountOut.toString(),
        sqrtPriceX96After: decoded.sqrtPriceX96After.toString(),
        initializedTicksCrossed: Number(decoded.initializedTicksCrossed),
        gasEstimate: decoded.gasEstimate.toString(),
      })
    }

    return {
      amountOut: decoded.amountOut.toString(),
      sqrtPriceX96After: decoded.sqrtPriceX96After.toString(),
      initializedTicksCrossed: Number(decoded.initializedTicksCrossed),
      gasEstimate: decoded.gasEstimate.toString(),
    }
  } catch (error) {
    // Step 4: Decode revert reason with comprehensive diagnostics
    // Step B: Decode revert data properly (after revert)
    const revertInfo = decodeQuoterRevert(error, {
      chainId,
      quoterAddress,
      poolAddress: poolState.poolAddress,
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
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
        poolAddress: poolState.poolAddress,
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

      // Also log to logger for persistence
      console.error('[QUOTER-DIAG] QuoterV2 reverted', {
        chainId,
        quoterAddress,
        poolAddress: poolState.poolAddress,
        functionName: 'quoteExactInputSingle',
        callParams: quoteParams,
        callData,
        revertDecoded: revertInfo.decoded,
        revertSelector: revertInfo.selector,
        isPanic: revertInfo.isPanic,
        isErrorString: revertInfo.isErrorString,
        rawRevertData: revertInfo.rawData,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        fullError: error,
      })

      logger.error('v3Quoter', 'quoteExactInputSingle', '[QUOTER-DIAG] QuoterV2 reverted', {
        chainId,
        quoterAddress,
        poolAddress: poolState.poolAddress,
        functionName: 'quoteExactInputSingle',
        callParams: quoteParams,
        callData,
        revertDecoded: revertInfo.decoded,
        revertSelector: revertInfo.selector,
        isPanic: revertInfo.isPanic,
        isErrorString: revertInfo.isErrorString,
        rawRevertData: revertInfo.rawData,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      })
    }

    // Step 5: Try legacy Quoter as fallback (only if revert is not a pool/token issue)
    // Don't fallback if it's a real execution failure (STF, TF, etc.)
    const shouldTryLegacy =
      !revertInfo.decoded.includes('STF') &&
      !revertInfo.decoded.includes('TF') &&
      !revertInfo.decoded.includes('Transfer') &&
      !revertInfo.isPanic

    if (shouldTryLegacy) {
      const quoterInterface = new Interface(QUOTER_ABI)

      try {
        const legacyCallDataRaw = quoterInterface.encodeFunctionData('quoteExactInputSingle', [
          tokenInAddress,
          tokenOutAddress,
          fee,
          amountInRaw,
          priceLimit,
        ])
        if (!isValidHexString(legacyCallDataRaw)) {
          throw new Error(`Invalid legacyCallData: ${legacyCallDataRaw}`)
        }
        const legacyCallData = legacyCallDataRaw

        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          logger.debug('v3Quoter', 'quoteExactInputSingle', '[QUOTER-DIAG] Trying legacy Quoter', {
            chainId,
            quoterAddress,
            callData: legacyCallData,
          })
        }

        const result = await publicClient.call({
          to: quoterAddress,
          data: legacyCallData,
        })

        if (!result.data) {
          throw new Error('Legacy Quoter call returned no data')
        }

        const decoded = quoterInterface.decodeFunctionResult('quoteExactInputSingle', result.data)

        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          logger.debug('v3Quoter', 'quoteExactInputSingle', '[QUOTER-DIAG] Legacy Quoter succeeded', {
            chainId,
            quoterAddress,
            amountOut: decoded.amountOut.toString(),
          })
        }

        return {
          amountOut: decoded.amountOut.toString(),
        }
      } catch (legacyError) {
        const legacyRevertInfo = decodeQuoterRevert(legacyError, {
          chainId,
          quoterAddress,
          poolAddress: poolState.poolAddress,
          tokenIn: tokenInAddress,
          tokenOut: tokenOutAddress,
        })

        if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
          console.error('[QUOTER-DIAG] Legacy Quoter also reverted', {
            chainId,
            quoterAddress,
            poolAddress: poolState.poolAddress,
            revertDecoded: legacyRevertInfo.decoded,
            revertSelector: legacyRevertInfo.selector,
            rawRevertData: legacyRevertInfo.rawData,
            fullError: legacyError,
          })

          logger.error(legacyError, {
            tags: { file: 'v3Quoter', function: 'quoteExactInputSingle' },
            extra: {
              message: '[QUOTER-DIAG] Legacy Quoter also reverted',
              chainId,
              quoterAddress,
              poolAddress: poolState.poolAddress,
              revertDecoded: legacyRevertInfo.decoded,
              revertSelector: legacyRevertInfo.selector,
              rawRevertData: legacyRevertInfo.rawData,
            },
          })
        }

        // Re-throw with decoded revert reason
        throw new Error(
          `Quoter call failed: ${revertInfo.decoded} (V2) / ${legacyRevertInfo.decoded} (Legacy). Pool: ${poolState.poolAddress || 'unknown'}`,
        )
      }
    }

    // Re-throw with decoded revert reason
    throw new Error(
      `Quoter call failed: ${revertInfo.decoded}. Pool: ${poolState.poolAddress || 'unknown'}, Quoter: ${quoterAddress}`,
    )
  }
}

/**
 * User-friendly error messages for common quote failures
 */
export function parseQuoteError(error: unknown): string {
  const errorString = error instanceof Error ? error.message : String(error)

  if (errorString.includes('STF') || errorString.includes('insufficient liquidity')) {
    return 'Insufficient liquidity in pool for this swap'
  }

  if (errorString.includes('SPL') || errorString.includes('price limit')) {
    return 'Price limit exceeded'
  }

  if (errorString.includes('revert') || errorString.includes('execution reverted')) {
    return 'Pool does not exist or swap cannot be executed'
  }

  return errorString || 'Failed to get quote from pool'
}
