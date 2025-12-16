import { InfoCard, LandingSection, SectionHeader } from 'pages/Landing/components'
import { CheckCircle, Lock, Shield } from 'react-feather'
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
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: '$spacing16',
  flex: 1,
  $md: {
    flexDirection: 'column',
  },
})

const IconWrapper = styled(Flex, {
  width: 24,
  height: 24,
  color: '$neutral1',
})

export function WhatIsAgroswap(): JSX.Element {
  const { t } = useTranslation()

  const description = (
    <Flex gap="$spacing8">
      <Text variant="body1" color="$neutral2">
        Permissioned, non-custodial exchange for tokenized carbon assets.
      </Text>
      <Text variant="body1" color="$neutral2">
        Compliant on-chain trading of certified carbon credits.
      </Text>
      <Text variant="body1" color="$neutral2">
        Participation restricted to verified users and whitelisted wallets.
      </Text>
    </Flex>
  )

  return (
    <LandingSection variant="default">
      <SplitLayout>
        <SectionHeader title={t('landing.whatIsAgroswap.title')} description={description} />
        <CardsContainer>
          <InfoCard
            icon={
              <IconWrapper>
                <Lock size={24} />
              </IconWrapper>
            }
            title="Permissioned access"
            body="KYC and wallet whitelisting required for all participants."
          />
          <InfoCard
            icon={
              <IconWrapper>
                <Shield size={24} />
              </IconWrapper>
            }
            title="Non-custodial"
            body="Users maintain control of their assets with on-chain settlement."
          />
          <InfoCard
            icon={
              <IconWrapper>
                <CheckCircle size={24} />
              </IconWrapper>
            }
            title="Certified carbon only"
            body="Only carbon credits certified by recognized national or jurisdictional authorities."
          />
        </CardsContainer>
      </SplitLayout>
    </LandingSection>
  )
}
