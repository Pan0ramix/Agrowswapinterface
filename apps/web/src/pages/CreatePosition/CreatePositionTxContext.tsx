/* eslint-disable max-lines */
import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { getProtocolVersionLabel } from 'components/Liquidity/utils/protocolVersion'
import { Currency, CurrencyAmount, MaxUint256, Price } from '@uniswap/sdk-core'
import { Pair } from '@uniswap/v2-sdk'
import { Pool as V3Pool, priceToClosestTick, TickMath, encodeSqrtRatioX96 } from '@uniswap/v3-sdk'
import { Pool as V4Pool } from '@uniswap/v4-sdk'
import { TradingApi } from '@universe/api'
import { useDepositInfo } from 'components/Liquidity/Create/hooks/useDepositInfo'
import { DYNAMIC_FEE_DATA, PositionState } from 'components/Liquidity/Create/types'
import { useCreatePositionDependentAmountFallback } from 'components/Liquidity/hooks/useDependentAmountFallback'
import { getTokenOrZeroAddress, validateCurrencyInput } from 'components/Liquidity/utils/currency'
import { isInvalidRange, isOutOfRange } from 'components/Liquidity/utils/priceRangeInfo'
import { getProtocolItems } from 'components/Liquidity/utils/protocolVersion'
import { useCreateLiquidityContext } from 'pages/CreatePosition/CreateLiquidityContextProvider'
import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { PositionField } from 'types/position'
import { useUniswapContextSelector } from 'uniswap/src/contexts/UniswapContext'
import { useCheckLpApprovalQuery } from 'uniswap/src/data/apiClients/tradingApi/useCheckLpApprovalQuery'
import { useCreateLpPositionCalldataQuery } from 'uniswap/src/data/apiClients/tradingApi/useCreateLpPositionCalldataQuery'
import { useV3MintPosition } from 'uniswap/src/features/transactions/liquidity/hooks/useV3MintPosition'
import { useOnChainLpApproval } from 'uniswap/src/features/transactions/liquidity/hooks/useOnChainLpApproval'
import { convertFeeToFeeAmount, convertOnChainTxToCreateLpResponse } from 'uniswap/src/features/transactions/liquidity/utils/v3OnChainIntegration'
import { isOnChainRouterEnabled } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { FeeAmount } from '@uniswap/v3-sdk'
import { Percent } from '@uniswap/sdk-core'
import { toSupportedChainId } from 'uniswap/src/features/chains/utils'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { useTransactionGasFee, useUSDCurrencyAmountOfGasFee } from 'uniswap/src/features/gas/hooks'
import { InterfaceEventName } from 'uniswap/src/features/telemetry/constants'
import { sendAnalyticsEvent } from 'uniswap/src/features/telemetry/send'
import { useTransactionSettingsStore } from 'uniswap/src/features/transactions/components/settings/stores/transactionSettingsStore/useTransactionSettingsStore'
import { CreatePositionTxAndGasInfo, LiquidityTransactionType } from 'uniswap/src/features/transactions/liquidity/types'
import { getErrorMessageToDisplay, parseErrorMessageTitle } from 'uniswap/src/features/transactions/liquidity/utils'
import { TransactionStepType } from 'uniswap/src/features/transactions/steps/types'
import { PermitMethod } from 'uniswap/src/features/transactions/swap/types/swapTxAndGasInfo'
import { validatePermit, validateTransactionRequest } from 'uniswap/src/features/transactions/swap/utils/trade'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { AccountDetails } from 'uniswap/src/features/wallet/types/AccountDetails'
import { logger } from 'utilities/src/logger/logger'
import JSBI from 'jsbi'
import { encodeFunctionData, erc20Abi } from 'viem'
import { getPositionManagerAddress } from 'uniswap/src/constants/v3Addresses'
import { AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from 'uniswap/src/constants/agroswapAddresses'
import { ONE_SECOND_MS } from 'utilities/src/time/time'

/**
 * @internal - exported for testing
 */
export function generateAddLiquidityApprovalParams({
  address,
  protocolVersion,
  displayCurrencies,
  currencyAmounts,
  canBatchTransactions,
}: {
  address?: string
  protocolVersion: ProtocolVersion
  displayCurrencies: { [field in PositionField]: Maybe<Currency> }
  currencyAmounts?: { [field in PositionField]?: Maybe<CurrencyAmount<Currency>> }
  canBatchTransactions?: boolean
}): TradingApi.CheckApprovalLPRequest | undefined {
  const apiProtocolItems = getProtocolItems(protocolVersion)

  if (
    !address ||
    !apiProtocolItems ||
    !currencyAmounts?.TOKEN0 ||
    !currencyAmounts.TOKEN1 ||
    !validateCurrencyInput(displayCurrencies)
  ) {
    return undefined
  }

  return {
    simulateTransaction: true,
    walletAddress: address,
    chainId: currencyAmounts.TOKEN0.currency.chainId,
    protocol: apiProtocolItems,
    token0: getTokenOrZeroAddress(displayCurrencies.TOKEN0),
    token1: getTokenOrZeroAddress(displayCurrencies.TOKEN1),
    amount0: currencyAmounts.TOKEN0.quotient.toString(),
    amount1: currencyAmounts.TOKEN1.quotient.toString(),
    generatePermitAsTransaction: protocolVersion === ProtocolVersion.V4 ? canBatchTransactions : undefined,
  } satisfies TradingApi.CheckApprovalLPRequest
}

/**
 * @internal - exported for testing
 */
export function generateCreateCalldataQueryParams({
  protocolVersion,
  creatingPoolOrPair,
  account,
  approvalCalldata,
  positionState,
  ticks,
  poolOrPair,
  displayCurrencies,
  currencyAmounts,
  independentField,
  slippageTolerance,
}: {
  protocolVersion: ProtocolVersion
  creatingPoolOrPair: boolean | undefined
  account?: AccountDetails
  approvalCalldata?: TradingApi.CheckApprovalLPResponse
  positionState: PositionState
  ticks: [Maybe<number>, Maybe<number>]
  poolOrPair: V3Pool | V4Pool | Pair | undefined
  displayCurrencies: { [field in PositionField]: Maybe<Currency> }
  currencyAmounts?: { [field in PositionField]?: Maybe<CurrencyAmount<Currency>> }
  independentField: PositionField
  slippageTolerance?: number
}): TradingApi.CreateLPPositionRequest | undefined {
  const apiProtocolItems = getProtocolItems(protocolVersion)

  if (
    !account?.address ||
    !apiProtocolItems ||
    !currencyAmounts?.TOKEN0 ||
    !currencyAmounts.TOKEN1 ||
    !validateCurrencyInput(displayCurrencies)
  ) {
    return undefined
  }

  const {
    token0Approval,
    token1Approval,
    positionTokenApproval,
    permitData,
    token0PermitTransaction,
    token1PermitTransaction,
  } = approvalCalldata ?? {}

  if (protocolVersion === ProtocolVersion.V2) {
    if (protocolVersion !== positionState.protocolVersion) {
      return undefined
    }

    const pair = poolOrPair

    if (!pair || !displayCurrencies.TOKEN0 || !displayCurrencies.TOKEN1) {
      return undefined
    }

    const independentToken =
      independentField === PositionField.TOKEN0
        ? TradingApi.IndependentToken.TOKEN_0
        : TradingApi.IndependentToken.TOKEN_1
    const dependentField = independentField === PositionField.TOKEN0 ? PositionField.TOKEN1 : PositionField.TOKEN0
    const independentAmount = currencyAmounts[independentField]
    const dependentAmount = currencyAmounts[dependentField]

    return {
      simulateTransaction: !(
        permitData ||
        token0PermitTransaction ||
        token1PermitTransaction ||
        token0Approval ||
        token1Approval ||
        positionTokenApproval
      ),
      protocol: apiProtocolItems,
      walletAddress: account.address,
      chainId: currencyAmounts.TOKEN0.currency.chainId,
      independentAmount: independentAmount?.quotient.toString(),
      independentToken,
      defaultDependentAmount: dependentAmount?.quotient.toString(),
      slippageTolerance,
      position: {
        pool: {
          token0: getTokenOrZeroAddress(displayCurrencies.TOKEN0),
          token1: getTokenOrZeroAddress(displayCurrencies.TOKEN1),
        },
      },
    } satisfies TradingApi.CreateLPPositionRequest
  }

  if (protocolVersion !== positionState.protocolVersion) {
    return undefined
  }

  const pool = poolOrPair as V4Pool | V3Pool | undefined
  if (!pool || !displayCurrencies.TOKEN0 || !displayCurrencies.TOKEN1) {
    return undefined
  }

  const tickLower = ticks[0]
  const tickUpper = ticks[1]

  if (tickLower === undefined || tickUpper === undefined) {
    return undefined
  }

  const initialPrice = creatingPoolOrPair ? pool.sqrtRatioX96.toString() : undefined
  const tickSpacing = pool.tickSpacing

  const independentToken =
    independentField === PositionField.TOKEN0
      ? TradingApi.IndependentToken.TOKEN_0
      : TradingApi.IndependentToken.TOKEN_1
  const dependentField = independentField === PositionField.TOKEN0 ? PositionField.TOKEN1 : PositionField.TOKEN0
  const independentAmount = currencyAmounts[independentField]
  const dependentAmount = currencyAmounts[dependentField]

  return {
    simulateTransaction: !(
      permitData ||
      token0PermitTransaction ||
      token1PermitTransaction ||
      token0Approval ||
      token1Approval ||
      positionTokenApproval
    ),
    protocol: apiProtocolItems,
    walletAddress: account.address,
    chainId: currencyAmounts.TOKEN0.currency.chainId,
    independentAmount: independentAmount?.quotient.toString(),
    independentToken,
    initialDependentAmount: initialPrice && dependentAmount?.quotient.toString(), // only set this if there is an initialPrice
    initialPrice,
    slippageTolerance,
    position: {
      tickLower: tickLower ?? undefined,
      tickUpper: tickUpper ?? undefined,
      pool: {
        tickSpacing,
        token0: getTokenOrZeroAddress(displayCurrencies.TOKEN0),
        token1: getTokenOrZeroAddress(displayCurrencies.TOKEN1),
        fee: positionState.fee?.isDynamic ? DYNAMIC_FEE_DATA.feeAmount : positionState.fee?.feeAmount,
        hooks: positionState.hook,
      },
    },
  } satisfies TradingApi.CreateLPPositionRequest
}

/**
 * @internal - exported for testing
 */
export function generateCreatePositionTxRequest({
  protocolVersion,
  approvalCalldata,
  createCalldata,
  createCalldataQueryParams,
  currencyAmounts,
  poolOrPair,
  canBatchTransactions,
}: {
  protocolVersion: ProtocolVersion
  approvalCalldata?: TradingApi.CheckApprovalLPResponse
  createCalldata?: TradingApi.CreateLPPositionResponse
  createCalldataQueryParams?: TradingApi.CreateLPPositionRequest
  currencyAmounts?: { [field in PositionField]?: Maybe<CurrencyAmount<Currency>> }
  poolOrPair: Pair | undefined
  canBatchTransactions: boolean
}): CreatePositionTxAndGasInfo | undefined {
  if (!createCalldata || !currencyAmounts?.TOKEN0 || !currencyAmounts.TOKEN1) {
    return undefined
  }

  const validatedApprove0Request = validateTransactionRequest(approvalCalldata?.token0Approval)
  if (approvalCalldata?.token0Approval && !validatedApprove0Request) {
    return undefined
  }

  const validatedApprove1Request = validateTransactionRequest(approvalCalldata?.token1Approval)
  if (approvalCalldata?.token1Approval && !validatedApprove1Request) {
    return undefined
  }

  const validatedRevoke0Request = validateTransactionRequest(approvalCalldata?.token0Cancel)
  if (approvalCalldata?.token0Cancel && !validatedRevoke0Request) {
    return undefined
  }

  const validatedRevoke1Request = validateTransactionRequest(approvalCalldata?.token1Cancel)
  if (approvalCalldata?.token1Cancel && !validatedRevoke1Request) {
    return undefined
  }

  const validatedPermitRequest = validatePermit(approvalCalldata?.permitData)
  if (approvalCalldata?.permitData && !validatedPermitRequest) {
    return undefined
  }

  const validatedToken0PermitTransaction = validateTransactionRequest(approvalCalldata?.token0PermitTransaction)
  const validatedToken1PermitTransaction = validateTransactionRequest(approvalCalldata?.token1PermitTransaction)

  const txRequest = validateTransactionRequest(createCalldata.create)
  if (!txRequest && !(validatedToken0PermitTransaction || validatedToken1PermitTransaction)) {
    // Allow missing txRequest if mismatched (unsigned flow using token0PermitTransaction/2)
    return undefined
  }

  const queryParams: TradingApi.CreateLPPositionRequest | undefined =
    protocolVersion === ProtocolVersion.V4
      ? { ...createCalldataQueryParams, batchPermitData: validatedPermitRequest }
      : createCalldataQueryParams

  return {
    type: LiquidityTransactionType.Create,
    canBatchTransactions,
    unsigned: Boolean(validatedPermitRequest),
    createPositionRequestArgs: queryParams,
    action: {
      type: LiquidityTransactionType.Create,
      currency0Amount: currencyAmounts.TOKEN0,
      currency1Amount: currencyAmounts.TOKEN1,
      liquidityToken: protocolVersion === ProtocolVersion.V2 ? poolOrPair?.liquidityToken : undefined,
    },
    approveToken0Request: validatedApprove0Request,
    approveToken1Request: validatedApprove1Request,
    txRequest,
    approvePositionTokenRequest: undefined,
    revokeToken0Request: validatedRevoke0Request,
    revokeToken1Request: validatedRevoke1Request,
    permit: validatedPermitRequest ? { method: PermitMethod.TypedData, typedData: validatedPermitRequest } : undefined,
    token0PermitTransaction: validatedToken0PermitTransaction,
    token1PermitTransaction: validatedToken1PermitTransaction,
    positionTokenPermitTransaction: undefined,
    sqrtRatioX96: createCalldata.sqrtRatioX96,
  } satisfies CreatePositionTxAndGasInfo
}

interface CreatePositionTxContextType {
  txInfo?: CreatePositionTxAndGasInfo
  gasFeeEstimateUSD?: Maybe<CurrencyAmount<Currency>>
  transactionError: boolean | string
  setTransactionError: Dispatch<SetStateAction<string | boolean>>
  dependentAmount?: string
  currencyAmounts?: { [field in PositionField]?: Maybe<CurrencyAmount<Currency>> }
  inputError?: ReactNode
  formattedAmounts?: { [field in PositionField]?: string }
  currencyAmountsUSDValue?: { [field in PositionField]?: Maybe<CurrencyAmount<Currency>> }
  currencyBalances?: { [field in PositionField]?: CurrencyAmount<Currency> }
}

const CreatePositionTxContext = createContext<CreatePositionTxContextType | undefined>(undefined)

export function CreatePositionTxContextProvider({ children }: PropsWithChildren): JSX.Element {
  const {
    protocolVersion,
    currencies,
    ticks,
    poolOrPair,
    depositState,
    creatingPoolOrPair,
    currentTransactionStep,
    positionState,
    setRefetch,
    price,
  } = useCreateLiquidityContext()
  const account = useWallet().evmAccount
  const { TOKEN0, TOKEN1 } = currencies.display
  const { exactField } = depositState
  const v3PoolForPosition = useMemo(
    () => (protocolVersion === ProtocolVersion.V3 ? (poolOrPair as V3Pool | undefined) : undefined),
    [poolOrPair, protocolVersion],
  )

  const invalidRange = protocolVersion !== ProtocolVersion.V2 && isInvalidRange(ticks[0], ticks[1])
  const depositInfoProps = useMemo(() => {
    const [tickLower, tickUpper] = ticks
    const outOfRange = isOutOfRange({
      poolOrPair,
      lowerTick: tickLower,
      upperTick: tickUpper,
    })

    const props = {
      protocolVersion,
      poolOrPair,
      address: account?.address,
      token0: TOKEN0,
      token1: TOKEN1,
      tickLower: protocolVersion !== ProtocolVersion.V2 ? (tickLower ?? undefined) : undefined,
      tickUpper: protocolVersion !== ProtocolVersion.V2 ? (tickUpper ?? undefined) : undefined,
      exactField,
      exactAmounts: depositState.exactAmounts,
      skipDependentAmount: protocolVersion === ProtocolVersion.V2 ? false : outOfRange || invalidRange,
      feeAmount: protocolVersion === ProtocolVersion.V3 ? (positionState.fee?.isDynamic ? undefined : positionState.fee?.feeAmount) : undefined,
      price: protocolVersion === ProtocolVersion.V3 ? price : undefined, // Pass price for V3 mock pool creation (matches upstream useV3DerivedMintInfo)
    }

    return props
  }, [TOKEN0, TOKEN1, exactField, ticks, poolOrPair, depositState, account?.address, protocolVersion, invalidRange])

  const {
    currencyAmounts,
    error: inputError,
    formattedAmounts,
    currencyAmountsUSDValue,
    currencyBalances,
  } = useDepositInfo(depositInfoProps)

  // Dev-only: log currencyAmounts received from useDepositInfo
  if (process.env.NODE_ENV !== 'production') {
    console.log('[CreatePositionTxContext] currencyAmounts received from useDepositInfo', {
      TOKEN0: currencyAmounts?.TOKEN0 ? {
        raw: currencyAmounts.TOKEN0.quotient.toString(),
        human: currencyAmounts.TOKEN0.toExact(),
        currency: currencyAmounts.TOKEN0.currency.symbol,
        address: currencyAmounts.TOKEN0.currency.address,
        decimals: currencyAmounts.TOKEN0.currency.decimals,
      } : undefined,
      TOKEN1: currencyAmounts?.TOKEN1 ? {
        raw: currencyAmounts.TOKEN1.quotient.toString(),
        human: currencyAmounts.TOKEN1.toExact(),
        currency: currencyAmounts.TOKEN1.currency.symbol,
        address: currencyAmounts.TOKEN1.currency.address,
        decimals: currencyAmounts.TOKEN1.currency.decimals,
      } : undefined,
      formattedAmounts,
      currencyAmountsUSDValue: currencyAmountsUSDValue ? {
        TOKEN0: currencyAmountsUSDValue.TOKEN0?.toExact(),
        TOKEN1: currencyAmountsUSDValue.TOKEN1?.toExact(),
      } : undefined,
    })
  }

  const { customDeadline, customSlippageTolerance } = useTransactionSettingsStore((s) => ({
    customDeadline: s.customDeadline,
    customSlippageTolerance: s.customSlippageTolerance,
  }))
  const canBatchTransactionsFromContext =
    useUniswapContextSelector((ctx) => ctx.getCanBatchTransactions?.(poolOrPair?.chainId)) ?? false

  const [transactionError, setTransactionError] = useState<string | boolean>(false)

  // STEP 1: Compute isOnChainEnabled as single source of truth for on-chain router enabled chains
  // This is used for both swaps and LP operations
  const chainId = TOKEN0?.chainId
  const isOnChainEnabled = useMemo(
    () => (chainId != null ? isOnChainRouterEnabled(chainId as number) : false),
    [chainId],
  )

  // Dev-only: log isOnChainEnabled as single source of truth
  if (process.env.NODE_ENV !== 'production') {
    console.log('[CreatePositionTxContext] isOnChainEnabled', { chainId, isOnChainEnabled })
  }

  // STEP 2: useOnChainV3 should depend on isOnChainEnabled
  // Determine if we should use on-chain V3 operations (check early to skip Trading API calls)
  // Use the same source of truth as swaps: isOnChainRouterEnabled
  const useOnChainV3 = useMemo(() => {
    if (!chainId) {
      return false
    }

    // Check if protocol is V3
    const protocolVersionStr = getProtocolVersionLabel(protocolVersion) ?? protocolVersion.toString()
    const isV3Protocol = protocolVersionStr === 'v3' || protocolVersionStr === 'V3' || protocolVersion === ProtocolVersion.V3

    const result = isOnChainEnabled && isV3Protocol

    // Dev-only: log to confirm on-chain mode is active
    if (process.env.NODE_ENV !== 'production') {
      console.log('[CreatePositionTxContext] useOnChainV3 resolved', {
        chainId,
        isOnChainEnabled,
        isV3Protocol,
        protocolVersion: protocolVersionStr,
        useOnChainV3: result,
      })
    }

    return result
  }, [chainId, isOnChainEnabled, protocolVersion])

  // Disable batching on on-chain router testnets to keep approvals sequential and wallet prompts visible.
  const canBatchTransactions = useMemo(
    () => (isOnChainEnabled ? false : canBatchTransactionsFromContext),
    [isOnChainEnabled, canBatchTransactionsFromContext],
  )

  const addLiquidityApprovalParams = useMemo(() => {
    return generateAddLiquidityApprovalParams({
      address: account?.address,
      protocolVersion,
      displayCurrencies: currencies.display,
      currencyAmounts,
      canBatchTransactions,
    })
  }, [account?.address, protocolVersion, currencies.display, currencyAmounts, canBatchTransactions])

  // STEP 3: Fully disable Trading API approvals on on-chain enabled chains
  // Use isOnChainEnabled (not just useOnChainV3) to ensure Trading API is never called
  const approvalQueryEnabled = !isOnChainEnabled && !!addLiquidityApprovalParams && !inputError && !transactionError && !invalidRange
  
  // Dev-only: log approval query status
  if (process.env.NODE_ENV !== 'production') {
    console.log('[CreatePositionTxContext] Approval query enabled check', {
      useOnChainV3,
      hasApprovalParams: !!addLiquidityApprovalParams,
      inputError,
      transactionError,
      invalidRange,
      enabled: approvalQueryEnabled,
      TOKEN0ChainId: TOKEN0?.chainId,
      protocolVersion: protocolVersion.toString(),
    })
  }
  
  // Use on-chain approval check when on-chain router is enabled
  const onChainApproval = useOnChainLpApproval({
    amount0: currencyAmounts?.TOKEN0,
    amount1: currencyAmounts?.TOKEN1,
    chainId: TOKEN0?.chainId as EVMUniverseChainId | undefined,
    owner: account?.address,
  })

  // Trading API approval query (completely disabled when using on-chain)
  // When useOnChainV3 is true, we must NOT call this hook at all to avoid Trading API errors
  const {
    data: tradingApiApprovalCalldata,
    error: approvalError,
    isLoading: approvalLoading,
    refetch: approvalRefetch,
  } = useCheckLpApprovalQuery({
    // Hard guard: pass undefined params and disable query when on-chain is enabled
    // Use isOnChainEnabled (not just useOnChainV3) to ensure Trading API is never called
    params: isOnChainEnabled ? undefined : addLiquidityApprovalParams,
    staleTime: 5 * ONE_SECOND_MS,
    retry: false,
    // Disable query completely when on-chain is enabled
    enabled: isOnChainEnabled ? false : approvalQueryEnabled,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  // Helper to build ERC20 approve transaction request for on-chain path
  const buildOnChainApprovalTxRequest = useCallback((
    token: Currency | undefined,
    spender: string | undefined,
    chainId: number | undefined,
  ): TradingApi.TransactionRequest | undefined => {
    if (!token || !spender || !chainId || token.isNative) {
      return undefined
    }

    try {
      const tokenAddress = token.address as `0x${string}`
      const spenderAddress = spender as `0x${string}`
      
      // Encode approve(spender, MaxUint256) calldata
      // Convert MaxUint256 (JSBI) to bigint for viem
      const maxUint256BigInt = BigInt(MaxUint256.toString())
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [spenderAddress, maxUint256BigInt],
      })

      return {
        to: tokenAddress,
        data,
        value: '0x0',
        chainId,
      } as TradingApi.TransactionRequest
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[CreatePositionTxContext] Failed to build approval tx request', { token: token.address, spender, error })
      }
      return undefined
    }
  }, [])

  // Get Position Manager address for approvals
  const positionManagerAddress = useMemo(() => {
    if (!TOKEN0?.chainId) {
      return undefined
    }
    const chainId = TOKEN0.chainId as EVMUniverseChainId
    
    // Try Agroswap addresses first
    if (chainId === 84532) {
      const address = AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId as keyof typeof AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES]
      if (address) {
        return address
      }
    }
    
    // Fall back to v3Addresses
    return getPositionManagerAddress(chainId)
  }, [TOKEN0?.chainId])

  // Merge on-chain and Trading API approval data
  // For on-chain enabled chains, build actual approval transaction requests when approvals are needed
  const approvalCalldata = useMemo(() => {
    if (isOnChainEnabled) {
      // Build approval transaction requests for tokens that need approval
      const token0Approval = onChainApproval.needsApproval0 && currencyAmounts?.TOKEN0 && positionManagerAddress
        ? buildOnChainApprovalTxRequest(currencyAmounts.TOKEN0.currency, positionManagerAddress, TOKEN0?.chainId)
        : undefined
      
      const token1Approval = onChainApproval.needsApproval1 && currencyAmounts?.TOKEN1 && positionManagerAddress
        ? buildOnChainApprovalTxRequest(currencyAmounts.TOKEN1.currency, positionManagerAddress, TOKEN1?.chainId)
        : undefined

      const result = {
        token0Approval,
        token1Approval,
        token0Cancel: undefined,
        token1Cancel: undefined,
        permitData: undefined,
        token0PermitTransaction: undefined,
        token1PermitTransaction: undefined,
        positionTokenApproval: undefined,
        gasFeeToken0Approval: undefined,
        gasFeeToken1Approval: undefined,
        gasFeeToken0Permit: undefined,
        gasFeeToken1Permit: undefined,
      } as TradingApi.CheckApprovalLPResponse

      // Dev-only: log on-chain approval data
      if (process.env.NODE_ENV !== 'production') {
        console.log('[CreatePositionTxContext] On-chain approvalCalldata', {
          needsApproval0: onChainApproval.needsApproval0,
          needsApproval1: onChainApproval.needsApproval1,
          approvalState0: onChainApproval.approvalState0,
          approvalState1: onChainApproval.approvalState1,
          positionManagerAddress,
          hasToken0Approval: !!token0Approval,
          hasToken1Approval: !!token1Approval,
          result,
        })
      }

      return result
    }
    return tradingApiApprovalCalldata
  }, [isOnChainEnabled, onChainApproval, tradingApiApprovalCalldata, currencyAmounts, positionManagerAddress, TOKEN0?.chainId, TOKEN1?.chainId, buildOnChainApprovalTxRequest])

  // STEP 3: LP approval must use only on-chain logic on on-chain chains
  // Force usingOnChainLpApproval to be true when isOnChainEnabled is true
  const usingOnChainLpApproval = isOnChainEnabled
  const usingTradingApiApproval = !isOnChainEnabled && !!addLiquidityApprovalParams && !transactionError

  // Values coming from useOnChainLpApproval
  const onChainNeedsApproval0 = onChainApproval.needsApproval0
  const onChainNeedsApproval1 = onChainApproval.needsApproval1
  const onChainApprovalState0 = onChainApproval.approvalState0
  const onChainApprovalState1 = onChainApproval.approvalState1

  // Values coming from Trading API (for non on-chain chains only)
  const tradingApiNeedsApproval0 = tradingApiApprovalCalldata?.token0Approval !== undefined
  const tradingApiNeedsApproval1 = tradingApiApprovalCalldata?.token1Approval !== undefined
  const tradingApiApprovalState0 = tradingApiNeedsApproval0 ? 'NOT_APPROVED' as const : 'APPROVED' as const
  const tradingApiApprovalState1 = tradingApiNeedsApproval1 ? 'NOT_APPROVED' as const : 'APPROVED' as const

  // Derive effective approval states from the correct source
  const effectiveNeedsApproval0 = isOnChainEnabled ? onChainNeedsApproval0 : tradingApiNeedsApproval0
  const effectiveNeedsApproval1 = isOnChainEnabled ? onChainNeedsApproval1 : tradingApiNeedsApproval1
  const effectiveApprovalState0 = isOnChainEnabled ? onChainApprovalState0 : tradingApiApprovalState0
  const effectiveApprovalState1 = isOnChainEnabled ? onChainApprovalState1 : tradingApiApprovalState1

  // Compute bothApproved
  const bothApproved = effectiveApprovalState0 === 'APPROVED' && effectiveApprovalState1 === 'APPROVED'

  // Dev-only: log approval path selection
  if (process.env.NODE_ENV !== 'production') {
    console.log('[CreatePositionTxContext] LP approval path', {
      chainId: TOKEN0?.chainId,
      isOnChainEnabled,
      useOnChainV3,
      usingOnChainLpApproval,
      usingTradingApiApproval,
      onChainApprovalState0,
      onChainApprovalState1,
      effectiveApprovalState0,
      effectiveApprovalState1,
    })
    
    // Log final approval state after mapping
    console.log('[CreatePositionTxContext] Final approval state', {
      chainId: TOKEN0?.chainId,
      isOnChainEnabled,
      effectiveNeedsApproval0,
      effectiveNeedsApproval1,
      effectiveApprovalState0,
      effectiveApprovalState1,
      bothApproved,
    })
  }

  // Only log approval errors if we're using Trading API (not on-chain)
  if (approvalError && !useOnChainV3) {
    try {
      const message =
        parseErrorMessageTitle(approvalError, { defaultTitle: 'unknown CheckLpApprovalQuery' }) ||
        'unknown CheckLpApprovalQuery'
      const errorToLog =
        approvalError instanceof Error
          ? approvalError
          : new Error(typeof message === 'string' ? message : 'unknown CheckLpApprovalQuery', { cause: approvalError })
      logger.error(errorToLog, {
        tags: { file: 'CreatePositionTxContext', function: 'useEffect' },
      })
    } catch (error) {
      // Fallback error logging if parseErrorMessageTitle fails
      const fallbackError =
        error instanceof Error ? error : new Error('Failed to parse approval error', { cause: approvalError })
      logger.error(fallbackError, {
        tags: { file: 'CreatePositionTxContext', function: 'useEffect' },
      })
    }
  }

  const gasFeeToken0USD = useUSDCurrencyAmountOfGasFee(poolOrPair?.chainId, approvalCalldata?.gasFeeToken0Approval)
  const gasFeeToken1USD = useUSDCurrencyAmountOfGasFee(poolOrPair?.chainId, approvalCalldata?.gasFeeToken1Approval)
  const gasFeeToken0PermitUSD = useUSDCurrencyAmountOfGasFee(poolOrPair?.chainId, approvalCalldata?.gasFeeToken0Permit)
  const gasFeeToken1PermitUSD = useUSDCurrencyAmountOfGasFee(poolOrPair?.chainId, approvalCalldata?.gasFeeToken1Permit)

  // Only generate Trading API params when NOT using on-chain path
  const createCalldataQueryParams = useMemo(() => {
    // Hard guard: return undefined when on-chain is enabled to prevent any Trading API calls
    if (useOnChainV3) {
      return undefined
    }
    return generateCreateCalldataQueryParams({
      account,
      approvalCalldata,
      positionState,
      protocolVersion,
      creatingPoolOrPair,
      displayCurrencies: currencies.display,
      ticks,
      poolOrPair,
      currencyAmounts,
      independentField: depositState.exactField,
      slippageTolerance: customSlippageTolerance,
    })
  }, [
    useOnChainV3, // Add useOnChainV3 as dependency
    account,
    approvalCalldata,
    currencyAmounts,
    creatingPoolOrPair,
    ticks,
    poolOrPair,
    positionState,
    depositState.exactField,
    customSlippageTolerance,
    currencies.display,
    protocolVersion,
  ])

  const isUserCommittedToCreate =
    currentTransactionStep?.step.type === TransactionStepType.IncreasePositionTransaction ||
    currentTransactionStep?.step.type === TransactionStepType.IncreasePositionTransactionAsync

  // For on-chain operations, we don't need approvalCalldata from Trading API
  // For Trading API operations, we still need approvalCalldata
  // For on-chain: approval check doesn't block transaction building - we can build the tx even while checking approvals
  // The approval status is used separately to determine if approval transactions are needed
  // NOTE: pool-not-found check will be added after onChainMintPosition is declared
  const preliminaryIsQueryEnabledForLogging = useMemo(() => {
    return (
      !isUserCommittedToCreate &&
      !inputError &&
      !transactionError &&
      !invalidRange &&
      (useOnChainV3
        ? true // For on-chain, we can always build the transaction - approval check is separate
        : !approvalLoading && !approvalError && Boolean(approvalCalldata)) &&
      (useOnChainV3 || Boolean(createCalldataQueryParams))
    )
  }, [
    isUserCommittedToCreate,
    inputError,
    transactionError,
    invalidRange,
    useOnChainV3,
    approvalLoading,
    approvalError,
    approvalCalldata,
    createCalldataQueryParams,
  ])

  // Dev-only: log query enabled status (using preliminary value before onChainMintPosition)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[CreatePositionTxContext] preliminary isQueryEnabled check', {
      useOnChainV3,
      isUserCommittedToCreate,
      inputError,
      transactionError,
      invalidRange,
      onChainApprovalLoading: useOnChainV3 ? onChainApproval.isLoading : undefined,
      onChainApprovalStates: useOnChainV3
        ? {
            state0: onChainApproval.approvalState0,
            state1: onChainApproval.approvalState1,
            bothApproved:
              onChainApproval.approvalState0 === 'APPROVED' && onChainApproval.approvalState1 === 'APPROVED',
          }
        : undefined,
      approvalLoading: !useOnChainV3 ? approvalLoading : undefined,
      approvalError: !useOnChainV3 ? approvalError : undefined,
      hasApprovalCalldata: !useOnChainV3 ? !!approvalCalldata : undefined,
      hasCreateCalldataQueryParams: !useOnChainV3 ? !!createCalldataQueryParams : undefined,
      preliminaryIsQueryEnabled: preliminaryIsQueryEnabledForLogging,
    })
  }

  // Get fee amount for on-chain operations
  const feeAmount = useMemo(() => {
    if (!useOnChainV3 || !positionState.fee) {
      return undefined
    }
    return convertFeeToFeeAmount(positionState.fee.feeAmount)
  }, [useOnChainV3, positionState.fee])

  // Get slippage tolerance - use Uniswap's standard helper pattern
  const slippageTolerancePercent = useMemo(() => {
    if (customSlippageTolerance !== undefined) {
      // customSlippageTolerance is a number (e.g., 0.5 for 0.5%)
      // Convert to basis points and create Percent instance
      const basisPoints = Math.round(customSlippageTolerance * 100)
      return new Percent(basisPoints, 10_000)
    }
    return new Percent(50, 10_000) // Default 0.5%
  }, [customSlippageTolerance])

  // Compute isQueryEnabled early (before onChainMintPosition) for use in hook enabled flag
  // This is a preliminary check - the full isQueryEnabled will be computed after onChainMintPosition
  const preliminaryIsQueryEnabled = useMemo(() => {
    return (
      !isUserCommittedToCreate &&
      !inputError &&
      !transactionError &&
      !invalidRange &&
      (useOnChainV3
        ? true // For on-chain, we can always build the transaction - approval check is separate
        : !approvalLoading && !approvalError && Boolean(approvalCalldata)) &&
      (useOnChainV3 || Boolean(createCalldataQueryParams))
    )
  }, [
    isUserCommittedToCreate,
    inputError,
    transactionError,
    invalidRange,
    useOnChainV3,
    approvalLoading,
    approvalError,
    approvalCalldata,
    createCalldataQueryParams,
  ])

  // Dev-only: log amounts being passed to useV3MintPosition
  if (process.env.NODE_ENV !== 'production' && useOnChainV3) {
    console.log('[CreatePositionTxContext] Passing amounts to useV3MintPosition', {
      TOKEN0: TOKEN0 ? {
        address: TOKEN0.address,
        symbol: TOKEN0.symbol,
        decimals: TOKEN0.decimals,
      } : undefined,
      TOKEN1: TOKEN1 ? {
        address: TOKEN1.address,
        symbol: TOKEN1.symbol,
        decimals: TOKEN1.decimals,
      } : undefined,
      amount0Desired: currencyAmounts?.TOKEN0 ? {
        raw: currencyAmounts.TOKEN0.quotient.toString(),
        human: currencyAmounts.TOKEN0.toExact(),
        currency: currencyAmounts.TOKEN0.currency.symbol,
        decimals: currencyAmounts.TOKEN0.currency.decimals,
      } : undefined,
      amount1Desired: currencyAmounts?.TOKEN1 ? {
        raw: currencyAmounts.TOKEN1.quotient.toString(),
        human: currencyAmounts.TOKEN1.toExact(),
        currency: currencyAmounts.TOKEN1.currency.symbol,
        decimals: currencyAmounts.TOKEN1.currency.decimals,
      } : undefined,
      slippageTolerance: {
        numerator: slippageTolerancePercent.numerator.toString(),
        denominator: slippageTolerancePercent.denominator.toString(),
        percent: slippageTolerancePercent.toFixed(2),
      },
      creatingPoolOrPair,
      mockPoolSqrtPrice: v3PoolForPosition?.sqrtRatioX96?.toString(),
    })
  }

  // Use on-chain V3 mint position hook for eligible positions
  // Build a mock V3 pool for initialization price when the real pool is missing (placed here so useOnChainV3 is defined).
  const v3MockPoolForInit = useMemo(() => {
    if (!useOnChainV3 || v3PoolForPosition) {
      return undefined
    }
    if (protocolVersion !== ProtocolVersion.V3 || !feeAmount || !TOKEN0 || !TOKEN1 || !price) {
      return undefined
    }
    try {
      const token0Wrapped = TOKEN0.wrapped
      const token1Wrapped = TOKEN1.wrapped
      const tokenA = token0Wrapped.sortsBefore(token1Wrapped) ? token0Wrapped : token1Wrapped
      const tokenB = token0Wrapped.sortsBefore(token1Wrapped) ? token1Wrapped : token0Wrapped

      const wrappedPrice = new Price(tokenA, tokenB, price.denominator, price.numerator)
      const sqrtRatioX96 = encodeSqrtRatioX96(wrappedPrice.numerator, wrappedPrice.denominator)
      const invalidPrice = !(
        JSBI.greaterThanOrEqual(sqrtRatioX96, TickMath.MIN_SQRT_RATIO) &&
        JSBI.lessThan(sqrtRatioX96, TickMath.MAX_SQRT_RATIO)
      )
      if (invalidPrice) {
        return undefined
      }
      const currentTick = priceToClosestTick(wrappedPrice)
      const currentSqrt = TickMath.getSqrtRatioAtTick(currentTick)
      return new V3Pool(tokenA, tokenB, feeAmount, currentSqrt, JSBI.BigInt(0), currentTick, [])
    } catch {
      return undefined
    }
  }, [useOnChainV3, v3PoolForPosition, protocolVersion, feeAmount, TOKEN0, TOKEN1, price])

  const onChainMintPosition = useV3MintPosition({
    token0: TOKEN0,
    token1: TOKEN1,
    fee: feeAmount,
    tickLower: ticks[0] ?? undefined,
    tickUpper: ticks[1] ?? undefined,
    amount0Desired: currencyAmounts?.TOKEN0,
    amount1Desired: currencyAmounts?.TOKEN1,
    slippageTolerance: slippageTolerancePercent,
    chainId: TOKEN0?.chainId as EVMUniverseChainId | undefined,
    recipient: account?.address,
    creatingPoolOrPair,
    pool: v3PoolForPosition ?? v3MockPoolForInit,
    accountAddress: account?.address, // Pass account address for transaction simulation
    enabled: useOnChainV3 && preliminaryIsQueryEnabled && !!feeAmount && ticks[0] !== undefined && ticks[1] !== undefined,
  })

  // Check if we have a pool-not-found error that should disable mint
  // Must be AFTER onChainMintPosition declaration
  const hasPoolNotFoundError = useMemo(() => {
    if (!useOnChainV3 || !onChainMintPosition.error) {
      return false
    }
    const error = onChainMintPosition.error as any
    return error?.code === 'POOL_NOT_FOUND' || error?.code === 'POOL_NOT_INITIALIZED'
  }, [useOnChainV3, onChainMintPosition.error])

  // Final isQueryEnabled that includes pool-not-found check
  // This is computed after onChainMintPosition and hasPoolNotFoundError
  const isQueryEnabled =
    !isUserCommittedToCreate &&
    !inputError &&
    !transactionError &&
    !invalidRange &&
    !hasPoolNotFoundError && // Disable mint when pool not found
    (useOnChainV3
      ? true // For on-chain, we can always build the transaction - approval check is separate (unless pool not found)
      : !approvalLoading && !approvalError && Boolean(approvalCalldata)) &&
    (useOnChainV3 || Boolean(createCalldataQueryParams))

  // Hard guard: completely disable Trading API when using on-chain path
  const disableTradingApi = useOnChainV3

  // Use Trading API query (fallback or for non-V3)
  // When useOnChainV3 is true, completely disable Trading API:
  // - Pass undefined params to prevent query execution
  // - Pass undefined for deadlineInMinutes
  // - Disable all refetch mechanisms
  // - Force enabled: false to prevent any network calls
  const {
    data: createCalldata,
    error: createError,
    refetch: createRefetch,
  } = useCreateLpPositionCalldataQuery({
    params: disableTradingApi ? undefined : createCalldataQueryParams,
    deadlineInMinutes: disableTradingApi ? undefined : customDeadline,
    // Hard guard: completely disable query when on-chain is enabled
    enabled: disableTradingApi ? false : (isQueryEnabled && !disableTradingApi),
    refetchInterval: false, // Always disable refetch interval
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  // Merge on-chain and Trading API results
  const finalCreateCalldata = useMemo(() => {
    if (useOnChainV3) {
      // When using on-chain path, ONLY use on-chain data
      // Never fall back to Trading API data (even if cached) to prevent silent fallback
      if (onChainMintPosition.txPayload && TOKEN0?.chainId) {
        // Convert on-chain payload to Trading API response format for compatibility
        return convertOnChainTxToCreateLpResponse(
          onChainMintPosition.txPayload,
          TOKEN0.chainId as EVMUniverseChainId,
        ) as any
      }
      // Return undefined if on-chain fails - don't use Trading API fallback
      return undefined
    }
    // Only use Trading API when NOT using on-chain path
    return createCalldata
  }, [useOnChainV3, onChainMintPosition.txPayload, createCalldata, TOKEN0?.chainId])

  // Merge errors
  const finalCreateError = useMemo(() => {
    if (useOnChainV3) {
      return onChainMintPosition.error || createError
    }
    return createError
  }, [useOnChainV3, onChainMintPosition.error, createError])

  // Hard guard: prevent refetch from triggering Trading API when on-chain is active
  useEffect(() => {
    if (useOnChainV3) {
      setRefetch(undefined)
      return
    }

    setRefetch(() =>
      approvalError ? approvalRefetch : finalCreateError ? createRefetch : undefined,
    )
  }, [
    useOnChainV3,
    approvalError,
    approvalRefetch,
    finalCreateError,
    createRefetch,
    setRefetch,
  ])

  // STEP 4: Make transactionError ignore Trading API errors on on-chain enabled chains
  useEffect(() => {
    // For on-chain operations, completely ignore Trading API errors
    // When isOnChainEnabled is true, approvalError and createError from Trading API should be ignored
    // Only on-chain errors should set transactionError
    const effectiveApprovalError = isOnChainEnabled ? undefined : approvalError
    
    // For on-chain path, only use errors from on-chain mint hook
    // Extract user-friendly error message from structured error if available
    let effectiveCreateError: Error | undefined = undefined
    if (isOnChainEnabled) {
      if (onChainMintPosition.error) {
        const error = onChainMintPosition.error as any
        
        // Check for structured pool-not-found errors (thrown early, before mint attempt)
        if (error?.code === 'POOL_NOT_FOUND' || error?.code === 'POOL_NOT_INITIALIZED') {
          effectiveCreateError = error
          
          // Dev-only: log that mint is disabled due to pool not found
          if (process.env.NODE_ENV !== 'production') {
            console.debug('[CreatePositionTxContext] on-chain mint disabled: pool not found for this pair/fee on chain', {
              chainId: TOKEN0?.chainId,
              token0: error.token0,
              token1: error.token1,
              fee: error.fee,
              code: error.code,
            })
          }
        } else if (error.poolDiagnostics || error.tickDiagnostics || error.amountDiagnostics) {
          // Use the user-friendly error message from structured error
          effectiveCreateError = error
        } else {
          // Fallback to regular error
          effectiveCreateError = onChainMintPosition.error
        }
      }
    } else {
      effectiveCreateError = finalCreateError
    }
    
    // Dev-only: log transaction error resolution
    if (process.env.NODE_ENV !== 'production') {
      if (effectiveApprovalError || effectiveCreateError) {
        console.log('[CreatePositionTxContext] Setting transactionError', {
          isOnChainEnabled,
          useOnChainV3,
          effectiveApprovalError: effectiveApprovalError ? 'present' : undefined,
          effectiveCreateError: effectiveCreateError ? 'present' : undefined,
          onChainMintError: onChainMintPosition.error ? 'present' : undefined,
          tradingApiCreateError: createError ? 'present' : undefined,
          errorMessage: effectiveCreateError?.message,
          errorCode: (effectiveCreateError as any)?.code,
          errorReason: (effectiveCreateError as any)?.reason,
        })
      }
    }
    
    setTransactionError(getErrorMessageToDisplay({ 
      approvalError: effectiveApprovalError, 
      calldataError: effectiveCreateError 
    }))
  }, [approvalError, finalCreateError, isOnChainEnabled, useOnChainV3, onChainMintPosition.error, createError, TOKEN0?.chainId])

  if (finalCreateError) {
    try {
      const message =
        parseErrorMessageTitle(finalCreateError, { defaultTitle: 'unknown CreateLpPositionCalldataQuery' }) ||
        'unknown CreateLpPositionCalldataQuery'
      const errorToLog =
        finalCreateError instanceof Error
          ? finalCreateError
          : new Error(typeof message === 'string' ? message : 'unknown CreateLpPositionCalldataQuery', {
              cause: finalCreateError,
            })
      logger.error(errorToLog, {
        tags: { file: 'CreatePositionTxContext', function: 'useEffect' },
      })

      if (createCalldataQueryParams && typeof message === 'string') {
        sendAnalyticsEvent(InterfaceEventName.CreatePositionFailed, {
          message,
          ...createCalldataQueryParams,
        })
      }
    } catch (error) {
      // Fallback error logging if parseErrorMessageTitle fails
      const fallbackError =
        error instanceof Error ? error : new Error('Failed to parse create error', { cause: finalCreateError })
      logger.error(fallbackError, {
        tags: { file: 'CreatePositionTxContext', function: 'useEffect' },
      })
    }
  }

  const dependentAmountFallback = useCreatePositionDependentAmountFallback(
    createCalldataQueryParams,
    isQueryEnabled && Boolean(finalCreateError),
  )

  const actualGasFee = finalCreateCalldata?.gasFee
  // For on-chain enabled chains, use the on-chain approval check directly
  // Use effective values computed earlier to ensure consistency
  const needsApprovals = isOnChainEnabled
    ? (effectiveNeedsApproval0 || effectiveNeedsApproval1)
    : !!(
        approvalCalldata?.token0Approval ||
        approvalCalldata?.token1Approval ||
        approvalCalldata?.token0Cancel ||
        approvalCalldata?.token1Cancel ||
        approvalCalldata?.token0PermitTransaction ||
        approvalCalldata?.token1PermitTransaction
      )
  const { value: calculatedGasFee } = useTransactionGasFee({
    tx: finalCreateCalldata?.create,
    skip: !!actualGasFee || needsApprovals,
  })
  const increaseGasFeeUsd = useUSDCurrencyAmountOfGasFee(
    toSupportedChainId(finalCreateCalldata?.create?.chainId) ?? undefined,
    actualGasFee || calculatedGasFee,
  )

  const totalGasFee = useMemo(() => {
    const fees = [gasFeeToken0USD, gasFeeToken1USD, increaseGasFeeUsd, gasFeeToken0PermitUSD, gasFeeToken1PermitUSD]
    return fees.reduce((total, fee) => {
      if (fee && total) {
        return total.add(fee)
      }
      return total || fee
    })
  }, [gasFeeToken0USD, gasFeeToken1USD, increaseGasFeeUsd, gasFeeToken0PermitUSD, gasFeeToken1PermitUSD])

  const txInfo = useMemo(() => {
    const result = generateCreatePositionTxRequest({
      protocolVersion,
      approvalCalldata,
      createCalldata: finalCreateCalldata, // Use merged calldata (on-chain or Trading API)
      createCalldataQueryParams,
      currencyAmounts,
      poolOrPair: protocolVersion === ProtocolVersion.V2 ? poolOrPair : undefined,
      canBatchTransactions,
    })

    // Debug logging for on-chain path when txInfo is missing
    if (useOnChainV3 && !result) {
      console.warn('[CreatePositionTxContext] Failed to generate txInfo for on-chain path', {
        hasFinalCreateCalldata: !!finalCreateCalldata,
        hasCreateCalldataCreate: !!finalCreateCalldata?.create,
        hasOnChainMintPosition: !!onChainMintPosition.txPayload,
        onChainMintPositionState: {
          isLoading: onChainMintPosition.isLoading,
          isError: onChainMintPosition.isError,
          error: onChainMintPosition.error,
        },
        hasCurrencyAmounts: !!currencyAmounts?.TOKEN0 && !!currencyAmounts?.TOKEN1,
        approvalState: {
          needsApproval0: onChainApproval.needsApproval0,
          needsApproval1: onChainApproval.needsApproval1,
          approvalState0: onChainApproval.approvalState0,
          approvalState1: onChainApproval.approvalState1,
        },
        isQueryEnabled,
        feeAmount,
        ticks: [ticks[0], ticks[1]],
      })
    }

    return result
  }, [
    useOnChainV3,
    approvalCalldata,
    finalCreateCalldata,
    createCalldataQueryParams,
    currencyAmounts,
    poolOrPair,
    protocolVersion,
    canBatchTransactions,
    onChainMintPosition.txPayload,
    onChainMintPosition.isLoading,
    onChainMintPosition.isError,
    onChainMintPosition.error,
    currencyAmounts?.TOKEN0,
    currencyAmounts?.TOKEN1,
    isQueryEnabled,
    feeAmount,
    ticks,
  ])

  const value = useMemo(
    (): CreatePositionTxContextType => ({
      txInfo,
      gasFeeEstimateUSD: totalGasFee,
      transactionError,
      setTransactionError,
      dependentAmount:
        createError && dependentAmountFallback ? dependentAmountFallback : createCalldata?.dependentAmount,
      currencyAmounts,
      inputError,
      formattedAmounts,
      currencyAmountsUSDValue,
      currencyBalances,
    }),
    [
      txInfo,
      totalGasFee,
      transactionError,
      createError,
      dependentAmountFallback,
      createCalldata?.dependentAmount,
      currencyAmounts,
      inputError,
      formattedAmounts,
      currencyAmountsUSDValue,
      currencyBalances,
    ],
  )

  return <CreatePositionTxContext.Provider value={value}>{children}</CreatePositionTxContext.Provider>
}

export const useCreatePositionTxContext = (): CreatePositionTxContextType => {
  const context = useContext(CreatePositionTxContext)

  if (!context) {
    throw new Error('`useCreatePositionTxContext` must be used inside of `CreatePositionTxContextProvider`')
  }

  return context
}
