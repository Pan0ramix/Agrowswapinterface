import { ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { Currency } from '@uniswap/sdk-core'
import { useTokenBalanceWithBuffer } from 'components/Liquidity/Create/hooks/useDepositInfo'
import { useNativeTokenPercentageBufferExperiment } from 'components/Liquidity/Create/hooks/useNativeTokenPercentageBufferExperiment'
import { DepositInfo } from 'components/Liquidity/types'
import { SwitchNetworkAction } from 'components/Popups/types'
import CurrencySearchModal from 'components/SearchModal/CurrencySearchModal'
import { useCurrencyInfoWithLoading } from 'hooks/Tokens'
import { SUPPORTED_V2POOL_CHAIN_IDS } from 'hooks/useNetworkSupportsV2'
import { useCreateLiquidityContext } from 'pages/CreatePosition/CreateLiquidityContextProvider'
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PositionField } from 'types/position'
import { Flex, FlexProps } from 'ui/src'
import { CurrencyInputPanel } from 'uniswap/src/components/CurrencyInputPanel/CurrencyInputPanel'
import { CurrencyInputPanelRef } from 'uniswap/src/components/CurrencyInputPanel/types'
import { TokenSelectorVariation } from 'uniswap/src/components/TokenSelector/TokenSelector'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { buildCurrencyInfo } from 'uniswap/src/features/dataApi/utils/buildCurrency'
import { Platform } from 'uniswap/src/features/platforms/types/Platform'
import { CurrencyField } from 'uniswap/src/types/currency'
import { areCurrenciesEqual, currencyId } from 'uniswap/src/utils/currencyId'
import { isV4UnsupportedChain } from 'utils/networkSupportsV4'

const INPUT_BORDER_RADIUS = '$rounded20'
const sharedPanelStyle = {
  borderTopLeftRadius: INPUT_BORDER_RADIUS,
  borderTopRightRadius: INPUT_BORDER_RADIUS,
  backgroundColor: '$surface2',
}

function borderRadiusStyles(component?: ReactNode): FlexProps {
  return {
    borderBottomLeftRadius: component ? '$rounded0' : INPUT_BORDER_RADIUS,
    borderBottomRightRadius: component ? '$rounded0' : INPUT_BORDER_RADIUS,
  }
}

function UnderCardComponent({ children }: { children: ReactNode }) {
  return (
    <Flex
      backgroundColor="$surface2"
      borderBottomLeftRadius="$rounded20"
      borderBottomRightRadius="$rounded20"
      py="$spacing8"
      px="$spacing16"
    >
      {children}
    </Flex>
  )
}

type InputFormProps = {
  token0?: Currency
  token1?: Currency
  onUserInput: (field: PositionField, newValue: string) => void
  onSetMax: (field: PositionField, amount: string) => void
  deposit0Disabled?: boolean
  deposit1Disabled?: boolean
  token0UnderCardComponent?: ReactNode
  token1UnderCardComponent?: ReactNode
  amount0Loading: boolean
  amount1Loading: boolean
  autofocus?: boolean
} & DepositInfo

