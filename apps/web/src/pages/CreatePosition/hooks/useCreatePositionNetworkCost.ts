/**
 * Hook for on-chain network cost estimation for Create Position modal
 *
 * Uses viem's estimateGas + estimateFeesPerGas/getGasPrice to compute
 * network cost without requiring Trading API or pool discovery.
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

interface UseCreatePositionNetworkCostParams {
  chainId?: EVMUniverseChainId
  account?: string
  txRequest?: { to: `0x${string}`; data: `0x${string}`; value?: string }
  enabled?: boolean
}

export interface CreatePositionNetworkCost {
  gasLimit: bigint
  totalWei: bigint
  nativeFormatted: string
  usdAmount?: CurrencyAmount<Currency>
  usdFormatted?: string
  feeModel: 'eip1559' | 'legacy'
}

// Module-level warned keys set to prevent console spam
const warnedKeys = new Set<string>()

function getWarnKey(chainId: number | undefined, account: string | undefined, errorType: string): string {
  return `${chainId ?? 'unknown'}-${account ?? 'unknown'}-${errorType}`
}

export function useCreatePositionNetworkCost({
  chainId,
  account,
  txRequest,
  enabled = true,
}: UseCreatePositionNetworkCostParams) {
  // Prefer Alchemy RPC for Base Sepolia (more reliable gas estimations)
  const publicClient = useMemo(() => {
    if (!chainId) return undefined

    // Check for Alchemy RPC for Base Sepolia
    if (chainId === UniverseChainId.BaseSepolia) {
      const alchemyRpc = process.env.REACT_APP_ALCHEMY_BASE_SEPOLIA
      if (alchemyRpc) {
        return createPublicClient({
          chain: defineChain({
            id: chainId,
            name: 'Base Sepolia',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: {
              default: { http: [alchemyRpc] },
            },
          }),
          transport: http(),
        })
      }
    }

    return createViemClient({ chainId })
  }, [chainId])

  const queryKey = useMemo(
    () =>
      enabled && chainId && account && txRequest?.to && txRequest?.data
        ? [
            'createPositionNetworkCost',
            chainId,
            account,
            txRequest.to,
            txRequest.data.substring(0, 32), // Stable hash of calldata
            txRequest.value?.toString() ?? '0',
          ]
        : skipToken,
    [enabled, chainId, account, txRequest?.to, txRequest?.data, txRequest?.value],
  )

  const queryFn = useMemo(
    () =>
      enabled && chainId && account && txRequest?.to && txRequest?.data && publicClient
        ? async (): Promise<CreatePositionNetworkCost> => {
            try {
              // Normalize value
              let valueBigint: bigint | undefined
              if (txRequest.value) {
                const valueStr = typeof txRequest.value === 'string' ? txRequest.value : String(txRequest.value)
                if (valueStr === '0x0' || valueStr === '0x00' || valueStr === '0') {
                  valueBigint = undefined
                } else {
                  valueBigint = BigInt(valueStr)
                }
              }

              // Estimate gas limit
              const gasLimit = await publicClient.estimateGas({
                account: account as `0x${string}`,
                to: txRequest.to,
                data: txRequest.data,
                value: valueBigint,
              })

              // Try EIP-1559 fees first, fallback to legacy
              let maxFeePerGas: bigint | undefined
              let maxPriorityFeePerGas: bigint | undefined
              let gasPrice: bigint | undefined
              let feeModel: 'eip1559' | 'legacy' = 'eip1559'

              try {
                const feesPerGas = await publicClient.estimateFeesPerGas()
                if (feesPerGas.maxFeePerGas) {
                  maxFeePerGas = feesPerGas.maxFeePerGas
                  maxPriorityFeePerGas = feesPerGas.maxPriorityFeePerGas
                }
              } catch (error) {
                const warnKey = getWarnKey(chainId, account, 'estimateFeesPerGas')
                if (!warnedKeys.has(warnKey)) {
                  warnedKeys.add(warnKey)
                  if (process.env.NODE_ENV !== 'production') {
                    logger.debug(
                      'useCreatePositionNetworkCost',
                      'estimateFeesPerGas failed, falling back to getGasPrice',
                      { chainId, error: error instanceof Error ? error.message : String(error) },
                    )
                  }
                }

                // Fallback to legacy gas price
                try {
                  gasPrice = await publicClient.getGasPrice()
                  feeModel = 'legacy'
                } catch (legacyError) {
                  const legacyWarnKey = getWarnKey(chainId, account, 'getGasPrice')
                  if (!warnedKeys.has(legacyWarnKey)) {
                    warnedKeys.add(legacyWarnKey)
                    if (process.env.NODE_ENV !== 'production') {
                      logger.debug(
                        'useCreatePositionNetworkCost',
                        'getGasPrice also failed',
                        {
                          chainId,
                          error: legacyError instanceof Error ? legacyError.message : String(legacyError),
                        },
                      )
                    }
                  }
                  throw new Error('Both estimateFeesPerGas and getGasPrice failed')
                }
              }

              // Compute total wei
              const totalWei = maxFeePerGas ? gasLimit * maxFeePerGas : gasPrice ? gasLimit * gasPrice : 0n

              // Format native token amount
              const nativeFormatted = formatEther(totalWei)

              return {
                gasLimit,
                totalWei,
                nativeFormatted,
                feeModel,
              }
            } catch (error) {
              const warnKey = getWarnKey(chainId, account, 'estimation')
              if (!warnedKeys.has(warnKey)) {
                warnedKeys.add(warnKey)
                if (process.env.NODE_ENV !== 'production') {
                  logger.debug('useCreatePositionNetworkCost', 'Gas estimation failed', {
                    chainId,
                    account,
                    error: error instanceof Error ? error.message : String(error),
                  })
                }
              }
              throw error
            }
          }
        : skipToken,
    [enabled, chainId, account, txRequest, publicClient],
  )

  const {
    data: estimateData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!chainId && !!account && !!txRequest?.to && !!txRequest?.data && !!publicClient,
    retry: false,
    staleTime: 30_000, // 30 seconds
    gcTime: 60_000, // 1 minute
  })

  // Get USD conversion (optional, best-effort)
  const gasFeeUSD = useUSDCurrencyAmountOfGasFee(
    chainId as UniverseChainId | undefined,
    estimateData?.totalWei ? BigInt(estimateData.totalWei.toString()) : undefined,
  )

  // Combine estimate data with USD conversion
  const data: CreatePositionNetworkCost | undefined = estimateData
    ? {
        gasLimit: estimateData.gasLimit,
        totalWei: estimateData.totalWei,
        nativeFormatted: estimateData.nativeFormatted,
        usdAmount: gasFeeUSD || undefined,
        usdFormatted: gasFeeUSD?.toExact() || undefined,
        feeModel: estimateData.feeModel,
      }
    : undefined

  return { isLoading, error, data }
}

