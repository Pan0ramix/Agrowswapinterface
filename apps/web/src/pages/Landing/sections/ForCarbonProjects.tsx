import { LandingSection, SectionHeader } from 'pages/Landing/components'
import { CheckCircle } from 'react-feather'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button, Flex, styled, Text } from 'ui/src'

const SplitLayout = styled(Flex, {
  flexDirection: 'row',
  gap: '$spacing32',
  alignItems: 'flex-start',
  $lg: {
    flexDirection: 'column',
    gap: '$spacing24',
  },
})

const ChecklistContainer = styled(Flex, {
  flexDirection: 'column',
  gap: '$spacing12',
  flex: 1,
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

const Description = (
  <Text variant="body1" color="$neutral2">
    Work with projects certified in accordance with applicable national or jurisdictional law.
  </Text>
)

export function ForCarbonProjects(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const handleTokenizeProject = () => {
    navigate('/projects')
  }

  return (
    <LandingSection variant="default">
      <SplitLayout>
        <SectionHeader title={t('landing.forProjects.title')} description={Description} />
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
          <Flex alignSelf="flex-start" mt="$spacing16">
            <Button variant="branded" emphasis="primary" onPress={handleTokenizeProject}>
              {t('landing.forProjects.button')}
            </Button>
          </Flex>
          <Text variant="body3" color="$neutral2" mt="$spacing8" fontStyle="italic">
            Submitting information does not guarantee acceptance. All projects are subject to compliance review.
          </Text>
        </ChecklistContainer>
      </SplitLayout>
    </LandingSection>
  )
}
