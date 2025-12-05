// Minimal Agroswap helper to gate portfolio features by chain.
// TODO(agroswap): when portfolio/analytics infra is ready for Base Sepolia (84532),
// update this to return true for that chain or remove the special casing entirely.
export function isPortfolioSupportedChain(chainId: number | undefined): boolean {
  if (chainId === undefined || chainId === null) {
    return true // preserve upstream behavior when chainId is not specified
  }
  if (chainId === 84532) {
    return false
  }
  return true
}

