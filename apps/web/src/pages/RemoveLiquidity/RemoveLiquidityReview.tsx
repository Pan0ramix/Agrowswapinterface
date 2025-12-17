import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { CurrencyAmount } from '@uniswap/sdk-core'
import { getLPBaseAnalyticsProperties } from 'components/Liquidity/analytics'
import { useGetPoolTokenPercentage } from 'components/Liquidity/hooks/useGetPoolTokenPercentage'
import { TokenInfo } from 'components/Liquidity/TokenInfo'
import { DetailLineItem } from 'components/swap/DetailLineItem'
import { useCurrencyInfo } from 'hooks/Tokens'
import { useAccount } from 'hooks/useAccount'
import useSelectChain from 'hooks/useSelectChain'
import { getEstimatedSuffix } from 'pages/RemoveLiquidity/feeDisplay'
import { useRemoveLiquidityModalContext } from 'pages/RemoveLiquidity/RemoveLiquidityModalContext'
import { useRemoveLiquidityTxContext } from 'pages/RemoveLiquidity/RemoveLiquidityTxContext'
import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import { liquiditySaga } from 'state/sagas/liquidity/liquiditySaga'
import { Button, Flex, Separator, Text } from 'ui/src'
import { Passkey } from 'ui/src/components/icons/Passkey'
import { iconSizes } from 'ui/src/theme'
import { ProgressIndicator } from 'uniswap/src/components/ConfirmSwapModal/ProgressIndicator'
import { CurrencyLogo } from 'uniswap/src/components/CurrencyLogo/CurrencyLogo'
import { NetworkLogo } from 'uniswap/src/components/CurrencyLogo/NetworkLogo'
import { PollingInterval } from 'uniswap/src/constants/misc'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { useLocalizationContext } from 'uniswap/src/features/language/LocalizationContext'
import { useGetPasskeyAuthStatus } from 'uniswap/src/features/passkey/hooks/useGetPasskeyAuthStatus'
import { usePositionFees } from 'uniswap/src/features/positions/fees'
import { useUSDCValue } from 'uniswap/src/features/transactions/hooks/useUSDCPrice'
import { isValidLiquidityTxContext } from 'uniswap/src/features/transactions/liquidity/types'
import { TransactionStep } from 'uniswap/src/features/transactions/steps/types'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { isSignerMnemonicAccountDetails } from 'uniswap/src/features/wallet/types/AccountDetails'
import { getSymbolDisplayText } from 'uniswap/src/utils/currency'
import { NumberType } from 'utilities/src/format/types'
import { useTrace } from 'utilities/src/telemetry/trace/TraceContext'

