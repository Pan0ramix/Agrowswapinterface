import { InfoCard, LandingSection, SectionHeader } from 'pages/Landing/components'
import { CheckCircle, FileText } from 'react-feather'
import { useTranslation } from 'react-i18next'
import { Flex, styled, Text } from 'ui/src'

const IconWrapper = styled(Flex, {
  width: 24,
  height: 24,
  color: '$neutral1',
})

const NoteBlock = styled(Flex, {
  p: '$spacing16',
  backgroundColor: '$surface2',
  borderRadius: '$rounded12',
  borderWidth: 1,
  borderColor: '$surface3',
})

const BodyContent = (
  <Flex gap="$spacing12">
    <Text variant="body1" color="$neutral2">
      Projects certified by recognized national or jurisdictional certification bodies.
    </Text>
    <Text variant="body1" color="$neutral2">
      Traceable metadata: certification context, issuance parameters, retirement status.
    </Text>
  </Flex>
)

export function Certification(): JSX.Element {
  const { t } = useTranslation()

  return (
    <LandingSection variant="highlight">
      <Flex gap="$spacing32" flexDirection="column">
        <SectionHeader title={t('landing.certification.title')} description={BodyContent} />
        <NoteBlock>
          <Text variant="body2" color="$neutral2" fontStyle="italic">
            Agroswap does not certify projects or issue carbon credits.
          </Text>
        </NoteBlock>
        <Flex
          flexDirection="row"
          flexWrap="wrap"
          gap="$spacing16"
          $md={{
            flexDirection: 'column',
          }}
        >
          <InfoCard
            icon={
              <IconWrapper>
                <FileText size={24} />
              </IconWrapper>
            }
            title="Traceable metadata"
            body="Each asset includes certification context, issuance parameters, and retirement status."
          />
          <InfoCard
            icon={
              <IconWrapper>
                <CheckCircle size={24} />
              </IconWrapper>
            }
            title="Retirement status"
            body="On-chain tracking of credit retirement in accordance with applicable standards."
          />
        </Flex>
      </Flex>
    </LandingSection>
  )
}
