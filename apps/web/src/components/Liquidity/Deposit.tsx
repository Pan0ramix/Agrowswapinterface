import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { ErrorCallout } from 'components/ErrorCallout'
import { useDefaultInitialPrice } from 'components/Liquidity/Create/hooks/useDefaultInitialPrice'
import { DepositInputForm } from 'components/Liquidity/DepositInputForm'
import { useUpdatedAmountsFromDependentAmount } from 'components/Liquidity/hooks/useDependentAmountFallback'
import { getPriceDifference } from 'components/Liquidity/utils/getPriceDifference'
import { getFieldsDisabled, isInvalidRange } from 'components/Liquidity/utils/priceRangeInfo'
import { useAccount } from 'hooks/useAccount'
import ConfirmCreatePositionModal from 'pages/CreatePosition/ConfirmCreatePositionModal'
import { useCreateLiquidityContext } from 'pages/CreatePosition/CreateLiquidityContextProvider'
import { CreatePositionModal } from 'pages/CreatePosition/CreatePositionModal'
import { useCreatePositionTxContext } from 'pages/CreatePosition/CreatePositionTxContext'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { PositionField } from 'types/position'
import { Button, Flex, Text } from 'ui/src'
import { AlertTriangleFilled } from 'ui/src/components/icons/AlertTriangleFilled'
import { WarningSeverity } from 'uniswap/src/components/modals/WarningModal/types'
import { useUniswapContext } from 'uniswap/src/contexts/UniswapContext'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { useRestrictedTokenAllowlistChecks } from 'uniswap/src/features/transactions/hooks/useRestrictedTokenAllowlistChecks'
import { EVMUniverseChainId } from 'uniswap/src/features/chains/types'
import { Address } from 'viem'
import { FeeAmount } from '@uniswap/v3-sdk'
import { PositionFlowStep } from 'components/Liquidity/Create/types'

// Component for rendering message with clickable addresses
function MessageWithClickableAddresses({ message }: { message: string }) {
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)

  const handleCopyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      setTimeout(() => setCopiedAddress(null), 2000)
    } catch (err) {
      console.error('Failed to copy address:', err)
    }
  }

  // Split by lines first to preserve line breaks
  const lines = message.split('\n')
  
  return (
    <Flex gap="$gap2">
      {lines.map((line, lineIdx) => {
        // Regex to match Ethereum addresses (0x followed by 40 hex characters)
        const addressRegex = /(0x[a-fA-F0-9]{40})/g
        const parts: React.ReactNode[] = []
        let lastIndex = 0
        let match
        let keyCounter = 0

        while ((match = addressRegex.exec(line)) !== null) {
          // Add text before the address
          if (match.index > lastIndex) {
            const textBefore = line.substring(lastIndex, match.index)
            if (textBefore) {
              parts.push(
                <Text key={`text-${lineIdx}-${keyCounter++}`} variant="body3" color="$neutral2">
                  {textBefore}
                </Text>
              )
            }
          }

          // Add clickable address
          const address = match[1]
          parts.push(
            <Text
              key={`addr-${lineIdx}-${keyCounter++}`}
              variant="body3"
              color={copiedAddress === address ? '$statusSuccess' : '$neutral1'}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onPress={() => handleCopyAddress(address)}
            >
              {address}
              {copiedAddress === address ? ' ✓ Copied!' : ''}
            </Text>
          )

          lastIndex = match.index + match[0].length
        }

        // Add remaining text
        if (lastIndex < line.length) {
          const textAfter = line.substring(lastIndex)
          if (textAfter) {
            parts.push(
              <Text key={`text-${lineIdx}-${keyCounter++}`} variant="body3" color="$neutral2">
                {textAfter}
              </Text>
            )
          }
        }

        // If no addresses found, just render the line as-is
        if (parts.length === 0) {
          return (
            <Text key={`line-${lineIdx}`} variant="body3" color="$neutral2">
              {line}
            </Text>
          )
        }

        return (
          <Flex key={`line-${lineIdx}`} row flexWrap="wrap" gap="$gap4" alignItems="flex-start">
            {parts}
          </Flex>
        )
      })}
    </Flex>
  )
}

