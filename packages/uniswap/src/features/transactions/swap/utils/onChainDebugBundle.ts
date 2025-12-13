/**
 * On-Chain Debug Bundle Builder
 * 
 * Collects all debug data for a single quote/tx-build cycle and emits as one structured JSON bundle.
 * Gated by isOnChainDebug(chainId).
 */

import { Currency, CurrencyAmount, Price } from '@uniswap/sdk-core'
import { Address, PublicClient } from 'viem'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { isOnChainDebug, makeOnChainDebugId, debugOnChain } from './isOnChainDebug'
import { V3PoolOnChainState } from 'uniswap/src/features/transactions/swap/services/v3OnChain/v3PoolOnChain'

export interface OnChainDebugBundle {
  header: {
    debugId: string
    chainId: number
    mode: 'onchain-only'
    timestamp: number
  }
  inputs?: {
    tokenIn: { symbol: string; address: string; decimals: number }
    tokenOut: { symbol: string; address: string; decimals: number }
    isExactIn: boolean
    amountSpecified: { raw: string; exact: string }
    slippageToleranceBps: number | 'unavailable'
    slippageSource: 'auto' | 'user' | 'unavailable'
  }
  pool?: {
    poolAddress: string
    fee: number
    token0: { address: string; decimals: number; symbol: string }
    token1: { address: string; decimals: number; symbol: string }
    tokenInIsToken0: boolean
    slot0: {
      sqrtPriceX96: string
      tick: number
      observationCardinality?: number
      observationCardinalityNext?: number
    }
    liquidity: string
    tickSpacing?: number
  }
  prices?: {
    midPrice_sdk: string | null
    midPrice_fromSqrtPriceX96: string | null
    executionPrice: string | null
    executionPriceRaw: string | null
    executionPrice_inverse: string | null
    midPrice_inverse: string | null
    direction: string | null
  }
  quoteOutputs?: {
    amountInRaw: string
    amountOutRaw: string
    amountInExact: string
    amountOutExact: string
    quotedRoute: string | null
    routerAddress: string
  }
  priceImpact?: {
    priceImpactFloat: number | null
    priceImpactBpsRounded: number | null
    priceImpactSign: 'positive' | 'negative' | 'zero' | null
    crossCheck: {
      impactBps_inverse: number | null
      differenceBps: number | null
      crossCheckPassed: boolean
    }
  }
  slippage?: {
    minAmountOutRaw: string | null
    minAmountOutExact: string | null
    bufferRaw: string | null
    wouldRevertIfActualOutBelowMin: string
  }
  simulation?: {
    simulatedAmountOutRaw: string | null
    diffVsComputedQuote: string | null
  }
  txPayload?: {
    txTo: string
    txDataLen: number
    txValue: string
    txDeadlineSeconds: number | null
    txAmountOutMinimumRaw: string | null
    txGasLimit: string | null
  }
  networkCost?: {
    approvalTx?: {
      estimateGas: string | null
      feeData: {
        maxFeePerGas?: string
        maxPriorityFeePerGas?: string
        gasPrice?: string
      } | null
      costWei: string | null
    }
    swapTx?: {
      estimateGas: string | null
      feeData: {
        maxFeePerGas?: string
        maxPriorityFeePerGas?: string
        gasPrice?: string
      } | null
      costWei: string | null
    }
    networkCostDisplayed: 'approval' | 'swap' | 'none'
  }
}

/**
 * Create a new debug bundle for a quote cycle
 */
export function createOnChainDebugBundle(chainId: number): {
  bundle: Partial<OnChainDebugBundle>
  emit: () => void
} {
  const isDebug = isOnChainDebug(chainId)
  const debugId = makeOnChainDebugId('quote')
  
  const bundle: Partial<OnChainDebugBundle> = {
    header: {
      debugId,
      chainId,
      mode: 'onchain-only',
      timestamp: Date.now(),
    },
  }
  
  return {
    bundle,
    emit: () => {
      if (isDebug) {
        debugOnChain(chainId, bundle as Record<string, unknown>)
      }
    },
  }
}
