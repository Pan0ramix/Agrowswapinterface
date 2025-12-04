/**
 * On-Chain LP Approval Hook
 * 
 * Checks ERC20 approval status for LP position minting.
 * Uses on-chain data only, no Trading API.
 */

import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { useReadContract } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import { getPositionManagerAddress } from 'uniswap/src/constants/v3Addresses'
import { AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { useTriggerOnTransactionType } from 'uniswap/src/features/transactions/hooks/useTriggerOnTransactionType'
import { TransactionType } from 'uniswap/src/features/transactions/types/transactionDetails'

/**
 * Helper to cast string to Address type (for wagmi compatibility)
 */
function toAddress(address: string | undefined): Address | undefined {
  return address as Address | undefined
}

/**
 * Approval state enum
 */
export enum ApprovalState {
  UNKNOWN = 'UNKNOWN',
  NOT_APPROVED = 'NOT_APPROVED',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
}

/**
 * Hook parameters
 */
interface UseOnChainLpApprovalParams {
  amount0?: CurrencyAmount<Token>
  amount1?: CurrencyAmount<Token>
  chainId: EVMUniverseChainId | undefined
  owner?: string
}

/**
 * Get Position Manager address for approval
 */
function getPositionManagerAddressForApproval(chainId: EVMUniverseChainId): string | undefined {
  // Try Agroswap addresses first
  if (chainId === 84532) {
    const address = AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId as keyof typeof AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES]
    if (address) {
      return address
    }
  }

  // Try v3Addresses override
  const v3Address = getPositionManagerAddress(chainId)
  if (v3Address) {
    return v3Address
  }

  return undefined
}

/**
 * Check approval status for LP position minting
 * 
 * @param params - Approval parameters
 * @returns Approval state for both tokens
 */