export function DepositInputForm({
  token0,
  token1,
  currencyAmounts,
  currencyBalances,
  currencyAmountsUSDValue,
  formattedAmounts,
  onUserInput,
  onSetMax,
  deposit0Disabled,
  deposit1Disabled,
  token0UnderCardComponent,
  token1UnderCardComponent,
  amount0Loading,
  amount1Loading,
  autofocus = true,
}: InputFormProps) {
  // refs must be used to control input focus rather than the focus prop because if the focus prop is used and the amounts are updated,
  // the focus will be stolen and brought back to the deposit form
  const token0InputRef = useRef<CurrencyInputPanelRef>(null)
  const token1InputRef = useRef<CurrencyInputPanelRef>(null)
  const bufferPercentage = useNativeTokenPercentageBufferExperiment()

  const token0BalanceWithBuffer = useTokenBalanceWithBuffer(currencyBalances?.[PositionField.TOKEN0], bufferPercentage)
  const token1BalanceWithBuffer = useTokenBalanceWithBuffer(currencyBalances?.[PositionField.TOKEN1], bufferPercentage)

  // TODO(WEB-4920): when the backend returns the logo info make sure that there is no call being made
  // to graphql to retrieve it
  // Use useCurrencyInfoWithLoading to check if GraphQL query is still loading or failed
  const {
    currencyInfo: token0CurrencyInfoFromQuery,
    loading: token0Loading,
    error: token0Error,
  } = useCurrencyInfoWithLoading(token0)
  const {
    currencyInfo: token1CurrencyInfoFromQuery,
    loading: token1Loading,
    error: token1Error,
  } = useCurrencyInfoWithLoading(token1)

  // Fallback: if GraphQL query fails but we have a Currency object, create a minimal CurrencyInfo
  const token0CurrencyInfo = useMemo((): CurrencyInfo | undefined => {
    if (token0CurrencyInfoFromQuery) {
      return token0CurrencyInfoFromQuery
    }
    // If GraphQL failed or returned no data, but we have a Currency object, create CurrencyInfo from it
    if (token0 && !token0Loading && (token0Error || !token0CurrencyInfoFromQuery)) {
      return buildCurrencyInfo({
        currency: token0,
        currencyId: currencyId(token0),
        logoUrl: undefined,
        safetyInfo: undefined,
      })
    }
    return undefined
  }, [token0CurrencyInfoFromQuery, token0, token0Loading, token0Error])

  const token1CurrencyInfo = useMemo((): CurrencyInfo | undefined => {
    if (token1CurrencyInfoFromQuery) {
      return token1CurrencyInfoFromQuery
    }
    // If GraphQL failed or returned no data, but we have a Currency object, create CurrencyInfo from it
    if (token1 && !token1Loading && (token1Error || !token1CurrencyInfoFromQuery)) {
      return buildCurrencyInfo({
        currency: token1,
        currencyId: currencyId(token1),
        logoUrl: undefined,
        safetyInfo: undefined,
      })
    }
    return undefined
  }, [token1CurrencyInfoFromQuery, token1, token1Loading, token1Error])
  const { setCurrencyInputs, protocolVersion } = useCreateLiquidityContext()
  // Use token0 and token1 from props as the currencyInputs source
  const currencyInputs = useMemo(() => ({ tokenA: token0, tokenB: token1 }), [token0, token1])
  const [currencySearchInputState, setCurrencySearchInputState] = useState<'tokenA' | 'tokenB' | undefined>(undefined)
  const { chains } = useEnabledChains({ platform: Platform.EVM, includeTestnets: true })

  // Calculate supported chains based on protocol version, matching SelectTokenStep logic
  const supportedChains = useMemo(() => {
    const result =
      protocolVersion === ProtocolVersion.V4
        ? chains.filter((chain) => !isV4UnsupportedChain(chain))
        : protocolVersion === ProtocolVersion.V2
          ? chains.filter((chain) => SUPPORTED_V2POOL_CHAIN_IDS.includes(chain))
          : chains // V3 and other versions support all chains

    return result
  }, [protocolVersion, chains])

  // Determine which currency is being selected and which is the "other" currency
  const selectedCurrency = useMemo(() => {
    if (!currencyInputs) {
      return undefined
    }
    if (currencySearchInputState === 'tokenA') {
      return currencyInputs.tokenA
    } else if (currencySearchInputState === 'tokenB') {
      return currencyInputs.tokenB
    }
    return undefined
  }, [currencySearchInputState, currencyInputs])

  const otherSelectedCurrency = useMemo(() => {
    if (!currencyInputs) {
      return undefined
    }
    if (currencySearchInputState === 'tokenA') {
      return currencyInputs.tokenB
    } else if (currencySearchInputState === 'tokenB') {
      return currencyInputs.tokenA
    }
    return undefined
  }, [currencySearchInputState, currencyInputs])

  // Log currencyInfo loading status
  useEffect(() => {}, [])

  useEffect(() => {
    if (autofocus) {
      token0InputRef.current?.textInputRef.current?.focus()
    }
  }, [autofocus])

  // Handler to open token selector modal
  const handleShowTokenSelector = useCallback((field: PositionField) => {
    // Map PositionField to tokenA/tokenB
    if (field === PositionField.TOKEN0) {
      setCurrencySearchInputState('tokenA')
    } else if (field === PositionField.TOKEN1) {
      setCurrencySearchInputState('tokenB')
    }
  }, [])

  // Handler for when a currency is selected from the modal
  const handleCurrencySelect = useCallback(
    (currency: Currency) => {
      if (currencySearchInputState === undefined) {
        return
      }

      const otherInputState = currencySearchInputState === 'tokenA' ? 'tokenB' : 'tokenA'
      const otherCurrency = currencyInputs[otherInputState]

      // If the new currency is the same as the other currency, clear the other
      if (areCurrenciesEqual(currency, otherCurrency)) {
        setCurrencyInputs((prevState) => ({
          ...prevState,
          [otherInputState]: undefined,
          [currencySearchInputState]: currency,
        }))
        setCurrencySearchInputState(undefined)
        return
      }

      // Update the selected currency
      setCurrencyInputs((prevState) => ({
        ...prevState,
        [currencySearchInputState]: currency,
      }))
      setCurrencySearchInputState(undefined)
    },
    [currencySearchInputState, currencyInputs, setCurrencyInputs],
  )

  const handleUserInput = (field: PositionField) => {
    return (newValue: string) => {
      onUserInput(field, newValue)
    }
  }
  const handleOnSetMax = (field: PositionField) => {
    return (amount: string) => {
      if (field === PositionField.TOKEN0) {
        token0InputRef.current?.textInputRef.current?.focus()
      } else {
        token1InputRef.current?.textInputRef.current?.focus()
      }

      onSetMax(field, amount)
    }
  }

  return (
    <>
      <Flex gap="$gap4">
        {!deposit0Disabled && (
          <Flex gap={2}>
            <CurrencyInputPanel
              ref={token0InputRef}
              customPanelStyle={{
                ...sharedPanelStyle,
                ...borderRadiusStyles(token0UnderCardComponent),
              }}
              currencyInfo={token0CurrencyInfo}
              currencyField={CurrencyField.INPUT}
              currencyAmount={currencyAmounts?.[PositionField.TOKEN0]}
              currencyBalance={token0BalanceWithBuffer}
              onSetExactAmount={handleUserInput(PositionField.TOKEN0)}
              onToggleIsFiatMode={() => undefined}
              usdValue={currencyAmountsUSDValue?.[PositionField.TOKEN0]}
              onSetPresetValue={handleOnSetMax(PositionField.TOKEN0)}
              value={formattedAmounts?.[PositionField.TOKEN0]}
              onPressIn={() => token0InputRef.current?.textInputRef.current?.focus()}
              onShowTokenSelector={() => handleShowTokenSelector(PositionField.TOKEN0)}
              isLoading={amount0Loading || token0Loading}
            />
            {token0UnderCardComponent && <UnderCardComponent>{token0UnderCardComponent}</UnderCardComponent>}
          </Flex>
        )}
        {!deposit1Disabled && (
          <Flex gap={2}>
            <CurrencyInputPanel
              ref={token1InputRef}
              customPanelStyle={{
                ...sharedPanelStyle,
                py: '$spacing16',
                ...borderRadiusStyles(token1UnderCardComponent),
              }}
              currencyInfo={token1CurrencyInfo}
              currencyField={CurrencyField.INPUT}
              currencyAmount={currencyAmounts?.[PositionField.TOKEN1]}
              currencyBalance={token1BalanceWithBuffer}
              onSetExactAmount={handleUserInput(PositionField.TOKEN1)}
              onToggleIsFiatMode={() => undefined}
              usdValue={currencyAmountsUSDValue?.[PositionField.TOKEN1]}
              onSetPresetValue={handleOnSetMax(PositionField.TOKEN1)}
              value={formattedAmounts?.[PositionField.TOKEN1]}
              onPressIn={() => token1InputRef.current?.textInputRef.current?.focus()}
              onShowTokenSelector={() => handleShowTokenSelector(PositionField.TOKEN1)}
              isLoading={amount1Loading || token1Loading}
            />
            {token1UnderCardComponent && <UnderCardComponent>{token1UnderCardComponent}</UnderCardComponent>}
          </Flex>
        )}
      </Flex>
      <CurrencySearchModal
        isOpen={currencySearchInputState !== undefined}
        onDismiss={() => {
          setCurrencySearchInputState(undefined)
        }}
        switchNetworkAction={SwitchNetworkAction.LP}
        onCurrencySelect={handleCurrencySelect}
        selectedCurrency={selectedCurrency}
        otherSelectedCurrency={otherSelectedCurrency}
        chainIds={supportedChains}
        currencyField={currencySearchInputState === 'tokenA' ? CurrencyField.INPUT : CurrencyField.OUTPUT}
        variation={TokenSelectorVariation.SwapInput}
      />
    </>
  )
}
