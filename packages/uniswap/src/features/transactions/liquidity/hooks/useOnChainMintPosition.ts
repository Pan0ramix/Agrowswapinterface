/**
 * On-Chain Mint Position Hook
 *
 * Wrapper around useV3MintPosition that ensures on-chain routing is used.
 * Matches the shape of existing hooks so UI remains unchanged.
 */

import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/liquidity/swap/services/onchainRouter/config'
import { type UseV3MintPositionReturn, useV3MintPosition } from 'uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition'

/**
 * Hook parameters
 */
interface UseOnChainMintPositionParams {
  token0: Currency | undefined
  token1: Currency | undefined
  fee: FeeAmount | undefined
  tickLower: number | undefined
  tickUpper: number | undefined
  amount0Desired: CurrencyAmount<Currency> | undefined
  amount1Desired: CurrencyAmount<Currency> | undefined
  slippageTolerance: Percent
  chainId: EVMUniverseChainId | undefined
  recipient: string | undefined
  enabled?: boolean
}

/**
 * On-chain mint position hook
 *
 * This is a wrapper around useV3MintPosition that ensures on-chain routing is enabled.
 * The underlying hook already uses on-chain data, so this just adds the router check.
 *
 * @param params - Mint position parameters
 * @returns Mint position result
 */
export function useOnChainMintPosition(params: UseOnChainMintPositionParams): UseV3MintPositionReturn {
  const { chainId, enabled = true, ...restParams } = params

  // Check if on-chain router is enabled for this chain
  const routerEnabled = chainId ? isOnChainRouterEnabled(chainId) : false

  // Use the existing on-chain mint position hook
  // It already uses on-chain data, so we just need to ensure router is enabled
  return useV3MintPosition({
    ...restParams,
    chainId,
    enabled: enabled && routerEnabled,
  })
}