export function RemoveLiquidityReview({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { percent, positionInfo, currencies, currentTransactionStep, setCurrentTransactionStep } =
    useRemoveLiquidityModalContext()
  const [steps, setSteps] = useState<TransactionStep[]>([])
  const removeLiquidityTxContext = useRemoveLiquidityTxContext()
  const { formatCurrencyAmount, formatPercent, convertFiatAmountFormatted } = useLocalizationContext()
  const currency0FiatAmount = useUSDCValue(positionInfo?.currency0Amount)
  const currency1FiatAmount = useUSDCValue(positionInfo?.currency1Amount)
  const selectChain = useSelectChain()
  const connectedAccount = useAccount()
  const startChainId = connectedAccount.chainId
  const account = useWallet().evmAccount
  const dispatch = useDispatch()
  const trace = useTrace()
  const { needsPasskeySignin } = useGetPasskeyAuthStatus(connectedAccount.connector?.id)

  const { txContext, gasFeeEstimateUSD, onChainNetworkCost } = removeLiquidityTxContext

  const onSuccess = () => {
    setSteps([])
    setCurrentTransactionStep(undefined)
    onClose()
  }

  const onFailure = () => {
    setCurrentTransactionStep(undefined)
  }

  if (!positionInfo) {
    throw new Error('RemoveLiquidityModal must have an initial state when opening')
  }

  // Get position manager address (for resolver hook)
  // Resolve from config like useOnChainCollectableFees does
  const positionManagerAddress = useMemo(() => {
    const chainId = positionInfo.chainId as EVMUniverseChainId | undefined
    if (!chainId) {
      return undefined
    }
    try {
      // Try Agroswap addresses first (Base Sepolia)
      const { AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } = require('uniswap/src/constants/agroswapAddresses')
      if (chainId === 84532) {
        const address =
          AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[
            chainId as keyof typeof AGROSWAP_NONFUNGIBLE_POSITION_MANAGER_ADDRESSES
          ]
        if (address) {
          return address
        }
      }

      // Try v3Addresses override
      const { getPositionManagerAddress } = require('uniswap/src/constants/v3Addresses')
      const v3Address = getPositionManagerAddress(chainId)
      if (v3Address) {
        return v3Address
      }

      // Fall back to SDK addresses
      const { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } = require('@uniswap/sdk-core')
      const sdkAddress =
        NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[chainId as keyof typeof NONFUNGIBLE_POSITION_MANAGER_ADDRESSES]
      return sdkAddress || undefined
    } catch {
      return undefined
    }
  }, [positionInfo.chainId])

  // Use position fees resolver hook (multiple providers with priority)
  // Priority: collect_simulation (authoritative) > onchain_math (estimated) > graphql (estimated)
  const feesQuery = usePositionFees({
    chainId: positionInfo.chainId as EVMUniverseChainId | undefined,
    tokenId: positionInfo.tokenId,
    account: account?.address,
    positionManagerAddress,
    // Fallback data from positionInfo (GraphQL/indexer source)
    positionInfoFee0Amount: positionInfo.fee0Amount,
    positionInfoFee1Amount: positionInfo.fee1Amount,
    positionInfoToken0: positionInfo.currency0Amount.currency,
    positionInfoToken1: positionInfo.currency1Amount.currency,
    enabled: positionInfo.version !== ProtocolVersion.V2 && !!positionInfo.tokenId && !!account?.address,
  })

  // Determine which fees to display based on resolver result
  const { fee0Amount, fee1Amount, fee0Token, fee1Token, dataSource } = useMemo(() => {
    // Priority 1: Resolver hook data (from collect_simulation, onchain_math, or graphql)
    if (feesQuery.data !== undefined) {
      return {
        fee0Amount: feesQuery.data.amount0,
        fee1Amount: feesQuery.data.amount1,
        fee0Token: feesQuery.data.token0,
        fee1Token: feesQuery.data.token1,
        dataSource: feesQuery.data.source,
      }
    }

    // Priority 2: No data available
    return {
      fee0Amount: undefined,
      fee1Amount: undefined,
      fee0Token: positionInfo.currency0Amount.currency,
      fee1Token: positionInfo.currency1Amount.currency,
      dataSource: 'none' as const,
    }
  }, [feesQuery.data, positionInfo.currency0Amount.currency, positionInfo.currency1Amount.currency])

  // Compute estimated suffix once for reuse in both token fee displays
  // Use isAuthoritative from resolver data to determine if estimated label is needed
  const estimatedSuffix = useMemo(() => {
    if (!feesQuery.data) {
      return ''
    }
    return feesQuery.data.isAuthoritative ? '' : getEstimatedSuffix(feesQuery.data.source)
  }, [feesQuery.data])

  // Compute fiat values for fees (only if fees exist)
  const fiatFeeValue0 = useUSDCValue(fee0Amount, PollingInterval.Slow)
  const fiatFeeValue1 = useUSDCValue(fee1Amount, PollingInterval.Slow)

  const {
    currency0Amount,
    currency1Amount,
    chainId,
    feeTier,
    tickSpacing,
    tickLower,
    tickUpper,
    version,
    poolId,
    v4hook,
  } = positionInfo

  const currentPrice = positionInfo.poolOrPair?.token1Price

  const currency0 = currencies?.TOKEN0 ?? positionInfo.currency0Amount.currency
  const currency1 = currencies?.TOKEN1 ?? positionInfo.currency1Amount.currency

  const {
    unwrappedCurrency0AmountToRemove,
    unwrappedCurrency1AmountToRemove,
    currency0AmountToRemove,
    currency1AmountToRemove,
  } = useMemo(() => {
    const unwrappedCurrency0AmountToRemove = CurrencyAmount.fromRawAmount(currency0, currency0Amount.quotient)
      .multiply(percent)
      .divide(100)
    const unwrappedCurrency1AmountToRemove = CurrencyAmount.fromRawAmount(currency1, currency1Amount.quotient)
      .multiply(percent)
      .divide(100)

    const currency0AmountToRemove = currency0Amount.multiply(percent).divide(100)
    const currency1AmountToRemove = currency1Amount.multiply(percent).divide(100)

    return {
      unwrappedCurrency0AmountToRemove,
      unwrappedCurrency1AmountToRemove,
      currency0AmountToRemove,
      currency1AmountToRemove,
    }
  }, [currency0Amount, currency0, currency1Amount, currency1, percent])

  const currency0AmountToRemoveUSD = useUSDCValue(unwrappedCurrency0AmountToRemove)
  const currency1AmountToRemoveUSD = useUSDCValue(unwrappedCurrency1AmountToRemove)

  const newCurrency0Amount = currency0Amount.subtract(currency0AmountToRemove)
  const newCurrency1Amount = currency1Amount.subtract(currency1AmountToRemove)

  const newCurrency0AmountUSD = useUSDCValue(newCurrency0Amount)
  const newCurrency1AmountUSD = useUSDCValue(newCurrency1Amount)

  const poolTokenPercentage = useGetPoolTokenPercentage(positionInfo)

  // Use fee tokens if available (from on-chain data), otherwise use currency0Amount/currency1Amount currencies
  const currency0CurrencyInfo = useCurrencyInfo(fee0Token ?? currency0Amount.currency)
  const currency1CurrencyInfo = useCurrencyInfo(fee1Token ?? currency1Amount.currency)

  const onDecreaseLiquidity = () => {
    const isValidTx = isValidLiquidityTxContext(txContext)
    if (!account || !isSignerMnemonicAccountDetails(account) || !isValidTx) {
      return
    }
    dispatch(
      liquiditySaga.actions.trigger({
        selectChain,
        startChainId,
        account,
        liquidityTxContext: txContext,
        setCurrentStep: setCurrentTransactionStep,
        setSteps,
        onSuccess,
        onFailure,
        analytics: {
          ...getLPBaseAnalyticsProperties({
            trace,
            fee: feeTier?.feeAmount,
            tickSpacing,
            tickLower,
            tickUpper,
            hook: v4hook,
            poolId,
            currency0,
            currency1,
            currency0AmountUsd: currency0AmountToRemoveUSD,
            currency1AmountUsd: currency1AmountToRemoveUSD,
            version,
          }),
          expectedAmountBaseRaw: unwrappedCurrency0AmountToRemove.quotient.toString(),
          expectedAmountQuoteRaw: unwrappedCurrency1AmountToRemove.quotient.toString(),
          closePosition: percent === '100',
        },
      }),
    )
  }

  return (
    <Flex gap="$gap16">
      <Flex gap="$gap16" px="$padding16">
        <TokenInfo
          currencyAmount={unwrappedCurrency0AmountToRemove}
          currencyUSDAmount={currency0FiatAmount?.multiply(percent).divide(100)}
        />
        <Text variant="body3" color="$neutral2">
          {t('common.and')}
        </Text>
        <TokenInfo
          currencyAmount={unwrappedCurrency1AmountToRemove}
          currencyUSDAmount={currency1FiatAmount?.multiply(percent).divide(100)}
        />
        {positionInfo.version !== ProtocolVersion.V2 && (
          <Flex p="$spacing16" gap="$gap12" background="$surface2" borderRadius="$rounded12">
            <Flex row alignItems="center" justifyContent="space-between">
            <Text variant="body4" color="$neutral2">
              {t('fee.uncollected')}
            </Text>
              {/* Show estimated label if using non-authoritative data */}
              {feesQuery.data && !feesQuery.data.isAuthoritative && (
                <Text variant="body4" color="$neutral3">
                  {t('pool.fees.estimated', { defaultValue: '(estimated)' })}
                </Text>
              )}
              {/* Show error tooltip if all providers failed */}
              {feesQuery.isError && !feesQuery.data && (
                <Text variant="body4" color="$neutral3">
                  {t('pool.fees.unavailable', { defaultValue: 'Unable to fetch from RPC' })}
                </Text>
              )}
            </Flex>

            {/* Token0 fees - Explicit data-source gating */}
            <Flex row alignItems="center" justifyContent="space-between">
              <Flex row gap="$gap8" alignItems="center">
                <CurrencyLogo currencyInfo={currency0CurrencyInfo} size={24} />
                <Text variant="body3">{fee0Token.symbol ?? currency0Amount.currency.symbol} fees</Text>
              </Flex>
              <Flex row alignItems="center" gap="$spacing4">
                {feesQuery.isLoading ? (
                  // Loading state
                  <Text variant="body3" color="$neutral2">
                    —
                  </Text>
                ) : feesQuery.data && fee0Amount !== undefined ? (
                  // Fee data from resolver (may be authoritative or estimated)
                  <>
                    <Text variant="body3">
                      {formatCurrencyAmount({ value: fee0Amount })}
                      {estimatedSuffix}
                    </Text>{' '}
                <Text variant="body3" color="$neutral2">
                  ({convertFiatAmountFormatted(fiatFeeValue0?.toExact(), NumberType.FiatTokenPrice)})
                </Text>
                  </>
                ) : (
                  // No data available
                  <Text variant="body3" color="$neutral2">
                    —
                  </Text>
                )}
              </Flex>
            </Flex>

            {/* Token1 fees - Explicit data-source gating */}
            <Flex row alignItems="center" justifyContent="space-between">
              <Flex row gap="$gap8" alignItems="center">
                <CurrencyLogo currencyInfo={currency1CurrencyInfo} size={24} />
                <Text variant="body3">{fee1Token.symbol ?? currency1Amount.currency.symbol} fees</Text>
              </Flex>
              <Flex row alignItems="center" gap="$spacing4">
                {feesQuery.isLoading ? (
                  // Loading state
                  <Text variant="body3" color="$neutral2">
                    —
                  </Text>
                ) : feesQuery.data && fee1Amount !== undefined ? (
                  // Fee data from resolver (may be authoritative or estimated)
                  <>
                    <Text variant="body3">
                      {formatCurrencyAmount({ value: fee1Amount })}
                      {estimatedSuffix}
                    </Text>{' '}
                <Text variant="body3" color="$neutral2">
                  ({convertFiatAmountFormatted(fiatFeeValue1?.toExact(), NumberType.FiatTokenPrice)})
                </Text>
                  </>
                ) : (
                  // No data available
                  <Text variant="body3" color="$neutral2">
                    —
                  </Text>
                )}
              </Flex>
            </Flex>
          </Flex>
        )}
      </Flex>
      {currentTransactionStep ? (
        <ProgressIndicator steps={steps} currentStep={currentTransactionStep} />
      ) : (
        <>
          <Separator mx="$padding16" />
          <Flex gap="$gap8" px="$padding16">
            <DetailLineItem
              LineItem={{
                Label: () => (
                  <Text variant="body3" color="$neutral2">
                    {t('common.rate')}
                  </Text>
                ),
                Value: () => (
                  <Text variant="body3">{`1 ${currentPrice?.baseCurrency.symbol} = ${currentPrice?.toFixed()} ${currentPrice?.quoteCurrency.symbol}`}</Text>
                ),
              }}
            />
            <DetailLineItem
              LineItem={{
                Label: () => (
                  <Text variant="body3" color="$neutral2">
                    <Trans i18nKey="pool.newSpecificPosition" values={{ symbol: currency0Amount.currency.symbol }} />
                  </Text>
                ),
                Value: () => (
                  <Flex row gap="$gap4">
                    <Text variant="body3">
                      {formatCurrencyAmount({ value: newCurrency0Amount, type: NumberType.TokenNonTx })}{' '}
                      {getSymbolDisplayText(newCurrency0Amount.currency.symbol)}
                    </Text>
                    <Text variant="body3" color="$neutral2">
                      {`(${convertFiatAmountFormatted(newCurrency0AmountUSD?.toExact(), NumberType.FiatStandard)})`}
                    </Text>
                  </Flex>
                ),
              }}
            />
            <DetailLineItem
              LineItem={{
                Label: () => (
                  <Text variant="body3" color="$neutral2">
                    <Trans i18nKey="pool.newSpecificPosition" values={{ symbol: currency1Amount.currency.symbol }} />
                  </Text>
                ),
                Value: () => (
                  <Flex row gap="$gap4">
                    <Text variant="body3">
                      {formatCurrencyAmount({ value: newCurrency1Amount, type: NumberType.TokenNonTx })}{' '}
                      {getSymbolDisplayText(newCurrency1Amount.currency.symbol)}
                    </Text>
                    <Text variant="body3" color="$neutral2">
                      {`(${convertFiatAmountFormatted(newCurrency1AmountUSD?.toExact(), NumberType.FiatStandard)})`}
                    </Text>
                  </Flex>
                ),
              }}
            />
            {poolTokenPercentage ? (
              <DetailLineItem
                LineItem={{
                  Label: () => (
                    <Text variant="body3" color="$neutral2">
                      {t('addLiquidity.shareOfPool')}
                    </Text>
                  ),
                  Value: () => <Text variant="body3">{formatPercent(poolTokenPercentage.toFixed())}</Text>,
                }}
              />
            ) : null}
            <DetailLineItem
              LineItem={{
                Label: () => (
                  <Text variant="body3" color="$neutral2">
                    {t('common.networkCost')}
                  </Text>
                ),
                Value: () => {
                  // Always show native fee if available (from on-chain estimation)
                  const nativeFee = onChainNetworkCost?.nativeFormatted
                  const usdFee = onChainNetworkCost?.usdFormatted || gasFeeEstimateUSD?.toExact()

                  return (
                  <Flex row gap="$gap4" alignItems="center">
                    <NetworkLogo chainId={chainId} size={iconSizes.icon16} shape="square" />
                      <Flex row gap="$gap2" alignItems="center">
                    <Text variant="body3">
                          {nativeFee ?? (usdFee ? convertFiatAmountFormatted(usdFee, NumberType.FiatGasPrice) : '—')}
                        </Text>
                        {nativeFee && usdFee && (
                          <Text variant="body4" color="$neutral2">
                            ({convertFiatAmountFormatted(usdFee, NumberType.FiatGasPrice)})
                    </Text>
                        )}
                      </Flex>
                  </Flex>
                  )
                },
              }}
            />
          </Flex>
          <Flex row>
            <Button
              size="large"
              onPress={onDecreaseLiquidity}
              icon={needsPasskeySignin ? <Passkey size="$icon.24" /> : undefined}
            >
              {needsPasskeySignin ? t('pool.removeLiquidity') : t('common.confirm')}
            </Button>
          </Flex>
        </>
      )}
    </Flex>
  )
}
