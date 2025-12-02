import { useQuery } from '@tanstack/react-query'
import { Token } from '@uniswap/sdk-core'
import { Interface } from 'ethers/lib/utils'
import { useMemo } from 'react'
import ERC20_ABI from 'uniswap/src/abis/erc20.json'
import { Erc20Interface } from 'uniswap/src/abis/types/Erc20'
import { Erc20Bytes32Interface } from 'uniswap/src/abis/types/Erc20Bytes32'
import { UniswapInterfaceMulticall } from 'uniswap/src/abis/types/v3'
import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { buildCurrency, buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { getValidAddress } from 'uniswap/src/utils/addresses'
import { currencyId } from 'uniswap/src/utils/currencyId'
import { logger } from 'utilities/src/logger/logger'
import { DEFAULT_ERC20_DECIMALS } from 'utilities/src/tokens/constants'

const Erc20 = new Interface(ERC20_ABI) as Erc20Interface
const Erc20Bytes32 = new Interface(ERC20_ABI) as Erc20Bytes32Interface

type Call = { target: string; callData: string; gasLimit: number }
type CallResult = { success: boolean; returnData: string }
const DEFAULT_GAS_LIMIT = 1_000_000

function createCallsForToken(address: string): Call[] {
  return [
    { target: address, callData: Erc20.encodeFunctionData('name'), gasLimit: DEFAULT_GAS_LIMIT },
    { target: address, callData: Erc20.encodeFunctionData('symbol'), gasLimit: DEFAULT_GAS_LIMIT },
    { target: address, callData: Erc20.encodeFunctionData('decimals'), gasLimit: DEFAULT_GAS_LIMIT },
    { target: address, callData: Erc20Bytes32.encodeFunctionData('name'), gasLimit: DEFAULT_GAS_LIMIT },
    { target: address, callData: Erc20Bytes32.encodeFunctionData('symbol'), gasLimit: DEFAULT_GAS_LIMIT },
  ]
}

function tryParseToken({
  address,
  chainId,
  data,
}: {
  address: string
  chainId: UniverseChainId
  data: CallResult[]
}): Token | null {
  try {
    // Ensure we have all required data elements
    if (data.length < 5) {
      return null
    }

    const [nameData, symbolData, decimalsData, nameDataBytes32, symbolDataBytes32] = data

    const name = nameData?.success
      ? (Erc20.decodeFunctionResult('name', nameData.returnData)[0] as string)
      : nameDataBytes32?.success
        ? (Erc20Bytes32.decodeFunctionResult('name', nameDataBytes32.returnData)[0] as string)
        : undefined
    const symbol = symbolData?.success
      ? (Erc20.decodeFunctionResult('symbol', symbolData.returnData)[0] as string)
      : symbolDataBytes32?.success
        ? (Erc20Bytes32.decodeFunctionResult('symbol', symbolDataBytes32.returnData)[0] as string)
        : undefined
    const decimals = decimalsData?.success
      ? (Erc20.decodeFunctionResult('decimals', decimalsData.returnData)[0] as number)
      : DEFAULT_ERC20_DECIMALS

    return new Token(chainId, address, decimals, symbol, name)
  } catch (error) {
    logger.debug('useOnChainTokenByAddress', 'tryParseToken', 'Failed to parse token', { error, address, chainId })
    return null
  }
}

/**
 * Fetches ERC20 token data directly using the provider (fallback when multicall fails)
 */
// Direct provider fetch removed - this function is kept for potential future use
// but is not currently called to avoid cross-package dependencies
// async function fetchTokenDirectly(
//   address: string,
//   chainId: UniverseChainId,
//   provider: Provider,
// ): Promise<Token | null> {
//   ...
// }

/**
 * Fetches a token on-chain by address when the search API doesn't return results.
 * This is useful for testnet tokens that may not be in the search database.
 */
export function useOnChainTokenByAddress({
  address,
  chainId,
  multicall,
  enabled,
}: {
  address: string | null
  chainId: UniverseChainId | null
  multicall: UniswapInterfaceMulticall | null
  enabled: boolean
}): { data: CurrencyInfo | null; loading: boolean; error: Error | null } {
  const validAddress = useMemo(() => {
    if (!address || !chainId) {
      return null
    }
    const chainInfo = getChainInfo(chainId)
    return getValidAddress({ address, platform: chainInfo.platform, withEVMChecksum: true, log: false }) ?? null
  }, [address, chainId])

  const {
    data: token,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['onChainToken', validAddress, chainId],
    queryFn: async (): Promise<Token | null> => {
      if (!validAddress || !chainId) {
        return null
      }

      // Try multicall first if available
      if (multicall) {
        try {
          const calls = createCallsForToken(validAddress)
          const returnData = (await multicall.callStatic.multicall(calls)).returnData
          const parsedToken = tryParseToken({ address: validAddress, chainId, data: returnData })
          if (parsedToken) {
            return parsedToken
          }
        } catch (_err) {
          // Fall through if multicall fails
        }
      }

      // Note: Direct provider calls removed to avoid cross-package dependencies
      // The hook now relies on multicall only. If direct calls are needed,
      // the provider should be passed as a parameter from the consuming component.

      return null
    },
    enabled: enabled && Boolean(validAddress && chainId && multicall),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })

  const currencyInfo = useMemo((): CurrencyInfo | null => {
    if (!token || !chainId) {
      return null
    }

    const currency = buildCurrency({
      chainId,
      address: token.address,
      decimals: token.decimals,
      symbol: token.symbol ?? undefined,
      name: token.name ?? undefined,
    })

    if (!currency) {
      return null
    }

    return buildCurrencyInfo({
      currency,
      currencyId: currencyId(currency),
      logoUrl: undefined,
      safetyInfo: undefined,
      isFromOtherNetwork: false,
    })
  }, [token, chainId])

  return {
    data: currencyInfo,
    loading: isLoading,
    error: error as Error | null,
  }
}
