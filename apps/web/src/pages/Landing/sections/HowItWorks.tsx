import { LandingSection, SectionHeader, StepperCard } from 'pages/Landing/components'
import { CheckSquare, Layers, TrendingUp, User } from 'react-feather'
import { useTranslation } from 'react-i18next'
import { Flex, styled } from 'ui/src'

const StepsContainer = styled(Flex, {
  flexDirection: 'column',
  gap: '$spacing16',
  $lg: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  $md: {
    flexDirection: 'column',
  },
})

const IconWrapper = styled(Flex, {
  width: 20,
  height: 20,
  color: '$neutral1',
})

export function HowItWorks(): JSX.Element {
  const { t } = useTranslation()

  return (
    <LandingSection variant="default">
      <Flex gap="$spacing32" flexDirection="column">
        <SectionHeader title={t('landing.howItWorks.title')} />
        <StepsContainer>
          <StepperCard
            stepNumber={1}
            totalSteps={4}
            icon={
              <IconWrapper>
                <Layers size={20} />
              </IconWrapper>
            }
            title={t('landing.howItWorks.step1.title')}
            body={t('landing.howItWorks.step1.body')}
          />
          <StepperCard
            stepNumber={2}
            totalSteps={4}
            icon={
              <IconWrapper>
                <User size={20} />
              </IconWrapper>
            }
            title={t('landing.howItWorks.step2.title')}
            body={t('landing.howItWorks.step2.body')}
          />
          <StepperCard
            stepNumber={3}
            totalSteps={4}
            icon={
              <IconWrapper>
                <TrendingUp size={20} />
              </IconWrapper>
            }
            title={t('landing.howItWorks.step3.title')}
            body={t('landing.howItWorks.step3.body')}
          />
          <StepperCard
            stepNumber={4}
            totalSteps={4}
            icon={
              <IconWrapper>
                <CheckSquare size={20} />
              </IconWrapper>
            }
            title={t('landing.howItWorks.step4.title')}
            body={t('landing.howItWorks.step4.body')}
          />
        </StepsContainer>
      </Flex>
    </LandingSection>
  )
}
