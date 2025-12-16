import { InfoCard, LandingSection, SectionHeader } from 'pages/Landing/components'
import { Compass, Shield, User } from 'react-feather'
import { useTranslation } from 'react-i18next'
import { Flex, styled, Text } from 'ui/src'

const SplitLayout = styled(Flex, {
  flexDirection: 'row',
  gap: '$spacing32',
  alignItems: 'flex-start',
  $lg: {
    flexDirection: 'column',
    gap: '$spacing24',
  },
})

const CardsContainer = styled(Flex, {
  flexDirection: 'column',
  gap: '$spacing16',
  flex: 1,
})

const IconWrapper = styled(Flex, {
  width: 24,
  height: 24,
  color: '$neutral1',
})

const Description = (
  <Flex gap="$spacing8">
    <Text variant="body1" color="$neutral2">
      Permissioned protocol operating within applicable legal and regulatory frameworks.
    </Text>
    <Text variant="body1" color="$neutral2">
      KYC + wallet whitelisting required; rules enforced at smart contract level.
    </Text>
  </Flex>
)

export function Compliance(): JSX.Element {
  const { t } = useTranslation()

  return (
    <LandingSection variant="default">
      <SplitLayout>
        <SectionHeader title={t('landing.compliance.title')} description={Description} />
        <CardsContainer>
          <InfoCard
            icon={
              <IconWrapper>
                <User size={24} />
              </IconWrapper>
            }
            title="KYC & wallet whitelisting"
            body="Identity verification and wallet approval required before access."
          />
          <InfoCard
            icon={
              <IconWrapper>
                <Shield size={24} />
              </IconWrapper>
            }
            title="Contract-enforced participation rules"
            body="Smart contract level enforcement of participation requirements."
          />
          <InfoCard
            icon={
              <IconWrapper>
                <Compass size={24} />
              </IconWrapper>
            }
            title="Regulatory alignment"
            body="Designed to operate within applicable legal and regulatory frameworks."
          />
        </CardsContainer>
      </SplitLayout>
    </LandingSection>
  )
}
