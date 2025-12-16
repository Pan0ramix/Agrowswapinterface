import { BigNumber } from '@ethersproject/bignumber'
import { L2_DEADLINE_FROM_NOW } from 'constants/misc'
import { useAccount } from 'hooks/useAccount'
import { useInterfaceMulticall } from 'hooks/useContract'
import useCurrentBlockTimestamp from 'hooks/useCurrentBlockTimestamp'
import { useCallback, useMemo } from 'react'
import { useAppSelector } from 'state/hooks'
import { useMultichainContext } from 'state/multichain/useMultichainContext'
import { isL2ChainId } from 'uniswap/src/features/chains/utils'

export default function useTransactionDeadline(): BigNumber | undefined {
  const { chainId } = useAccount()
  const ttl = useAppSelector((state) => state.user.userDeadline)
  const blockTimestamp = useCurrentBlockTimestamp()
  return useMemo(
    () => timestampToDeadline({ chainId, blockTimestamp: BigNumber.from(blockTimestamp), ttl }),
    [blockTimestamp, chainId, ttl],
  )
}

/**
 * Returns an asynchronous function which will get the block timestamp and combine it with user settings for a deadline.
 * Should be used for any submitted transactions, as it uses an on-chain timestamp instead of a client timestamp.
 */
export function useGetTransactionDeadline(): () => Promise<BigNumber | undefined> {
  const { chainId } = useMultichainContext()
  const ttl = useAppSelector((state) => state.user.userDeadline)
  const multicall = useInterfaceMulticall(chainId)
  return useCallback(async () => {
    const blockTimestamp = await multicall.getCurrentBlockTimestamp()
    return timestampToDeadline({ chainId, blockTimestamp, ttl })
  }, [chainId, multicall, ttl])
}

/**
 * Shared utility to compute transaction deadline from block timestamp and TTL
 *
 * This is the single source of truth for deadline computation, used by:
 * - React hooks (useTransactionDeadline, useGetTransactionDeadline) for swaps
 * - Sagas (for on-chain transactions like V3 LP mint)
 *
 * Behavior (identical to how swaps compute deadlines):
 * - For L2 chains: uses L2_DEADLINE_FROM_NOW constant (300 seconds = 5 minutes), ignoring ttl
 * - For L1 chains: uses user-configured TTL from Redux state (state.user.userDeadline, in seconds)
 * - Returns undefined if blockTimestamp is missing OR (for L1) if ttl is missing/undefined
 *
 * TTL source: state.user.userDeadline (Redux state)
 * - Units: seconds (stored as seconds, despite comment in reducer saying "minutes")
 * - Default: DEFAULT_DEADLINE_FROM_NOW (600 seconds = 10 minutes) - set in reducer initialState
 * - Can be undefined if user hasn't set it (though reducer initializes it)
 *
 * @param chainId - Chain ID to determine if L2
 * @param blockTimestamp - Current block timestamp (BigNumber, in seconds, from on-chain)
 * @param ttl - Time-to-live in seconds (from state.user.userDeadline, can be undefined)
 * @returns Deadline as BigNumber (in seconds) or undefined
 */
export function timestampToDeadline({
  chainId,
  blockTimestamp,
  ttl,
}: {
  chainId?: number
  blockTimestamp?: BigNumber
  ttl?: number
}): BigNumber | undefined {
  if (blockTimestamp && isL2ChainId(chainId)) {
    return blockTimestamp.add(L2_DEADLINE_FROM_NOW)
  }
  if (blockTimestamp && ttl) {
    return blockTimestamp.add(ttl)
  }
  return undefined
}
