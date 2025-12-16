import { getChainInfo } from 'uniswap/src/features/chains/chainInfo'
import { RPCType, UniverseChainId } from 'uniswap/src/features/chains/types'
import { createViemClient } from 'uniswap/src/features/providers/createViemClient'
import { boundaryLog, boundaryLogDeduped } from 'uniswap/src/utils/boundaryLog'
import type { PublicClient } from 'viem'
import { createPublicClient, defineChain, http } from 'viem'

export interface EstimateGasFeeParams {
  chainId: number
  txRequest: {
    to: string
    data: string
    value?: string | bigint
  }
  provider?: PublicClient
  account?: string // Account address for gas estimation
}

export interface EstimatedGasFee {
  totalCostWei: bigint
  gasLimit: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasPrice?: bigint
  estimationSource: 'alchemy' | 'wallet' | 'default'
}

/**
 * Estimates gas fee for a transaction request.
 * For Base Sepolia (84532): Uses Alchemy RPC if REACT_APP_ALCHEMY_BASE_SEPOLIA is set, otherwise uses default RPC.
 * For other chains: Uses the provided provider or creates a default Viem client.
 * Returns structured gas fee data including gasLimit, fee per gas, and total cost.
 */
export async function estimateGasFee({
  chainId,
  txRequest,
  provider,
  account,
}: EstimateGasFeeParams): Promise<EstimatedGasFee> {
  let client: PublicClient | undefined = provider
  let estimationSource: 'alchemy' | 'wallet' | 'default' = 'default'

  // For Base Sepolia, use Alchemy RPC if available
  if (chainId === 84532) {
    const alchemyRpcUrl = process.env.REACT_APP_ALCHEMY_BASE_SEPOLIA
    if (alchemyRpcUrl) {
      try {
        const chainInfo = getChainInfo(UniverseChainId.BaseSepolia)
        const viemChain = defineChain({
          id: chainInfo.id,
          name: chainInfo.name,
          nativeCurrency: chainInfo.nativeCurrency,
          rpcUrls: chainInfo.rpcUrls,
        })
        client = createPublicClient({
          chain: viemChain,
          transport: http(alchemyRpcUrl),
        })
        estimationSource = 'alchemy'
      } catch (error) {
        boundaryLog(
          '[ESTIMATE-GAS] Failed to create Alchemy client, falling back',
          {
            tags: { file: 'estimateGasFee', function: 'estimateGasFee' },
            extra: {
              chainId,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          chainId,
        )
        // Fall through to use default client
      }
    }
  }

  // If no client yet, create one using existing logic
  if (!client) {
    if (chainId === 84532) {
      // For Base Sepolia, use createViemClient with public RPC
      client = createViemClient({ chainId: UniverseChainId.BaseSepolia, rpcType: RPCType.Public })
      estimationSource = 'default'
    } else {
      // For other chains, use provided provider or create default
      client = provider || createViemClient({ chainId: chainId as UniverseChainId })
      estimationSource = provider ? 'wallet' : 'default'
    }
  }

  if (!client) {
    throw new Error(`Failed to create client for chain ${chainId}`)
  }

  try {
    // Estimate gas limit (with account if provided)
    const gasEstimateParams: any = {
      to: txRequest.to as `0x${string}`,
      data: txRequest.data as `0x${string}`,
      value: txRequest.value
        ? typeof txRequest.value === 'string'
          ? BigInt(txRequest.value)
          : BigInt(String(txRequest.value))
        : undefined,
    }
    if (account) {
      gasEstimateParams.account = account as `0x${string}`
    }

    const gasLimit = await client.estimateGas(gasEstimateParams)

    // Get fee data (EIP-1559 or legacy)
    const feeData: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint } =
      (await client.estimateFeesPerGas()) as {
        maxFeePerGas?: bigint
        maxPriorityFeePerGas?: bigint
        gasPrice?: bigint
      }

    // Fallback to getGasPrice if maxFeePerGas is missing
    if (!feeData.maxFeePerGas && !feeData.gasPrice) {
      try {
        const gasPrice = await client.getGasPrice()
        feeData.gasPrice = gasPrice
      } catch (fallbackError) {
        boundaryLog(
          '[ESTIMATE-GAS] getGasPrice fallback failed',
          {
            tags: { file: 'estimateGasFee', function: 'estimateGasFee' },
            extra: {
              chainId,
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            },
          },
          chainId,
        )
      }
    }

    // Compute total gas cost
    let totalCostWei: bigint
    if (feeData.maxFeePerGas) {
      // EIP-1559: total = maxFeePerGas * gasLimit
      totalCostWei = feeData.maxFeePerGas * gasLimit
    } else if (feeData.gasPrice) {
      // Legacy: total = gasPrice * gasLimit
      totalCostWei = feeData.gasPrice * gasLimit
    } else {
      throw new Error('No fee data available (neither maxFeePerGas nor gasPrice)')
    }

    const result: EstimatedGasFee = {
      totalCostWei,
      gasLimit,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasPrice: feeData.gasPrice,
      estimationSource,
    }

    boundaryLog(
      '[ESTIMATE-GAS] gas estimated',
      {
        tags: { file: 'estimateGasFee', function: 'estimateGasFee' },
        extra: {
          chainId,
          estimationSource,
          gasLimit: gasLimit.toString(),
          maxFeePerGas: feeData.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
          gasPrice: feeData.gasPrice ? feeData.gasPrice.toString() : undefined,
          totalCostWei: totalCostWei.toString(),
        },
      },
      chainId,
    )

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const txTo = txRequest.to ? String(txRequest.to).toLowerCase() : undefined
    const txData = txRequest.data || ''
    const selector = txData.length >= 10 ? txData.slice(0, 10) : undefined
    const dataLen = txData.length
    const value = txRequest.value ? String(txRequest.value) : '0'
    const hasAccount = !!account

    // Classify tx type for diagnostic
    const isApprovalLike =
      selector === '0x095ea7b3' || // ERC20 approve(address,uint256)
      (txTo &&
        (txTo === '0x000000000022d473030f116ddee9f6b43ac78ba3' ||
          txTo === '0x000000000022D473030F116dDEE9F6B43aC78BA3')) // Permit2
    const isSwapLike =
      txTo &&
      (txTo === '0xfbe90a25e523e7e668cc2da97bed21d8fb0bda26' || // Agroswap Swap Router
        txTo === '0xf2405e35650268a08a9c12d3ab7fc0b82eba5318') // Universal Router
    const txType = isApprovalLike ? 'approve-like' : isSwapLike ? 'swap-like' : 'unknown'

    // Diagnostic log (temporary, minimal)
    if (chainId === 84532 && process.env.NODE_ENV !== 'production') {
       
      console.log('[ESTIMATE FAIL]', {
        chainId,
        to: txTo,
        selector,
        dataLen,
        value,
        hasAccount,
        txType,
        err: errorMessage.includes('STF') ? 'STF' : errorMessage.slice(0, 50),
      })
    }

    boundaryLogDeduped(
      '[ESTIMATE-GAS] estimation failed',
      {
        tags: { file: 'estimateGasFee', function: 'estimateGasFee' },
        extra: {
          chainId,
          estimationSource,
          error: errorMessage,
          txRequestTo: txTo,
          txRequestDataLen: dataLen,
          txType,
          hasAccount,
        },
      },
      chainId,
      {
        ttlMs: 5000,
        minIntervalMs: 5000,
        keyParts: ['ESTIMATE-GAS-failed', chainId, txTo],
      },
    )
    throw error
  }
}
