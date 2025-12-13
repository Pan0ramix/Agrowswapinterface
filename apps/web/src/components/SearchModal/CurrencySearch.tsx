import { Currency } from '@uniswap/sdk-core'
import { SwitchNetworkAction } from 'components/Popups/types'
import { useCurrencyInfoWithLoading } from 'hooks/Tokens'
import useSelectChain from 'hooks/useSelectChain'
import { useCallback, useEffect, useMemo } from 'react'
import { useMultichainContext } from 'state/multichain/useMultichainContext'
import { useSwapAndLimitContext } from 'state/swap/useSwapContext'
import { Flex } from 'ui/src'
import { TokenSelectorContent, TokenSelectorVariation } from 'uniswap/src/components/TokenSelector/TokenSelector'
import { TokenSelectorFlow } from 'uniswap/src/components/TokenSelector/types'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { InterfaceEventName, ModalName } from 'uniswap/src/features/telemetry/constants'
import Trace from 'uniswap/src/features/telemetry/Trace'
import { currencyToAsset } from 'uniswap/src/features/transactions/swap/utils/asset'
import { useWallet } from 'uniswap/src/features/wallet/hooks/useWallet'
import { CurrencyField } from 'uniswap/src/types/currency'
import { SwapTab } from 'uniswap/src/types/screens/interface'
import { currencyId } from 'uniswap/src/utils/currencyId'
import { usePrevious } from 'utilities/src/react/hooks'
import { showSwitchNetworkNotification } from 'utils/showSwitchNetworkNotification'

interface CurrencySearchProps {
  currencyField: CurrencyField
  switchNetworkAction: SwitchNetworkAction
  onCurrencySelect: (currency: Currency) => void
  onDismiss: () => void
  chainIds?: UniverseChainId[]
  variation?: TokenSelectorVariation
  selectedCurrency?: Currency | null
  otherSelectedCurrency?: Currency | null
}

