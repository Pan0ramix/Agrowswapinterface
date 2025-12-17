/**
 * Helper functions for fee display logic
 * Pure functions for testing without React dependencies
 */

import type { FeeDataSource } from 'uniswap/src/features/positions/fees'

/**
 * Get "(estimated)" suffix for fee amounts based on data source
 * @param dataSource - Source of fee data from provider pattern
 * @returns Empty string for authoritative data, " (estimated)" for estimated data
 */
export function getEstimatedSuffix(dataSource: FeeDataSource): string {
  // Only collect_simulation is authoritative; all others are estimated
  return dataSource === 'collect_simulation' ? '' : dataSource !== 'none' ? ' (estimated)' : ''
}
