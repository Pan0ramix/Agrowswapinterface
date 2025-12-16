import { Certification } from 'pages/Landing/sections/Certification'
import { Compliance } from 'pages/Landing/sections/Compliance'
import { FinalCTA } from 'pages/Landing/sections/FinalCTA'
import { Footer } from 'pages/Landing/sections/Footer'
import { ForCarbonProjects } from 'pages/Landing/sections/ForCarbonProjects'
import { GlobalParticipation } from 'pages/Landing/sections/GlobalParticipation'
import { HowItWorks } from 'pages/Landing/sections/HowItWorks'
import { WhatIsAgroswap } from 'pages/Landing/sections/WhatIsAgroswap'
import { WhoUsesAgroswap } from 'pages/Landing/sections/WhoUsesAgroswap'
import { WhyCarbonMarkets } from 'pages/Landing/sections/WhyCarbonMarkets'
import { forwardRef } from 'react'
import { Flex } from 'ui/src'

const Fold = forwardRef<HTMLDivElement>(function Fold(_props, scrollAnchor) {
  return (
    <Flex
      gap={120}
      $sm={{ gap: 80 }}
      position="relative"
      alignItems="center"
      width="100%"
      zIndex={1}
      maxWidth="100vw"
      ref={scrollAnchor}
    >
      <WhatIsAgroswap />
      <WhyCarbonMarkets />
      <HowItWorks />
      <Compliance />
      <Certification />
      <GlobalParticipation />
      <WhoUsesAgroswap />
      <ForCarbonProjects />
      <FinalCTA />
      <Footer />
    </Flex>
  )
})

export default Fold
