import { Token } from '@uniswap/sdk-core'
import { GraphQLApi } from '@universe/api'
import { BASE_LOGO, ETH_LOGO } from 'ui/src/assets'
import { config } from 'uniswap/src/config'
import {
  DEFAULT_NATIVE_ADDRESS_LEGACY,
  DEFAULT_RETRY_OPTIONS,
  getPlaywrightRpcUrls,
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
import { buildUSDC } from 'uniswap/src/features/tokens/stablecoin'
import { isPlaywrightEnv } from 'utilities/src/environment/env'
import { defineChain } from 'viem'

// Base Sepolia chain definition (not available in wagmi/chains)
const baseSepolia = defineChain({
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://sepolia.base.org'],
    },
  },
  blockExplorers: {
    default: {
      name: 'BaseScan',
      url: 'https://sepolia.basescan.org',
    },
  },
  testnet: true,
})

const testnetTokens = buildChainTokens({
  stables: {
    USDC: buildUSDC('0x036CbD53842c5426634e7929541eC2318f3dCF7e', UniverseChainId.BaseSepolia),
    EURC: new Token(UniverseChainId.BaseSepolia, '0x808456652fdb597867f38412077A9182bf77359F', 6, 'EURC', 'Euro Coin'),
  },
})

const LOCAL_BASE_SEPOLIA_PLAYWRIGHT_RPC_URL = 'http://127.0.0.1:8547'

export const BASE_SEPOLIA_CHAIN_INFO = {
  ...baseSepolia,
  id: UniverseChainId.BaseSepolia,
  platform: Platform.EVM,
  testnet: true,
  assetRepoNetworkName: undefined,
  backendChain: {
    chain: GraphQLApi.Chain.BaseSepolia as GqlChainId,
    backendSupported: true,
    nativeTokenBackendAddress: undefined,
  },
  blockPerMainnetEpochForChainId: 6,
  blockWaitMsBeforeWarning: undefined,
  bridge: undefined,
  docs: 'https://docs.base.org/docs/',
  elementName: ElementName.ChainSepolia,
  explorer: {
    name: 'BaseScan',
    url: 'https://sepolia.basescan.org/',
    apiURL: 'https://api-sepolia.basescan.org',
  },
  openseaName: undefined,
  interfaceName: 'base-sepolia',
  label: 'Base Sepolia',
  logo: BASE_LOGO,
  nativeCurrency: {
    name: 'Base Sepolia ETH',
    symbol: 'ETH',
    decimals: 18,
    address: DEFAULT_NATIVE_ADDRESS_LEGACY,
    explorerLink: 'https://sepolia.basescan.org/chart/etherprice',
    logo: ETH_LOGO,
  },
  networkLayer: NetworkLayer.L2,
  pendingTransactionsRetryOptions: DEFAULT_RETRY_OPTIONS,
  statusPage: undefined,
  supportsV4: true,
  supportsNFTs: false,
  urlParam: 'base_sepolia',
  rpcUrls: isPlaywrightEnv()
    ? getPlaywrightRpcUrls(LOCAL_BASE_SEPOLIA_PLAYWRIGHT_RPC_URL)
    : {
        [RPCType.Public]: { http: ['https://sepolia.base.org'] },
        [RPCType.Default]: { http: ['https://sepolia.base.org'] },
        [RPCType.Fallback]: { http: ['https://sepolia.base.org'] },
        [RPCType.Interface]: { http: [`https://base-sepolia.infura.io/v3/${config.infuraKey}`] },
      },
  tokens: testnetTokens,
  wrappedNativeCurrency: {
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    address: '0xE6acF4D03Fb173e590645Cc2432F2943c438A57A',
  },
  gasConfig: GENERIC_L2_GAS_CONFIG,
  tradingApiPollingIntervalMs: 150,
} as const satisfies UniverseChainInfo
