/**
 * V3 On-Chain Services
 *
 * Services for fetching V3 pool state, quoting, and building swap transactions
 * directly from on-chain contracts without Trading API dependency.
 */

export {
  type FetchV3PoolStateByAddressParams,
  type FetchV3PoolStateParams,
  fetchV3PoolState,
  fetchV3PoolStateByAddress,
  type V3PoolOnChainState,
} from './v3PoolOnChain'

export {
  parseQuoteError,
  type QuoteExactInputSingleParams,
  quoteExactInputSingle,
  type V3QuoteResult,
} from './v3Quoter'

export {
  type BuildExactInputSingleSwapParams,
  type BuildSwapTxError,
  type BuildSwapTxErrorCode,
  type BuildSwapTxResult,
  buildExactInputSingleSwapTx,
  buildExactInputSingleSwapTxStrict,
  calculateAmountOutMinimum,
  getDeadline,
  type InvalidSlippageTxBuildError,
  type SwapTransactionPayload,
} from './v3SwapTxBuilder'
