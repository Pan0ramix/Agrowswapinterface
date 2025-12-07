import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { RPCType, UniverseChainId } from 'uniswap/src/features/chains/types'
import { SignerInfo } from 'uniswap/src/features/providers/FlashbotsCommon'
import { createFlashbotsRpcClient } from 'uniswap/src/features/providers/FlashbotsRpcClient'
import { selectRpcUrl } from 'uniswap/src/features/providers/rpcUrlSelector'
import { logger } from 'utilities/src/logger/logger'
import { createPublicClient, defineChain, http, PublicClient, walletActions } from 'viem'

// Creates a viem PublicClient for the given chain
// Supports Flashbots for private RPC providers when needed
export function createViemClient({
  chainId,
  rpcType = RPCType.Public,
  signerInfo,
}: {
  chainId: UniverseChainId
  rpcType?: RPCType
  signerInfo?: SignerInfo
}): PublicClient | undefined {
  try {
    // Use the shared RPC URL selector
    const rpcConfig = selectRpcUrl(chainId, rpcType)
    if (!rpcConfig) {
      return undefined
    }

    // Define the chain for viem
    const chainInfo = getChainInfo(chainId)
    // TEMP: Base Sepolia (84532) RPC override for on-chain quoting.
    // Force primary public RPC to avoid flaky alt endpoints. Do not enable for mainnet.
    let effectiveRpcUrl = rpcConfig.rpcUrl
    const shouldForcePublic =
      chainId === UniverseChainId.BaseSepolia &&
      (rpcType === RPCType.Public || rpcType === RPCType.Default || rpcType === RPCType.Fallback)
    if (shouldForcePublic) {
      const primaryPublic = chainInfo.rpcUrls?.[RPCType.Public]?.http?.[0]
      if (primaryPublic && primaryPublic !== effectiveRpcUrl) {
        effectiveRpcUrl = primaryPublic
        if (process.env.NODE_ENV !== 'production') {
          logger.debug('createViemClient', 'createViemClient', 'Applying Base Sepolia primary RPC override', {
            chainId,
            rpcType,
            rpcUrl: primaryPublic,
          })
        }
      }
    }

    const viemChain = defineChain({
      id: chainInfo.id,
      name: chainInfo.name,
      nativeCurrency: chainInfo.nativeCurrency,
      rpcUrls: chainInfo.rpcUrls,
    })

    let client

    // Check if we should use Flashbots
    if (rpcConfig.shouldUseFlashbots && rpcConfig.flashbotsConfig) {
      client = createFlashbotsRpcClient({
        chain: viemChain,
        refundPercent: rpcConfig.flashbotsConfig.refundPercent,
        signerInfo,
      })
    } else {
      // Create a standard public client
      client = createPublicClient({
        chain: viemChain,
        transport: http(effectiveRpcUrl),
      }).extend(walletActions)
    }

    // Attach the effective RPC URL for downstream logging/labeling when viem transport does not expose it.
    try {
      ;(client as any).__agroswapEffectiveRpcUrl = effectiveRpcUrl
    } catch {
      // ignore
    }

    if (process.env.NODE_ENV !== 'production' && chainId === UniverseChainId.BaseSepolia) {
      const rpcLabel = effectiveRpcUrl.includes('sepolia.base.org') ? 'base-public' : 'alt-public'
      logger.debug('createViemClient', 'createViemClient', 'Initialized viem client', {
        chainId,
        rpcType,
        rpcLabel,
        rpcUrl: effectiveRpcUrl,
      })
    }

    return client
  } catch (error) {
    logger.error(error, {
      tags: { file: 'createViemClient', function: 'createViemClient' },
      extra: { chainId, rpcType },
    })
    return undefined
  }
}
