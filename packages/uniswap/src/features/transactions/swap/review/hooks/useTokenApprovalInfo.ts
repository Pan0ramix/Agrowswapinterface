import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { TradingApi } from '@universe/api'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useUniswapContextSelector } from 'uniswap/src/contexts/UniswapContext'
import { useCheckApprovalQuery } from 'uniswap/src/data/apiClients/tradingApi/useCheckApprovalQuery'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { convertGasFeeToDisplayValue, useActiveGasStrategy } from 'uniswap/src/features/gas/hooks'
import { GasFeeResult } from 'uniswap/src/features/gas/types'
import { ApprovalAction, TokenApprovalInfo } from 'uniswap/src/features/transactions/swap/types/trade'
import { isUniswapX } from 'uniswap/src/features/transactions/swap/utils/routing'
import {
  getTokenAddressForApi,
  toTradingApiSupportedChainId,
} from 'uniswap/src/features/transactions/swap/utils/tradingApi'
import {
  isOnChainOnlyChain,
  isOnChainRouterEnabled,
} from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { WrapType } from 'uniswap/src/features/transactions/types/wrap'
import { AccountDetails } from 'uniswap/src/features/wallet/types/AccountDetails'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { getAgroswapSwapRouterAddress } from 'uniswap/src/constants/agroswapAddresses'
import { logger } from 'utilities/src/logger/logger'
import { ONE_MINUTE_MS, ONE_SECOND_MS } from 'utilities/src/time/time'
import { Interface } from 'ethers/lib/utils'
import type { providers } from 'ethers/lib/ethers'

export interface TokenApprovalInfoParams {
  chainId: UniverseChainId
  wrapType: WrapType
  currencyInAmount: Maybe<CurrencyAmount<Currency>>
  currencyOutAmount?: Maybe<CurrencyAmount<Currency>>
  routing: TradingApi.Routing | undefined
  account?: AccountDetails
  // For on-chain-only swaps: router/spender address to check allowance against
  // Should match the swap transaction request's `to` address
  routerAddress?: string
  // For on-chain-only swaps: swap transaction request data (if available) to extract spender
  swapTxRequest?: { to?: string } | null
}

export type ApprovalTxInfo = {
  tokenApprovalInfo: TokenApprovalInfo
  approvalGasFeeResult: GasFeeResult
  revokeGasFeeResult: GasFeeResult
}

function useApprovalWillBeBatchedWithSwap(chainId: UniverseChainId, routing: TradingApi.Routing | undefined): boolean {
  const canBatchTransactions = useUniswapContextSelector((ctx) => ctx.getCanBatchTransactions?.(chainId))
  const swapDelegationInfo = useUniswapContextSelector((ctx) => ctx.getSwapDelegationInfo?.(chainId))

  const isBatchableFlow = Boolean(routing && !isUniswapX({ routing }))

  return Boolean((canBatchTransactions || swapDelegationInfo?.delegationAddress) && isBatchableFlow)
}

