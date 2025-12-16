import { parseToRgb } from 'polished'
import { ReactNode } from 'react'
import { Flex, styled, useSporeColors } from 'ui/src'

interface LandingSectionProps {
  variant?: 'default' | 'highlight' | 'cta'
  children: ReactNode
}

const Container = styled(Flex, {
  width: '100%',
  maxWidth: 1360,
  alignItems: 'center',
  p: 40,

  $lg: {
    p: 48,
  },

  $sm: {
    p: 24,
  },
})

const SectionContentBase = styled(Flex, {
  width: '100%',
  maxWidth: 1280,
  flexDirection: 'column',
})

const SectionContentHighlight = styled(SectionContentBase, {
  backgroundColor: '$surface1',
  borderRadius: '$rounded24',
  p: '$spacing32',
  position: 'relative',
  overflow: 'hidden',
})

const SectionContentCTA = styled(SectionContentBase, {
  backgroundColor: '$surface3',
  borderRadius: '$rounded24',
  p: '$spacing40',
  alignItems: 'center',
})

export function LandingSection({ variant = 'default', children }: LandingSectionProps): JSX.Element {
  const colors = useSporeColors()
  const { red, green, blue } = parseToRgb(colors.neutral2.val)

  const gradientOverlay =
    variant === 'highlight' || variant === 'cta'
      ? {
          backgroundImage: `radial-gradient(rgba(${red}, ${green}, ${blue}, 0.25) 0.5px, transparent 0)`,
          backgroundSize: '12px 12px',
          backgroundPosition: '-8.5px -8.5px',
          position: 'absolute' as const,
          inset: 0,
          pointerEvents: 'none' as const,
        }
      : undefined

  const SectionContent =
    variant === 'highlight' ? SectionContentHighlight : variant === 'cta' ? SectionContentCTA : SectionContentBase

  return (
    <Container>
      <SectionContent position="relative">
        {gradientOverlay && <Flex style={gradientOverlay} />}
        <Flex position="relative" zIndex={1} width="100%">
          {children}
        </Flex>
      </SectionContent>
    </Container>
  )
}
