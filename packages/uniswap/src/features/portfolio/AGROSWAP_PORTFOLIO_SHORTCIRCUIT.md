# Agroswap – Portfolio Short-Circuit on Base Sepolia (84532)

We disable all portfolio-based features (balances, visibility, trending, valuation) on Base Sepolia because portfolio/analytics infra is not available.

Implementation:
- `isPortfolioSupportedChain` returns `false` for `chainId === 84532`.
- Early returns in portfolio hooks for unsupported chains:
  - `usePortfolioData`
  - `usePortfolioBalancesForAddressById` (when `disablePortfolio` or unsupported)
  - `useRestPortfolioValueModifier` / `useRestPortfolioValueModifiers`
  - `useCurrencyIdToVisibility` (bypassed via callers)
  - Token selector helpers (`useTrendingTokensOptions`, `useCurrencyInfosToTokenOptions`, `useTokenSectionsForSearchResults*`, etc.) pass `disablePortfolio` and avoid invoking portfolio hooks.

How to re-enable later:
1. Deploy portfolio/analytics backend for Base Sepolia.
2. Update `isPortfolioSupportedChain` to return `true` for `84532` (or remove special casing).
3. Remove/relax the short-circuits as appropriate.
4. Verify hook order remains stable and balances/valuation render correctly.

