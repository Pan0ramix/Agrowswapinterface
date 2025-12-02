import { Token } from '@uniswap/sdk-core'
import { GraphQLApi } from '@universe/api'
import { BASE_LOGO, ETH_LOGO } from 'ui/src/assets'
import { config } from 'uniswap/src/config'
import {
  DEFAULT_NATIVE_ADDRESS_LEGACY,
  DEFAULT_RETRY_OPTIONS,
  getPlaywrightRpcUrls,
  getQuicknodeEndpointUrl,
} from 'uniswap/src/features/chains/evm/rpc'
import { buildChainTokens } from 'uniswap/src/features/chains/evm/tokens'
import { GENERIC_L2_GAS_CONFIG } from 'uniswap/src/features/chains/gasDefaults'
import {
  GqlChainId,
  NetworkLayer,
  RPCType,
  UniverseChainId,
  UniverseChainInfo,
} from 'uniswap/src/features/chains/types'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { ElementName } from 'uniswap/src/features/telemetry/constants'
import { buildUSDC, buildUSDT } from 'uniswap/src/features/tokens/stablecoin'
import { isPlaywrightEnv } from 'utilities/src/environment/env'
import { isWebApp } from 'utilities/src/platform'
import { baseSepolia } from 'wagmi/chains'

// Stablecoin tokens for Base Sepolia
const BASE_SEPOLIA_USDC = buildUSDC('0x036CbD53842c5426634e7929541eC2318f3dCF7e', UniverseChainId.BaseSepolia)
const BASE_SEPOLIA_USDT = buildUSDT('0x8d9cb8f3191fd685e2c14d2ac3fb2b16d44eafc3', UniverseChainId.BaseSepolia)
const BASE_SEPOLIA_EURC = new Token(
  UniverseChainId.BaseSepolia,
  '0x808456652fdb597867f38412077A9182bf77359F',
  6,
  'EURC',
  'EURC',
)

const tokens = buildChainTokens({
  stables: {
    USDC: BASE_SEPOLIA_USDC,
    USDT: BASE_SEPOLIA_USDT,
    EURC: BASE_SEPOLIA_EURC,
  },
})

const LOCAL_BASE_SEPOLIA_PLAYWRIGHT_RPC_URL = 'http://127.0.0.1:8547'

export const BASE_SEPOLIA_CHAIN_INFO = {
  ...baseSepolia,
  id: UniverseChainId.BaseSepolia,
  platform: Platform.EVM,
  assetRepoNetworkName: undefined,
  backendChain: {
    chain: GraphQLApi.Chain.BaseSepolia as GqlChainId,
    backendSupported: true,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 6,
  blockWaitMsBeforeWarning: isWebApp ? 1500000 : 600000,
  bridge: undefined,
  docs: 'https://docs.base.org',
  elementName: ElementName.ChainBase,
  explorer: {
    name: 'BaseScan',
    url: 'https://sepolia.basescan.org/',
    apiURL: 'https://api-sepolia.basescan.org',
  },
  interfaceName: 'base-sepolia',
  label: 'Base Sepolia',
  logo: BASE_LOGO,
  nativeCurrency: {
    name: 'Sepolia Ether',
    symbol: 'ETH',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS_LEGACY,
    explorerLink: 'https://sepolia.basescan.org/chart/etherprice',
    logo: ETH_LOGO,
  },
  networkLayer: NetworkLayer.L1,
  pendingTransactionsRetryOptions: DEFAULT_RETRY_OPTIONS,
  statusPage: 'https://status.base.org/',
  supportsV4: true,
  supportsNFTs: true,
  urlParam: 'base-sepolia',
  rpcUrls: isPlaywrightEnv()
    ? getPlaywrightRpcUrls(LOCAL_BASE_SEPOLIA_PLAYWRIGHT_RPC_URL)
    : {
        [RPCType.Public]: { http: [getQuicknodeEndpointUrl(UniverseChainId.BaseSepolia)] },
        [RPCType.Default]: { http: ['https://sepolia.base.org'] },
        [RPCType.Fallback]: { http: ['https://sepolia.base.org'] },
        [RPCType.Interface]: { http: [`https://base-sepolia.infura.io/v3/${config.infuraKey}`] },
      },
  tokens,
  wrappedNativeCurrency: {
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    address: '0xE6acF4D03Fb173e590645Cc2432F2943c438A57A',
  },
  gasConfig: GENERIC_L2_GAS_CONFIG,
  tradingApiPollingIntervalMs: 150,
  testnet: true,
} as const satisfies UniverseChainInfo
