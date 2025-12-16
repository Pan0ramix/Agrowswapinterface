import { BigNumber } from '@ethersproject/bignumber'
import { JsonRpcSigner } from '@ethersproject/providers'
import { getAccount } from '@wagmi/core'
import { popupRegistry } from 'components/Popups/registry'
import { PopupType } from 'components/Popups/types'
import { wagmiConfig } from 'components/Web3Provider/wagmiConfig'
import { timestampToDeadline } from 'hooks/useTransactionDeadline'
import { getRoutingForTransaction } from 'state/activity/utils'
import { getSigner, watchForInterruption } from 'state/sagas/transactions/utils'
import { handleGetCapabilities } from 'state/walletCapabilities/lib/handleGetCapabilities'
import { setCapabilitiesByChain } from 'state/walletCapabilities/reducer'
import type { InterfaceState } from 'state/webReducer'
import { call, put, select } from 'typed-redux-saga'
import { updateMintDeadline } from 'uniswap/src/features/transactions/liquidity/utils/updateMintDeadline'
import { addTransaction } from 'uniswap/src/features/transactions/slice'
import { HandleOnChainStepParams, OnChainTransactionStepBatched } from 'uniswap/src/features/transactions/steps/types'
import {
  InterfaceTransactionDetails,
  TransactionOriginType,
  TransactionStatus,
} from 'uniswap/src/features/transactions/types/transactionDetails'
import { ValidatedTransactionRequest } from 'uniswap/src/features/transactions/types/transactionRequests'
import { didUserReject } from 'utils/swapErrorToUserReadableMessage'

const CURRENT_SEND_CALLS_VERSION = '2.0.0'

/**
 * Compute deadline using Uniswap's shared deadline helper (for batched transactions)
 * Same logic as computeDeadlineForMint in liquiditySaga.ts
 *
 * TTL source: state.user.userDeadline (from Redux state, same as swaps)
 * - For L2 chains: timestampToDeadline uses L2_DEADLINE_FROM_NOW constant (300 seconds), ignoring ttl
 * - For L1 chains: timestampToDeadline uses ttl from user settings (can be undefined)
 * - Returns undefined if blockTimestamp or required TTL is missing (same behavior as swaps)
 *
 * This matches the exact behavior of useGetTransactionDeadline used by swaps.
 */
async function computeDeadlineForBatchedMint(
  chainId: number,
  userDeadline: number | undefined, // TTL from state.user.userDeadline (can be undefined, same as swaps)
  accountAddress: string,
): Promise<number | undefined> {
  try {
    // Get current block timestamp (on-chain, not client time - same as swaps)
    // Use getSigner to access provider (same pattern as other saga functions)
    const signer = await getSigner(accountAddress)
    const block = await signer.provider.getBlock('latest')
    const blockTimestamp = BigNumber.from(block.timestamp)

    // Use Uniswap's shared deadline helper (same as useGetTransactionDeadline)
    const deadline = timestampToDeadline({
      chainId,
      blockTimestamp,
      ttl: userDeadline,
    })

    if (!deadline) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[computeDeadlineForBatchedMint] Failed to compute deadline', {
          chainId,
          blockTimestamp: blockTimestamp.toString(),
          ttl: userDeadline,
        })
      }
      return undefined
    }

    // Convert BigNumber to number (deadline is in seconds)
    return deadline.toNumber()
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[computeDeadlineForBatchedMint] Error computing deadline', {
        chainId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return undefined
  }
}