export function CurrencySearch({
  currencyField,
  switchNetworkAction,
  onCurrencySelect,
  onDismiss,
  chainIds,
  variation,
  selectedCurrency,
  otherSelectedCurrency,
}: CurrencySearchProps) {
  const wallet = useWallet()
  const { chainId, setSelectedChainId, isUserSelectedToken, setIsUserSelectedToken, isMultichainContext } =
    useMultichainContext()
  const { currentTab } = useSwapAndLimitContext()
  const prevChainId = usePrevious(chainId)

  const selectChain = useSelectChain()
  const { chains } = useEnabledChains()

  // Convert selected currencies to CurrencyInfo for TokenSelectorContent
  // Use useCurrencyInfoWithLoading to check if GraphQL query is still loading or failed
  const {
    currencyInfo: inputCurrencyInfoFromQuery,
    loading: inputLoading,
    error: inputError,
  } = useCurrencyInfoWithLoading(selectedCurrency ?? undefined, selectedCurrency?.chainId)
  const {
    currencyInfo: outputCurrencyInfoFromQuery,
    loading: outputLoading,
    error: outputError,
  } = useCurrencyInfoWithLoading(otherSelectedCurrency ?? undefined, otherSelectedCurrency?.chainId)

  // Fallback: if GraphQL query fails but we have a Currency object, create a minimal CurrencyInfo
  const inputCurrencyInfo = useMemo((): CurrencyInfo | undefined => {
    if (inputCurrencyInfoFromQuery) {
      return inputCurrencyInfoFromQuery
    }
    // If GraphQL failed or returned no data, but we have a Currency object, create CurrencyInfo from it
    if (selectedCurrency && !inputLoading && (inputError || !inputCurrencyInfoFromQuery)) {
      return buildCurrencyInfo({
        currency: selectedCurrency,
        currencyId: currencyId(selectedCurrency),
        logoUrl: undefined,
        safetyInfo: undefined,
      })
    }
    return undefined
  }, [inputCurrencyInfoFromQuery, selectedCurrency, inputLoading, inputError])

  const outputCurrencyInfo = useMemo((): CurrencyInfo | undefined => {
    if (outputCurrencyInfoFromQuery) {
      return outputCurrencyInfoFromQuery
    }
    // If GraphQL failed or returned no data, but we have a Currency object, create CurrencyInfo from it
    if (otherSelectedCurrency && !outputLoading && (outputError || !outputCurrencyInfoFromQuery)) {
      return buildCurrencyInfo({
        currency: otherSelectedCurrency,
        currencyId: currencyId(otherSelectedCurrency),
        logoUrl: undefined,
        safetyInfo: undefined,
      })
    }
    return undefined
  }, [outputCurrencyInfoFromQuery, otherSelectedCurrency, outputLoading, outputError])

  const handleCurrencySelectTokenSelectorCallback = useCallback(
    async ({ currency }: { currency: Currency }) => {
      console.error('[CurrencySearch] handleCurrencySelectTokenSelectorCallback CALLED', {
        currency: currency ? {
          address: currency.isToken ? currency.address : 'native',
          symbol: currency.symbol,
          chainId: currency.chainId,
        } : 'UNDEFINED',
        isMultichainContext,
      })
      
      if (!isMultichainContext) {
        console.error('[CurrencySearch] Not multichain context, selecting chain', { chainId: currency.chainId })
        const correctChain = await selectChain(currency.chainId)
        console.error('[CurrencySearch] Chain selection result', { correctChain, chainId: currency.chainId })
        if (!correctChain) {
          console.error('[CurrencySearch] Chain selection failed, aborting currency select')
          return
        }
      }
      
      console.error('[CurrencySearch] Calling onCurrencySelect', {
        currency: currency ? {
          address: currency.isToken ? currency.address : 'native',
          symbol: currency.symbol,
          chainId: currency.chainId,
        } : 'UNDEFINED',
      })
      // Call onCurrencySelect - it will handle resetting the modal state by setting currencySearchInputState to undefined
      // Don't call onDismiss here to avoid race condition - let handleCurrencySelect reset the state first
      onCurrencySelect(currency)
      setSelectedChainId(currency.chainId)
      setIsUserSelectedToken(true)
      // Note: We don't call onDismiss() here because handleCurrencySelect will reset currencySearchInputState,
      // which will automatically close the modal (since isOpen={currencySearchInputState !== undefined})
      // Only call onDismiss if onCurrencySelect doesn't handle it (for error cases)
    },
    [onCurrencySelect, onDismiss, setSelectedChainId, setIsUserSelectedToken, selectChain, isMultichainContext],
  )

  useEffect(() => {
    if ((currentTab !== SwapTab.Swap && currentTab !== SwapTab.Send) || !isMultichainContext) {
      return
    }

    showSwitchNetworkNotification({ chainId, prevChainId, action: switchNetworkAction })
  }, [currentTab, chainId, prevChainId, isMultichainContext, switchNetworkAction])

  return (
    <Trace logImpression eventOnTrigger={InterfaceEventName.TokenSelectorOpened} modal={ModalName.TokenSelectorWeb}>
      <Flex width="100%" flexGrow={1} flexShrink={1} flexBasis="auto">
        <TokenSelectorContent
          renderedInModal={false}
          evmAddress={wallet.evmAccount?.address}
          svmAddress={wallet.svmAccount?.address}
          isLimits={currentTab === SwapTab.Limit}
          chainId={!isMultichainContext || isUserSelectedToken ? chainId : undefined}
          chainIds={chainIds ?? chains}
          currencyField={currencyField}
          flow={TokenSelectorFlow.Swap}
          isSurfaceReady={true}
          variation={
            variation ??
            (currencyField === CurrencyField.INPUT
              ? TokenSelectorVariation.SwapInput
              : TokenSelectorVariation.SwapOutput)
          }
          input={
            currencyField === CurrencyField.INPUT
              ? (currencyToAsset(inputCurrencyInfo?.currency) ?? undefined)
              : (currencyToAsset(outputCurrencyInfo?.currency) ?? undefined)
          }
          output={
            currencyField === CurrencyField.INPUT
              ? (currencyToAsset(outputCurrencyInfo?.currency) ?? undefined)
              : (currencyToAsset(inputCurrencyInfo?.currency) ?? undefined)
          }
          onClose={onDismiss}
          onSelectCurrency={handleCurrencySelectTokenSelectorCallback}
        />
      </Flex>
    </Trace>
  )
}
