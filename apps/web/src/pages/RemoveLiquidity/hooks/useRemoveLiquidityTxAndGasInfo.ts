import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { TradingApi } from '@universe/api'
import { getTokenOrZeroAddress } from 'components/Liquidity/utils/currency'
import { getProtocolItems, getProtocolVersionLabel } from 'components/Liquidity/utils/protocolVersion'
import JSBI from 'jsbi'
import { useRemoveLiquidityNetworkCost } from 'pages/RemoveLiquidity/hooks/useRemoveLiquidityNetworkCost'
import { useRemoveLiquidityModalContext } from 'pages/RemoveLiquidity/RemoveLiquidityModalContext'
import type { RemoveLiquidityTxInfo } from 'pages/RemoveLiquidity/RemoveLiquidityTxContext'
import { useEffect, useMemo, useState } from 'react'
import { useCheckLpApprovalQuery } from 'uniswap/src/data/apiClients/tradingApi/useCheckLpApprovalQuery'
import { useDecreaseLpPositionCalldataQuery } from 'uniswap/src/data/apiClients/tradingApi/useDecreaseLpPositionCalldataQuery'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { toSupportedChainId } from 'uniswap/src/features/chains/utils'
import { useTransactionGasFee, useUSDCurrencyAmountOfGasFee } from 'uniswap/src/features/gas/hooks'
import { InterfaceEventName } from 'uniswap/src/features/telemetry/constants'
import { sendAnalyticsEvent } from 'uniswap/src/features/telemetry/send'
import { useTransactionSettingsStore } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/useTransactionSettingsStore'
import { useV3DecreaseLiquidity } from 'uniswap/src/features/transactions/liquidity/hooks/useV3LiquidityOperations'
import { getErrorMessageToDisplay, parseErrorMessageTitle } from 'uniswap/src/features/transactions/liquidity/utils'
import {
  convertOnChainTxToDecreaseLpResponse,
  shouldUseV3OnChainLp,
} from 'uniswap/src/features/transactions/liquidity/utils/v3OnChainIntegration'
import { TransactionStepType } from 'uniswap/src/features/transactions/steps/types'
import { calculateAmountOutMinimumLenient } from 'uniswap/src/features/transactions/utils/slippage'
import { logger } from 'utilities/src/logger/logger'
import { ONE_SECOND_MS } from 'utilities/src/time/time'

