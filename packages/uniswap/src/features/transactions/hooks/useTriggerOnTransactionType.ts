import { useEffect, useMemo } from 'react'
import { usePendingTransactions } from 'uniswap/src/features/transactions/hooks/usePendingTransactions'
import { TransactionType } from 'uniswap/src/features/transactions/types/transactionDetails'
import { usePrevious } from 'utilities/src/react/hooks'
import { useActiveAddresses } from 'uniswap/src/features/accounts/store/hooks'
import type { Address } from 'viem'

/**
 * Trigger a function when a transaction of a given type is confirmed
 * Package-level version that works in packages/uniswap
 * @param type - The type of transaction to trigger on
 * @param trigger - The function to trigger
 */
export function useTriggerOnTransactionType(type: TransactionType, trigger: () => void) {
  const activeAddresses = useActiveAddresses()
  const pendingTransactions = usePendingTransactions({
    evmAddress: activeAddresses.evmAddress ?? null,
    svmAddress: activeAddresses.svmAddress ?? null,
  })

  const numPendingTransactions = useMemo(
    () => pendingTransactions?.filter((tx) => tx.typeInfo.type === type).length ?? 0,
    [pendingTransactions, type],
  )
  const prevNumPendingTransactions = usePrevious(numPendingTransactions)

  useEffect(() => {
    if (prevNumPendingTransactions !== undefined && numPendingTransactions < prevNumPendingTransactions) {
      trigger()
    }
  }, [numPendingTransactions, prevNumPendingTransactions, trigger])
}

