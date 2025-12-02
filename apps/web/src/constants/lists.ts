// Lists we use as fallbacks on chains that our backend doesn't support
const COINGECKO_AVAX_LIST = 'https://tokens.coingecko.com/avalanche/all.json'

// Agroswap token list for Base Sepolia
export const AGROSWAP_BASE_SEPOLIA_LIST = '/agroswap-base-sepolia.tokenlist.json'

export const DEFAULT_INACTIVE_LIST_URLS: string[] = [COINGECKO_AVAX_LIST, AGROSWAP_BASE_SEPOLIA_LIST]