async function sendCalls(params: {
  signer: JsonRpcSigner
  batchedTxRequests: ValidatedTransactionRequest[]
  from: string
  chainId: number
  userDeadline: number | undefined // TTL from Redux state (state.user.userDeadline, can be undefined - same as swaps)
}): Promise<string> {
  const { signer, batchedTxRequests, from, userDeadline } = params
  const chainId = `0x${params.chainId.toString(16)}`

  // Update deadlines in mint calldata before sending
  // This ensures deadlines are always fresh when transactions are actually sent
  // Uses the same deadline computation as swaps (timestampToDeadline with user TTL from Redux)
  // TTL source: state.user.userDeadline (same as swaps)
  const calls = await Promise.all(
    batchedTxRequests.map(async ({ to, data, value }) => {
      // Check if this is a V3 mint transaction (starts with 0x88316456)
      if (data && data.startsWith('0x88316456')) {
        const freshDeadline = await computeDeadlineForBatchedMint(params.chainId, userDeadline, from)
        if (freshDeadline !== undefined) {
          const updatedData = updateMintDeadline(data, freshDeadline)
          return { to, data: updatedData, value }
        } else if (process.env.NODE_ENV !== 'production') {
          console.warn('[sendCalls] Could not compute fresh deadline for mint, using original calldata', {
            chainId: params.chainId,
          })
        }
      }
      return { to, data, value }
    }),
  )
  const result = await signer.provider.send('wallet_sendCalls', [
    { version: CURRENT_SEND_CALLS_VERSION, calls, from, chainId, atomicRequired: true },
  ])

  return result.id as string
}

export function* handleAtomicSendCalls(
  params: Omit<HandleOnChainStepParams, 'step'> & {
    step: OnChainTransactionStepBatched
    disableOneClickSwap?: () => void
  },
) {
  const { step, info, address, ignoreInterrupt, disableOneClickSwap } = params
  const { batchedTxRequests } = step
  const chainId = batchedTxRequests[0].chainId

  // Get user-configured TTL from Redux state (same source as swaps)
  // Pass ttl as-is (can be undefined) - timestampToDeadline handles it the same way swaps do
  // TTL source: state.user.userDeadline (initialized to DEFAULT_DEADLINE_FROM_NOW in reducer, but can be undefined)
  const userDeadline: number | undefined = yield* select((state: InterfaceState) => state.user.userDeadline)

  try {
    // Add a watcher to check if the transaction flow during user input
    const { throwIfInterrupted } = yield* watchForInterruption(ignoreInterrupt)

    const signer = yield* call(getSigner, address)
    const batchId = yield* call(() => sendCalls({ signer, batchedTxRequests, from: address, chainId, userDeadline }))

    const connectorId = getAccount(wagmiConfig).connector?.id
    const batchInfo = { connectorId, batchId, chainId }

    // Add transaction to local state to start polling for status
    yield* put(
      addTransaction({
        id: batchId,
        hash: batchId,
        from: address,
        typeInfo: info,
        chainId,
        batchInfo,
        routing: getRoutingForTransaction(info),
        transactionOriginType: TransactionOriginType.Internal,
        status: TransactionStatus.Pending,
        addedTime: Date.now(),
        options: {
          request: {
            to: batchedTxRequests[0].to,
            from: address,
            data: batchedTxRequests[0].data,
            value: batchedTxRequests[0].value,
            gasLimit: batchedTxRequests[0].gasLimit,
            gasPrice: batchedTxRequests[0].gasPrice,
            nonce: batchedTxRequests[0].nonce,
            chainId: batchedTxRequests[0].chainId,
          },
        },
      } satisfies InterfaceTransactionDetails),
    )

    popupRegistry.addPopup({ type: PopupType.Transaction, hash: batchId }, batchId)

    // If the transaction flow was interrupted, throw an error after the step has completed
    yield* call(throwIfInterrupted)

    return batchId
  } catch (error) {
    // Specific handling for when the user rejects
    if (error.code === 5750 || isMetaMaskNonTypicalRejection(error)) {
      const updatedCapabilities = yield* call(handleGetCapabilities)
      if (updatedCapabilities) {
        // A wallet may update its capabilities after a delegation is rejected, so we refresh state here such subsequent transactions use the updated capabilities
        yield* put(setCapabilitiesByChain(updatedCapabilities))
      }
      // If the user tries again,
      disableOneClickSwap?.()
    }
    throw error
  }
}

// TODO(WEB-7784): Remove once MetaMask fixes their error -32603 response code
function isMetaMaskNonTypicalRejection(error: any): boolean {
  return didUserReject(error) && error.code === -32603
}
