import { useEffect, useState } from 'react'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { useSwapTxAndGasInfo as useServiceBasedSwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/review/services/swapTxAndGasInfoService/hooks'
import { useSwapFormStore } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { createSwapTxStore } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/createSwapTxStore'
import { useSwapTxAndGasInfo as useLegacySwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/hooks/useSwapTxAndGasInfo'
import { SwapTxStoreContext } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/SwapTxStoreContext'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { usePreviousWithLayoutEffect } from 'utilities/src/react/usePreviousWithLayoutEffect'
import { logger } from 'utilities/src/logger/logger'

/** @deprecated Delete when ServiceBasedSwapTransactionInfo is fully rolled out */
const LegacySwapTxStoreContextProvider = ({ children }: { children: React.ReactNode }): JSX.Element => {
  const account = useWallet().evmAccount
  const derivedSwapInfo = useSwapFormStore((s) => s.derivedSwapInfo)
  const txState = useLegacySwapTxAndGasInfo({ derivedSwapInfo, account })

  const [storeState] = useState(() => createSwapTxStore(txState))
  const { store, cleanup } = storeState

  useEffect(() => () => cleanup(), [cleanup])

  const previousTxState = usePreviousWithLayoutEffect(txState)

  useEffect(() => {
    if (previousTxState !== txState) {
      store.setState(txState)
    }
  }, [txState, previousTxState, store])

  return <SwapTxStoreContext.Provider value={store}>{children}</SwapTxStoreContext.Provider>
}

export const SwapTxStoreContextProvider = ({ children }: { children: React.ReactNode }): JSX.Element => {
  // Always use the legacy provider (on-chain router friendly, avoids feature-flag hook ordering).
  return <LegacySwapTxStoreContextProvider>{children}</LegacySwapTxStoreContextProvider>
}
