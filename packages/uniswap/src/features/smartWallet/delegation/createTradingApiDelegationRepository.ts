import type { CheckWalletDelegation } from 'uniswap/src/data/apiClients/tradingApi/TradingApiClient'
import type {
  ChainDelegationDetails,
  DelegationRepository,
} from 'uniswap/src/features/smartWallet/delegation/delegationRepository'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import type { Logger } from 'utilities/src/logger/logger'

interface TradingApiClient {
  checkWalletDelegation: CheckWalletDelegation
}

/**
 * Creates a delegation repository that uses the trading API to check wallet delegations.
 * @param ctx - The context object containing the trading API client and logger.
 * @returns A delegation repository that can be used to check wallet delegations.
 */
export function createTradingApiDelegationRepository(ctx: {
  tradingApiClient: TradingApiClient
  logger?: Logger
}): DelegationRepository {
  /**
   * Checks the delegation status for a given wallet address and array of chain IDs.
   * @param input - The input object containing the wallet address and chain IDs.
   * @returns A record of chain IDs and their delegation details.
   */
  const getWalletDelegations: DelegationRepository['getWalletDelegations'] = async (input) => {
    const result: ChainDelegationDetails = {}

    // Filter out on-chain-only chains (Trading API disabled for these)
    const filteredChainIds = input.chainIds.filter((chainId) => !isOnChainOnlyChain(chainId))

    // If all chains are on-chain-only, return empty result
    if (filteredChainIds.length === 0) {
      for (const chainId of input.chainIds) {
        result[String(chainId)] = null
      }
      return result
    }

    try {
      const response = await ctx.tradingApiClient.checkWalletDelegation({
        walletAddresses: [input.address],
        chainIds: filteredChainIds,
      })

      const walletDelegationDetails = response.delegationDetails[input.address]

      // Populate the record with results for each requested chain
      for (const chainId of input.chainIds) {
        // On-chain-only chains return null (no delegation check needed)
        if (isOnChainOnlyChain(chainId)) {
          result[String(chainId)] = null
          continue
        }

        const delegationDetails = walletDelegationDetails?.[chainId]
        if (delegationDetails) {
          result[String(chainId)] = {
            currentDelegationAddress: delegationDetails.currentDelegationAddress,
            isWalletDelegatedToUniswap: delegationDetails.isWalletDelegatedToUniswap,
            latestDelegationAddress: delegationDetails.latestDelegationAddress,
          }
        } else {
          result[String(chainId)] = null
        }
      }
      return result
    } catch (error) {
      ctx.logger?.error(error, {
        tags: { file: 'createTradingApiDelegationRepository.ts', function: 'getWalletDelegations' },
        extra: { address: input.address, chainIds: input.chainIds },
      })
      // Return object with null values for all chains on error
      for (const chainId of input.chainIds) {
        result[String(chainId)] = null
      }
      return result
    }
  }
  return {
    getWalletDelegations,
  }
}
