import { Experiments, getExperimentValue, PrivateRpcProperties } from '@universe/gating'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { RPCType, UniverseChainId } from 'uniswap/src/features/chains/types'
import {
  DEFAULT_FLASHBOTS_ENABLED,
  FLASHBOTS_DEFAULT_REFUND_PERCENT,
  FLASHBOTS_RPC_URL,
} from 'uniswap/src/features/providers/FlashbotsCommon'
import { logger } from 'utilities/src/logger/logger'

// Deduplication for RPC selection logs (module-level cache)
const rpcLogCache = new Map<string, number>()
const RPC_LOG_DEDUPE_WINDOW_MS = 5000 // 5 seconds

function shouldLogRpcSelection(chainId: number, rpcType: RPCType, rpcUrl: string): boolean {
  // Create stable key from selection parameters
  const logKey = `${chainId}:${rpcType}:${rpcUrl}`
  const now = Date.now()
  const lastLogTime = rpcLogCache.get(logKey)

  // Log if:
  // 1. Never logged before, OR
  // 2. Last log was more than DEDUPE_WINDOW_MS ago, OR
  // 3. Values have changed (new key)
  if (!lastLogTime || now - lastLogTime >= RPC_LOG_DEDUPE_WINDOW_MS) {
    rpcLogCache.set(logKey, now)

    // Clean old entries (keep cache size reasonable)
    if (rpcLogCache.size > 50) {
      const cutoff = now - RPC_LOG_DEDUPE_WINDOW_MS * 10
      for (const [key, timestamp] of rpcLogCache.entries()) {
        if (timestamp < cutoff) {
          rpcLogCache.delete(key)
        }
      }
    }

    return true
  }

  return false
}

// Types of configurations for RPC providers
export interface RpcConfig {
  rpcUrl: string
  shouldUseFlashbots?: boolean
  flashbotsConfig?: FlashbotsConfig
}

export interface FlashbotsConfig {
  refundPercent: number
}

/**
 * Selects the appropriate RPC URL based on the chain ID and RPC type
 * This utility is shared between createEthersProvider and createViemClient
 */
export function selectRpcUrl(chainId: UniverseChainId, rpcType: RPCType = RPCType.Public): RpcConfig | null {
  try {
    // Handle private RPC providers
    if (rpcType === RPCType.Private) {
      const privateRPCUrl = getChainInfo(chainId).rpcUrls[RPCType.Private]?.http[0]
      if (!privateRPCUrl) {
        throw new Error(`No private RPC available for chain ${chainId}`)
      }

      const flashbotsEnabled = getExperimentValue({
        experiment: Experiments.PrivateRpc,
        param: PrivateRpcProperties.FlashbotsEnabled,
        defaultValue: DEFAULT_FLASHBOTS_ENABLED,
      })

      if (chainId === UniverseChainId.Mainnet && flashbotsEnabled) {
        const flashbotsRefundPercent = getExperimentValue({
          experiment: Experiments.PrivateRpc,
          param: PrivateRpcProperties.RefundPercent,
          defaultValue: FLASHBOTS_DEFAULT_REFUND_PERCENT,
        })
        return {
          rpcUrl: FLASHBOTS_RPC_URL,
          shouldUseFlashbots: true,
          flashbotsConfig: {
            refundPercent: flashbotsRefundPercent,
          },
        }
      }

      return { rpcUrl: privateRPCUrl }
    }

    // Handle public RPC providers
    try {
      const publicRPCUrl = getChainInfo(chainId).rpcUrls[RPCType.Public]?.http[0]
      if (publicRPCUrl) {
        if (
          process.env.NODE_ENV !== 'production' &&
          chainId === UniverseChainId.BaseSepolia &&
          shouldLogRpcSelection(chainId, rpcType, publicRPCUrl)
        ) {
          logger.debugDeduped(
            'rpcUrlSelector',
            'selectRpcUrl',
            'Selected Public RPC',
            {
              chainId,
              rpcType,
              rpcUrl: publicRPCUrl,
            },
            {
              ttlMs: 10000,
              minIntervalMs: 10000,
              keyParts: ['Selected-Public-RPC', chainId, rpcType],
            }
          )
        }
        return { rpcUrl: publicRPCUrl }
      }
      throw new Error(`No public RPC available for chain ${chainId}`)
    } catch (error) {
      // Fall back to alternative public RPC URL if available
      const altPublicRPCUrl = getChainInfo(chainId).rpcUrls[RPCType.PublicAlt]?.http[0]
      if (altPublicRPCUrl) {
        if (
          process.env.NODE_ENV !== 'production' &&
          chainId === UniverseChainId.BaseSepolia &&
          shouldLogRpcSelection(chainId, rpcType, altPublicRPCUrl)
        ) {
          logger.debug('rpcUrlSelector', 'selectRpcUrl', 'Selected PublicAlt RPC', {
            chainId,
            rpcType,
            rpcUrl: altPublicRPCUrl,
          })
        }
        return { rpcUrl: altPublicRPCUrl }
      }
      throw error
    }
  } catch (error) {
    logger.error(error, {
      tags: { file: 'rpcUrlSelector', function: 'selectRpcUrl' },
      extra: { chainId, rpcType },
    })
    return null
  }
}
