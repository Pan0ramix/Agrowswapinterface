import { InfoCard, LandingSection, SectionHeader } from 'pages/Landing/components'
import { Briefcase, Droplet, ShoppingCart, Users } from 'react-feather'
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

export function WhoUsesAgroswap(): JSX.Element {
  const { t } = useTranslation()

  return (
    <LandingSection variant="default">
      <Flex gap="$spacing32" flexDirection="column">
        <SectionHeader title={t('landing.whoUses.title')} />
        <CardsContainer>
          <InfoCard
            icon={
              <IconWrapper>
                <Briefcase size={24} />
              </IconWrapper>
            }
            title={t('landing.whoUses.institutions.title')}
            body={t('landing.whoUses.institutions.body')}
          />
          <InfoCard
            icon={
              <IconWrapper>
                <ShoppingCart size={24} />
              </IconWrapper>
            }
            title={t('landing.whoUses.companies.title')}
            body={t('landing.whoUses.companies.body')}
          />
          <InfoCard
            icon={
              <IconWrapper>
                <Droplet size={24} />
              </IconWrapper>
            }
            title={t('landing.whoUses.liquidity.title')}
            body={t('landing.whoUses.liquidity.body')}
          />
          <InfoCard
            icon={
              <IconWrapper>
                <Users size={24} />
              </IconWrapper>
            }
            title={t('landing.whoUses.projects.title')}
            body={t('landing.whoUses.projects.body')}
          />
        </CardsContainer>
      </Flex>
    </LandingSection>
  )
}
