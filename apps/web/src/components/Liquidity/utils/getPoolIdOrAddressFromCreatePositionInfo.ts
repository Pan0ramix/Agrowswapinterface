import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { Currency, V3_CORE_FACTORY_ADDRESSES as SDK_V3_CORE_FACTORY_ADDRESSES } from '@uniswap/sdk-core'
import { Pair } from '@uniswap/v2-sdk'
import { Pool as V3Pool } from '@uniswap/v3-sdk'
import { Pool as V4Pool } from '@uniswap/v4-sdk'
import { PoolCache } from 'hooks/usePools'
import { AGROSWAP_V3_CORE_FACTORY_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

export function getPoolIdOrAddressFromCreatePositionInfo({
  protocolVersion,
  poolOrPair,
  sdkCurrencies,
}: {
  protocolVersion: ProtocolVersion
  poolOrPair: V3Pool | V4Pool | Pair | undefined
  sdkCurrencies: { TOKEN0: Maybe<Currency>; TOKEN1: Maybe<Currency> }
}): string | undefined {
  if (!poolOrPair) {
    return undefined
  }

  switch (protocolVersion) {
    case ProtocolVersion.V2: {
      if ('liquidityToken' in poolOrPair) {
        return poolOrPair.liquidityToken.address
      }
      return undefined
    }
    case ProtocolVersion.V3: {
      if ('fee' in poolOrPair && 'chainId' in poolOrPair) {
        return poolOrPair.chainId && sdkCurrencies.TOKEN0 && sdkCurrencies.TOKEN1
          ? (() => {
              // Use Agroswap addresses for Base Sepolia, otherwise use SDK addresses
              const factoryAddresses =
                poolOrPair.chainId === UniverseChainId.BaseSepolia
                  ? AGROSWAP_V3_CORE_FACTORY_ADDRESSES
                  : SDK_V3_CORE_FACTORY_ADDRESSES
              return PoolCache.getPoolAddress({
                factoryAddress: factoryAddresses[poolOrPair.chainId as keyof typeof factoryAddresses] as string,
                tokenA: sdkCurrencies.TOKEN0.wrapped,
                tokenB: sdkCurrencies.TOKEN1.wrapped,
                fee: poolOrPair.fee,
                chainId: poolOrPair.chainId,
              })
            })()
          : undefined
      }
      return undefined
    }
    case ProtocolVersion.V4:
    default: {
      if ('poolId' in poolOrPair) {
        return poolOrPair.poolId
      }
      return undefined
    }
  }
}
