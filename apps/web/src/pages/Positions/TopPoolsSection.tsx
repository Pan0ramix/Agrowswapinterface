import { LoadingRow } from 'components/Liquidity/Loader'
import { LoadingRows } from 'components/Loader/styled'
import { TopPoolsCard } from 'pages/Positions/TopPoolsCard'
import { PoolStat } from 'state/explore/types'
import { Flex, Text } from 'ui/src'

export function TopPoolsSection({
  pools,
  title,
  isLoading,
  showEmptyState,
}: {
  pools: PoolStat[]
  title: string
  isLoading: boolean
  showEmptyState?: boolean
}) {
  if (isLoading) {
    return (
      <Flex gap="$gap20">
        <Text variant="subheading1">{title}</Text>
        <LoadingRows>
          <LoadingRow />
          <LoadingRow />
          <LoadingRow />
          <LoadingRow />
          <LoadingRow />
          <LoadingRow />
        </LoadingRows>
      </Flex>
    )
  }

  const hasPools = pools && pools.length > 0

  return (
    <Flex gap="$gap20">
      <Text variant="subheading1">{title}</Text>
      {hasPools ? (
        <Flex gap="$gap12">
          {pools.slice(0, 6).map((pool) => {
            return <TopPoolsCard key={pool.id} pool={pool} />
          })}
        </Flex>
      ) : showEmptyState ? (
        <Flex gap="$gap8" p="$padding16" backgroundColor="$surface2" borderRadius="$rounded12">
          <Text variant="body3" color="$neutral2">
            No pools found.
          </Text>
        </Flex>
      ) : null}
    </Flex>
  )
}
