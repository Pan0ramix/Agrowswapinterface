/**
 * Safe wrappers for Statsig hooks that don't depend on Statsig provider
 * This prevents hook ordering issues in SwapFormStore and other critical paths
 *
 * In this fork, we hard-disable Statsig to avoid React hook ordering problems.
 * These wrappers always return fallback values, ensuring stable hook calls.
 */

/**
 * Safe version of useDynamicConfigValue that always returns the fallback
 * No Statsig hooks are called, ensuring stable hook ordering
 *
 * @param _configName - Config name (ignored, for API compatibility)
 * @param _key - Config key (ignored, for API compatibility)
 * @param fallback - The value to return (always used)
 * @returns The fallback value
 */
export function useDynamicConfigValueSafe<T>(_configName: string, _key: string, fallback: T): T {
  // No hooks inside; always returns fallback
  // This ensures hook calls are stable and unconditional
  return fallback
}

/**
 * Safe version of useFeatureFlag that always returns false (disabled)
 * No Statsig hooks are called, ensuring stable hook ordering
 *
 * @param _flag - Feature flag (ignored, for API compatibility)
 * @returns Always false (feature disabled)
 */
export function useFeatureFlagSafe(_flag: string | number | symbol): boolean {
  // No hooks inside; always returns false (feature disabled)
  // This ensures hook calls are stable and unconditional
  return false
}
