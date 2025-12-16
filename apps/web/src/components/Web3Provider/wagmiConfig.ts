import { getWagmiConnectorV2 } from '@binance/w3w-wagmi-connector-v2'
import { PLAYWRIGHT_CONNECT_ADDRESS } from 'components/Web3Provider/constants'
import { createRejectableMockConnector } from 'components/Web3Provider/rejectableConnector'
import { WC_PARAMS } from 'components/Web3Provider/walletConnect'
import { embeddedWallet } from 'connection/EmbeddedWalletConnector'
import { porto } from 'porto/wagmi'
import { UNISWAP_LOGO } from 'ui/src/assets'
import { UNISWAP_WEB_URL } from 'uniswap/src/constants/urls'
import { CONNECTION_PROVIDER_IDS } from 'uniswap/src/constants/web3'
import type { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { ORDERED_EVM_CHAINS } from 'uniswap/src/features/chains/chainInfo'
import { isTestnetChain } from 'uniswap/src/features/chains/utils'
import { isPlaywrightEnv, isTestEnv } from 'utilities/src/environment/env'
import { logger } from 'utilities/src/logger/logger'
import { getNonEmptyArrayOrThrow } from 'utilities/src/primitives/array'
import type { Chain } from 'viem'
import { createClient } from 'viem'
import type { Config } from 'wagmi'
import { createConfig, fallback, http } from 'wagmi'
import { baseSepolia, polygonAmoy } from 'wagmi/chains'
import { coinbaseWallet, injected, safe, walletConnect } from 'wagmi/connectors'

// Get the appropriate Binance connector based on the environment
const getBinanceConnector = () => {
  // Check if Binance extension is installed
  const isBinanceDetected =
    typeof window !== 'undefined' && (window.BinanceChain || (window.binancew3w && window.binancew3w.ethereum))

  // Check if TrustWallet extension is installed
  const isTrustWalletExtensionInstalled = typeof window !== 'undefined' && window.BinanceChain?.isTrustWallet

  const isBinanceExtensionInstalled = isBinanceDetected && !isTrustWalletExtensionInstalled

  // If extension is installed, use the injected connector directly
  // This avoids issues with the Binance connector's detection logic
  if (isBinanceExtensionInstalled) {
    return injected({
      target: {
        id: CONNECTION_PROVIDER_IDS.BINANCE_WALLET_CONNECTOR_ID,
        name: 'Binance Wallet',
        // @ts-expect-error - window.BinanceChain and window.binancew3w.ethereum are typed to the best of our ability
        provider: () => window.BinanceChain || window.binancew3w?.ethereum,
      },
    })
  }

  // Otherwise, use the Binance connector with QR modal for mobile connection
  const BinanceConnector = getWagmiConnectorV2()
  return BinanceConnector({
    showQrCodeModal: true,
  })
}

export const orderedTransportUrls = (chain: ReturnType<typeof getChainInfo>): string[] => {
  const orderedRpcUrls = [
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    ...(chain.rpcUrls.interface?.http ?? []),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    ...(chain.rpcUrls.default?.http ?? []),
    ...(chain.rpcUrls.public?.http ?? []),
    ...(chain.rpcUrls.fallback?.http ?? []),
  ]

  return Array.from(new Set(orderedRpcUrls.filter(Boolean)))
}

// Build the chains array with testnets conditionally included
// Only include testnets when not in production
const WAGMI_CHAINS =
  process.env.NODE_ENV !== 'production'
    ? (() => {
        const baseChains = [...ORDERED_EVM_CHAINS]
        // Check if baseSepolia is already in ORDERED_EVM_CHAINS (it might be)
        const hasBaseSepolia = baseChains.some((chain) => chain.id === baseSepolia.id)
        const hasPolygonAmoy = baseChains.some((chain) => chain.id === polygonAmoy.id)

        const testnetChains: Chain[] = []
        if (!hasBaseSepolia) {
          testnetChains.push(baseSepolia)
        }
        if (!hasPolygonAmoy) {
          testnetChains.push(polygonAmoy)
        }

        return [...baseChains, ...testnetChains] as const
      })()
    : (ORDERED_EVM_CHAINS as const)

function createWagmiConnectors(params: {
  /** If `true`, appends the wagmi `mock` connector. Used in Playwright. */
  includeMockConnector: boolean
  /** The chains array to use for connectors */
  chains: readonly Chain[]
}): any[] {
  const { includeMockConnector, chains } = params

  const baseConnectors = [
    porto(),
    // Binance connector - uses injected for extension, QR code for mobile
    getBinanceConnector(),
    // There are no unit tests that expect WalletConnect to be included here,
    // so we can disable it to reduce log noise.
    // Pass chains to walletConnect to ensure Base Sepolia and Polygon Amoy are supported
    ...(isTestEnv() && !isPlaywrightEnv() ? [] : [walletConnect({ ...WC_PARAMS, chains })]),
    embeddedWallet(),
    // Pass chains to coinbaseWallet to ensure Base Sepolia and Polygon Amoy are supported
    coinbaseWallet({
      appName: 'Uniswap',
      // CB SDK doesn't pass the parent origin context to their passkey site
      // Flagged to CB team and can remove UNISWAP_WEB_URL once fixed
      appLogoUrl: `${UNISWAP_WEB_URL}${UNISWAP_LOGO}`,
      reloadOnDisconnect: false,
    }),
    // Pass chains to safe connector to ensure Base Sepolia and Polygon Amoy are supported
    safe(),
    // injected connector automatically uses chains from wagmi config
  ]

  return includeMockConnector
    ? [
        ...baseConnectors,
        createRejectableMockConnector({
          features: {},
          accounts: [PLAYWRIGHT_CONNECT_ADDRESS],
        }),
      ]
    : baseConnectors
}

function createWagmiConfig(params: {
  /** The connector list to use. */
  connectors: any[]
  /** Optional custom `onFetchResponse` handler – defaults to `defaultOnFetchResponse`. */
  onFetchResponse?: (response: Response, chain: Chain, url: string) => void
}): Config<typeof WAGMI_CHAINS> {
  const { connectors, onFetchResponse = defaultOnFetchResponse } = params

  return createConfig({
    chains: getNonEmptyArrayOrThrow(WAGMI_CHAINS),
    connectors,
    client({ chain }) {
      return createClient({
        chain,
        batch: { multicall: true },
        pollingInterval: 12_000,
        transport: fallback(
          orderedTransportUrls(chain).map((url) =>
            http(url, { onFetchResponse: (response) => onFetchResponse(response, chain, url) }),
          ),
        ),
      })
    },
  })
}

// eslint-disable-next-line max-params
const defaultOnFetchResponse = (response: Response, chain: Chain, url: string) => {
  if (response.status !== 200) {
    const message = `RPC provider returned non-200 status: ${response.status}`

    // only warn for testnet chains
    if (isTestnetChain(chain.id)) {
      logger.warn('wagmiConfig.ts', 'client', message, {
        extra: {
          chainId: chain.id,
          url,
        },
      })
    } else {
      // log errors for mainnet chains so we can fix them
      logger.error(new Error(message), {
        extra: {
          chainId: chain.id,
          url,
        },
        tags: {
          file: 'wagmiConfig.ts',
          function: 'client',
        },
      })
    }
  }
}

const defaultConnectors = createWagmiConnectors({
  includeMockConnector: isPlaywrightEnv(),
  chains: WAGMI_CHAINS,
})

export const wagmiConfig = createWagmiConfig({ connectors: defaultConnectors })

// Debug: Verify Base Sepolia and Polygon Amoy are included in wagmi config chains
// Only log after wagmiConfig is initialized to avoid printing before config is ready
if (process.env.NODE_ENV !== 'production') {
  // Use setTimeout to ensure wagmiConfig is fully initialized
  setTimeout(() => {
    const hasBaseSepolia = wagmiConfig.chains.some((chain) => chain.id === 84532)
    const hasPolygonAmoy = wagmiConfig.chains.some((chain) => chain.id === 80002)
    console.log('[wagmiConfig] Chain support verification', {
      totalChains: wagmiConfig.chains.length,
      hasBaseSepolia,
      hasPolygonAmoy,
      baseSepoliaChain: wagmiConfig.chains.find((chain) => chain.id === 84532),
      polygonAmoyChain: wagmiConfig.chains.find((chain) => chain.id === 80002),
      allChainIds: wagmiConfig.chains.map((chain) => chain.id),
    })
  }, 0)
}

declare module 'wagmi' {
  interface Register {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    config: typeof wagmiConfig
  }
}