export const DepositStep = () => {
  const {
    priceRangeState: { initialPrice, priceInverted },
    protocolVersion,
    creatingPoolOrPair,
    currencies,
    ticks,
    poolOrPair,
    depositState,
    setDepositState,
    refetch,
    positionState,
    step,
  } = useCreateLiquidityContext()

  const { t } = useTranslation()
  const { onConnectWallet } = useUniswapContext()
  const account = useAccount()
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const { TOKEN0, TOKEN1 } = currencies.display
  const { exactField } = depositState

  useEffect(() => {}, [])

  const { price: defaultInitialPrice } = useDefaultInitialPrice({
    currencies: {
      [PositionField.TOKEN0]: currencies.display.TOKEN0,
      [PositionField.TOKEN1]: currencies.display.TOKEN1,
    },
    // V2 create flow doesn't show the liquidity range chart so we always want
    // to get the default initial price for DisplayCurrentPrice in deposit step
    skip: !creatingPoolOrPair && protocolVersion === ProtocolVersion.V2,
  })

  const priceDifference = useMemo(
    () =>
      getPriceDifference({
        initialPrice,
        defaultInitialPrice,
        priceInverted,
      }),
    [initialPrice, defaultInitialPrice, priceInverted],
  )

  const invalidRange = protocolVersion !== ProtocolVersion.V2 && isInvalidRange(ticks[0], ticks[1])

  const {
    txInfo,
    gasFeeEstimateUSD,
    dependentAmount,
    transactionError,
    setTransactionError,
    currencyAmounts,
    inputError,
    formattedAmounts,
    currencyAmountsUSDValue,
    currencyBalances,
  } = useCreatePositionTxContext()

  const handleUserInput = (field: PositionField, newValue: string) => {
    setDepositState((prev) => ({
      exactField: field,
      exactAmounts: {
        ...prev.exactAmounts,
        [field]: newValue,
      },
    }))
  }

  const handleOnSetMax = (field: PositionField, amount: string) => {
    setDepositState((prev) => ({
      exactField: field,
      exactAmounts: {
        ...prev.exactAmounts,
        [field]: amount,
      },
    }))
  }

  const handleReview = useCallback(() => {
    if (priceDifference?.warning === WarningSeverity.High) {
      setIsConfirmModalOpen(true)
      return
    }

    setIsReviewModalOpen(true)
  }, [priceDifference?.warning])

  const { TOKEN0: deposit0Disabled, TOKEN1: deposit1Disabled } = getFieldsDisabled({
    ticks,
    poolOrPair,
  })

  const {
    updatedFormattedAmounts,
    updatedCurrencyAmounts,
    updatedUSDAmounts,
    updatedDeposit0Disabled,
    updatedDeposit1Disabled,
  } = useUpdatedAmountsFromDependentAmount({
    token0: TOKEN0,
    token1: TOKEN1,
    dependentAmount,
    exactField,
    currencyAmounts,
    currencyAmountsUSDValue,
    formattedAmounts,
    deposit0Disabled,
    deposit1Disabled,
  })

  useEffect(() => {
    if (deposit1Disabled) {
      setDepositState({ exactField: PositionField.TOKEN0, exactAmounts: {} })
    } else if (deposit0Disabled) {
      setDepositState({ exactField: PositionField.TOKEN1, exactAmounts: {} })
    }
  }, [deposit0Disabled, deposit1Disabled, setDepositState])

  // Check token whitelist status for TOKEN0 and TOKEN1
  // Only check when we're actually on the DEPOSIT step to avoid running hooks unnecessarily
  // (DepositStep is rendered on PRICE_RANGE step too, so we need to gate the hooks)
  const isDepositStep = step === PositionFlowStep.DEPOSIT
  
  const chainId = TOKEN0?.chainId as EVMUniverseChainId | undefined
  const walletAddress = account?.address as Address | undefined

  // Use the new consolidated hook for allowlist checks
  const feeAmount = positionState.fee?.isDynamic ? undefined : (positionState.fee?.feeAmount as FeeAmount | undefined)

  const allowlistChecks = useRestrictedTokenAllowlistChecks({
    account: walletAddress,
    chainId,
    tokens: {
      tokenA: TOKEN0,
      tokenB: TOKEN1,
    },
    feeAmount,
    flow: 'liquidity',
    enabled: isDepositStep && !!TOKEN0 && !!TOKEN1 && !!feeAmount && !!chainId && !!walletAddress,
  })

  const isLoading = allowlistChecks.isLoading

  // Separate wallet checks from other address checks
  const { walletStatus, otherAddressWarnings } = useMemo(() => {
    // Find wallet check status
    const walletChecks = allowlistChecks.debug.checked.filter((check) => check.subjectLabel === 'Wallet')
    const walletCheck = walletChecks.length > 0 ? walletChecks[0] : null
    const walletIsAllowed = walletCheck?.isAllowed === true
    const walletIsLoading = walletChecks.length === 0 && isLoading

    // Get warnings for non-wallet addresses only
    const nonWalletWarnings = [
      ...allowlistChecks.blockingWarnings.filter((w) => w.subjectLabel !== 'Wallet'),
      ...allowlistChecks.nonBlockingWarnings.filter((w) => w.subjectLabel !== 'Wallet'),
    ]

    // Build warning message for non-wallet addresses
    let otherAddressMessage: string | undefined = undefined
    if (nonWalletWarnings.length > 0) {
      const warningsByToken = new Map<string, Array<{ label: string; address: string }>>()
      
      for (const warning of nonWalletWarnings) {
        const tokenKey = warning.tokenSymbol || warning.tokenAddress
        if (!warningsByToken.has(tokenKey)) {
          warningsByToken.set(tokenKey, [])
        }
        warningsByToken.get(tokenKey)!.push({
          label: warning.subjectLabel,
          address: warning.subjectAddress,
        })
      }

      const parts: string[] = []
      for (const [tokenSymbol, addresses] of warningsByToken.entries()) {
        if (addresses.length > 0) {
          // Deduplicate addresses by address
          const uniqueAddresses = Array.from(
            new Map(addresses.map((a) => [a.address, a])).values()
          )
          
          parts.push(`The following addresses are not whitelisted for ${tokenSymbol}:`)
          const addressList = uniqueAddresses.map((a) => `• ${a.label}: ${a.address}`).join('\n')
          parts.push(addressList)
          parts.push('')
          parts.push('Please contact your system administrator to whitelist these addresses.')
        }
      }

      otherAddressMessage = parts.join('\n\n')
    }

    return {
      walletStatus: {
        isAllowed: walletIsAllowed,
        isLoading: walletIsLoading,
        check: walletCheck,
      },
      otherAddressWarnings: otherAddressMessage,
    }
  }, [allowlistChecks, isLoading])

  // Block if wallet is not allowed OR if other addresses are not allowed
  const hasWhitelistRestriction = useMemo(() => {
    if (walletStatus.isLoading) return false // Don't block while loading
    if (walletStatus.check && walletStatus.check.isAllowed === false) return true // Block if wallet not allowed
    if (otherAddressWarnings) return true // Block if other addresses not allowed
    return false
  }, [walletStatus, otherAddressWarnings])

  if (!TOKEN0 || !TOKEN1) {
    return null
  }

  const disabled = !!inputError || !txInfo?.txRequest || hasWhitelistRestriction

  const requestLoading = Boolean(
    !transactionError &&
      !inputError &&
      !txInfo?.txRequest &&
      currencyAmounts?.TOKEN0 &&
      currencyAmounts.TOKEN1 &&
      !invalidRange,
  )

  return (
    <>
      {invalidRange ? null : (
        <Flex gap={32}>
          <Flex gap="$spacing4">
            <Text variant="subheading1">
              <Trans i18nKey="common.depositTokens" />
            </Text>
            <Text variant="body3" color="$neutral2">
              <Trans i18nKey="position.deposit.description" />
            </Text>
          </Flex>
        </Flex>
      )}
      {/* Wallet status and allowlist warnings */}
      {allowlistChecks.debug.restrictedTokens.length > 0 && (
        <>
          {/* Wallet status - show separately */}
          {!walletStatus.isLoading && walletStatus.check && (
            <Flex row gap="$spacing12" backgroundColor="$surface2" borderRadius="$rounded16" p="$padding12">
              <Flex
                backgroundColor={walletStatus.isAllowed ? '$statusSuccess2' : '$statusCritical2'}
                p="$padding12"
                borderRadius="$rounded12"
                alignSelf="flex-start"
              >
                {walletStatus.isAllowed ? (
                  <Text color="$statusSuccess" fontSize={20}>✓</Text>
                ) : (
                  <AlertTriangleFilled color="$statusCritical" size="$icon.20" />
                )}
              </Flex>
              <Flex alignItems="flex-start" flexWrap="wrap" flexShrink={1} gap="$gap4">
                <Text 
                  color={walletStatus.isAllowed ? '$statusSuccess' : '$statusCritical'} 
                  variant="body3"
                  fontWeight="600"
                >
                  {walletStatus.isAllowed 
                    ? 'Wallet KYC\'d and allowed ✓'
                    : 'Wallet not authorized'}
                </Text>
                {!walletStatus.isAllowed && (
                  <Text variant="body3" color="$neutral2">
                    You need to complete KYC verification to allow your wallet for trading. Please contact your system administrator to submit your wallet for KYC approval.
                  </Text>
                )}
              </Flex>
            </Flex>
          )}

          {/* Other address warnings - only show if there are non-wallet issues */}
          {otherAddressWarnings && (
            <Flex row gap="$spacing12" backgroundColor="$surface2" borderRadius="$rounded16" p="$padding12">
              <Flex
                backgroundColor="$statusCritical2"
                p="$padding12"
                borderRadius="$rounded12"
                alignSelf="flex-start"
              >
                <AlertTriangleFilled color="$statusCritical" size="$icon.20" />
              </Flex>
              <Flex alignItems="flex-start" flexWrap="wrap" flexShrink={1} gap="$gap4">
                <Text color="$statusCritical" variant="body3" fontWeight="600">
                  Address Whitelist Required
                </Text>
                <Flex gap="$gap4">
                  {otherAddressWarnings.split('\n\n').map((paragraph, idx) => {
                    if (paragraph.trim() === '') return <Text key={idx} variant="body3" color="$neutral2" height={16} />
                    return <MessageWithClickableAddresses key={idx} message={paragraph} />
                  })}
                </Flex>
              </Flex>
            </Flex>
          )}

          {/* Loading state */}
          {walletStatus.isLoading && (
            <Flex row gap="$spacing12" backgroundColor="$surface2" borderRadius="$rounded16" p="$padding12">
              <Flex
                backgroundColor="$statusWarning2"
                p="$padding12"
                borderRadius="$rounded12"
                alignSelf="flex-start"
              >
                <AlertTriangleFilled color="$statusWarning" size="$icon.20" />
              </Flex>
              <Flex alignItems="flex-start" flexWrap="wrap" flexShrink={1} gap="$gap4">
                <Text color="$statusWarning" variant="body3">
                  Checking allowlist status for restricted token{allowlistChecks.debug.restrictedTokens.length > 1 ? 's' : ''}: {allowlistChecks.debug.restrictedTokens.map((t) => t.symbol || t.address).join(', ')}
                </Text>
              </Flex>
            </Flex>
          )}
        </>
      )}
      <DepositInputForm
        autofocus={false}
        token0={TOKEN0}
        token1={TOKEN1}
        formattedAmounts={updatedFormattedAmounts ?? formattedAmounts}
        currencyAmounts={updatedCurrencyAmounts ?? currencyAmounts}
        currencyAmountsUSDValue={updatedUSDAmounts ?? currencyAmountsUSDValue}
        currencyBalances={currencyBalances}
        onUserInput={handleUserInput}
        onSetMax={handleOnSetMax}
        deposit0Disabled={updatedDeposit0Disabled}
        deposit1Disabled={updatedDeposit1Disabled}
        amount0Loading={requestLoading && exactField === PositionField.TOKEN1}
        amount1Loading={requestLoading && exactField === PositionField.TOKEN0}
      />
      <Flex row>
        {account.isConnected ? (
          <Button
            size="large"
            variant="branded"
            onPress={handleReview}
            isDisabled={disabled}
            key="Position-Create-DepositButton"
            loading={requestLoading}
          >
            {hasWhitelistRestriction
              ? t('position.whitelistRestriction.button')
              : inputError
                ? inputError
                : t('swap.button.review')}
          </Button>
        ) : (
          <Button size="large" variant="branded" emphasis="secondary" onPress={() => onConnectWallet?.(Platform.EVM)}>
            {t('common.connectWallet.button')}
          </Button>
        )}
      </Flex>
      <ErrorCallout errorMessage={transactionError} onPress={refetch} />
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
            <Trans i18nKey="position.poolNotFound.title" />
          </Text>
          <Text variant="body3" color="$neutral2">
            <Trans i18nKey="position.poolNotFound.description" />
          </Text>
          {process.env.NODE_ENV !== 'production' && (
            <Text variant="body3" color="$neutral3" mt="$spacing8">
              <Trans i18nKey="position.poolNotFound.devNote" />
            </Text>
          )}
        </Flex>
      )}
      <CreatePositionModal
        formattedAmounts={updatedFormattedAmounts}
        currencyAmounts={updatedCurrencyAmounts ?? currencyAmounts}
        currencyAmountsUSDValue={updatedUSDAmounts}
        gasFeeEstimateUSD={gasFeeEstimateUSD}
        txInfo={txInfo}
        isOpen={isReviewModalOpen}
        transactionError={transactionError}
        setTransactionError={setTransactionError}
        onClose={() => setIsReviewModalOpen(false)}
      />
      {priceDifference?.warning === WarningSeverity.High && (
        <ConfirmCreatePositionModal
          isOpen={isConfirmModalOpen}
          onClose={() => setIsConfirmModalOpen(false)}
          onContinue={() => {
            setIsConfirmModalOpen(false)
            setIsReviewModalOpen(true)
          }}
          priceDifference={priceDifference}
        />
      )}
    </>
  )
}
