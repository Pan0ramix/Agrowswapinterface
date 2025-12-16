/**
 * Wagmi Store Readiness Hook
 *
 * Checks if Wagmi store is ready by accessing the internal store state.
 * This prevents React dependency comparison errors when store isn't initialized.
 *
 * IMPORTANT: This hook must be called unconditionally (React rules of hooks).
 * It checks readiness but doesn't prevent hook calls - that's handled in the safe wrappers.
 */

import { wagmiConfig } from 'components/Web3Provider/wagmiConfig'
import { useEffect, useRef, useState } from 'react'

/**
 * Check if Wagmi store is ready by attempting to read its state
 * Returns true if store is ready, false otherwise
 * This function is safe to call even when store isn't initialized
 */
function checkWagmiStoreReady(): boolean {
  try {
    // Wagmi v2 stores the store in config.store
    // Try to access it - if it exists and has getState, store is ready
    const store = (wagmiConfig as any).store
    if (!store) {
      return false
    }

    // Try to get state - if this succeeds, store is ready
    // getState should exist on the store object
    if (typeof store.getState !== 'function') {
      return false
    }

    // Try to call getState - if it doesn't throw, store is ready
    const state = store.getState()
    return state !== undefined && state !== null
  } catch {
    // Store not ready or error accessing it
    return false
  }
}

/**
 * Hook to check if Wagmi store is ready
 * Uses a polling approach to detect when store becomes ready
 *
 * This hook can be called unconditionally and will return false until store is ready.
 * It uses a simple polling mechanism to avoid issues with useSyncExternalStore
 * when the store itself isn't ready yet.
 *
 * SAFETY: This hook always returns a stable boolean value, ensuring React's
 * dependency comparison never fails due to undefined or unstable values.
 */
export function useWagmiStoreReady(): boolean {
  const [isReady, setIsReady] = useState(() => {
    // Initial check - safe to call even if store isn't ready
    try {
      return checkWagmiStoreReady()
    } catch {
      return false
    }
  })
  const readyRef = useRef(isReady)

  useEffect(() => {
    // If already ready, no need to poll
    if (isReady) {
      readyRef.current = true
      return
    }

    // Poll to check if store becomes ready
    // Use a short interval initially, then back off
    let attempts = 0
    const maxAttempts = 50 // Check for up to 5 seconds (50 * 100ms)

    const checkInterval = setInterval(() => {
      attempts++
      try {
        const ready = checkWagmiStoreReady()

        if (ready && !readyRef.current) {
          readyRef.current = true
          setIsReady(true)
          clearInterval(checkInterval)
        } else if (attempts >= maxAttempts) {
          // Stop polling after max attempts
          clearInterval(checkInterval)
        }
      } catch {
        // Ignore errors during polling
        if (attempts >= maxAttempts) {
          clearInterval(checkInterval)
        }
      }
    }, 100) // Check every 100ms

    return () => clearInterval(checkInterval)
  }, [isReady])

  // Also try to subscribe to store changes if store exists (for immediate updates)
  useEffect(() => {
    try {
      const store = (wagmiConfig as any).store
      if (store && typeof store.subscribe === 'function' && !isReady) {
        const unsubscribe = store.subscribe(() => {
          try {
            const ready = checkWagmiStoreReady()
            if (ready && !readyRef.current) {
              readyRef.current = true
              setIsReady(true)
            }
          } catch {
            // Ignore errors
          }
        })
        return unsubscribe
      }
    } catch {
      // Store not ready, ignore
    }
  }, [isReady])

  // Always return a stable boolean (never undefined)
  return isReady
}