export function useRemoveLiquidityTxAndGasInfo({ account }: { account?: string }): RemoveLiquidityTxInfo {
  const { positionInfo, percent, percentInvalid, currencies, currentTransactionStep } = useRemoveLiquidityModalContext()
  const { customDeadline, customSlippageTolerance } = useTransactionSettingsStore((s) => ({
    customDeadline: s.customDeadline,
    customSlippageTolerance: s.customSlippageTolerance,
  }))

  const [transactionError, setTransactionError] = useState<string | boolean>(false)

  const currency0 = currencies?.TOKEN0
  const currency1 = currencies?.TOKEN1

  const v2LpTokenApprovalQueryParams: TradingApi.CheckApprovalLPRequest | undefined = useMemo(() => {
    if (!positionInfo || !positionInfo.liquidityToken || percentInvalid || !positionInfo.liquidityAmount) {
      return undefined
    }
    return {
      protocol: TradingApi.ProtocolItems.V2,
      walletAddress: account,
      chainId: positionInfo.liquidityToken.chainId,
      positionToken: positionInfo.liquidityToken.address,
      positionAmount: positionInfo.liquidityAmount
        .multiply(JSBI.BigInt(percent))
        .divide(JSBI.BigInt(100))
        .quotient.toString(),
    }
  }, [positionInfo, percent, account, percentInvalid])
  const {
    data: v2LpTokenApproval,
    isLoading: v2ApprovalLoading,
    error: approvalError,
    refetch: approvalRefetch,
  } = useCheckLpApprovalQuery({
    params: v2LpTokenApprovalQueryParams,
    staleTime: 5 * ONE_SECOND_MS,
    enabled: Boolean(v2LpTokenApprovalQueryParams),
  })

  if (approvalError) {
    logger.info(
      'RemoveLiquidityTxAndGasInfo',
      'RemoveLiquidityTxAndGasInfo',
      parseErrorMessageTitle(approvalError, { defaultTitle: 'unkown CheckLpApprovalQuery' }),
      {
        error: JSON.stringify(approvalError),
        v2LpTokenApprovalQueryParams: JSON.stringify(v2LpTokenApprovalQueryParams),
      },
    )
  }

  const v2ApprovalGasFeeUSD =
    useUSDCurrencyAmountOfGasFee(
      positionInfo?.liquidityToken?.chainId,
      v2LpTokenApproval?.gasFeePositionTokenApproval,
    ) ?? undefined

  const approvalsNeeded = Boolean(v2LpTokenApproval)

  const { token0UncollectedFees, token1UncollectedFees } = positionInfo ?? {}

  const decreaseCalldataQueryParams = useMemo((): TradingApi.DecreaseLPPositionRequest | undefined => {
    const apiProtocolItems = getProtocolItems(positionInfo?.version)
    if (!positionInfo || !apiProtocolItems || !account || percentInvalid || !currency0 || !currency1) {
      return undefined
    }

    return {
      simulateTransaction: !approvalsNeeded,
      protocol: apiProtocolItems,
      tokenId: positionInfo.tokenId ? Number(positionInfo.tokenId) : undefined,
      chainId: positionInfo.currency0Amount.currency.chainId,
      walletAddress: account,
      liquidityPercentageToDecrease: Number(percent),
      liquidity0:
        positionInfo.version === ProtocolVersion.V2 ? positionInfo.currency0Amount.quotient.toString() : undefined,
      liquidity1:
        positionInfo.version === ProtocolVersion.V2 ? positionInfo.currency1Amount.quotient.toString() : undefined,
      positionLiquidity:
        positionInfo.version === ProtocolVersion.V2
          ? positionInfo.liquidityAmount?.quotient.toString()
          : positionInfo.liquidity,
      expectedTokenOwed0RawAmount: positionInfo.version !== ProtocolVersion.V4 ? token0UncollectedFees : undefined,
      expectedTokenOwed1RawAmount: positionInfo.version !== ProtocolVersion.V4 ? token1UncollectedFees : undefined,
      position: {
        tickLower: positionInfo.tickLower !== undefined ? positionInfo.tickLower : undefined,
        tickUpper: positionInfo.tickUpper !== undefined ? positionInfo.tickUpper : undefined,
        pool: {
          token0: getTokenOrZeroAddress(currency0),
          token1: getTokenOrZeroAddress(currency1),
          fee: positionInfo.feeTier?.feeAmount,
          tickSpacing: positionInfo.tickSpacing ? Number(positionInfo.tickSpacing) : undefined,
          hooks: positionInfo.v4hook,
        },
      },
      slippageTolerance: customSlippageTolerance,
    }
  }, [
    positionInfo,
    account,
    percentInvalid,
    currency0,
    currency1,
    approvalsNeeded,
    percent,
    token0UncollectedFees,
    token1UncollectedFees,
    customSlippageTolerance,
  ])

  // AGROSWAP: Check if we should use on-chain methods instead of Trading API
  const chainId = positionInfo?.currency0Amount.currency.chainId
  const protocolVersion = positionInfo?.version
  const protocolVersionStr = protocolVersion
    ? (getProtocolVersionLabel(protocolVersion) ?? protocolVersion.toString())
    : undefined
  const useOnChainV3 = useMemo(() => {
    if (!chainId || !protocolVersion) {
      return false
    }

    // Check if protocol is V3 (check both string and enum for safety)
    const isV3Protocol =
      protocolVersionStr === 'v3' || protocolVersionStr === 'V3' || protocolVersion === ProtocolVersion.V3

    if (!isV3Protocol) {
      return false
    }

    return shouldUseV3OnChainLp({
      chainId: chainId as number,
      protocolVersion: protocolVersionStr || 'V3', // Fallback to 'V3' if string conversion fails
    })
  }, [chainId, protocolVersion, protocolVersionStr])

  // AGROSWAP: Calculate liquidity and amounts for on-chain decrease
  const liquidityToDecrease = useMemo(() => {
    if (!useOnChainV3 || !positionInfo?.liquidity || percentInvalid) {
      return undefined
    }
    // Calculate liquidity amount to decrease based on percentage
    const totalLiquidity = BigInt(positionInfo.liquidity)
    const percentBigInt = BigInt(percent)
    const liquidityToRemove = (totalLiquidity * percentBigInt) / 100n
    return liquidityToRemove.toString()
  }, [useOnChainV3, positionInfo?.liquidity, percent, percentInvalid])

  // Calculate amount0Min and amount1Min from position amounts and slippage
  const slippageTolerancePercent = useMemo(() => {
    if (customSlippageTolerance !== undefined) {
      const basisPoints = Math.round(customSlippageTolerance * 100)
      return new Percent(basisPoints, 10_000)
    }
    return new Percent(50, 10_000) // Default 0.5%
  }, [customSlippageTolerance])

  const amount0ToRemove = useMemo(() => {
    if (!useOnChainV3 || !positionInfo?.currency0Amount || !currency0 || percentInvalid) {
      return undefined
    }
    const totalAmount0 = CurrencyAmount.fromRawAmount(currency0, positionInfo.currency0Amount.quotient)
    return totalAmount0.multiply(percent).divide(100)
  }, [useOnChainV3, positionInfo?.currency0Amount, currency0, percent, percentInvalid])

  const amount1ToRemove = useMemo(() => {
    if (!useOnChainV3 || !positionInfo?.currency1Amount || !currency1 || percentInvalid) {
      return undefined
    }
    const totalAmount1 = CurrencyAmount.fromRawAmount(currency1, positionInfo.currency1Amount.quotient)
    return totalAmount1.multiply(percent).divide(100)
  }, [useOnChainV3, positionInfo?.currency1Amount, currency1, percent, percentInvalid])

  const amount0Min = useMemo(() => {
    if (!amount0ToRemove || !useOnChainV3) {
      return undefined
    }
    // Use lenient mode: resilient fallback that preserves protection (amountOut if invalid)
    const chainId = currencies?.[0]?.chainId
    return calculateAmountOutMinimumLenient(amount0ToRemove, slippageTolerancePercent, {
      feature: 'liquidity',
      chainId: chainId ? Number(chainId) : undefined,
    })
  }, [amount0ToRemove, slippageTolerancePercent, useOnChainV3, currencies])

  const amount1Min = useMemo(() => {
    if (!amount1ToRemove || !useOnChainV3) {
      return undefined
    }
    // Use lenient mode: resilient fallback that preserves protection (amountOut if invalid)
    const chainId = currencies?.[0]?.chainId
    return calculateAmountOutMinimumLenient(amount1ToRemove, slippageTolerancePercent, {
      feature: 'liquidity',
      chainId: chainId ? Number(chainId) : undefined,
    })
  }, [amount1ToRemove, slippageTolerancePercent, useOnChainV3, currencies])

  const isUserCommittedToDecrease =
    currentTransactionStep?.step.type === TransactionStepType.DecreasePositionTransaction

  // AGROSWAP: Use on-chain hook for Base Sepolia V3
  const onChainDecreaseLiquidity = useV3DecreaseLiquidity({
    tokenId: positionInfo?.tokenId ? Number(positionInfo.tokenId) : undefined,
    liquidity: liquidityToDecrease,
    amount0Min,
    amount1Min,
    chainId: chainId as EVMUniverseChainId | undefined,
    enabled:
      useOnChainV3 &&
      !isUserCommittedToDecrease &&
      !percentInvalid &&
      !!liquidityToDecrease &&
      !!amount0Min &&
      !!amount1Min &&
      !!positionInfo?.tokenId,
  })

  // AGROSWAP: Disable Trading API query when using on-chain methods
  const disableTradingApi = useOnChainV3

  const {
    data: decreaseCalldata,
    isLoading: decreaseCalldataLoading,
    error: calldataError,
    refetch: calldataRefetch,
  } = useDecreaseLpPositionCalldataQuery({
    params: disableTradingApi ? undefined : decreaseCalldataQueryParams,
    deadlineInMinutes: disableTradingApi ? undefined : customDeadline,
    refetchInterval: false, // Always disable refetch interval
    retry: false,
    enabled:
      !disableTradingApi &&
      !isUserCommittedToDecrease &&
      !!decreaseCalldataQueryParams &&
      ((!percentInvalid && !v2LpTokenApprovalQueryParams) ||
        (!v2ApprovalLoading && !approvalError && Boolean(v2LpTokenApproval))),
  })

  // AGROSWAP: Merge on-chain and Trading API results
  const finalDecreaseCalldata = useMemo(() => {
    if (useOnChainV3) {
      // When using on-chain path, ONLY use on-chain data
      // Never fall back to Trading API data (even if cached) to prevent silent fallback
      if (onChainDecreaseLiquidity.txPayload && chainId) {
        // Get sqrtRatioX96 from position pool if available
        const sqrtRatioX96 =
          positionInfo.poolOrPair && 'sqrtRatioX96' in positionInfo.poolOrPair
            ? positionInfo.poolOrPair.sqrtRatioX96.toString()
            : undefined

        // Convert on-chain payload to Trading API response format for compatibility
        return convertOnChainTxToDecreaseLpResponse(
          onChainDecreaseLiquidity.txPayload,
          chainId as EVMUniverseChainId,
          sqrtRatioX96,
        ) as TradingApi.DecreaseLPPositionResponse
      }
      // Return undefined if on-chain fails - don't use Trading API fallback
      return undefined
    }
    // Only use Trading API when NOT using on-chain path
    return decreaseCalldata
  }, [useOnChainV3, onChainDecreaseLiquidity.txPayload, decreaseCalldata, chainId, positionInfo?.poolOrPair])

  // Merge errors
  const finalCalldataError = useMemo(() => {
    if (useOnChainV3) {
      return onChainDecreaseLiquidity.error || calldataError
    }
    return calldataError
  }, [useOnChainV3, onChainDecreaseLiquidity.error, calldataError])

  // Merge loading states
  const finalDecreaseCalldataLoading = useMemo(() => {
    if (useOnChainV3) {
      return onChainDecreaseLiquidity.isLoading
    }
    return decreaseCalldataLoading
  }, [useOnChainV3, onChainDecreaseLiquidity.isLoading, decreaseCalldataLoading])

  // biome-ignore lint/correctness/useExhaustiveDependencies: +decreaseCalldataQueryParams
  useEffect(() => {
    setTransactionError(getErrorMessageToDisplay({ approvalError, finalCalldataError }))
  }, [finalCalldataError, decreaseCalldataQueryParams, approvalError])

  if (finalCalldataError && !useOnChainV3) {
    // Only log Trading API errors, not on-chain errors (they're handled separately)
    const message = parseErrorMessageTitle(finalCalldataError, { defaultTitle: 'DecreaseLpPositionCalldataQuery' })
    logger.error(message, {
      tags: {
        file: 'RemoveLiquidityTxAndGasInfo',
        function: 'useEffect',
      },
    })
    sendAnalyticsEvent(InterfaceEventName.DecreaseLiquidityFailed, {
      message,
    })
  }

  // AGROSWAP: Use on-chain gas estimation when we have tx payload (Base Sepolia)
  // Fall back to Trading API gas service for other chains
  const onChainTxRequest = useMemo(() => {
    if (!useOnChainV3 || !onChainDecreaseLiquidity.txPayload || !account) {
      return undefined
    }
    const payload = onChainDecreaseLiquidity.txPayload
    // Ensure to and data are defined (required for gas estimation)
    if (!payload.to || !payload.data) {
      // Dev-only debug log once per modal open when request is missing
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('useRemoveLiquidityTxAndGasInfo', 'onChainTxRequest missing required fields', {
          hasTo: !!payload.to,
          hasData: !!payload.data,
        })
      }
      return undefined
    }

    // Normalize value: convert string to bigint or undefined (NOT '0x0' string)
    let valueBigint: bigint | undefined
    if (payload.value) {
      try {
        const valueStr = typeof payload.value === 'string' ? payload.value : String(payload.value)
        // Handle hex strings like '0x0' or '0x00' - convert to bigint
        if (valueStr === '0x0' || valueStr === '0x00' || valueStr === '0') {
          valueBigint = undefined // 0 value means undefined for viem
        } else {
          valueBigint = BigInt(valueStr)
        }
      } catch (error) {
        // Invalid value string - treat as undefined
        if (process.env.NODE_ENV !== 'production') {
          logger.debug('useRemoveLiquidityTxAndGasInfo', 'Failed to parse value, treating as undefined', {
            value: payload.value,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        valueBigint = undefined
      }
    }

    return {
      to: payload.to as `0x${string}`,
      data: payload.data as `0x${string}`,
      value: valueBigint,
    }
  }, [useOnChainV3, onChainDecreaseLiquidity.txPayload, account])

  // Use on-chain network cost hook for Base Sepolia (Alchemy RPC)
  const { data: onChainNetworkCost, isLoading: onChainGasLoading, error: onChainGasError } =
    useRemoveLiquidityNetworkCost({
      chainId: chainId as EVMUniverseChainId | undefined,
      account,
      txRequest: onChainTxRequest,
      enabled: useOnChainV3 && !!onChainTxRequest && !!account && !!chainId,
    })

  // Use Trading API/Uniswap API gas estimation ONLY for non-on-chain paths
  // IMPORTANT: Skip entirely when useOnChainV3 is true to prevent /v1/gas-fee calls
  const { value: estimatedGasFee } = useTransactionGasFee({
    tx: useOnChainV3 ? undefined : finalDecreaseCalldata?.decrease, // Only use for Trading API path
    skip: !!finalDecreaseCalldata?.gasFee || useOnChainV3, // Skip if using on-chain OR if gasFee already provided
  })
  const decreaseGasFeeUsd =
    useUSDCurrencyAmountOfGasFee(
      toSupportedChainId(finalDecreaseCalldata?.decrease?.chainId) ?? undefined,
      finalDecreaseCalldata?.gasFee || estimatedGasFee,
    ) ?? undefined

  // Select gas fee source: on-chain if available (Base Sepolia), otherwise Trading API (other chains)
  const totalGasFeeEstimate = useMemo(() => {
    if (useOnChainV3) {
      // On-chain estimation (Base Sepolia using Alchemy)
      // Always use USD amount if available, even if native is present
      const onChainUSD = onChainNetworkCost?.usdAmount
      if (onChainUSD) {
        return v2ApprovalGasFeeUSD ? onChainUSD.add(v2ApprovalGasFeeUSD) : onChainUSD
      }
      // Return undefined if still loading or failed (UI will show "—")
      return undefined
    }
    // Trading API/Uniswap API estimation (other chains)
    return v2ApprovalGasFeeUSD ? decreaseGasFeeUsd?.add(v2ApprovalGasFeeUSD) : decreaseGasFeeUsd
  }, [useOnChainV3, onChainNetworkCost?.usdAmount, v2ApprovalGasFeeUSD, decreaseGasFeeUsd])

  // Hard guard: prevent refetch from triggering Trading API when on-chain is active
  const finalRefetch = useMemo(() => {
    if (useOnChainV3) {
      // On-chain methods don't need refetch - they're reactive
      return undefined
    }
    return approvalError ? approvalRefetch : finalCalldataError ? calldataRefetch : undefined
  }, [useOnChainV3, approvalError, finalCalldataError, approvalRefetch, calldataRefetch])

  // Dev-only: log on-chain path selection
  if (process.env.NODE_ENV !== 'production') {
    console.log('[useRemoveLiquidityTxAndGasInfo] Path selection', {
      chainId,
      protocolVersion: protocolVersionStr,
      useOnChainV3,
      hasOnChainPayload: !!onChainDecreaseLiquidity.txPayload,
      hasTradingApiCalldata: !!decreaseCalldata,
      finalCalldataLoading: finalDecreaseCalldataLoading,
    })
  }

  return {
    gasFeeEstimateUSD: totalGasFeeEstimate,
    onChainNetworkCost: useOnChainV3 ? onChainNetworkCost : undefined, // Expose on-chain cost data for UI
    decreaseCalldataLoading: finalDecreaseCalldataLoading,
    decreaseCalldata: finalDecreaseCalldata,
    v2LpTokenApproval,
    approvalLoading: v2ApprovalLoading,
    error: getErrorMessageToDisplay({ approvalError, finalCalldataError }),
    refetch: finalRefetch,
  }
}
