import { useSelector } from 'react-redux'
import { useFeatureFlaggedChainIds } from 'uniswap/src/features/chains/hooks/useFeatureFlaggedChainIds'
// This is the only file that should be importing `useOrderedChainIds` directly.
// biome-ignore lint/style/noRestrictedImports: legacy import will be migrated
import { useOrderedChainIds } from 'uniswap/src/features/chains/hooks/useOrderedChainIds'
import { EnabledChainsInfo, UniverseChainId } from 'uniswap/src/features/chains/types'
import { getEnabledChains, isTestnetChain } from 'uniswap/src/features/chains/utils'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
// biome-ignore lint/style/noRestrictedImports: legacy import will be migrated
import { selectIsTestnetModeEnabled } from 'uniswap/src/features/settings/selectors'

export function useIsModeMismatch(chainId?: UniverseChainId): boolean {
  const { isTestnetModeEnabled } = useEnabledChains()
  return isTestnetChain(chainId ?? UniverseChainId.Mainnet) ? !isTestnetModeEnabled : isTestnetModeEnabled
}

export function useEnabledChains(options?: { platform?: Platform; includeTestnets?: boolean }): EnabledChainsInfo {
  const featureFlaggedChainIds = useFeatureFlaggedChainIds()
  const safeFeatureFlaggedChainIds = (featureFlaggedChainIds ?? []) as UniverseChainId[]
  const isTestnetModeEnabled = useSelector(selectIsTestnetModeEnabled)
  const featureFlagsKey = safeFeatureFlaggedChainIds.join(',')

  const {
    chains: unorderedChains,
    gqlChains,
    defaultChainId,
  } = getEnabledChains({
    platform: options?.platform,
    includeTestnets: options?.includeTestnets,
    isTestnetModeEnabled,
    featureFlaggedChainIds: safeFeatureFlaggedChainIds,
  })

  const orderedChains = useOrderedChainIds(unorderedChains)

  return { chains: orderedChains, gqlChains, defaultChainId, isTestnetModeEnabled }
}

// use in non hook contexts
export function createGetEnabledChains(ctx: {
  getIsTestnetModeEnabled: () => boolean
  getFeatureFlaggedChainIds: () => UniverseChainId[]
}): () => EnabledChainsInfo {
  const { getIsTestnetModeEnabled, getFeatureFlaggedChainIds } = ctx
  return () =>
    getEnabledChains({
      isTestnetModeEnabled: getIsTestnetModeEnabled(),
      featureFlaggedChainIds: getFeatureFlaggedChainIds(),
    })
}
