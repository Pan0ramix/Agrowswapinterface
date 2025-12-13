import { useMemo } from 'react'
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

type ReplaceChainId<T> = T extends { chainId: number }
  ? Omit<T, 'chainId'> & { chainId: EVMUniverseChainId | undefined }
  : T extends { chainId: number | undefined }
    ? Omit<T, 'chainId'> & { chainId: EVMUniverseChainId | undefined }
    : T

type UseAccountReturnType = ReplaceChainId<UseAccountReturnTypeWagmi<Register['config']>>

/**
 * Safe wrapper for wagmi hooks that handles cases where wagmi store isn't ready
 */
function useSafeWagmiHooks(): {
  wagmiAccount: ReturnType<typeof useAccountWagmi> | undefined
  fallbackChainId: number | undefined
} {
  let wagmiAccount: ReturnType<typeof useAccountWagmi> | undefined
  let fallbackChainId: number | undefined

  try {
    wagmiAccount = useAccountWagmi()
  } catch (error) {
    // If wagmi store isn't ready, use undefined
    if (error instanceof Error && (error.message.includes('getSnapshot') || error.message.includes('length') || error.message.includes('undefined'))) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[useAccount] useAccountWagmi failed, using fallback', error)
      }
      wagmiAccount = undefined
    } else {
      throw error
    }
  }

  try {
    fallbackChainId = useChainId()
  } catch (error) {
    // If wagmi store isn't ready, use undefined
    if (error instanceof Error && (error.message.includes('getSnapshot') || error.message.includes('length') || error.message.includes('undefined'))) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[useAccount] useChainId failed, using fallback', error)
      }
      fallbackChainId = undefined
    } else {
      throw error
    }
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
  // Use all relevant values as dependencies
  return useMemo(
    () => {
      // If wagmiAccount is not available, return a safe fallback structure
      if (!wagmiAccount) {
        return {
          address: undefined,
          chainId: supportedChainId,
          connector: undefined,
          isConnected: false,
          isConnecting: false,
          isDisconnected: true,
          isReconnecting: false,
          status: 'disconnected' as const,
        } as UseAccountReturnType
      }

      return {
        ...wagmiAccount,
        chainId: supportedChainId,
      }
    },
    // Always provide a valid array - include all values that might change
    [wagmiAccount, fallbackChainId, supportedChainId],
  )
}
