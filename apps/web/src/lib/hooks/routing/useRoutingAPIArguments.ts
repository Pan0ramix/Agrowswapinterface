import { SkipToken, skipToken } from '@reduxjs/toolkit/query/react'
import { FeatureFlags, useFeatureFlag } from '@universe/gating'
import { useIsUniswapXSupportedChain } from 'hooks/useIsUniswapXSupportedChain'
import {
  createGetRoutingAPIArguments,
  type RoutingAPIInput,
  validateRoutingAPIInput,
} from 'lib/hooks/routing/createGetRoutingAPIArguments'
import { useMemo } from 'react'
import { GetQuoteArgs } from 'state/routing/types'
import { useIsMismatchAccountQuery } from 'uniswap/src/features/smartWallet/mismatch/hooks'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { useUniswapXPriorityOrderFlag } from 'uniswap/src/features/transactions/swap/utils/protocols'
import { logger } from 'utilities/src/logger/logger'

/**
 * Returns query arguments for the Routing API query or undefined if the
 * query should be skipped. Input arguments do not need to be memoized, as they will
 * be destructured.
 */
export function useRoutingAPIArguments(input: RoutingAPIInput): GetQuoteArgs | SkipToken {
  const isUniswapXSupportedChain = useIsUniswapXSupportedChain(input.tokenIn?.chainId)
  const isPriorityOrdersEnabled = useUniswapXPriorityOrderFlag(input.tokenIn?.chainId)
  const isDutchV3Enabled = useFeatureFlag(FeatureFlags.ArbitrumDutchV3)
  const { data: isDelegationMismatch } = useIsMismatchAccountQuery({ chainId: input.tokenIn?.chainId })
  // if there is a mismatched account, we want to disable uniswapX
  const canUseUniswapX = isUniswapXSupportedChain && !isDelegationMismatch

  const getRoutingAPIArguments = useMemo(
    () =>
      createGetRoutingAPIArguments({
        canUseUniswapX,
        isPriorityOrdersEnabled,
        isDutchV3Enabled,
      }),
    [canUseUniswapX, isPriorityOrdersEnabled, isDutchV3Enabled],
  )

  const { tokenIn, tokenOut, amount, account, routerPreference, protocolPreferences, tradeType } = input

  const inputValidated = validateRoutingAPIInput(input)

  // Check if on-chain router is enabled for this chain - if so, skip Trading API
  const isOnChainEnabled = useMemo(() => {
    if (!tokenIn?.chainId) {
      return false
    }
    return isOnChainRouterEnabled(tokenIn.chainId)
  }, [tokenIn?.chainId])

  return useMemo(() => {
    // Skip Trading API if on-chain router is enabled for this chain
    if (isOnChainEnabled) {
      // Development debug only; deduped per chainId to avoid spam.
      if (process.env.NODE_ENV !== 'production' && logOnChainSkipOnce(tokenIn?.chainId)) {
        logger.debug('useRoutingAPIArguments', 'useRoutingAPIArguments', 'Skipping Trading API for on-chain chain', {
          chainId: tokenIn?.chainId,
        })
      }
      return skipToken
    }
    if (!inputValidated) {
      return skipToken
    }
    return getRoutingAPIArguments({
      account,
      tokenIn,
      tokenOut,
      amount,
      tradeType,
      routerPreference,
      protocolPreferences,
    })
  }, [
    isOnChainEnabled,
    getRoutingAPIArguments,
    tokenIn,
    tokenOut,
    amount,
    account,
    routerPreference,
    protocolPreferences,
    tradeType,
    inputValidated,
  ])
}

// Deduplicate debug logging for on-chain skip per chainId
let lastOnChainSkipChainId: number | undefined
function logOnChainSkipOnce(chainId?: number): boolean {
  if (!chainId) {
    return false
  }
  if (lastOnChainSkipChainId === chainId) {
    return false
  }
  lastOnChainSkipChainId = chainId
  return true
}