export function useOnChainLpApproval(
  params: UseOnChainLpApprovalParams,
): {
  approvalState0: ApprovalState
  approvalState1: ApprovalState
  needsApproval0: boolean
  needsApproval1: boolean
  isLoading: boolean
} {
  const { amount0, amount1, chainId, owner } = params

  const spender = useMemo(() => {
    if (!chainId) {
      return undefined
    }
    return getPositionManagerAddressForApproval(chainId)
  }, [chainId])

  // Check token0 allowance
  const queryEnabled0 = !!owner && !!spender && !!amount0?.currency
  const { data: rawAllowance0, isLoading: isLoading0, refetch: refetchAllowance0 } = useReadContract({
    address: toAddress(amount0?.currency.address),
    chainId: amount0?.currency.chainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: queryEnabled0 ? [toAddress(owner), toAddress(spender)] : undefined,
    query: { 
      enabled: queryEnabled0,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
    },
  })

  // Refetch when any approval transactions confirm (same pattern as useTokenAllowance)
  useTriggerOnTransactionType(TransactionType.Approve, refetchAllowance0)

  const allowance0 = useMemo(
    () =>
      amount0?.currency && rawAllowance0 !== undefined
        ? CurrencyAmount.fromRawAmount(amount0.currency, rawAllowance0.toString())
        : undefined,
    [amount0?.currency, rawAllowance0],
  )

  // Check token1 allowance
  const queryEnabled1 = !!owner && !!spender && !!amount1?.currency
  const { data: rawAllowance1, isLoading: isLoading1, refetch: refetchAllowance1 } = useReadContract({
    address: toAddress(amount1?.currency.address),
    chainId: amount1?.currency.chainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: queryEnabled1 ? [toAddress(owner), toAddress(spender)] : undefined,
    query: { 
      enabled: queryEnabled1,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
    },
  })

  // Refetch when any approval transactions confirm (same pattern as useTokenAllowance)
  useTriggerOnTransactionType(TransactionType.Approve, refetchAllowance1)

  const allowance1 = useMemo(
    () =>
      amount1?.currency && rawAllowance1 !== undefined
        ? CurrencyAmount.fromRawAmount(amount1.currency, rawAllowance1.toString())
        : undefined,
    [amount1?.currency, rawAllowance1],
  )

  // STEP 4: useOnChainLpApproval must derive approval purely from allowances
  // Determine approval states from on-chain allowances
  const needsApproval0 = useMemo(() => {
    if (!amount0 || !spender || amount0.currency.isNative) {
      return false
    }
    if (!allowance0) {
      return true // Unknown allowance means we need approval
    }
    // Check if allowance is less than required amount
    const needs = allowance0.lessThan(amount0)
    
    // Dev-only: log approval check for token0
    if (process.env.NODE_ENV !== 'production') {
      console.log('[useOnChainLpApproval] Token0 approval check', {
        amount0: amount0 ? {
          raw: amount0.quotient.toString(),
          human: amount0.toExact(),
          currency: amount0.currency.symbol,
          address: amount0.currency.address,
          decimals: amount0.currency.decimals,
        } : undefined,
        allowance0: allowance0 ? {
          raw: allowance0.quotient.toString(),
          human: allowance0.toExact(),
          isMaxUint256: allowance0.quotient.toString() === '115792089237316195423570985008687907853269984665640564039457584007913129639935',
        } : undefined,
        spender,
        needsApproval: needs,
      })
    }
    
    return needs
  }, [amount0, allowance0, spender])

  const needsApproval1 = useMemo(() => {
    if (!amount1 || !spender || amount1.currency.isNative) {
      return false
    }
    if (!allowance1) {
      return true // Unknown allowance means we need approval
    }
    // Check if allowance is less than required amount
    const needs = allowance1.lessThan(amount1)
    
    // Dev-only: log approval check for token1
    if (process.env.NODE_ENV !== 'production') {
      console.log('[useOnChainLpApproval] Token1 approval check', {
        amount1: amount1 ? {
          raw: amount1.quotient.toString(),
          human: amount1.toExact(),
          currency: amount1.currency.symbol,
          address: amount1.currency.address,
          decimals: amount1.currency.decimals,
        } : undefined,
        allowance1: allowance1 ? {
          raw: allowance1.quotient.toString(),
          human: allowance1.toExact(),
          isMaxUint256: allowance1.quotient.toString() === '115792089237316195423570985008687907853269984665640564039457584007913129639935',
        } : undefined,
        spender,
        needsApproval: needs,
      })
    }
    
    return needs
  }, [amount1, allowance1, spender])

  const approvalState0 = useMemo(() => {
    if (!amount0 || !spender) {
      return ApprovalState.UNKNOWN
    }
    if (amount0.currency.isNative) {
      return ApprovalState.APPROVED
    }
    if (!allowance0) {
      return ApprovalState.UNKNOWN
    }
    return needsApproval0 ? ApprovalState.NOT_APPROVED : ApprovalState.APPROVED
  }, [amount0, allowance0, spender, needsApproval0])

  const approvalState1 = useMemo(() => {
    if (!amount1 || !spender) {
      return ApprovalState.UNKNOWN
    }
    if (amount1.currency.isNative) {
      return ApprovalState.APPROVED
    }
    if (!allowance1) {
      return ApprovalState.UNKNOWN
    }
    return needsApproval1 ? ApprovalState.NOT_APPROVED : ApprovalState.APPROVED
  }, [amount1, allowance1, spender, needsApproval1])

  const isLoading = isLoading0 || isLoading1

  // Dev-only: log approval state for debugging
  if (process.env.NODE_ENV !== 'production') {
    console.log('[useOnChainLpApproval] state', {
      chainId,
      token0: amount0?.currency.address,
      token1: amount1?.currency.address,
      spender,
      allowance0: allowance0?.quotient.toString(),
      allowance1: allowance1?.quotient.toString(),
      amount0Required: amount0?.quotient.toString(),
      amount1Required: amount1?.quotient.toString(),
      needsApproval0,
      needsApproval1,
      approvalState0,
      approvalState1,
      isLoading,
    })
  }

  return {
    approvalState0,
    approvalState1,
    needsApproval0,
    needsApproval1,
    isLoading,
  }
}

