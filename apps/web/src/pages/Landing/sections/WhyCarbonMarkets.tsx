import { InfoCard, LandingSection, SectionHeader } from 'pages/Landing/components'
import { Eye, Shield, Shuffle } from 'react-feather'
import { useTranslation } from 'react-i18next'
import { Flex, styled, Text } from 'ui/src'

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

export function WhyCarbonMarkets(): JSX.Element {
  const { t } = useTranslation()

  return (
    <LandingSection variant="default">
      <Flex gap="$spacing32" flexDirection="column">
        <SectionHeader title={t('landing.whyCarbonMarkets.title')} />
        <CardsContainer>
          <InfoCard
            icon={
              <IconWrapper>
                <Shuffle size={24} />
              </IconWrapper>
            }
            title={t('landing.whyCarbonMarkets.fragmented.title')}
            body={t('landing.whyCarbonMarkets.fragmented.body')}
          />
          <InfoCard
            icon={
              <IconWrapper>
                <Eye size={24} />
              </IconWrapper>
            }
            title={t('landing.whyCarbonMarkets.transparency.title')}
            body={t('landing.whyCarbonMarkets.transparency.body')}
          />
          <InfoCard
            icon={
              <IconWrapper>
                <Shield size={24} />
              </IconWrapper>
            }
            title={t('landing.whyCarbonMarkets.regulatory.title')}
            body={t('landing.whyCarbonMarkets.regulatory.body')}
          />
        </CardsContainer>
        <Text variant="body1" color="$neutral2" maxWidth={800}>
          {t('landing.whyCarbonMarkets.closing')}
        </Text>
      </Flex>
    </LandingSection>
  )
}
