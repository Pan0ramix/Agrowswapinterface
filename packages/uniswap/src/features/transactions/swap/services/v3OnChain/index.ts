/**
 * V3 On-Chain Services
 * 
 * Services for fetching V3 pool state, quoting, and building swap transactions
 * directly from on-chain contracts without Trading API dependency.
 */

export {
  fetchV3PoolState,
  fetchV3PoolStateByAddress,
  type V3PoolOnChainState,
  type FetchV3PoolStateParams,
  type FetchV3PoolStateByAddressParams,
} from './v3PoolOnChain'

export {
  quoteExactInputSingle,
  parseQuoteError,
  type V3QuoteResult,
  type QuoteExactInputSingleParams,
} from './v3Quoter'

export {
  buildExactInputSingleSwapTx,
  calculateAmountOutMinimum,
  getDeadline,
  type SwapTransactionPayload,
  type BuildExactInputSingleSwapParams,
} from './v3SwapTxBuilder'




