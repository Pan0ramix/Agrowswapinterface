import { ReactNode } from 'react'
import { Flex, styled, Text } from 'ui/src'

interface SectionHeaderProps {
  kicker?: string
  title: string
  description?: string | ReactNode
}

const HeaderContainer = styled(Flex, {
  flexDirection: 'column',
  gap: '$spacing16',
  maxWidth: 800,
})

const DescriptionContainer = styled(Flex, {
  flexDirection: 'column',
  gap: '$spacing8',
})

export function SectionHeader({ kicker, title, description }: SectionHeaderProps): JSX.Element {
  return (
    <HeaderContainer>
      {kicker && (
        <Text variant="body2" color="$neutral2" fontWeight="$medium">
          {kicker}
        </Text>
      )}
      <Text variant="heading1" $md={{ variant: 'heading2' }}>
        {title}
      </Text>
      {description && (
        <DescriptionContainer>
          {typeof description === 'string' ? (
            <Text variant="body1" color="$neutral2" whiteSpace="pre-line">
              {description}
            </Text>
          ) : (
            description
          )}
        </DescriptionContainer>
      )}
    </HeaderContainer>
  )
}
