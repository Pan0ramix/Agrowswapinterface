import { Currency, CurrencyAmount, Token } from '@uniswap/sdk-core'
import { OnChainTransactionFields, TransactionStepType } from 'uniswap/src/features/transactions/steps/types'
import { ValidatedTransactionRequest } from 'uniswap/src/features/transactions/types/transactionRequests'
import { parseERC20ApproveCalldata } from 'uniswap/src/utils/approvals'

export interface TokenApprovalTransactionStep extends OnChainTransactionFields {
  type: TransactionStepType.TokenApprovalTransaction
  token: Token
  spender: string
  pair?: [Currency, Currency]
  // TODO(WEB-5083): this is used to distinguish a revoke from an approve. It can likely be replaced by a boolean because for LP stuff the amount isn't straight forward.
  amount: string
}

export function createApprovalTransactionStep({
  txRequest,
  amountIn,
  pair,
}: {
  txRequest?: ValidatedTransactionRequest
  amountIn?: CurrencyAmount<Currency>
  pair?: [Currency, Currency]
}): TokenApprovalTransactionStep | undefined {
  // CRITICAL: Check all required fields
  const missingTo = !txRequest?.to
  const missingData = !txRequest?.data
  const missingAmountIn = !amountIn
  const dataLen = (txRequest?.data as string | undefined)?.length ?? 0

  if (missingTo || missingData || missingAmountIn) {
    // Debug logging for why approval step creation failed (Base Sepolia on-chain-only)
    if (process.env.NODE_ENV !== 'production' && txRequest?.chainId === 84532) {
      console.warn('[APPROVAL-STEP] returned-undefined', {
        missingTo,
        missingData,
        missingAmountIn,
        to: txRequest.to,
        dataLen,
        hasAmountIn: !!amountIn,
        amountInValue: amountIn?.quotient.toString(),
        chainId: txRequest.chainId,
      })
    }
    return undefined
  }

  const type = TransactionStepType.TokenApprovalTransaction
  const token = amountIn.currency.wrapped
  const { spender } = parseERC20ApproveCalldata(txRequest.data.toString())
  const amount = amountIn.quotient.toString()

  // Debug logging for successful approval step creation (Base Sepolia on-chain-only)
  if (process.env.NODE_ENV !== 'production' && txRequest.chainId === 84532) {
    console.log('[APPROVAL-STEP] approval step created successfully', {
      chainId: txRequest.chainId,
      token: token.address,
      spender,
      amount,
      txRequestTo: txRequest.to,
    })
  }

  return { type, txRequest, token, spender, amount, pair }
}
