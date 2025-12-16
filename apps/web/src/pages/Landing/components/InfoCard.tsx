import { ReactNode } from 'react'
import { Flex, styled, Text } from 'ui/src'

interface InfoCardProps {
  icon?: ReactNode
  title: string
  body: string
}

const Card = styled(Flex, {
  flexDirection: 'column',
  gap: '$spacing12',
  p: '$spacing20',
  backgroundColor: '$surface2',
  borderRadius: '$rounded20',
  flex: 1,
  minWidth: 280,
})

const IconContainer = styled(Flex, {
  width: 40,
  height: 40,
  borderRadius: '$rounded12',
  backgroundColor: '$surface3',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
})

export function InfoCard({ icon, title, body }: InfoCardProps): JSX.Element {
  return (
    <Card>
      {icon && <IconContainer>{icon}</IconContainer>}
      <Text variant="heading3" fontWeight="$medium">
        {title}
      </Text>
      <Text variant="body2" color="$neutral2">
        {body}
      </Text>
    </Card>
  )
}
