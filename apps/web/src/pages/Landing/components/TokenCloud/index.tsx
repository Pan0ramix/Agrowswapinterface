import { getTokenDetailsURL } from 'appGraphql/data/util'
import { approvedERC20, InteractiveToken } from 'pages/Landing/assets/approvedTokens'
import { Ticker } from 'pages/Landing/components/TokenCloud/Ticker'
import { useAgroswapTokens } from 'pages/Landing/hooks/useAgroswapTokens'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router'
import { IconCloud, ItemPoint } from 'uniswap/src/components/IconCloud/IconCloud'
import { shuffleArray } from 'uniswap/src/components/IconCloud/utils'

// Fallback to approved tokens if no pools are available
const fallbackTokenList = shuffleArray(approvedERC20) as InteractiveToken[]

export function TokenCloud() {
  const agroswapTokens = useAgroswapTokens()
  const previousTokenCountRef = useRef<number | null>(null)

  // Log only when token count actually changes (deduplication)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      const currentCount = agroswapTokens.length
      const previousCount = previousTokenCountRef.current

      // Only log if the count changed
      if (previousCount !== currentCount) {
        if (currentCount > 0) {
          console.log('[TokenCloud] Using Agroswap tokens:', currentCount)
        } else if (previousCount !== null) {
          // Only log fallback if we previously had tokens (avoid logging on initial mount)
          console.log('[TokenCloud] Falling back to approved tokens (Agroswap tokens count: 0)')
        }
        previousTokenCountRef.current = currentCount
      }
    }
  }, [agroswapTokens.length])

  // Use Agroswap tokens if available, otherwise fallback to approved tokens
  const tokenList = useMemo(() => {
    if (agroswapTokens.length > 0) {
      return shuffleArray(agroswapTokens) as InteractiveToken[]
    }
    return fallbackTokenList
  }, [agroswapTokens])

  const renderOuterElement = useCallback((item: ItemPoint<InteractiveToken>) => {
    return <Ticker itemPoint={item} />
  }, [])

  const navigate = useNavigate()
  const onPress = useCallback(
    (item: ItemPoint<InteractiveToken>) => {
      const { address, chain } = item.itemData
      navigate(
        getTokenDetailsURL({
          address,
          chain,
        }),
      )
    },
    [navigate],
  )

  return (
    <IconCloud
      data={tokenList}
      renderOuterElement={renderOuterElement}
      onPress={onPress}
      getElementRounded={() => true}
    />
  )
}
