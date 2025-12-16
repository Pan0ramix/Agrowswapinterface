/**
 * Decimals Safety Validation
 *
 * Validates that token decimals used in UI match on-chain contract decimals
 * to prevent unsafe transactions with wildly incorrect amounts.
 *
 * Gated to on-chain-only chains (testnets, chains without Trading API).
 */

import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import ERC20_ABI from 'uniswap/src/abis/erc20.json'
import { EVMUniverseChainId, UniverseChainId } from 'uniswap/src/features/chains/types'
import { logger } from 'utilities/src/logger/logger'
import { formatUnits, PublicClient, parseUnits } from 'viem'

const ONCHAIN_ONLY_CHAINS: UniverseChainId[] = [84532] // Base Sepolia

/**
 * Check if chain is on-chain-only (requires strict decimals validation)
 */
function isOnChainOnlyChain(chainId: UniverseChainId): boolean {
  return ONCHAIN_ONLY_CHAINS.includes(chainId)
}

/**
 * Fetch on-chain decimals for a token
 */
async function fetchOnChainDecimals(
  tokenAddress: string,
  chainId: EVMUniverseChainId,
  publicClient: PublicClient,
): Promise<number | null> {
  try {
    const decimals = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'decimals',
    })
    return Number(decimals)
  } catch (error) {
    logger.warn('validateDecimalsSafety', 'fetchOnChainDecimals', 'Failed to fetch on-chain decimals', {
      error,
      tokenAddress,
      chainId,
    })
    return null
  }
}

/**
 * Validate that a CurrencyAmount's decimals match on-chain contract decimals
 *
 * @param amount - The CurrencyAmount to validate
 * @param publicClient - Viem public client for on-chain calls
 * @param tolerance - Allowed difference between formatted-back value and original (default: 0.0001)
 * @returns Error message if validation fails, null if valid
 */
export async function validateDecimalsSafety(
  amount: CurrencyAmount<Currency>,
  publicClient: PublicClient | null,
  tolerance: number = 0.0001,
): Promise<string | null> {
  // Only validate on on-chain-only chains
  if (!isOnChainOnlyChain(amount.currency.chainId)) {
    return null
  }

  // Skip if no public client (can't verify)
  if (!publicClient) {
    return null
  }

  const currency = amount.currency
  if (!currency.isToken) {
    return null // Native currency decimals are always correct
  }

  const tokenAddress = currency.address
  const uiDecimals = currency.decimals

  // Fetch on-chain decimals
  const onChainDecimals = await fetchOnChainDecimals(tokenAddress, currency.chainId as EVMUniverseChainId, publicClient)
  if (onChainDecimals === null) {
    // Can't verify, but don't block transaction
    return null
  }

  // Check if decimals match
  if (uiDecimals !== onChainDecimals) {
    const humanValue = amount.toExact()
    const rawAmount = amount.quotient.toString()

    // Calculate what the amount would be if we used correct decimals
    const correctRawAmount = parseUnits(humanValue, onChainDecimals)
    const formattedBackWithCorrectDecimals = formatUnits(correctRawAmount, onChainDecimals)
    const formattedBackWithWrongDecimals = formatUnits(BigInt(rawAmount), onChainDecimals)

    const mismatchFactor = 10 ** Math.abs(onChainDecimals - uiDecimals)

    // Log structured error
    logger.error(new Error('Token decimals mismatch detected'), {
      tags: {
        file: 'validateDecimalsSafety',
        function: 'validateDecimalsSafety',
      },
      extra: {
        tokenAddress,
        tokenSymbol: currency.symbol,
        uiDecimals,
        onChainDecimals,
        humanValue,
        rawAmount,
        formattedBackWithCorrectDecimals,
        formattedBackWithWrongDecimals,
        mismatchFactor,
      },
    })

    return `Token decimals mismatch for ${currency.symbol}. UI metadata: ${uiDecimals}, on-chain: ${onChainDecimals}. Prevented unsafe transaction.`
  }

  // Additional validation: verify that formatting back matches original
  // This catches edge cases where decimals match but there's still a conversion error
  // Convert JSBI to BigInt for viem's formatUnits
  const formattedBack = formatUnits(BigInt(amount.quotient.toString()), uiDecimals)
  const originalValue = parseFloat(amount.toExact())
  const formattedBackValue = parseFloat(formattedBack)
  const difference = Math.abs(originalValue - formattedBackValue)
  const relativeDifference = originalValue > 0 ? difference / originalValue : difference

  // If difference is huge (>1e-6x or <1e6x), something is wrong
  if (relativeDifference > 1e-6 && difference > tolerance) {
    const mismatchFactor =
      originalValue > 0 && formattedBackValue > 0
        ? Math.max(originalValue / formattedBackValue, formattedBackValue / originalValue)
        : Infinity

    if (mismatchFactor > 1e6 || mismatchFactor < 1e-6) {
      logger.error(new Error('Amount conversion mismatch detected'), {
        tags: {
          file: 'validateDecimalsSafety',
          function: 'validateDecimalsSafety',
        },
        extra: {
          tokenAddress,
          tokenSymbol: currency.symbol,
          decimals: uiDecimals,
          originalValue,
          formattedBackValue,
          difference,
          relativeDifference,
          mismatchFactor,
          rawAmount: amount.quotient.toString(),
        },
      })

      return `Amount conversion mismatch for ${currency.symbol}. Original: ${originalValue}, formatted back: ${formattedBackValue}. Prevented unsafe transaction.`
    }
  }

  return null
}

/**
 * Validate multiple CurrencyAmounts
 */
export async function validateDecimalsSafetyMultiple(
  amounts: CurrencyAmount<Currency>[],
  publicClient: PublicClient | null,
  tolerance?: number,
): Promise<string | null> {
  for (const amount of amounts) {
    const error = await validateDecimalsSafety(amount, publicClient, tolerance)
    if (error) {
      return error
    }
  }
  return null
}
