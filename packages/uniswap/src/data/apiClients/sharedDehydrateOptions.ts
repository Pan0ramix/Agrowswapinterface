import { defaultShouldDehydrateQuery } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { DISABLE_CACHE_PERSISTENCE_TO_DISK, ReactQueryCacheKey } from 'utilities/src/reactQuery/cache'

export const sharedDehydrateOptions: React.ComponentProps<
  typeof PersistQueryClientProvider
>['persistOptions']['dehydrateOptions'] = {
  shouldDehydrateQuery: (query) => {
    if (query.gcTime === 0) {
      // Do not persist queries that are not cached.
      return false
    }

    if (
      query.queryKey.length > 0 &&
      typeof query.queryKey[0] === 'string' &&
      DISABLE_CACHE_PERSISTENCE_TO_DISK.includes(query.queryKey[0] as ReactQueryCacheKey)
    ) {
      return false
    }

    const keyParts = Array.isArray(query.queryKey) ? query.queryKey : [query.queryKey]
    if (keyParts.includes(ReactQueryCacheKey.TradeService)) {
      return false
    }

    return defaultShouldDehydrateQuery(query)
  },
}
