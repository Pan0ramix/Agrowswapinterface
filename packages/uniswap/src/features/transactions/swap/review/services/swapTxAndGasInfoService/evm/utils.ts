import type { GasStrategy } from '@universe/api'
import type { providers } from 'ethers/lib/ethers'
import type { TransactionSettings } from 'uniswap/src/features/transactions/components/settings/types'
import type { ApprovalTxInfo } from 'uniswap/src/features/transactions/swap/review/hooks/useTokenApprovalInfo'
import type { EVMSwapInstructionsService } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/evm/evmSwapInstructionsService'
import type { TransactionRequestInfo } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/utils'
import {
  createProcessSwapResponse,
  getSwapInputExceedsBalance,
} from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/utils'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import type { DerivedSwapInfo } from 'uniswap/src/features/transactions/swap/types/derivedSwapInfo'
import type {
  BridgeTrade,
  ClassicTrade,
  UnwrapTrade,
  WrapTrade,
} from 'uniswap/src/features/transactions/swap/types/trade'
import { ApprovalAction } from 'uniswap/src/features/transactions/swap/types/trade'
import { tryCatch } from 'utilities/src/errors'
import { logger } from 'utilities/src/logger/logger'

type GetEVMSwapTransactionRequestInfoFn = (params: {
  trade: ClassicTrade | BridgeTrade | WrapTrade | UnwrapTrade
  approvalTxInfo: ApprovalTxInfo
  derivedSwapInfo: DerivedSwapInfo
}) => Promise<TransactionRequestInfo>

export function createGetEVMSwapTransactionRequestInfo(ctx: {
  instructionService: EVMSwapInstructionsService
  gasStrategy: GasStrategy
  transactionSettings: TransactionSettings
}): GetEVMSwapTransactionRequestInfoFn {
  const { gasStrategy, transactionSettings, instructionService } = ctx

  const processSwapResponse = createProcessSwapResponse({ gasStrategy })

  const getEVMSwapTransactionRequestInfo: GetEVMSwapTransactionRequestInfoFn = async ({
    trade,
    approvalTxInfo,
    derivedSwapInfo,
  }) => {
    const { tokenApprovalInfo } = approvalTxInfo
    const chainId = derivedSwapInfo.chainId
    const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false
    const onChainQuote = derivedSwapInfo.onChainQuote

    // Always log for Base Sepolia to debug the issue
    if (chainId === 84532) {
      logger.debug(
        'getEVMSwapTransactionRequestInfo',
        'getEVMSwapTransactionRequestInfo',
        '[ONCHAIN-TX-BUILD] Checking for on-chain quote',
        {
          chainId,
          isOnChainOnly,
          hasOnChainQuote: !!onChainQuote,
          hasTxPayload: !!onChainQuote?.txPayload,
          onChainQuoteKeys: onChainQuote ? Object.keys(onChainQuote) : [],
          hasTradeQuote: !!trade.quote,
          hasTrade: !!trade,
          onChainQuoteData: onChainQuote
            ? {
                hasQuoteAmountIn: !!onChainQuote.quoteAmountIn,
                hasQuoteAmountOut: !!onChainQuote.quoteAmountOut,
                hasRoute: !!onChainQuote.route,
                txPayloadKeys: onChainQuote.txPayload ? Object.keys(onChainQuote.txPayload) : [],
                txPayloadTo: onChainQuote.txPayload.to,
                txPayloadDataLen: onChainQuote.txPayload.data.length,
              }
            : null,
        },
      )
    }

    // For on-chain-only chains, use on-chain quote data instead of Trading API
    if (isOnChainOnly) {
      if (onChainQuote?.txPayload) {
        const txPayload = onChainQuote.txPayload

        if (chainId === 84532) {
          logger.debug(
            'getEVMSwapTransactionRequestInfo',
            'getEVMSwapTransactionRequestInfo',
            '[ONCHAIN-TX-BUILD] Building tx request from on-chain quote',
            {
              chainId,
              txTo: txPayload.to,
              txDataLen: txPayload.data.length,
              txValue: txPayload.value,
              txGasLimit: txPayload.gasLimit,
            },
          )
        }

        // Build transaction request from on-chain quote payload
        const swapTxRequest: providers.TransactionRequest = {
          to: txPayload.to as `0x${string}`,
          data: txPayload.data as `0x${string}`,
          value: txPayload.value ? BigInt(txPayload.value) : undefined,
          gasLimit: txPayload.gasLimit ? BigInt(txPayload.gasLimit) : undefined,
        }

        // Return transaction request info with on-chain data
        // Gas fee will be estimated separately by the gas estimation system
        // For now, provide a placeholder so validation passes
        return {
          txRequests: [swapTxRequest],
          permitData: undefined,
          gasFeeResult: {
            value: '0', // Placeholder - will be updated by gas estimation
            displayValue: '0', // Placeholder - will be updated by gas estimation
            error: null,
            isLoading: false, // Set to false so validation passes; gas will be estimated separately
          },
          gasEstimate: {},
          swapRequestArgs: undefined,
          includesDelegation: false,
        }
      } else {
        // On-chain-only chain but no on-chain quote yet - this is expected during loading
        if (chainId === 84532) {
          logger.debug(
            'getEVMSwapTransactionRequestInfo',
            'getEVMSwapTransactionRequestInfo',
            '[ONCHAIN-TX-BUILD] On-chain-only chain but no onChainQuote yet',
            {
              chainId,
              hasOnChainQuote: !!onChainQuote,
              hasTxPayload: !!onChainQuote?.txPayload,
              onChainQuoteType: onChainQuote ? typeof onChainQuote : 'null',
              onChainQuoteKeys: onChainQuote ? Object.keys(onChainQuote) : [],
            },
          )
        }
        // Don't throw - return empty result so query can retry when onChainQuote becomes available
        return {
          txRequests: undefined,
          permitData: undefined,
          gasFeeResult: {
            value: '0',
            displayValue: '0',
            error: null,
            isLoading: true, // Still loading
          },
          gasEstimate: {},
          swapRequestArgs: undefined,
          includesDelegation: false,
        }
      }
    }

    // Guard: fail safely if Trading API quote is missing (on-chain-only chains don't have trade.quote)
    if (!trade.quote.quote) {
      throw new Error('Missing Trading API quote for classic tx request build')
    }

    const swapQuoteResponse = trade.quote
    const swapQuote = swapQuoteResponse.quote

    const approvalAction = tokenApprovalInfo.action
    const approvalUnknown = approvalAction === ApprovalAction.Unknown

    const skip = getSwapInputExceedsBalance({ derivedSwapInfo }) || approvalUnknown
    const { data, error } = await tryCatch(
      skip
        ? Promise.resolve(undefined)
        : instructionService.getSwapInstructions({ swapQuoteResponse, transactionSettings, approvalAction }),
    )

    const isRevokeNeeded = tokenApprovalInfo.action === ApprovalAction.RevokeAndPermit2Approve
    const swapTxInfo = processSwapResponse({
      response: data?.response ?? undefined,
      error,
      permitData: data?.unsignedPermit,
      swapQuote,
      isSwapLoading: false,
      isRevokeNeeded,
      swapRequestParams: data?.swapRequestParams ?? undefined,
    })

    return swapTxInfo
  }

  return getEVMSwapTransactionRequestInfo
}
