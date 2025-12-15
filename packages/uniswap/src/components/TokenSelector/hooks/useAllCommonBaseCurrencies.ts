import { GqlResult } from '@universe/api'
import { useMemo } from 'react'
import { useCurrencies } from 'uniswap/src/components/TokenSelector/hooks/useCurrencies'
import { USDC, USDT, WBTC } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { buildNativeCurrencyId, buildWrappedNativeCurrencyId, currencyId } from 'uniswap/src/utils/currencyId'

// Use Mainnet base token addresses since TokenProjects query returns each token
// on each network
const baseCurrencyIds = [
  buildNativeCurrencyId(UniverseChainId.Mainnet),
  buildNativeCurrencyId(UniverseChainId.Polygon),
  buildNativeCurrencyId(UniverseChainId.Bnb),
  buildNativeCurrencyId(UniverseChainId.Celo),
  buildNativeCurrencyId(UniverseChainId.Avalanche),
  buildNativeCurrencyId(UniverseChainId.Solana),
  buildNativeCurrencyId(UniverseChainId.Monad),
  currencyId(USDC),
  currencyId(USDT),
  currencyId(WBTC),
  buildWrappedNativeCurrencyId(UniverseChainId.Mainnet),
]

export function useAllCommonBaseCurrencies(): GqlResult<CurrencyInfo[]> {
  // On this fork we hard-disable feature-flag-driven chain selection to keep hook
  // order stable. Always return mainnet bases and fall back to an empty list rather
  // than synthesizing partial CurrencyInfos (which can break downstream filters).
  const stableIds = baseCurrencyIds
  const result = useCurrencies(stableIds)
  
  return useMemo(
    () => {
      return {
      data: result?.data ?? [],
      error: result?.error,
      refetch: result?.refetch,
      loading: result?.loading ?? false,
      }
    },
    [result],
  )
}
