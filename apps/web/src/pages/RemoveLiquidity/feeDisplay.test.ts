/**
 * Tests for fee display helper functions
 * Pure unit tests without React dependencies
 */

import { getEstimatedSuffix } from 'pages/RemoveLiquidity/feeDisplay'
import { describe, expect, it } from 'vitest'

describe('getEstimatedSuffix', () => {
  it('should return empty string for collect_simulation (authoritative)', () => {
    expect(getEstimatedSuffix('collect_simulation')).toBe('')
  })

  it('should return " (estimated)" for onchain_math (estimated)', () => {
    expect(getEstimatedSuffix('onchain_math')).toBe(' (estimated)')
  })

  it('should return " (estimated)" for graphql_indexer (estimated)', () => {
    expect(getEstimatedSuffix('graphql_indexer')).toBe(' (estimated)')
  })

  it('should return empty string for none data source', () => {
    expect(getEstimatedSuffix('none')).toBe('')
  })

  it('should only skip estimated label for collect_simulation', () => {
    // Only collect_simulation is authoritative; all others are estimated
    expect(getEstimatedSuffix('collect_simulation')).toBe('')
    expect(getEstimatedSuffix('onchain_math')).toBe(' (estimated)')
    expect(getEstimatedSuffix('graphql_indexer')).toBe(' (estimated)')
    expect(getEstimatedSuffix('none')).toBe('')
  })
})
