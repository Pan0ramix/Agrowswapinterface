import { ReactNode } from 'react'
import { Flex, styled, Text } from 'ui/src'

interface StepperCardProps {
  stepNumber: number
  totalSteps: number
  icon?: ReactNode
  title: string
  body: string
}

const Card = styled(Flex, {
  flexDirection: 'row',
  gap: '$spacing16',
  p: '$spacing20',
  backgroundColor: '$surface2',
  borderRadius: '$rounded20',
  flex: 1,
  minWidth: 280,
  $md: {
    flexDirection: 'column',
  },
})

const StepBadge = styled(Flex, {
  width: 40,
  height: 40,
  borderRadius: '$roundedFull',
  backgroundColor: '$surface3',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
})

const ContentContainer = styled(Flex, {
  flexDirection: 'column',
  gap: '$spacing8',
  flex: 1,
})

const IconContainer = styled(Flex, {
  width: 32,
  height: 32,
  borderRadius: '$rounded8',
  backgroundColor: '$surface3',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
})

export function StepperCard({ stepNumber, totalSteps, icon, title, body }: StepperCardProps): JSX.Element {
  return (
    <Card>
      <StepBadge>
        <Text variant="buttonLabel2" color="$neutral2">
          {stepNumber.toString().padStart(2, '0')}
        </Text>
      </StepBadge>
      {icon && <IconContainer>{icon}</IconContainer>}
      <ContentContainer>
        <Text variant="heading3" fontWeight="$medium">
          {title}
        </Text>
        <Text variant="body2" color="$neutral2">
          {body}
        </Text>
      </ContentContainer>
    </Card>
  )
}
