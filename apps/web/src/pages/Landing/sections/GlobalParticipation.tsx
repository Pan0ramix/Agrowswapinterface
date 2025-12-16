import { InfoCard, LandingSection, SectionHeader } from 'pages/Landing/components'
import { Globe, Layers, TrendingUp } from 'react-feather'
import { useTranslation } from 'react-i18next'
import { Flex, styled } from 'ui/src'

const CardsContainer = styled(Flex, {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: '$spacing16',
  $md: {
    flexDirection: 'column',
  },
})

const IconWrapper = styled(Flex, {
  width: 24,
  height: 24,
  color: '$neutral1',
})

export function GlobalParticipation(): JSX.Element {
  const { t } = useTranslation()

  return (
    <LandingSection variant="default">
      <Flex gap="$spacing32" flexDirection="column">
        <SectionHeader title={t('landing.globalParticipation.title')} />
        <CardsContainer>
          <InfoCard
            icon={
              <IconWrapper>
                <Globe size={24} />
              </IconWrapper>
            }
            title="Multi-jurisdiction support"
            body="Built to support carbon assets from multiple jurisdictions, subject to applicable certification and regulatory requirements."
          />
          <InfoCard
            icon={
              <IconWrapper>
                <TrendingUp size={24} />
              </IconWrapper>
            }
            title="Expansion as compliant supply becomes available"
            body="Protocol designed to expand across regions as compliant supply becomes available."
          />
          <InfoCard
            icon={
              <IconWrapper>
                <Layers size={24} />
              </IconWrapper>
            }
            title="Unified market structure"
            body="Enabling a unified, global market for certified carbon assets with geographic diversity."
          />
        </CardsContainer>
      </Flex>
    </LandingSection>
  )
}
