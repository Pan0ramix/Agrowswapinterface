import { LandingSection, SectionHeader, StepperCard } from 'pages/Landing/components'
import { CheckCircle, CheckSquare, FileText, Shield } from 'react-feather'
import { useTranslation } from 'react-i18next'
import { Button, Flex, styled, Text } from 'ui/src'

const ChecklistContainer = styled(Flex, {
  flexDirection: 'column',
  gap: '$spacing12',
  mb: '$spacing32',
})

const ChecklistItem = styled(Flex, {
  flexDirection: 'row',
  gap: '$spacing12',
  alignItems: 'flex-start',
  p: '$spacing16',
  backgroundColor: '$surface2',
  borderRadius: '$rounded12',
})

const IconWrapper = styled(Flex, {
  width: 20,
  height: 20,
  color: '$neutral1',
  flexShrink: 0,
  mt: 2,
})

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

const StepIconWrapper = styled(Flex, {
  width: 20,
  height: 20,
  color: '$neutral1',
})

export default function Projects(): JSX.Element {
  const { t } = useTranslation()

  const handleRequestOnboarding = () => {
    // TODO: Implement project onboarding flow
    console.log('Request project onboarding')
  }

  return (
    <Flex width="100%" minHeight="100vh" pt={80} pb={40}>
      <LandingSection variant="default">
        <Flex gap="$spacing40" flexDirection="column">
          <SectionHeader
            title="Tokenizing carbon projects on Agroswap"
            description="Projects must be certified in accordance with applicable national or jurisdictional law to be eligible for tokenization on Agroswap."
          />

          <Flex gap="$spacing32" flexDirection="column">
            <Text variant="heading2">Eligibility Requirements</Text>
            <ChecklistContainer>
              <ChecklistItem>
                <IconWrapper>
                  <CheckCircle size={20} />
                </IconWrapper>
                <Text variant="body2" color="$neutral2" flex={1}>
                  Valid certification issued by recognized authorities
                </Text>
              </ChecklistItem>
              <ChecklistItem>
                <IconWrapper>
                  <CheckCircle size={20} />
                </IconWrapper>
                <Text variant="body2" color="$neutral2" flex={1}>
                  Clear ownership and issuance rights
                </Text>
              </ChecklistItem>
              <ChecklistItem>
                <IconWrapper>
                  <CheckCircle size={20} />
                </IconWrapper>
                <Text variant="body2" color="$neutral2" flex={1}>
                  Compliance with applicable legal and regulatory requirements
                </Text>
              </ChecklistItem>
            </ChecklistContainer>

            <Text variant="heading2">Process</Text>
            <StepsContainer>
              <StepperCard
                stepNumber={1}
                totalSteps={4}
                icon={
                  <StepIconWrapper>
                    <FileText size={20} />
                  </StepIconWrapper>
                }
                title="Submit project information"
                body="Provide certification details, ownership documentation, and compliance information."
              />
              <StepperCard
                stepNumber={2}
                totalSteps={4}
                icon={
                  <StepIconWrapper>
                    <Shield size={20} />
                  </StepIconWrapper>
                }
                title="Compliance review"
                body="Agroswap reviews project documentation for compliance with applicable requirements."
              />
              <StepperCard
                stepNumber={3}
                totalSteps={4}
                icon={
                  <StepIconWrapper>
                    <CheckSquare size={20} />
                  </StepIconWrapper>
                }
                title="Tokenization setup"
                body="Upon approval, tokenization parameters are configured for on-chain representation."
              />
              <StepperCard
                stepNumber={4}
                totalSteps={4}
                icon={
                  <StepIconWrapper>
                    <CheckCircle size={20} />
                  </StepIconWrapper>
                }
                title="Market access"
                body="Tokenized carbon assets become available for trading on the Agroswap platform."
              />
            </StepsContainer>
          </Flex>

          <Flex alignSelf="flex-start" mt="$spacing16">
            <Button variant="branded" emphasis="primary" onPress={handleRequestOnboarding}>
              Request project onboarding
            </Button>
          </Flex>

          <Text variant="body3" color="$neutral2" fontStyle="italic">
            Submitting information does not guarantee acceptance. All projects are subject to compliance review.
          </Text>
        </Flex>
      </LandingSection>
    </Flex>
  )
}
