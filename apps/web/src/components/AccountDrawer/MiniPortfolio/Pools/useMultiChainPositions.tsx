import { BigNumber } from '@ethersproject/bignumber'
import { PositionStatus, ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { CurrencyAmount, V3_CORE_FACTORY_ADDRESSES as SDK_V3_CORE_FACTORY_ADDRESSES, Token } from '@uniswap/sdk-core'
import IUniswapV3PoolStateJSON from '@uniswap/v3-core/artifacts/contracts/interfaces/pool/IUniswapV3PoolState.sol/IUniswapV3PoolState.json'
import { computePoolAddress, Pool, Position } from '@uniswap/v3-sdk'
import {
  PositionInfo,
  useCachedPositions,
  useGetCachedTokens,
  usePoolAddressCache,
} from 'components/AccountDrawer/MiniPortfolio/Pools/cache'
import { Call, DEFAULT_GAS_LIMIT } from 'components/AccountDrawer/MiniPortfolio/Pools/getTokensAsync'
import {
  useInterfaceMulticallContracts,
  usePoolPriceMap,
  useV3ManagerContracts,
} from 'components/AccountDrawer/MiniPortfolio/Pools/hooks'
import { RPC_PROVIDERS } from 'constants/providers'
import { Interface } from 'ethers/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PositionDetails } from 'types/position'
import ERC20_ABI from 'uniswap/src/abis/erc20.json'
import { NonfungiblePositionManager, UniswapInterfaceMulticall } from 'uniswap/src/abis/types/v3'
import { UniswapV3PoolInterface } from 'uniswap/src/abis/types/v3/UniswapV3Pool'
import { AGROSWAP_V3_CORE_FACTORY_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { logger } from 'utilities/src/logger/logger'
import { DEFAULT_ERC20_DECIMALS } from 'utilities/src/tokens/constants'
import { currencyKey } from 'utils/currencyKey'

function createPositionInfo({
  owner,
  chainId,
  details,
  slot0,
  tokenA,
  tokenB,
  poolAddress,
}: {
  owner: string
  chainId: UniverseChainId
  details: PositionDetails
  slot0: any
  tokenA: Token
  tokenB: Token
  poolAddress: string
}): PositionInfo {
  /* Instantiates a Pool with a hardcoded 0 liqudity value since the sdk only uses this value for swap state and this avoids an RPC fetch */
  const pool = new Pool(tokenA, tokenB, details.fee, slot0.sqrtPriceX96.toString(), 0, slot0.tick)
  const position = new Position({
    pool,
    liquidity: details.liquidity.toString(),
    tickLower: details.tickLower,
    tickUpper: details.tickUpper,
  })
  const inRange = slot0.tick >= details.tickLower && slot0.tick < details.tickUpper
  const closed = details.liquidity.eq(0)
  return {
    owner,
    chainId,
    pool,
    position,
    details,
    inRange,
    closed,
    version: ProtocolVersion.V3,
    poolOrPair: pool,
    currency0Amount: position.amount0,
    currency1Amount: position.amount1,
    poolId: poolAddress,
    tokenId: details.tokenId.toString(),
    tickLower: details.tickLower,
    tickUpper: details.tickUpper,
    tickSpacing: pool.tickSpacing,
    liquidity: details.liquidity.toString(),
    status: closed ? PositionStatus.CLOSED : inRange ? PositionStatus.IN_RANGE : PositionStatus.OUT_OF_RANGE,
    fee0Amount: CurrencyAmount.fromRawAmount(tokenA, details.tokensOwed0.toString()),
    fee1Amount: CurrencyAmount.fromRawAmount(tokenB, details.tokensOwed1.toString()),
    isHidden: false,
  }
}

type FeeAmounts = [BigNumber, BigNumber]

const MAX_UINT128 = BigNumber.from(2).pow(128).sub(1)

type UseMultiChainPositionsData = { positions?: PositionInfo[]; loading: boolean }

type UseMultiChainPositionsOptions = {
  includeTestnets?: boolean
}

/**
 * Returns all positions for a given account on multiple chains.
 *
 * This hook doesn't use the redux-multicall library to avoid having to manually fetching blocknumbers for each chain.
 *
 * @param account - account to fetch positions for
 * @param chains - chains to fetch positions from
 * @returns positions, fees
 */
export default function useMultiChainPositions(
  account: string,
  options?: UseMultiChainPositionsOptions,
): UseMultiChainPositionsData {
  const { chains } = useEnabledChains({ includeTestnets: options?.includeTestnets })

  const pms = useV3ManagerContracts(chains)
  const multicalls = useInterfaceMulticallContracts(chains)

  const getTokens = useGetCachedTokens(chains)
  const poolAddressCache = usePoolAddressCache()

  const [cachedPositions, setPositions] = useCachedPositions(account)
  const positions = cachedPositions?.result
  const positionsFetching = useRef(false)
  const positionsLoading = !cachedPositions?.result && positionsFetching.current

  const [feeMap, setFeeMap] = useState<{ [key: string]: FeeAmounts }>({})

  const { priceMap, pricesLoading } = usePoolPriceMap(positions)

  const fetchErc20Token = useCallback(
    async ({
      address,
      chainId,
      provider,
    }: {
      address: string
      chainId: UniverseChainId
      provider: any
    }): Promise<Token | undefined> => {
      try {
        const iface = new Interface(ERC20_ABI)
        const [nameData, symbolData, decimalsData] = await Promise.all([
          provider.call({ to: address, data: iface.encodeFunctionData('name') }),
          provider.call({ to: address, data: iface.encodeFunctionData('symbol') }),
          provider.call({ to: address, data: iface.encodeFunctionData('decimals') }),
        ])
        const name = iface.decodeFunctionResult('name', nameData)[0] as string
        const symbol = iface.decodeFunctionResult('symbol', symbolData)[0] as string
        const decimals = Number(iface.decodeFunctionResult('decimals', decimalsData)[0])
        return new Token(chainId, address, decimals || DEFAULT_ERC20_DECIMALS, symbol, name)
      } catch (error) {
        logger.debug('useMultiChainPositions', 'fetchErc20Token', 'Failed to fetch token', { error, address, chainId })
        return undefined
      }
    },
    [],
  )

  const fetchPositionFees = useCallback(
    // eslint-disable-next-line max-params
    async (pm: NonfungiblePositionManager, positionIds: BigNumber[], chainId: number) => {
      const callData = positionIds.map((id) =>
        pm.interface.encodeFunctionData('collect', [
          { tokenId: id, recipient: account, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 },
        ]),
      )
      const fees = (await pm.callStatic.multicall(callData)).reduce(
        // eslint-disable-next-line max-params
        (acc, feeBytes, index) => {
          const key = chainId.toString() + positionIds[index]
          acc[key] = pm.interface.decodeFunctionResult('collect', feeBytes) as FeeAmounts
          return acc
        },
        {} as { [key: string]: FeeAmounts },
      )

      setFeeMap((prev) => ({ ...prev, ...fees }))
    },
    [account],
  )

  const fetchPositionIds = useCallback(
    async (pm: NonfungiblePositionManager, balance: BigNumber, chainId: UniverseChainId) => {
      const callData = Array.from({ length: balance.toNumber() }, (_, i) =>
        pm.interface.encodeFunctionData('tokenOfOwnerByIndex', [account, i]),
      )
      try {
        return (await pm.callStatic.multicall(callData)).map((idByte) => BigNumber.from(idByte))
      } catch (error) {
        logger.debug('useMultiChainPositions', 'fetchPositionIds', 'multicall failed, sequential fallback', {
          error,
          chainId,
        })
        const ids: BigNumber[] = []
        for (let i = 0; i < balance.toNumber(); i++) {
          ids.push(await pm.tokenOfOwnerByIndex(account, i))
        }
        return ids
      }
    },
    [account],
  )

  const fetchPositionDetails = useCallback(
    async (pm: NonfungiblePositionManager, positionIds: BigNumber[], chainId: UniverseChainId) => {
      const callData = positionIds.map((id) => pm.interface.encodeFunctionData('positions', [id]))
      try {
        return (await pm.callStatic.multicall(callData)).map(
          (positionBytes, index) =>
            ({
              ...pm.interface.decodeFunctionResult('positions', positionBytes),
              tokenId: positionIds[index],
            }) as unknown as PositionDetails,
        )
      } catch (error) {
        logger.debug('useMultiChainPositions', 'fetchPositionDetails', 'multicall failed, sequential fallback', {
          error,
          chainId,
        })
        const details: PositionDetails[] = []
        for (const id of positionIds) {
          const res = await pm.positions(id)
          details.push({ ...res, tokenId: id } as unknown as PositionDetails)
        }
        return details
      }
    },
    [],
  )

  // Combines PositionDetails with Pool data to build our return type
  const fetchPositionInfo = useCallback(
    // eslint-disable-next-line max-params
    async (positionDetails: PositionDetails[], chainId: UniverseChainId, multicall: UniswapInterfaceMulticall) => {
      const poolInterface = new Interface(IUniswapV3PoolStateJSON.abi) as UniswapV3PoolInterface

      // Fetch tokens - use standard multicall-based token fetching first
      const tokens: { [key: string]: Token | undefined } = await getTokens(
        positionDetails.flatMap((details) => [details.token0, details.token1]),
        chainId,
      )

      // Fetch missing tokens before creating positions (fallback for when multicall fails or returns incomplete data)
      const uniqueTokenAddresses = Array.from(
        new Set(positionDetails.flatMap((details) => [details.token0, details.token1])),
      )
      const missingTokenAddresses = uniqueTokenAddresses.filter((addr) => !tokens[addr])

      // Fetch missing tokens if any - try multicall provider first, then RPC provider
      if (missingTokenAddresses.length > 0) {
        const provider = multicall.provider ?? RPC_PROVIDERS[chainId]
        if (provider) {
          logger.debug('useMultiChainPositions', 'fetchPositionInfo', 'Fetching missing tokens', {
            missingCount: missingTokenAddresses.length,
            chainId,
            addresses: missingTokenAddresses,
          })
          const fetchedTokens = await Promise.all(
            missingTokenAddresses.map((address) => fetchErc20Token({ address, chainId, provider })),
          )
          fetchedTokens.forEach((token, idx) => {
            if (token) {
              tokens[missingTokenAddresses[idx]] = token
            }
          })
        } else {
          logger.debug('useMultiChainPositions', 'fetchPositionInfo', 'No provider available for missing token fetch', {
            chainId,
            missingCount: missingTokenAddresses.length,
          })
        }
      }

      const calls: Call[] = []
      const poolPairs: [Token, Token][] = []
      const poolAddresses: string[] = []
      positionDetails.forEach((details) => {
        // Ensure we have complete token data before creating positions
        const tokenA = tokens[details.token0]
        const tokenB = tokens[details.token1]

        // Skip positions with missing token data
        if (!tokenA || !tokenB) {
          logger.debug('useMultiChainPositions', 'fetchPositionInfo', 'Skipping position with missing token data', {
            token0: details.token0,
            token1: details.token1,
            hasTokenA: !!tokenA,
            hasTokenB: !!tokenB,
            chainId,
          })
          return
        }

        let poolAddress = poolAddressCache.get(details, chainId)
        if (!poolAddress) {
          // Use Agroswap addresses for Base Sepolia, otherwise use SDK addresses
          const factoryAddresses =
            chainId === UniverseChainId.BaseSepolia ? AGROSWAP_V3_CORE_FACTORY_ADDRESSES : SDK_V3_CORE_FACTORY_ADDRESSES
          const factoryAddress = factoryAddresses[chainId as keyof typeof factoryAddresses] as string | undefined
          if (!factoryAddress) {
            throw new Error(`Factory address not found for chain ${chainId}`)
          }
          poolAddress = computePoolAddress({
            factoryAddress,
            tokenA,
            tokenB,
            fee: details.fee,
            chainId: chainId as number,
          })
          poolAddressCache.set(details, chainId, poolAddress)
        }
        poolPairs.push([tokenA, tokenB])
        poolAddresses.push(poolAddress)
        calls.push({
          target: poolAddress,
          callData: poolInterface.encodeFunctionData('slot0'),
          gasLimit: DEFAULT_GAS_LIMIT,
        })
      }, [])

      try {
        return (await multicall.callStatic.multicall(calls)).returnData.reduce((acc: PositionInfo[], result, i) => {
          if (result.success) {
            const slot0 = poolInterface.decodeFunctionResult('slot0', result.returnData)
            acc.push(
              createPositionInfo({
                owner: account,
                chainId,
                details: positionDetails[i],
                slot0,
                tokenA: poolPairs[i][0],
                tokenB: poolPairs[i][1],
                poolAddress: poolAddresses[i],
              }),
            )
          } else {
            logger.debug('useMultiChainPositions', 'fetchPositionInfo', 'slot0 fetch errored', result)
          }
          return acc
        }, [])
      } catch (error) {
        logger.debug('useMultiChainPositions', 'fetchPositionInfo', 'multicall slot0 failed, sequential fallback', {
          error,
          chainId,
        })
        const results: PositionInfo[] = []
        for (let i = 0; i < calls.length; i++) {
          try {
            const returnData = await multicall.provider.call({ to: calls[i].target, data: calls[i].callData })
            const slot0 = poolInterface.decodeFunctionResult('slot0', returnData)
            results.push(
              createPositionInfo({
                owner: account,
                chainId,
                details: positionDetails[i],
                slot0,
                tokenA: poolPairs[i][0],
                tokenB: poolPairs[i][1],
                poolAddress: poolAddresses[i],
              }),
            )
          } catch (slotError) {
            logger.debug('useMultiChainPositions', 'fetchPositionInfo', 'slot0 direct call failed', {
              slotError,
              chainId,
            })
          }
        }
        return results
      }
    },
    [account, fetchErc20Token, poolAddressCache, getTokens],
  )

  const fetchPositionsForChain = useCallback(
    async (chainId: UniverseChainId): Promise<PositionInfo[]> => {
      if (!account || account.length === 0) {
        return []
      }
      try {
        const pm = pms[chainId]
        const multicall = multicalls[chainId]
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const balance = await pm?.balanceOf(account)
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!pm || !multicall || balance.lt(1)) {
          return []
        }

        const positionIds = await fetchPositionIds(pm, balance, chainId)
        // Fetches fees in the background and stores them separetely from the results of this function
        fetchPositionFees(pm, positionIds, chainId)

        const postionDetails = await fetchPositionDetails(pm, positionIds, chainId)
        return fetchPositionInfo(postionDetails, chainId, multicall)
      } catch (error) {
        const wrappedError = new Error('Failed to fetch positions for chain', { cause: error })
        logger.debug('useMultiChainPositions', 'fetchPositionsForChain', wrappedError.message, {
          error: wrappedError,
          chainId,
        })
        return []
      }
    },
    [account, fetchPositionDetails, fetchPositionFees, fetchPositionIds, fetchPositionInfo, pms, multicalls],
  )

  const fetchAllPositions = useCallback(async () => {
    positionsFetching.current = true
    const positions = (await Promise.all(chains.map(fetchPositionsForChain))).flat()
    positionsFetching.current = false
    setPositions(positions)
  }, [chains, fetchPositionsForChain, setPositions])

  // Fetches positions when existing positions are stale and the document has focus
  // biome-ignore lint/correctness/useExhaustiveDependencies: +positionsFetching
  useEffect(() => {
    if (positionsFetching.current || cachedPositions?.stale === false) {
      return undefined
    } else if (document.hasFocus()) {
      fetchAllPositions()
    } else {
      // Avoids refetching positions until the user returns to Interface to avoid polling unnused rpc data
      const onFocus = () => {
        fetchAllPositions()
        window.removeEventListener('focus', onFocus)
      }
      window.addEventListener('focus', onFocus)
      return () => {
        window.removeEventListener('focus', onFocus)
      }
    }
    return undefined
  }, [fetchAllPositions, positionsFetching, cachedPositions?.stale])

  const positionsWithFeesAndPrices: PositionInfo[] | undefined = useMemo(
    () =>
      positions?.map((position) => {
        const key = position.chainId.toString() + position.details.tokenId
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const fees = feeMap[key]
          ? [
              // We parse away from SDK/ethers types so fees can be multiplied by primitive number prices
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              parseFloat(CurrencyAmount.fromRawAmount(position.pool.token0, feeMap[key]?.[0].toString()).toExact()),
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              parseFloat(CurrencyAmount.fromRawAmount(position.pool.token1, feeMap[key]?.[1].toString()).toExact()),
            ]
          : undefined
        const prices = [priceMap[currencyKey(position.pool.token0)], priceMap[currencyKey(position.pool.token1)]]
        return { ...position, fees, prices } as PositionInfo
      }),
    [feeMap, positions, priceMap],
  )

  return { positions: positionsWithFeesAndPrices, loading: pricesLoading || positionsLoading }
}
