import * as React from 'react'
import { TradingApi } from '@universe/api'
import { PERMIT2_ADDRESS } from '@uniswap/permit2-sdk'
import { useSwapFormStore } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { createSwapTxStore } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/createSwapTxStore'
import { debugMark } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/debugHooks'
import { useSwapTxAndGasInfo as useLegacySwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/hooks/useSwapTxAndGasInfo'
import { SwapTxStoreContext } from 'uniswap/src/features/transactions/swap/stores/swapTxStore/SwapTxStoreContext'
import type { SwapTxAndGasInfo } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { validateSwapTxContextWithReasons } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { estimateGasFee } from 'uniswap/src/features/transactions/swap/utils/estimateGasFee'
import type { TransactionEip1559FeeParams, TransactionLegacyFeeParams } from 'uniswap/src/features/gas/types'
import { logger } from 'utilities/src/logger/logger'
import { boundaryLog, boundaryLogDeduped } from 'uniswap/src/utils/boundaryLog'
import { getAgroswapSwapRouterAddress } from 'uniswap/src/constants/agroswapAddresses'
import { UniverseChainId } from 'uniswap/src/features/chains/types'

// Universal Router address for Base Sepolia (Agroswap deployment)
const BASE_SEPOLIA_UNIVERSAL_ROUTER_ADDRESS = '0xF2405e35650268a08a9c12d3Ab7Fc0B82EBa5318'

/**
 * Classifies a transaction request as approval or swap.
 * Used to break the deadlock: estimate approval tx first, not swap tx.
 */
function classifyTxRequest(
  txRequest: { to?: string; data?: string },
  chainId: number
): 'approval' | 'swap' | 'unknown' {
  if (!txRequest.to || !txRequest.data) {
    return 'unknown'
  }

  const to = txRequest.to.toLowerCase()
  const data = txRequest.data.toLowerCase()
  const selector = data.slice(0, 10)

  // Check for Permit2 address (case-insensitive)
  const permit2Address = PERMIT2_ADDRESS.toLowerCase()
  if (to === permit2Address) {
    return 'approval'
  }

  // Check for ERC20 approve(address,uint256) selector: 0x095ea7b3
  if (selector === '0x095ea7b3') {
    return 'approval'
  }

  // Check for swap router addresses
  if (chainId === UniverseChainId.BaseSepolia) {
    const swapRouter = getAgroswapSwapRouterAddress(chainId).toLowerCase()
    const universalRouter = BASE_SEPOLIA_UNIVERSAL_ROUTER_ADDRESS.toLowerCase()
    if (to === swapRouter || to === universalRouter) {
      return 'swap'
    }
  }

  return 'unknown'
}

const EMPTY_SWAP_TX_AND_GAS_INFO: SwapTxAndGasInfo = {
  routing: TradingApi.Routing.CLASSIC,
  txRequests: undefined,
  approveTxRequest: undefined,
  revocationTxRequest: undefined,
  gasFee: { isLoading: false, error: null },
  gasFeeEstimation: {},
  trade: undefined,
  permit: undefined,
  swapRequestArgs: undefined,
  unsigned: false,
  includesDelegation: false,
} satisfies SwapTxAndGasInfo

/** @deprecated Delete when ServiceBasedSwapTransactionInfo is fully rolled out */
const LegacySwapTxStoreContextProvider = ({ children }: { children: React.ReactNode }): JSX.Element => {
  // React instance check - compare with App.tsx
  if (process.env.NODE_ENV !== 'production') {
    logger.debugDeduped(
      'SwapTxStoreContextProvider',
      'LegacySwapTxStoreContextProvider',
      '[SwapTxStore] React instance',
      {
        reactVersion: React.version,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['SwapTxStore-React-instance'],
      }
    )
  }

  // Temporary debug log to confirm provider version
  if (process.env.NODE_ENV !== 'production') {
    logger.debugDeduped(
      'SwapTxStoreContextProvider',
      'LegacySwapTxStoreContextProvider',
      '[SwapTxStore] provider version',
      {
        version: '2025-12-12T-onchain-only-v2',
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['SwapTxStore-provider-version'],
      }
    )
  }

  // CRITICAL: All hooks must be unconditional and in the same order every render.
  // No early returns before hooks. No conditional hook calls. Dependency arrays must always be arrays.

  // Hook probe utility (dev-only) to diagnose hook order changes
  // CRITICAL: useRef must be called unconditionally at the very top, before any other logic
  const hookProbeCounter = React.useRef(0)
  hookProbeCounter.current += 1 // Always increment, even in production (no-op if not logged)

  debugMark('before useWallet')
  const wallet = useWallet()
  const account = wallet.evmAccount

  debugMark('before useSwapFormStore')
  const derivedSwapInfo = useSwapFormStore((s) => s.derivedSwapInfo)

  // Hook probe: after initial setup
  // CRITICAL: useRef must be called unconditionally
  const hookProbeTXH01 = React.useRef(0)
  hookProbeTXH01.current += 1
  if (process.env.NODE_ENV !== 'production') {
    const chainId = derivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapTxStoreContextProvider',
      'LegacySwapTxStoreContextProvider',
      '[HookProbe] TX-H01: after initial contexts',
      {
        chainId,
        renderCount: hookProbeCounter.current,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['TX-H01', chainId],
      }
    )
  }

  // Hook probe: before useLegacySwapTxAndGasInfo
  // CRITICAL: useRef must be called unconditionally
  const hookProbeTXH02 = React.useRef(0)
  hookProbeTXH02.current += 1
  const chainIdForProbe = derivedSwapInfo?.chainId
    boundaryLogDeduped(
      '[HookProbe] TX-H02: before useLegacySwapTxAndGasInfo',
      {
        tags: { file: 'SwapTxStoreContextProvider', function: 'LegacySwapTxStoreContextProvider' },
        extra: {
          chainId: chainIdForProbe,
          hasOnChainQuote: !!derivedSwapInfo?.onChainQuote,
          hasTrade: !!derivedSwapInfo?.trade?.trade,
        },
      },
      chainIdForProbe,
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['TX-H02', chainIdForProbe],
      }
    )

  debugMark('before useLegacySwapTxAndGasInfo')
  const txState = useLegacySwapTxAndGasInfo({ derivedSwapInfo, account })

  // Hook probe: after useLegacySwapTxAndGasInfo
  // CRITICAL: useRef must be called unconditionally
  const hookProbeTXH03 = React.useRef(0)
  hookProbeTXH03.current += 1
  if (process.env.NODE_ENV !== 'production') {
    const chainId = derivedSwapInfo?.chainId
    const routing = txState.routing
    logger.debugDeduped(
      'SwapTxStoreContextProvider',
      'LegacySwapTxStoreContextProvider',
      '[HookProbe] TX-H03: after useLegacySwapTxAndGasInfo',
      {
        chainId,
        routing,
        hasTxRequests: !!(txState as any).txRequests,
        txRequestsLength: (txState as any).txRequests?.length ?? 0,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['TX-H03', chainId, routing],
      }
    )
  }

  // Gas fee repair state (hook-safe async repair for Base Sepolia)
  // CRITICAL: All hooks must be called unconditionally
  const [repairedGasFee, setRepairedGasFee] = React.useState<SwapTxAndGasInfo['gasFee'] | null>(null)
  const [repairError, setRepairError] = React.useState<Error | null>(null)
  const [isRepairing, setIsRepairing] = React.useState(false)

  // Gas fee repair effect (Base Sepolia only)
  // CRITICAL: useEffect must be called unconditionally, dependency array must be stable
  React.useEffect(() => {
    const chainId = derivedSwapInfo?.chainId
    const txRequests = (txState as any)?.txRequests
    const firstTxRequest = txRequests?.[0]
    const accountAddress = account?.address

    // Only repair on Base Sepolia when conditions are met
    if (
      chainId !== 84532 ||
      !firstTxRequest?.to ||
      !firstTxRequest?.data ||
      !accountAddress ||
      isRepairing
    ) {
      // Clear repair state if conditions no longer met
      if (chainId !== 84532) {
        setRepairedGasFee(null)
        setRepairError(null)
      }
      return
    }

    // If we already have a repaired gasFee and it's still valid, don't re-repair
    if (repairedGasFee) {
      const repairedContext = {
        ...txState,
        gasFee: repairedGasFee,
      }
      const validation = validateSwapTxContextWithReasons(repairedContext)
      if (validation.ok || !validation.reasons.includes('INVALID_GAS_FEE')) {
        // Repair is still valid, no need to re-repair
        return
      }
    }

    // Pre-validate to check if repair is needed
    const preValidation = validateSwapTxContextWithReasons(txState)
    const reasonsString = preValidation.reasons.join('|')

    boundaryLogDeduped(
      '[TX-CONTEXT] pre-validate',
      {
        tags: { file: 'SwapTxStoreContextProvider', function: 'gasFeeRepairEffect' },
        extra: {
          chainId,
          reasonsString,
          ok: preValidation.ok,
        },
      },
      chainId,
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['TX-CONTEXT-pre-validate', chainId],
      }
    )

    // Only repair if INVALID_GAS_FEE is present
    if (!preValidation.ok && preValidation.reasons.includes('INVALID_GAS_FEE')) {
      setIsRepairing(true)
      setRepairError(null)

      // BREAK DEADLOCK: Approval-first gas estimation
      // If approval tx exists, estimate approval gas first (it doesn't require allowance).
      // Swap estimation fails with STF when allowance doesn't exist yet.
      const approveTxRequest = (txState as any)?.approveTxRequest
      const txRequestToEstimate = approveTxRequest || firstTxRequest

      if (!txRequestToEstimate?.to || !txRequestToEstimate?.data) {
        setIsRepairing(false)
        return
      }

      // Async gas estimation (approval-first to break deadlock)
      estimateGasFee({
        chainId,
        txRequest: {
          to: txRequestToEstimate.to,
          data: txRequestToEstimate.data as string,
          value: txRequestToEstimate.value,
        },
        account: accountAddress, // CRITICAL: Always pass account
      })
        .then((gasEstimate) => {
          // Build params object based on fee type
          let params: TransactionEip1559FeeParams | TransactionLegacyFeeParams | undefined
          if (gasEstimate.maxFeePerGas) {
            params = {
              maxFeePerGas: gasEstimate.maxFeePerGas.toString(),
              maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas?.toString() ?? '0',
              gasLimit: gasEstimate.gasLimit.toString(),
            } as TransactionEip1559FeeParams
          } else if (gasEstimate.gasPrice) {
            params = {
              gasPrice: gasEstimate.gasPrice.toString(),
              gasLimit: gasEstimate.gasLimit.toString(),
            } as TransactionLegacyFeeParams
          }

          const repaired: SwapTxAndGasInfo['gasFee'] = {
            ...txState.gasFee,
            value: gasEstimate.totalCostWei.toString(), // string, not bigint
            error: null, // must be null for validation
            params, // include params for completeness
            isLoading: false,
          }

          setRepairedGasFee(repaired)
          setIsRepairing(false)

          // Re-validate the repaired context
          const repairedContext = {
            ...txState,
            gasFee: repaired,
          }
          const postValidation = validateSwapTxContextWithReasons(repairedContext)
          const postReasonsString = postValidation.reasons.join('|')

          boundaryLogDeduped(
            '[TX-CONTEXT] gas-fee-repair-attempt',
            {
              tags: { file: 'SwapTxStoreContextProvider', function: 'gasFeeRepairEffect' },
              extra: {
                chainId,
                estimationSource: gasEstimate.estimationSource,
                totalCostWei: gasEstimate.totalCostWei.toString(),
                gasLimit: gasEstimate.gasLimit.toString(),
                maxFeePerGas: gasEstimate.maxFeePerGas?.toString(),
                gasPrice: gasEstimate.gasPrice?.toString(),
                hasParams: !!params,
              },
            },
            chainId,
            {
              ttlMs: 10000,
              minIntervalMs: 10000,
              keyParts: ['TX-CONTEXT-repair-attempt', chainId],
            }
          )

          boundaryLogDeduped(
            '[TX-CONTEXT] post-validate',
            {
              tags: { file: 'SwapTxStoreContextProvider', function: 'gasFeeRepairEffect' },
              extra: {
                chainId,
                reasonsString: postReasonsString,
                ok: postValidation.ok,
                stillHasInvalidGasFee: postValidation.reasons.includes('INVALID_GAS_FEE'),
              },
            },
            chainId,
            {
              ttlMs: 10000,
              minIntervalMs: 10000,
              keyParts: ['TX-CONTEXT-post-validate', chainId],
            }
          )
        })
        .catch((error: Error) => {
          setRepairError(error)
          setIsRepairing(false)
          boundaryLogDeduped(
            '[TX-CONTEXT] gas-fee-repair-failed',
            {
              tags: { file: 'SwapTxStoreContextProvider', function: 'gasFeeRepairEffect' },
              extra: {
                chainId,
                error: error.message,
                stack: error.stack,
              },
            },
            chainId,
            {
              ttlMs: 10000,
              minIntervalMs: 10000,
              keyParts: ['TX-CONTEXT-repair-failed', chainId],
            }
          )
        })
    } else {
      // No repair needed, clear any previous repair state
      setRepairedGasFee(null)
      setRepairError(null)
    }
  }, [
    txState,
    derivedSwapInfo?.chainId ?? null,
    account?.address ?? null,
    isRepairing,
    repairedGasFee,
  ])

  // Use repaired gasFee if available, otherwise use original
  const txStateToUse = React.useMemo(() => {
    if (repairedGasFee) {
      return {
        ...txState,
        gasFee: repairedGasFee,
      }
    }
    // If repair failed, preserve original but attach error info
    if (repairError && txState.gasFee) {
      return {
        ...txState,
        gasFee: {
          ...txState.gasFee,
          error: repairError,
        },
      }
    }
    return txState
  }, [txState, repairedGasFee, repairError])

  // Create the store exactly once using React.useRef (no state queue)
  // CRITICAL: useRef must be called unconditionally
  const storeStateRef = React.useRef<ReturnType<typeof createSwapTxStore> | null>(null)
  if (!storeStateRef.current) {
    storeStateRef.current = createSwapTxStore(EMPTY_SWAP_TX_AND_GAS_INFO)
  }
  // Store and cleanup are guaranteed to exist after the check above
  const store = storeStateRef.current.store
  const cleanupFn = storeStateRef.current.cleanup

  // Hook probe: before first useEffect
  // CRITICAL: useRef must be called unconditionally
  const hookProbeTXH06 = React.useRef(0)
  hookProbeTXH06.current += 1
  const chainIdForProbe6 = derivedSwapInfo?.chainId
    boundaryLogDeduped(
      '[HookProbe] TX-H06: before first useEffect',
      {
        tags: { file: 'SwapTxStoreContextProvider', function: 'LegacySwapTxStoreContextProvider' },
        extra: {
          chainId: chainIdForProbe6,
        },
      },
      chainIdForProbe6,
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['TX-H06', chainIdForProbe6],
      }
    )

  debugMark('before cleanup effect')
  // CRITICAL: Cleanup function should be returned from effect, not included in deps
  // The cleanup function from store.subscribe is stable (created once), but we return it
  // from the effect to ensure proper cleanup without dependency array issues
  // CRITICAL: Use fixed-length dependency array to prevent size changes
  // cleanupFn is stable (created once), but we include it with ?? null to ensure array length is constant
  React.useEffect(() => {
    // Return the cleanup function directly - it's stable and doesn't need to be in deps
    return cleanupFn ?? (() => {}) // Fallback no-op if somehow undefined
  }, [cleanupFn ?? null]) // Fixed-length array: always 1 element (null if cleanupFn is undefined)

  debugMark('before setState effect')
  // CRITICAL: Dependency array must always be an array, normalize all values
  // Use txStateToUse (with repaired gasFee if available) instead of txState
  React.useEffect(() => {
    store.setState(txStateToUse)
    if (process.env.NODE_ENV !== 'production') {
      const chainId = derivedSwapInfo?.chainId
      const routing = txStateToUse.routing
      logger.debugDeduped(
        'SwapTxStoreContextProvider',
        'LegacySwapTxStoreContextProvider',
        '[SwapTxStore] setState',
        {
          routing,
          hasTxRequests: !!(txStateToUse as any).txRequests,
          txRequestsLength: (txStateToUse as any).txRequests?.length ?? 0,
          hasApprove: !!txStateToUse.approveTxRequest,
          hasRevoke: !!txStateToUse.revocationTxRequest,
          chainId,
          hasRepairedGasFee: !!repairedGasFee,
          isRepairing,
          hasRepairError: !!repairError,
        },
        {
          ttlMs: 10000,
          minIntervalMs: 10000,
          keyParts: ['SwapTxStore-setState', chainId, routing],
        }
      )
    }
  }, [store, txStateToUse, derivedSwapInfo.chainId ?? null, repairedGasFee, isRepairing, repairError])

  // Hook probe: after useEffect
  // CRITICAL: useRef must be called unconditionally
  const hookProbeTXH07 = React.useRef(0)
  hookProbeTXH07.current += 1
  if (process.env.NODE_ENV !== 'production') {
    const chainId = derivedSwapInfo?.chainId
    logger.debugDeduped(
      'SwapTxStoreContextProvider',
      'LegacySwapTxStoreContextProvider',
      '[HookProbe] TX-H07: after useEffect',
      {
        chainId,
      },
      {
        ttlMs: 10000,
        minIntervalMs: 10000,
        keyParts: ['TX-H07', chainId],
      }
    )
  }

  return <SwapTxStoreContext.Provider value={store}>{children}</SwapTxStoreContext.Provider>
}

export const SwapTxStoreContextProvider = ({ children }: { children: React.ReactNode }): JSX.Element => {
  // Always use the legacy provider (on-chain router friendly, avoids feature-flag hook ordering).
  return <LegacySwapTxStoreContextProvider>{children}</LegacySwapTxStoreContextProvider>
}
