/**
 * On-chain network cost estimation for Remove Liquidity
 *
 * Estimates gas costs directly from the blockchain without Trading API dependency.
 * Falls back gracefully if estimation fails.
 */

import { skipToken, useQuery } from '@tanstack/react-query'
import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { EVMUniverseChainId, UniverseChainId } from 'uniswap/src/features/chains/types'
import { useUSDCurrencyAmountOfGasFee } from 'uniswap/src/features/gas/hooks'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { logger } from 'utilities/src/logger/logger'
import { createPublicClient, defineChain, formatEther, http } from 'viem'

interface UseRemoveLiquidityNetworkCostParams {
  chainId: EVMUniverseChainId | undefined
  account: string | undefined
  txRequest:
    | {
        to: `0x${string}`
        data: `0x${string}`
        value?: bigint
      }
    | undefined
  enabled?: boolean
}

export interface RemoveLiqNetworkCost {
  gasLimit: bigint
  totalWei: bigint
  nativeFormatted: string // always derived if totalWei exists
  usdAmount?: CurrencyAmount<Currency> // optional
  usdFormatted?: string // optional
  feeModel: 'eip1559' | 'legacy'
}

interface NetworkCostEstimate {
  gasLimit: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasPrice?: bigint
  totalWei: bigint
  formattedNative: string
  feeModel: 'eip1559' | 'legacy'
}

// Module-level warnedKeys set to prevent spam (keyed by unique error scenario)
const warnedKeys = new Set<string>()

function getWarnKey(chainId: number | undefined, account: string | undefined, errorType: string): string {
  return `${chainId}-${account || 'no-account'}-${errorType}`
}

/**
 * Estimate network cost for Remove Liquidity transaction
 * Returns both native and USD amounts (USD optional, native always if available)
 */
