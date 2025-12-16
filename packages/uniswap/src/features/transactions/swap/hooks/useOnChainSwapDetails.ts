/**
 * Hook to compute on-chain swap details for swap review UI
 *
 * Computes Rate, Price Impact, Network Cost, and Routing label using only on-chain data.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { getAgroswapSwapRouterAddress } from 'uniswap/src/constants/agroswapAddresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import { ApprovalAction, type TokenApprovalInfo } from 'uniswap/src/features/transactions/swap/types/trade'
import {
  getOnChainSwapDetails,
  type OnChainSwapDetails,
} from 'uniswap/src/features/transactions/swap/utils/getOnChainSwapDetails'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { logger } from 'utilities/src/logger/logger'
import { Address } from 'viem'

interface UseOnChainSwapDetailsParams {
  derivedSwapInfo: DerivedSwapInfo
  tokenApprovalInfo?: TokenApprovalInfo | undefined
  approveTxRequest?: { to: string; data: string } | null | undefined
  enabled?: boolean
}

/**
 * Hook to compute on-chain swap details
 */
export function useOnChainSwapDetails({
  derivedSwapInfo,
  tokenApprovalInfo,
  approveTxRequest,
  enabled = true,
}: UseOnChainSwapDetailsParams): {
  data: OnChainSwapDetails | undefined
  isLoading: boolean
  error: Error | null
} {
  const chainId = derivedSwapInfo.chainId as EVMUniverseChainId | undefined
  const trade = derivedSwapInfo.trade.trade
  const onChainQuote = derivedSwapInfo.onChainQuote

  // Only enable for on-chain-only chains
  const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false
  const shouldEnable = enabled && isOnChainOnly && !!trade && !!onChainQuote

  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return createViemClient({ chainId })
  }, [chainId])

  const wallet = useWallet()
  const account = wallet.evmAccount?.address as Address | undefined

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'onchain-swap-details',
      chainId,
      account,
      trade?.inputAmount.currency.isToken ? trade.inputAmount.currency.address : undefined,
      trade?.outputAmount.currency.isToken ? trade.outputAmount.currency.address : undefined,
      trade?.inputAmount.quotient.toString(),
      trade?.outputAmount.quotient.toString(),
      tokenApprovalInfo?.action,
      approveTxRequest?.to,
    ],
    queryFn: async (): Promise<OnChainSwapDetails> => {
      if (!chainId || !trade || !onChainQuote || !publicClient) {
        throw new Error('Missing required parameters for on-chain swap details')
      }

      const tokenIn = trade.inputAmount.currency
      const tokenOut = trade.outputAmount.currency
      const amountIn = trade.inputAmount
      const amountOut = trade.outputAmount
      const routerAddress = getAgroswapSwapRouterAddress(chainId) as Address

      // Extract slippage info from trade (if available)
      const slippageToleranceBps = (() => {
        if ('slippageTolerance' in trade && typeof trade.slippageTolerance === 'number') {
          return Math.round(trade.slippageTolerance * 100) // Convert to basis points
        }
        return undefined
      })()

      const amountOutQuotedRaw = amountOut.quotient.toString()
      const amountOutMinimumRaw = (() => {
        if ('minAmountOut' in trade && trade.minAmountOut) {
          return trade.minAmountOut.quotient.toString()
        }
        return undefined
      })()

      // Extract approval tx request from tokenApprovalInfo or approveTxRequest prop
      const approvalTxRequest: { to: Address; data: `0x${string}` } | undefined = (() => {
        // First try the prop (from swapTxContext)
        if (approveTxRequest?.to && approveTxRequest.data) {
          return {
            to: approveTxRequest.to as Address,
            data: approveTxRequest.data as `0x${string}`,
          }
        }
        // Fallback to tokenApprovalInfo
        if (
          tokenApprovalInfo &&
          tokenApprovalInfo.action !== ApprovalAction.None &&
          'txRequest' in tokenApprovalInfo &&
          tokenApprovalInfo.txRequest
        ) {
          return {
            to: tokenApprovalInfo.txRequest.to as Address,
            data: tokenApprovalInfo.txRequest.data as `0x${string}`,
          }
        }
        return undefined
      })()

      const needsApprove = tokenApprovalInfo ? tokenApprovalInfo.action !== ApprovalAction.None : !!approvalTxRequest

      // Extract swap tx request from on-chain quote
      const swapTxRequest = onChainQuote.txPayload
        ? {
            to: onChainQuote.txPayload.to as Address,
            data: onChainQuote.txPayload.data as `0x${string}`,
            value: onChainQuote.txPayload.value ? BigInt(onChainQuote.txPayload.value) : undefined,
          }
        : undefined

      // Extract swap tx payload details for debug bundle
      // Note: deadline is computed in buildSwapTx, we don't have it here
      // But we can extract amountOutMinimum from the trade
      const swapTxPayload = onChainQuote.txPayload
        ? {
            to: onChainQuote.txPayload.to,
            data: onChainQuote.txPayload.data,
            value: onChainQuote.txPayload.value,
            gasLimit: onChainQuote.txPayload.gasLimit,
            deadline: undefined, // Deadline is in tx data, would need decoding
            amountOutMinimumRaw,
          }
        : undefined

      const details = await getOnChainSwapDetails({
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        chainId,
        publicClient,
        account,
        routerAddress,
        onChainRoute: onChainQuote.route,
        tokenApprovalInfo: approvalTxRequest
          ? {
              needsApprove,
              approveTxRequest: approvalTxRequest,
            }
          : undefined,
        swapTxRequest,
        slippageToleranceBps,
        amountOutQuotedRaw,
        amountOutMinimumRaw,
        swapTxPayload,
        // Debug bundle will be created in getOnChainSwapDetails
        debugBundle: undefined,
      })

      // Log debug info for Base Sepolia
      if (process.env.NODE_ENV !== 'production' && chainId === 84532) {
        logger.debug('useOnChainSwapDetails', 'useOnChainSwapDetails', '[ONCHAIN-DETAILS] computed', {
          chainId,
          executionPrice: details.executionPrice?.toSignificant(6),
          midPrice: details.midPrice?.toSignificant(6),
          priceImpactBps: details.priceImpactBps,
          rate: details.rate,
          networkCostStep: details.networkCost?.step,
          networkCostGasLimit: details.networkCost?.gasLimit?.toString(),
          debug: details.debug,
        })
      }

      return details
    },
    enabled: shouldEnable && !!publicClient && !!account,
    staleTime: 10_000, // 10 seconds
    gcTime: 30_000, // 30 seconds
  })

  return {
    data,
    isLoading,
    error: error instanceof Error ? error : error ? new Error(String(error)) : null,
  }
}
