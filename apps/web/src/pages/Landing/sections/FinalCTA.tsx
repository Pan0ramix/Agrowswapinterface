import { LandingSection, SectionHeader } from 'pages/Landing/components'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button, Flex, styled } from 'ui/src'

const ButtonsContainer = styled(Flex, {
  flexDirection: 'row',
  gap: '$spacing16',
  flexWrap: 'wrap',
  justifyContent: 'center',
  $sm: {
    flexDirection: 'column',
    width: '100%',
  },
})

export function FinalCTA(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const handleRequestAccess = () => {
    // TODO: Route to existing onboarding/KYC/waitlist flow
    navigate('/request-access')
  }

  const handleLearnMore = () => {
    // TODO: Route to learn more page or scroll to relevant section
    navigate('/learn-more')
  }

  return (
    <LandingSection variant="cta">
      <Flex gap="$spacing24" alignItems="center" flexDirection="column">
        <SectionHeader
          title={t('landing.finalCta.primary')}
          description="Verification and wallet whitelisting required."
        />
        <ButtonsContainer>
          <Button variant="branded" emphasis="primary" onPress={handleRequestAccess} fill={false}>
            {t('landing.finalCta.primary')}
          </Button>
          <Button variant="default" emphasis="secondary" onPress={handleLearnMore} fill={false}>
            {t('landing.finalCta.secondary')}
          </Button>
        </ButtonsContainer>
      </Flex>
    </LandingSection>
  )
}