export function useRemoveLiquidityNetworkCost({
  chainId,
  account,
  txRequest,
  enabled = true,
}: UseRemoveLiquidityNetworkCostParams): {
  isLoading: boolean
  error: Error | null
  data?: RemoveLiqNetworkCost
} {
  const publicClient = useMemo(() => {
    if (!chainId) {
      return undefined
    }

    // For Base Sepolia (84532), prefer Alchemy RPC if configured
    if (chainId === UniverseChainId.BaseSepolia) {
      const alchemyRpcUrl = process.env.REACT_APP_ALCHEMY_BASE_SEPOLIA
      if (alchemyRpcUrl) {
        try {
          const chainInfo = getChainInfo(UniverseChainId.BaseSepolia)
          const viemChain = defineChain({
            id: chainInfo.id,
            name: chainInfo.name,
            nativeCurrency: chainInfo.nativeCurrency,
            rpcUrls: chainInfo.rpcUrls,
          })
          return createPublicClient({
            chain: viemChain,
            transport: http(alchemyRpcUrl),
          })
        } catch (error) {
          // Fall through to default client
          if (process.env.NODE_ENV !== 'production') {
            logger.debug('useRemoveLiquidityNetworkCost', 'Failed to create Alchemy client, using default', {
              chainId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }
    }

    // Default: use createViemClient (handles RPC selection)
    return createViemClient({ chainId })
  }, [chainId])

  const queryKey = useMemo(() => {
    if (!chainId || !account || !txRequest || !publicClient) {
      return skipToken
    }
    // Stable query key: include chainId, account, to, hash of data (first 32 chars), and value
    const dataHash = txRequest.data.substring(0, 32) // More stable hash
    const valueStr = txRequest.value?.toString() || '0'
    return ['removeLiquidityNetworkCost', chainId, account, txRequest.to, dataHash, valueStr] as const
  }, [chainId, account, txRequest, publicClient])

  const queryFn = useMemo(() => {
    if (!chainId || !account || !txRequest || !publicClient) {
      return skipToken
    }

    return async (): Promise<NetworkCostEstimate> => {
      try {
        // Estimate gas limit
        const gasLimit = await publicClient.estimateGas({
          account: account as `0x${string}`,
          to: txRequest.to as `0x${string}`,
          data: txRequest.data as `0x${string}`,
          value: txRequest.value
            ? typeof txRequest.value === 'string'
              ? BigInt(txRequest.value)
              : txRequest.value
            : undefined,
        })

        // Try EIP-1559 fees first
        let maxFeePerGas: bigint | undefined
        let maxPriorityFeePerGas: bigint | undefined
        let gasPrice: bigint | undefined
        let feeModel: 'eip1559' | 'legacy' = 'legacy'

        try {
          const feeData = await publicClient.estimateFeesPerGas()
          if (feeData && 'maxFeePerGas' in feeData && feeData.maxFeePerGas) {
            maxFeePerGas = feeData.maxFeePerGas
            maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
            feeModel = 'eip1559'
          }
        } catch (feeError) {
          // Fallback to legacy gasPrice
          const warnKey = getWarnKey(chainId, account, 'estimateFeesPerGas-failed')
          if (process.env.NODE_ENV !== 'production' && !warnedKeys.has(warnKey)) {
            logger.debug('useRemoveLiquidityNetworkCost', 'estimateFeesPerGas failed, falling back to getGasPrice', {
              chainId,
              error: feeError instanceof Error ? feeError.message : String(feeError),
            })
            warnedKeys.add(warnKey)
          }
        }

        // If EIP-1559 failed, try legacy gasPrice
        if (!maxFeePerGas) {
          try {
            gasPrice = await publicClient.getGasPrice()
            feeModel = 'legacy'
          } catch (gasPriceError) {
            // If both fail, throw error (fail-soft handled by React Query)
            const warnKey = getWarnKey(chainId, account, 'getGasPrice-failed')
            if (process.env.NODE_ENV !== 'production' && !warnedKeys.has(warnKey)) {
              logger.debug('useRemoveLiquidityNetworkCost', 'Both fee estimation methods failed', {
                chainId,
                account,
                to: txRequest.to,
                error: gasPriceError instanceof Error ? gasPriceError.message : String(gasPriceError),
              })
              warnedKeys.add(warnKey)
            }
            throw new Error(
              `Failed to estimate gas price: ${gasPriceError instanceof Error ? gasPriceError.message : String(gasPriceError)}`,
            )
          }
        }

        // Calculate total cost deterministically
        const totalWei = maxFeePerGas ? gasLimit * maxFeePerGas : gasPrice ? gasLimit * gasPrice : 0n

        // Format native using viem formatEther (handles bigint correctly)
        const nativeFormatted = formatEther(totalWei)

        return {
          gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas,
          gasPrice,
          totalWei,
          formattedNative: nativeFormatted,
          feeModel,
        }
      } catch (error) {
        // Fail-soft: log dev-only warning once per unique error scenario
        const warnKey = getWarnKey(chainId, account, `gas-estimation-failed-${txRequest.to.substring(0, 10)}`)
        if (process.env.NODE_ENV !== 'production' && !warnedKeys.has(warnKey)) {
          logger.debug('useRemoveLiquidityNetworkCost', 'Gas estimation failed, network cost will show "—"', {
            chainId,
            account,
            to: txRequest.to,
            error: error instanceof Error ? error.message : String(error),
          })
          warnedKeys.add(warnKey)
        }
        // Re-throw so React Query sets isError state (UI will show "—")
        throw error
      }
    }
  }, [chainId, account, txRequest, publicClient])

  const {
    data: estimateData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && queryFn !== skipToken && !!txRequest && !!account && !!chainId,
    staleTime: 10_000, // 10 seconds
    gcTime: 30_000, // 30 seconds
    retry: 1,
    retryDelay: 1000,
  })

  // Convert totalWei to USD using existing hook (best-effort, optional)
  const gasFeeUSD = useUSDCurrencyAmountOfGasFee(chainId, estimateData?.totalWei.toString())

  // Build return object: always return native if available, USD is optional
  const data: RemoveLiqNetworkCost | undefined = estimateData
    ? {
        gasLimit: estimateData.gasLimit,
        totalWei: estimateData.totalWei,
        nativeFormatted: estimateData.formattedNative, // Always present if estimateData exists
        usdAmount: gasFeeUSD || undefined, // Optional
        usdFormatted: gasFeeUSD?.toExact() || undefined, // Optional
        feeModel: estimateData.feeModel,
      }
    : undefined

  return {
    isLoading,
    error: isError ? (error instanceof Error ? error : new Error(String(error))) : null,
    data,
  }
}