export function useTokenApprovalInfo(params: TokenApprovalInfoParams): ApprovalTxInfo {
  const { account, chainId, wrapType, currencyInAmount, currencyOutAmount, routing } = params

  const isWrap = wrapType !== WrapType.NotApplicable
  /** Approval is included elsewhere for Chained Actions so it can be skipped */
  const isChained = routing === TradingApi.Routing.CHAINED

  const address = account?.address
  const inputWillBeWrapped = routing && isUniswapX({ routing })
  // Off-chain orders must have wrapped currencies approved, rather than natives.
  const currencyIn = inputWillBeWrapped ? currencyInAmount?.currency.wrapped : currencyInAmount?.currency
  const amount = currencyInAmount?.quotient.toString()

  const tokenInAddress = getTokenAddressForApi(currencyIn)

  // Only used for bridging
  const isBridge = routing === TradingApi.Routing.BRIDGE
  const currencyOut = currencyOutAmount?.currency
  const tokenOutAddress = getTokenAddressForApi(currencyOut)

  const gasStrategy = useActiveGasStrategy(chainId, 'general')

  const approvalRequestArgs: TradingApi.ApprovalRequest | undefined = useMemo(() => {
    const tokenInChainId = toTradingApiSupportedChainId(chainId)
    const tokenOutChainId = toTradingApiSupportedChainId(currencyOut?.chainId)

    if (!address || !amount || !currencyIn || !tokenInAddress || !tokenInChainId) {
      return undefined
    }
    if (isBridge && !tokenOutAddress && !tokenOutChainId) {
      return undefined
    }

    return {
      walletAddress: address,
      token: tokenInAddress,
      amount,
      chainId: tokenInChainId,
      includeGasInfo: true,
      tokenOut: tokenOutAddress,
      tokenOutChainId,
      gasStrategies: [gasStrategy],
    }
  }, [
    gasStrategy,
    address,
    amount,
    chainId,
    currencyIn,
    currencyOut?.chainId,
    isBridge,
    tokenInAddress,
    tokenOutAddress,
  ])

  const approvalWillBeBatchedWithSwap = useApprovalWillBeBatchedWithSwap(chainId, routing)
  const isOnChainEnabled = isOnChainRouterEnabled(chainId)
  const isOnChainOnly = isOnChainOnlyChain(chainId)
  // Skip Trading API approval check for on-chain-only chains (use on-chain allowance reads instead)
  const shouldSkip =
    !approvalRequestArgs || isWrap || !address || approvalWillBeBatchedWithSwap || isChained || isOnChainOnly

  const { data, isLoading, error } = useCheckApprovalQuery({
    params: shouldSkip ? undefined : approvalRequestArgs,
    staleTime: 15 * ONE_SECOND_MS,
    immediateGcTime: ONE_MINUTE_MS,
  })

  // CRITICAL: For on-chain-only chains, check allowance on-chain and generate approval if needed
  const publicClient = useMemo(() => {
    if (!isOnChainOnly || !chainId) return undefined
    return createViemClient({ chainId })
  }, [isOnChainOnly, chainId])

  // ERC20 ABI for allowance and approve
  const ERC20_ABI = [
    {
      inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
      ],
      name: 'allowance',
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
    {
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      name: 'approve',
      outputs: [{ name: '', type: 'bool' }],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ] as const

  // Determine spender address: prefer swap tx request's `to` address, then provided routerAddress, then config
  // CRITICAL: The spender must match the swap transaction's `to` address for the approval to work
  const spenderAddress = useMemo(() => {
    // For on-chain-only swaps, prefer the swap tx request's `to` address (actual router used in swap)
    if (isOnChainOnly && params.swapTxRequest?.to) {
      logger.debug('useTokenApprovalInfo', 'spenderAddress', '[SWAP-STEPS] using swap tx request spender', {
        chainId,
        spenderFromSwapTx: params.swapTxRequest.to,
        routerAddressFromConfig: params.routerAddress,
      })
      return params.swapTxRequest.to
    }
    // Fallback to provided router address
    if (params.routerAddress) {
      return params.routerAddress
    }
    // Final fallback to config
    if (isOnChainOnly && chainId === 84532) {
      return getAgroswapSwapRouterAddress(chainId)
    }
    return undefined
  }, [params.routerAddress, params.swapTxRequest?.to, isOnChainOnly, chainId])

  // Check on-chain allowance for on-chain-only swaps
  const {
    data: onChainAllowance,
    isLoading: isAllowanceLoading,
    error: allowanceError,
  } = useQuery({
    queryKey: [
      'onchain-allowance',
      chainId,
      address,
      tokenInAddress,
      spenderAddress,
      amount,
    ],
    queryFn: async () => {
      if (!publicClient || !address || !tokenInAddress || !spenderAddress || !amount || currencyIn?.isNative) {
        return null
      }

      try {
        const allowance = await publicClient.readContract({
          address: tokenInAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address as `0x${string}`, spenderAddress as `0x${string}`],
        })

        logger.debug('useTokenApprovalInfo', 'allowance-check', '[SWAP-STEPS] allowance check', {
          token: tokenInAddress,
          owner: address,
          spender: spenderAddress,
          allowance: allowance.toString(),
          required: amount,
          chainId,
        })

        return {
          allowance: BigInt(allowance.toString()),
          required: BigInt(amount),
          isSufficient: BigInt(allowance.toString()) >= BigInt(amount),
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.warn('useTokenApprovalInfo', 'allowance-check-failed', errorMessage, {
          chainId,
          token: tokenInAddress,
          spender: spenderAddress,
          error: errorMessage,
        })
        return null
      }
    },
    enabled: Boolean(
      isOnChainOnly &&
      publicClient &&
      address &&
      tokenInAddress &&
      spenderAddress &&
      amount &&
      !currencyIn?.isNative,
    ),
    staleTime: 10_000, // 10 seconds
    gcTime: 30_000, // 30 seconds
  })

  // Generate approval transaction if allowance is insufficient
  const onChainApprovalTxRequest = useMemo((): providers.TransactionRequest | null => {
    if (
      !isOnChainOnly ||
      !onChainAllowance ||
      onChainAllowance.isSufficient ||
      !tokenInAddress ||
      !spenderAddress ||
      !amount ||
      currencyIn?.isNative
    ) {
      return null
    }

    try {
      const erc20Interface = new Interface(ERC20_ABI)
      const approveData = erc20Interface.encodeFunctionData('approve', [spenderAddress, amount])

      logger.debug('useTokenApprovalInfo', 'onChainApprovalTxRequest', '[SWAP-STEPS] adding approve step', {
        token: tokenInAddress,
        spender: spenderAddress,
        amount,
        chainId,
      })

      // CRITICAL: Ensure approval tx request has all required fields for validation
      // validateTransactionRequest requires: to, chainId
      const approvalTx: providers.TransactionRequest = {
        to: tokenInAddress,
        data: approveData,
        value: '0x0',
        chainId,
      }

      // Validate the tx request shape before returning
      if (!approvalTx.to || !approvalTx.chainId) {
        logger.error(new Error('[SWAP-STEPS] Invalid approval tx request shape'), {
          tags: { file: 'useTokenApprovalInfo', function: 'onChainApprovalTxRequest' },
          extra: {
            hasTo: !!approvalTx.to,
            hasChainId: !!approvalTx.chainId,
            tokenInAddress,
            spenderAddress,
            amount,
            chainId,
          },
        })
        return null
      }

      logger.debug('useTokenApprovalInfo', 'onChainApprovalTxRequest', '[SWAP-STEPS] generated approval tx request', {
        token: tokenInAddress,
        spender: spenderAddress,
        amount,
        chainId,
        to: approvalTx.to,
        dataLen: (approvalTx.data as string | undefined)?.length,
      })

      return approvalTx
    } catch (error) {
      logger.error(error, {
        tags: { file: 'useTokenApprovalInfo', function: 'onChainApprovalTxRequest' },
        extra: { tokenInAddress, spenderAddress, amount, chainId },
      })
      return null
    }
  }, [isOnChainOnly, onChainAllowance, tokenInAddress, spenderAddress, amount, currencyIn?.isNative, chainId])

  const tokenApprovalInfo: TokenApprovalInfo = useMemo(() => {
    // For on-chain-only chains, use on-chain allowance check
    if (isOnChainOnly) {
      if (currencyIn?.isNative || isWrap || !address) {
        return {
          action: ApprovalAction.None,
          txRequest: null,
          cancelTxRequest: null,
        }
      }

      if (isAllowanceLoading) {
        return {
          action: ApprovalAction.Unknown,
          txRequest: null,
          cancelTxRequest: null,
        }
      }

      if (allowanceError || !onChainAllowance) {
        // If we can't check allowance, assume approval is needed for safety
        if (onChainApprovalTxRequest) {
          logger.debug('useTokenApprovalInfo', 'onChainApprovalNeeded', '[SWAP-STEPS] on-chain approval needed (allowance check failed)', {
            chainId,
            token: tokenInAddress,
            spender: spenderAddress,
            hasApprovalTxRequest: !!onChainApprovalTxRequest,
            approvalTxRequestTo: onChainApprovalTxRequest.to,
            approvalTxRequestDataLen: (onChainApprovalTxRequest.data as string | undefined)?.length,
          })
          return {
            // NOTE: ApprovalAction.Permit2Approve is used for all ERC20 approvals in this codebase,
            // including direct router approvals (not just Permit2 contract approvals).
            // The action type is just a label; the actual approval transaction is a direct ERC20 approve.
            action: ApprovalAction.Permit2Approve,
            txRequest: onChainApprovalTxRequest,
            cancelTxRequest: null,
          }
        }
        return {
          action: ApprovalAction.Unknown,
          txRequest: null,
          cancelTxRequest: null,
        }
      }

      if (!onChainAllowance.isSufficient) {
        if (onChainApprovalTxRequest) {
          logger.debug('useTokenApprovalInfo', 'onChainApprovalNeeded', '[SWAP-STEPS] on-chain approval needed (allowance insufficient)', {
            chainId,
            token: tokenInAddress,
            spender: spenderAddress,
            allowance: onChainAllowance.allowance.toString(),
            required: onChainAllowance.required.toString(),
            hasApprovalTxRequest: !!onChainApprovalTxRequest,
            approvalTxRequestTo: onChainApprovalTxRequest.to,
            approvalTxRequestDataLen: (onChainApprovalTxRequest.data as string | undefined)?.length,
          })
          return {
            // NOTE: ApprovalAction.Permit2Approve is used for all ERC20 approvals in this codebase,
            // including direct router approvals (not just Permit2 contract approvals).
            // The action type is just a label; the actual approval transaction is a direct ERC20 approve.
            action: ApprovalAction.Permit2Approve,
            txRequest: onChainApprovalTxRequest,
            cancelTxRequest: null,
          }
        }
        logger.error(new Error('[SWAP-STEPS] ERROR attempted swap without sufficient allowance'), {
          tags: { file: 'useTokenApprovalInfo', function: 'tokenApprovalInfo' },
          extra: {
            token: tokenInAddress,
            owner: address,
            spender: spenderAddress,
            allowance: onChainAllowance.allowance.toString(),
            required: onChainAllowance.required.toString(),
            chainId,
          },
        })
        return {
          action: ApprovalAction.Unknown,
          txRequest: null,
          cancelTxRequest: null,
        }
      }

      // Allowance is sufficient
      return {
        action: ApprovalAction.None,
        txRequest: null,
        cancelTxRequest: null,
      }
    }

    // For non-on-chain-only chains, use Trading API approval check
    if (isOnChainEnabled && !isOnChainOnly) {
      return {
        action: ApprovalAction.None,
        txRequest: null,
        cancelTxRequest: null,
      }
    }

    if (error) {
      logger.error(error, {
        tags: { file: 'useTokenApprovalInfo', function: 'useTokenApprovalInfo' },
        extra: {
          approvalRequestArgs,
        },
      })
    }

    // Approval is N/A for wrap transactions or unconnected state.
    if (isWrap || !address || approvalWillBeBatchedWithSwap || isChained) {
      return {
        action: ApprovalAction.None,
        txRequest: null,
        cancelTxRequest: null,
      }
    }

    if (data && !error) {
      // API returns null if no approval is required

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (data.approval === null) {
        return {
          action: ApprovalAction.None,
          txRequest: null,
          cancelTxRequest: null,
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (data.approval) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (data.cancel) {
          return {
            action: ApprovalAction.RevokeAndPermit2Approve,
            txRequest: data.approval,
            cancelTxRequest: data.cancel,
          }
        }

        return {
          action: ApprovalAction.Permit2Approve,
          txRequest: data.approval,
          cancelTxRequest: null,
        }
      }
    }

    // No valid approval type found
    return {
      action: ApprovalAction.Unknown,
      txRequest: null,
      cancelTxRequest: null,
    }
  }, [
    address,
    approvalRequestArgs,
    approvalWillBeBatchedWithSwap,
    data,
    error,
    isWrap,
    isChained,
    isOnChainEnabled,
    isOnChainOnly,
    currencyIn?.isNative,
    isAllowanceLoading,
    allowanceError,
    onChainAllowance,
    onChainApprovalTxRequest,
    tokenInAddress,
    spenderAddress,
    amount,
    chainId,
  ])

  return useMemo(() => {
    const gasEstimate = data?.gasEstimates?.[0]
    const noApprovalNeeded = tokenApprovalInfo.action === ApprovalAction.None
    const noRevokeNeeded =
      tokenApprovalInfo.action === ApprovalAction.Permit2Approve || tokenApprovalInfo.action === ApprovalAction.None
    const approvalFee = noApprovalNeeded ? '0' : data?.gasFee
    const revokeFee = noRevokeNeeded ? '0' : data?.cancelGasFee

    // For on-chain-only swaps, gas fee is not available from Trading API
    // We'll estimate it separately if needed, but for now return minimal gas fee result
    const unknownApproval = tokenApprovalInfo.action === ApprovalAction.Unknown
    const isGasLoading = unknownApproval && (isLoading || isAllowanceLoading)
    const approvalGasError =
      unknownApproval && !isLoading && !isAllowanceLoading
        ? new Error('Approval action unknown')
        : allowanceError
          ? new Error(`Allowance check failed: ${allowanceError instanceof Error ? allowanceError.message : String(allowanceError)}`)
          : null

    return {
      tokenApprovalInfo,
      approvalGasFeeResult: {
        value: approvalFee,
        displayValue: convertGasFeeToDisplayValue(approvalFee, gasStrategy),
        isLoading: isGasLoading,
        error: approvalGasError,
        gasEstimate,
      },
      revokeGasFeeResult: {
        value: revokeFee,
        displayValue: convertGasFeeToDisplayValue(revokeFee, gasStrategy),
        isLoading: isGasLoading,
        error: approvalGasError,
      },
    }
  }, [
    gasStrategy,
    data?.cancelGasFee,
    data?.gasEstimates,
    data?.gasFee,
    isLoading,
    tokenApprovalInfo,
    isAllowanceLoading,
    allowanceError,
  ])
}
