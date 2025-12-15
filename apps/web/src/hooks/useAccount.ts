import { useMemo, useRef } from 'react'
import { useSupportedChainId } from 'uniswap/src/features/chains/hooks/useSupportedChainId'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import {
  type Register,
  type UseAccountReturnType as UseAccountReturnTypeWagmi,
  // biome-ignore lint/style/noRestrictedImports: wagmi account hook needed for wallet integration
  useAccount as useAccountWagmi,
  // biome-ignore lint/style/noRestrictedImports: wagmi chain hook needed for chain management
  useChainId,
} from 'wagmi'
import { useWagmiStoreReady } from './useWagmiStoreReady'

type ReplaceChainId<T> = T extends { chainId: number }
  ? Omit<T, 'chainId'> & { chainId: EVMUniverseChainId | undefined }
  : T extends { chainId: number | undefined }
    ? Omit<T, 'chainId'> & { chainId: EVMUniverseChainId | undefined }
    : T

type UseAccountReturnType = ReplaceChainId<UseAccountReturnTypeWagmi<Register['config']>>

/**
 * Safe wrapper for wagmi hooks that handles cases where wagmi store isn't ready
 * Checks store readiness before calling hooks to prevent React dependency comparison errors
 */
function useSafeWagmiHooks(): {
  wagmiAccount: ReturnType<typeof useAccountWagmi> | undefined
  fallbackChainId: number | undefined
} {
  // Check if Wagmi store is ready before calling hooks
  const isStoreReady = useWagmiStoreReady()
  
  // Use refs to store fallback values to avoid dependency array issues
  const fallbackRef = useRef<{
    wagmiAccount: ReturnType<typeof useAccountWagmi> | undefined
    fallbackChainId: number | undefined
  }>({ wagmiAccount: undefined, fallbackChainId: undefined })

  let wagmiAccount: ReturnType<typeof useAccountWagmi> | undefined
  let fallbackChainId: number | undefined

  // Hooks must be called unconditionally (React rules)
  // But we check store readiness to handle errors gracefully
  try {
    wagmiAccount = useAccountWagmi()
    // Always update ref when we successfully get a value (even if store check says not ready)
    // This ensures we have the latest value for fallback
    if (wagmiAccount) {
      fallbackRef.current.wagmiAccount = wagmiAccount
    } else if (isStoreReady) {
      // Only clear ref if store is ready and account is undefined (disconnected)
      fallbackRef.current.wagmiAccount = undefined
    }
  } catch (error) {
    // If wagmi store isn't ready, use fallback from ref
    if (error instanceof Error && (error.message.includes('getSnapshot') || error.message.includes('length') || error.message.includes('undefined'))) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[useAccount] useAccountWagmi failed, using fallback', error)
      }
      wagmiAccount = fallbackRef.current.wagmiAccount
    } else {
      throw error
    }
  }

  try {
    fallbackChainId = useChainId()
    // Always update ref when we successfully get a value
    if (fallbackChainId !== undefined) {
      fallbackRef.current.fallbackChainId = fallbackChainId
    } else if (isStoreReady) {
      // Only clear ref if store is ready and chainId is undefined
      fallbackRef.current.fallbackChainId = undefined
    }
  } catch (error) {
    // If wagmi store isn't ready, use fallback from ref
    if (error instanceof Error && (error.message.includes('getSnapshot') || error.message.includes('length') || error.message.includes('undefined'))) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[useAccount] useChainId failed, using fallback', error)
      }
      fallbackChainId = fallbackRef.current.fallbackChainId
    } else {
      throw error
    }
  }
  
  // If store isn't ready but we have valid values from hooks, use them
  // Only use fallback if hooks failed or returned undefined
  if (!isStoreReady && wagmiAccount === undefined) {
    wagmiAccount = fallbackRef.current.wagmiAccount
  }
  if (!isStoreReady && fallbackChainId === undefined) {
    fallbackChainId = fallbackRef.current.fallbackChainId
  }

  return { wagmiAccount, fallbackChainId }
}

/**
 * @deprecated use new Account hooks from apps/web/src/features/accounts/store/hooks.ts instead
 */
export function useAccount(): UseAccountReturnType {
  // Hooks must be called unconditionally
  // Use safe wrappers to handle cases where wagmi store isn't ready
  const { wagmiAccount, fallbackChainId } = useSafeWagmiHooks()

  const supportedChainId = useSupportedChainId(wagmiAccount?.chainId ?? fallbackChainId ?? undefined) as
    | EVMUniverseChainId
    | undefined

  // Ensure dependency array is always a valid array (never undefined)
  // Use all relevant values as dependencies, but ensure they're always defined
  const stableWagmiAccount = wagmiAccount ?? null
  const stableFallbackChainId = fallbackChainId ?? null
  const stableSupportedChainId = supportedChainId ?? null

  return useMemo(
    () => {
      // If wagmiAccount is not available, return a safe fallback structure
      if (!stableWagmiAccount) {
        return {
          address: undefined,
          chainId: stableSupportedChainId ?? undefined,
          connector: undefined,
          isConnected: false,
          isConnecting: false,
          isDisconnected: true,
          isReconnecting: false,
          status: 'disconnected' as const,
        } as UseAccountReturnType
      }

      return {
        ...stableWagmiAccount,
        chainId: stableSupportedChainId ?? undefined,
      }
    },
    // Always provide a valid array with stable values (null instead of undefined)
    [stableWagmiAccount, stableFallbackChainId, stableSupportedChainId],
  )
}
