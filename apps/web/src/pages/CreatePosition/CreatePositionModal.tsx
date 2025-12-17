import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { FeeAmount } from '@uniswap/v3-sdk'
import {
  getLiquidityRangeChartProps,
  WrappedLiquidityPositionRangeChart,
} from 'components/Charts/LiquidityPositionRangeChart/LiquidityPositionRangeChart'
import { ErrorCallout } from 'components/ErrorCallout'
import { getLPBaseAnalyticsProperties } from 'components/Liquidity/analytics'
import { BaseQuoteFiatAmount } from 'components/Liquidity/BaseQuoteFiatAmount'
import { PoolOutOfSyncError } from 'components/Liquidity/Create/PoolOutOfSyncError'
import { LiquidityPositionInfoBadges } from 'components/Liquidity/LiquidityPositionInfoBadges'
import { getPoolIdOrAddressFromCreatePositionInfo } from 'components/Liquidity/utils/getPoolIdOrAddressFromCreatePositionInfo'
import { DoubleCurrencyLogo } from 'components/Logo/DoubleLogo'
import { DetailLineItem } from 'components/swap/DetailLineItem'
import { useCurrencyInfo } from 'hooks/Tokens'
import { useAccount } from 'hooks/useAccount'
import useSelectChain from 'hooks/useSelectChain'
import { useCreateLiquidityContext } from 'pages/CreatePosition/CreateLiquidityContextProvider'
import { useSetOverrideOneClickSwapFlag } from 'pages/Swap/settings/OneClickSwap'
import { useCallback, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router'
import { liquiditySaga } from 'state/sagas/liquidity/liquiditySaga'
import { PositionField } from 'types/position'
import { Button, Flex, Separator, Text } from 'ui/src'
import { Passkey } from 'ui/src/components/icons/Passkey'
import { iconSizes } from 'ui/src/theme'
import { ProgressIndicator } from 'uniswap/src/components/ConfirmSwapModal/ProgressIndicator'
import { NetworkLogo } from 'uniswap/src/components/CurrencyLogo/NetworkLogo'
import { TokenLogo } from 'uniswap/src/components/CurrencyLogo/TokenLogo'
import { GetHelpHeader } from 'uniswap/src/components/dialog/GetHelpHeader'
import { Modal } from 'uniswap/src/components/modals/Modal'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { useGetPasskeyAuthStatus } from 'uniswap/src/features/passkey/hooks/useGetPasskeyAuthStatus'
import { ModalName } from 'uniswap/src/features/telemetry/constants'
import { useRestrictedTokenAllowlistChecks } from 'uniswap/src/features/transactions/hooks/useRestrictedTokenAllowlistChecks'
import {
  CreatePositionTxAndGasInfo,
  isValidLiquidityTxContext,
} from 'uniswap/src/features/transactions/liquidity/types'
import { getErrorMessageToDisplay } from 'uniswap/src/features/transactions/liquidity/utils'
import { TransactionStep } from 'uniswap/src/features/transactions/steps/types'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { isSignerMnemonicAccountDetails } from 'uniswap/src/features/wallet/types/AccountDetails'
import { NumberType } from 'utilities/src/format/types'
import { useTrace } from 'utilities/src/telemetry/trace/TraceContext'
import { Address } from 'viem'

export function CreatePositionModal({
  formattedAmounts,
  currencyAmounts,
  currencyAmountsUSDValue,
  txInfo,
  gasFeeEstimateUSD,
  onChainNetworkCost,
  transactionError,
  setTransactionError,
  isOpen,
  onClose,
}: {
  formattedAmounts?: { [field in PositionField]?: string }
  currencyAmounts?: { [field in PositionField]?: Maybe<CurrencyAmount<Currency>> }
  currencyAmountsUSDValue?: { [field in PositionField]?: Maybe<CurrencyAmount<Currency>> }
  txInfo?: CreatePositionTxAndGasInfo
  gasFeeEstimateUSD?: Maybe<CurrencyAmount<Currency>>
  onChainNetworkCost?: import('pages/CreatePosition/hooks/useCreatePositionNetworkCost').CreatePositionNetworkCost
  transactionError: string | boolean
  setTransactionError: (error: string | boolean) => void
  isOpen: boolean
  onClose: () => void
}) {
  const {
    protocolVersion,
    creatingPoolOrPair,
    positionState: { fee, hook },
    currentTransactionStep,
    setCurrentTransactionStep,
    price,
    poolOrPair,
    ticks,
    ticksAtLimit,
    pricesAtTicks,
    priceRangeState: { priceInverted },
    refetch,
  } = useCreateLiquidityContext()
  const { t } = useTranslation()

  const token0 = currencyAmounts?.TOKEN0?.currency
  const token1 = currencyAmounts?.TOKEN1?.currency
  const token0CurrencyInfo = useCurrencyInfo(token0)
  const token1CurrencyInfo = useCurrencyInfo(token1)
  const chainId = token0?.chainId

  const { formatNumberOrString, formatCurrencyAmount } = useLocalizationContext()
  const disableOneClickSwap = useSetOverrideOneClickSwapFlag()

  const baseCurrency = price?.baseCurrency
  const quoteCurrency = price?.quoteCurrency

  const formattedPrices = useMemo(() => {
    if (protocolVersion === ProtocolVersion.V2) {
      return ['', '']
    }

    const lowerPriceFormatted = ticksAtLimit[0]
      ? '0'
      : formatNumberOrString({ value: pricesAtTicks[0]?.toSignificant(), type: NumberType.TokenTx })

    const upperPriceFormatted = ticksAtLimit[1]
      ? '∞'
      : formatNumberOrString({ value: pricesAtTicks[1]?.toSignificant(), type: NumberType.TokenTx })

    const postfix = `${quoteCurrency?.symbol + '/' + baseCurrency?.symbol}`
    return [`${lowerPriceFormatted} ${postfix}`, `${upperPriceFormatted} ${postfix}`]
  }, [formatNumberOrString, pricesAtTicks, ticksAtLimit, protocolVersion, baseCurrency, quoteCurrency])

  const [steps, setSteps] = useState<TransactionStep[]>([])
  const dispatch = useDispatch()
  const account = useWallet().evmAccount
  const selectChain = useSelectChain()
  const connectedAccount = useAccount()
  const startChainId = connectedAccount.chainId
  const navigate = useNavigate()
  const trace = useTrace()
  const { isSignedInWithPasskey, isSessionAuthenticated, needsPasskeySignin } = useGetPasskeyAuthStatus(
    connectedAccount.connector?.id,
  )

  // Use the new consolidated hook for allowlist checks
  const evmChainId = chainId as EVMUniverseChainId | undefined
  const walletAddress = account?.address as Address | undefined
  const feeAmount = fee?.isDynamic ? undefined : (fee?.feeAmount as FeeAmount | undefined)

  const allowlistChecks = useRestrictedTokenAllowlistChecks({
    account: walletAddress,
    chainId: evmChainId,
    tokens: {
      tokenA: token0,
      tokenB: token1,
    },
    feeAmount,
    flow: 'liquidity',
    enabled: !!token0 && !!token1 && !!feeAmount && !!evmChainId && !!walletAddress,
  })

  const hasWhitelistRestriction = allowlistChecks.isBlocked

  // Build warning message from allowlist checks
  const whitelistWarningMessage = useMemo(() => {
    if (allowlistChecks.blockingWarnings.length === 0 && allowlistChecks.nonBlockingWarnings.length === 0) {
      return undefined
    }

    // Group warnings by subject type for better messaging
    const messages: string[] = []
    for (const warning of [...allowlistChecks.blockingWarnings, ...allowlistChecks.nonBlockingWarnings]) {
      messages.push(warning.message)
    }

    return messages.join(' ')
  }, [allowlistChecks])

  const onSuccess = useCallback(() => {
    setSteps([])
    setCurrentTransactionStep(undefined)
    onClose()
    navigate('/positions')
  }, [setCurrentTransactionStep, onClose, navigate])

  const liquidityRangeChartProps = useMemo(
    () =>
      getLiquidityRangeChartProps({
        protocolVersion,
        sdkCurrencies: {
          TOKEN0: currencyAmounts?.TOKEN0?.currency,
          TOKEN1: currencyAmounts?.TOKEN1?.currency,
        },
        ticks,
        poolOrPair,
        pricesAtTicks,
        priceInverted,
      }),
    [protocolVersion, currencyAmounts, priceInverted, ticks, pricesAtTicks, poolOrPair],
  )

  const handleCreate = useCallback(() => {
    console.log('[CreatePositionModal] Create button clicked', {
      hasTxInfo: !!txInfo,
      hasAccount: !!account,
      isValidAccount: account ? isSignerMnemonicAccountDetails(account) : false,
      hasCurrencyAmounts: !!currencyAmounts?.TOKEN0 && !!currencyAmounts.TOKEN1,
      txInfoType: txInfo?.type,
      txInfoAction: txInfo?.action,
      txInfoTxRequest: !!txInfo?.txRequest,
      chainId: currencyAmounts?.TOKEN0?.currency.chainId,
      token0: currencyAmounts?.TOKEN0?.currency.symbol,
      token1: currencyAmounts?.TOKEN1?.currency.symbol,
      amount0: currencyAmounts?.TOKEN0?.toExact(),
      amount1: currencyAmounts?.TOKEN1?.toExact(),
    })

    setTransactionError(false)

    const isValidTx = isValidLiquidityTxContext(txInfo)
    if (
      !account ||
      !isSignerMnemonicAccountDetails(account) ||
      !isValidTx ||
      !currencyAmounts ||
      !currencyAmounts.TOKEN0 ||
      !currencyAmounts.TOKEN1
    ) {
      console.warn('[CreatePositionModal] Validation failed, not dispatching saga', {
        hasAccount: !!account,
        isValidAccount: account ? isSignerMnemonicAccountDetails(account) : false,
        isValidTx,
        hasCurrencyAmounts: !!currencyAmounts?.TOKEN0 && !!currencyAmounts.TOKEN1,
      })
      return
    }

    const sagaPayload = {
      selectChain,
      startChainId,
      account,
      liquidityTxContext: txInfo,
      setCurrentStep: setCurrentTransactionStep,
      setSteps,
      onSuccess,
      onFailure: (e) => {
        if (e) {
          setTransactionError(getErrorMessageToDisplay({ calldataError: e }))
        }
        setCurrentTransactionStep(undefined)
      },
      disableOneClickSwap,
      analytics: {
        ...getLPBaseAnalyticsProperties({
          trace,
          hook,
          version: protocolVersion,
          tickLower: ticks[0] ?? undefined,
          tickUpper: ticks[1] ?? undefined,
          fee: fee?.feeAmount,
          tickSpacing: fee?.tickSpacing,
          currency0: currencyAmounts.TOKEN0.currency,
          currency1: currencyAmounts.TOKEN1.currency,
          currency0AmountUsd: currencyAmountsUSDValue?.TOKEN0,
          currency1AmountUsd: currencyAmountsUSDValue?.TOKEN1,
          poolId: getPoolIdOrAddressFromCreatePositionInfo({
            protocolVersion,
            poolOrPair,
            sdkCurrencies: {
              TOKEN0: currencyAmounts.TOKEN0.currency,
              TOKEN1: currencyAmounts.TOKEN1.currency,
            },
          }),
        }),
        expectedAmountBaseRaw: currencyAmounts.TOKEN0.quotient.toString(),
        expectedAmountQuoteRaw: currencyAmounts.TOKEN1.quotient.toString(),
        createPool: creatingPoolOrPair,
        createPosition: true,
      },
    }

    console.log('[CreatePositionModal] Dispatching liquiditySaga.actions.trigger', {
      startChainId,
      accountAddress: account.address,
      liquidityTxContextType: txInfo.type,
      liquidityTxContextAction: txInfo.action,
      hasTxRequest: !!txInfo.txRequest,
      txRequestChainId: txInfo.txRequest?.chainId,
      txRequestTo: txInfo.txRequest?.to,
      txRequestData: txInfo.txRequest?.data ? `${txInfo.txRequest.data.substring(0, 20)}...` : undefined,
      needsApproval0: !!txInfo.approveToken0Request,
      needsApproval1: !!txInfo.approveToken1Request,
      protocolVersion,
      chainId: currencyAmounts.TOKEN0.currency.chainId,
    })

    dispatch(liquiditySaga.actions.trigger(sagaPayload))
  }, [
    txInfo,
    account,
    currencyAmounts,
    dispatch,
    selectChain,
    startChainId,
    setTransactionError,
    setCurrentTransactionStep,
    onSuccess,
    trace,
    fee?.feeAmount,
    fee?.tickSpacing,
    ticks,
    hook,
    currencyAmountsUSDValue?.TOKEN0,
    currencyAmountsUSDValue?.TOKEN1,
    protocolVersion,
    creatingPoolOrPair,
    poolOrPair,
    disableOneClickSwap,
  ])

  return (
    <Modal name={ModalName.CreatePosition} padding="$none" onClose={onClose} isDismissible isModalOpen={isOpen}>
      <Flex px="$spacing8" pt="$spacing12" pb="$spacing8" gap="$spacing24">
        <Flex px="$spacing12">
          <GetHelpHeader
            title={
              <Text variant="subheading2" color="$neutral2">
                <Trans i18nKey="position.create.modal.header" />
              </Text>
            }
            closeModal={() => onClose()}
          />
          <Flex py="$spacing12" gap="$spacing12" mt="$spacing16">
            <Flex row alignItems="center" justifyContent="space-between">
              <Flex>
                <Flex row gap="$gap8">
                  <Text variant="heading3">{currencyAmounts?.TOKEN0?.currency.symbol}</Text>
                  <Text variant="heading3">/</Text>
                  <Text variant="heading3">{currencyAmounts?.TOKEN1?.currency.symbol}</Text>
                </Flex>
                <Flex row gap={2} alignItems="center">
                  <LiquidityPositionInfoBadges size="small" version={protocolVersion} v4hook={hook} feeTier={fee} />
                </Flex>
              </Flex>
              <DoubleCurrencyLogo
                currencies={[currencyAmounts?.TOKEN0?.currency, currencyAmounts?.TOKEN1?.currency]}
                size={iconSizes.icon36}
              />
            </Flex>
            {(protocolVersion === ProtocolVersion.V3 || protocolVersion === ProtocolVersion.V4) && (
              <>
                {!creatingPoolOrPair && !!liquidityRangeChartProps && (
                  <WrappedLiquidityPositionRangeChart width="100%" {...liquidityRangeChartProps} />
                )}
                <Flex row>
                  <Flex fill gap="$gap4">
                    <Text variant="body3" color="$neutral2">
                      <Trans i18nKey="common.min" />
                    </Text>
                    <Text variant="body3">{formattedPrices[0]}</Text>
                  </Flex>
                  <Flex fill gap="$gap4">
                    <Text variant="body3" color="$neutral2">
                      <Trans i18nKey="common.max" />
                    </Text>
                    <Text variant="body3">{formattedPrices[1]}</Text>
                  </Flex>
                </Flex>
              </>
            )}
          </Flex>
          {creatingPoolOrPair && (
            <Flex gap="$spacing12" mt="$spacing32">
              <Text variant="body3" color="$neutral2">
                <Trans i18nKey="position.initialPrice" />
              </Text>
              <BaseQuoteFiatAmount variant="body1" price={price} base={baseCurrency} quote={quoteCurrency} />
            </Flex>
          )}
          <Flex gap="$spacing12" pb="$spacing8" mt="$spacing32">
            <Text variant="body3" color="$neutral2">
              <Trans i18nKey="common.depositing" />
            </Text>
            {currencyAmounts?.TOKEN0?.greaterThan(0) && (
              <Flex row justifyContent="space-between">
                <Flex gap="$gap4">
                  <Flex row gap="$gap8">
                    <Text variant="body1">{formattedAmounts?.TOKEN0}</Text>
                    <Text variant="body1">{currencyAmounts.TOKEN0.currency.symbol}</Text>
                  </Flex>
                  <Text variant="body3" color="$neutral2">
                    {formatCurrencyAmount({ value: currencyAmountsUSDValue?.TOKEN0, type: NumberType.FiatTokenPrice })}
                  </Text>
                </Flex>
                <TokenLogo
                  size={iconSizes.icon36}
                  chainId={currencyAmounts.TOKEN0.currency.chainId}
                  name={currencyAmounts.TOKEN0.currency.name}
                  symbol={currencyAmounts.TOKEN0.currency.symbol}
                  url={token0CurrencyInfo?.logoUrl}
                />
              </Flex>
            )}
            {currencyAmounts?.TOKEN1?.greaterThan(0) && (
              <Flex row justifyContent="space-between">
                <Flex gap="$gap4">
                  <Flex row gap="$gap8">
                    <Text variant="body1">{formattedAmounts?.TOKEN1}</Text>
                    <Text variant="body1">{currencyAmounts.TOKEN1.currency.symbol}</Text>
                  </Flex>
                  <Text variant="body3" color="$neutral2">
                    {formatCurrencyAmount({ value: currencyAmountsUSDValue?.TOKEN1, type: NumberType.FiatTokenPrice })}
                  </Text>
                </Flex>
                <TokenLogo
                  size={iconSizes.icon36}
                  chainId={currencyAmounts.TOKEN1.currency.chainId}
                  name={currencyAmounts.TOKEN1.currency.name}
                  symbol={currencyAmounts.TOKEN1.currency.symbol}
                  url={token1CurrencyInfo?.logoUrl}
                />
              </Flex>
            )}
          </Flex>
          <Flex gap="$spacing12">
            <ErrorCallout errorMessage={transactionError} onPress={refetch} />
            {/* Whitelist restriction warning */}
            {(hasWhitelistRestriction || allowlistChecks.nonBlockingWarnings.length > 0) && (
              <ErrorCallout
                errorMessage={true}
                isWarning={!hasWhitelistRestriction}
                title={t('position.whitelistRestriction.title')}
                description={
                  whitelistWarningMessage ||
                  (allowlistChecks.debug.restrictedTokens.length > 0
                    ? `Checking allowlist status for restricted token${allowlistChecks.debug.restrictedTokens.length > 1 ? 's' : ''}: ${allowlistChecks.debug.restrictedTokens.map((t) => t.symbol || t.address).join(', ')}`
                    : t('position.whitelistRestriction.message', { tokenSymbol: '' }))
                }
              />
            )}
            {/* Show pool-not-found message for on-chain V3 flows */}
            {typeof transactionError === 'string' &&
              transactionError.includes('pool') &&
              transactionError.includes('does not exist') && (
                <Flex
                  backgroundColor="$surface2"
                  borderRadius="$rounded16"
                  p="$spacing16"
                  gap="$spacing8"
                  borderWidth={1}
                  borderColor="$surface3"
                >
                  <Text variant="body2" color="$neutral1">
                    Pool Not Found
                  </Text>
                  <Text variant="body3" color="$neutral2">
                    The V3 pool for this token pair and fee tier does not exist on this chain. A pool must be created
                    and initialized before you can add liquidity.
                  </Text>
                  {process.env.NODE_ENV !== 'production' && (
                    <Text variant="body3" color="$neutral3" mt="$spacing8">
                      On this development environment, the pool must be created and initialized via a separate script or
                      tool before adding liquidity.
                    </Text>
                  )}
                </Flex>
              )}
            <PoolOutOfSyncError />
          </Flex>
        </Flex>
        {currentTransactionStep && steps.length > 1 ? (
          <ProgressIndicator steps={steps} currentStep={currentTransactionStep} />
        ) : (
          <>
            <Separator mx="$padding12" />
            <Flex mx="$padding12">
              <DetailLineItem
                LineItem={{
                  Label: () => (
                    <Text variant="body3" color="$neutral2">
                      <Trans i18nKey="common.networkCost" />
                    </Text>
                  ),
                  Value: () => {
                    const nativeFee = onChainNetworkCost?.nativeFormatted
                    const usdFee = onChainNetworkCost?.usdFormatted || gasFeeEstimateUSD?.toExact()

                    return (
                      <Flex row gap="$gap4" alignItems="center">
                        <NetworkLogo chainId={chainId ?? null} size={iconSizes.icon16} shape="square" />
                        <Flex row gap="$gap2" alignItems="center">
                          <Text variant="body3">
                            {nativeFee ??
                              (usdFee && gasFeeEstimateUSD
                                ? formatCurrencyAmount({ value: gasFeeEstimateUSD, type: NumberType.FiatGasPrice })
                                : '—')}
                          </Text>
                          {nativeFee && usdFee && gasFeeEstimateUSD && (
                            <Text variant="body4" color="$neutral2">
                              ({formatCurrencyAmount({ value: gasFeeEstimateUSD, type: NumberType.FiatGasPrice })})
                            </Text>
                          )}
                        </Flex>
                      </Flex>
                    )
                  },
                }}
              />
            </Flex>
            {currentTransactionStep ? (
              <Button size="large" variant="branded" loading={true} key="create-position-confirm" fill={false}>
                {isSignedInWithPasskey ? t('swap.button.submitting.passkey') : t('common.confirmWallet')}
              </Button>
            ) : (
              <Button
                size="large"
                variant="branded"
                onPress={handleCreate}
                isDisabled={!txInfo?.action || hasWhitelistRestriction}
                fill={false}
                icon={needsPasskeySignin ? <Passkey size="$icon.24" /> : undefined}
              >
                {hasWhitelistRestriction
                  ? t('position.whitelistRestriction.button')
                  : isSignedInWithPasskey && isSessionAuthenticated
                    ? t('position.create.confirm')
                    : t('common.button.create')}
              </Button>
            )}
          </>
        )}
      </Flex>
    </Modal>
  )
}
