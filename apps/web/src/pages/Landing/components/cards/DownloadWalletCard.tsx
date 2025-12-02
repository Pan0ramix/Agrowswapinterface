import { Alignment, Fit, Layout, useRive } from '@rive-app/react-canvas'
import { PillButton } from 'pages/Landing/components/cards/PillButton'
import ValuePropCard from 'pages/Landing/components/cards/ValuePropCard'
import { Wallet } from 'pages/Landing/components/Icons'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useIsDarkMode } from 'theme/components/ThemeToggle'
import { Flex, useSporeColors } from 'ui/src'
import { Star } from 'ui/src/components/icons/Star'
import { uniswapUrls } from 'uniswap/src/constants/urls'

function DownloadWalletCardInner() {
  const theme = useSporeColors()
  const isDarkMode = useIsDarkMode()
  const { t } = useTranslation()
  const [riveInitialized, setRiveInitialized] = useState(false)

  // Ensure React is available before initializing Rive
  useEffect(() => {
    // Small delay to ensure React context is fully initialized
    const timer = setTimeout(() => {
      setRiveInitialized(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // Initialize Rive hooks - these must be called unconditionally
  const lightRive = useRive({
    src: '/rive/landing-page.riv',
    artboard: 'Mobile-Light',
    stateMachines: 'Animation',
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.BottomCenter }),
    autoplay: false,
  })

  const darkRive = useRive({
    src: '/rive/landing-page.riv',
    artboard: 'Mobile-Dark',
    stateMachines: 'Animation',
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.BottomCenter }),
    autoplay: false,
  })

  const lightAnimation = lightRive.rive
  const LightAnimation = lightRive.RiveComponent
  const darkAnimation = darkRive.rive
  const DarkAnimation = darkRive.RiveComponent

  return (
    <ValuePropCard
      href={uniswapUrls.downloadWalletUrl}
      minHeight={500}
      color="$accent1"
      backgroundColor="rgba(252, 114, 255, 0.12)"
      title={
        <PillButton
          color={theme.accent1.val}
          label={t('common.uniswapWallet')}
          icon={<Wallet size="24px" fill={theme.accent1.val} />}
        />
      }
      subtitle={t('landing.walletSubtitle')}
      bodyText={
        <Trans
          i18nKey="landing.walletBody"
          components={{
            Star: <Star color="$accent1" size="$icon.24" mb={-4} />,
          }}
        />
      }
      button={
        <PillButton color={theme.accent1.val} label={t('common.downloadUniswapWallet')} backgroundColor="$surface1" />
      }
      $lg={{
        minHeight: 750,
        maxWidth: '100%',
      }}
      $sm={{
        minHeight: 700,
      }}
      $xs={{
        minHeight: 540,
      }}
    >
      {riveInitialized && (
        <Flex width="100%" height="60%" position="absolute" m="auto" bottom={0} zIndex={1}>
          {isDarkMode && DarkAnimation ? (
            <DarkAnimation onMouseEnter={() => darkAnimation?.play()} />
          ) : LightAnimation ? (
            <LightAnimation onMouseEnter={() => lightAnimation?.play()} />
          ) : null}
        </Flex>
      )}
    </ValuePropCard>
  )
}

// Export as default for lazy loading
export default DownloadWalletCardInner

// Also export as named for direct imports (backwards compatibility)
export const DownloadWalletCard = DownloadWalletCardInner
