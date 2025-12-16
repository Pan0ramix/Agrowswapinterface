import { useTranslation } from 'react-i18next'
import { Flex, Text } from 'ui/src'

export default function RequestAccess(): JSX.Element {
  const { t } = useTranslation()

  return (
    <Flex width="100%" minHeight="100vh" alignItems="center" justifyContent="center" p={40} gap="$spacing24">
      <Text variant="heading1">Request Access</Text>
      <Text variant="body1" color="$neutral2" textAlign="center" maxWidth={600}>
        This page is under development. Please check back soon.
      </Text>
    </Flex>
  )
}
