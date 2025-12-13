import { Web3Provider } from '@ethersproject/providers'
import { useAccount } from 'hooks/useAccount'
import { useMemo } from 'react'
import type { Chain, Client, Transport } from 'viem'
import { useClient, useConnectorClient } from 'wagmi'

const providers = new WeakMap<Client, Web3Provider>()

export function clientToProvider(client?: Client<Transport, Chain>, chainId?: number) {
  if (!client) {
    return undefined
  }
  const { chain, transport } = client

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const network = chain
    ? {
        chainId: chain.id,
        name: chain.name,
        ensAddress: chain.contracts?.ensRegistry?.address,
      }
    : chainId
      ? { chainId, name: 'Unsupported' }
      : undefined
  if (!network) {
    return undefined
  }

  if (providers.has(client)) {
    return providers.get(client)
  } else {
    const provider = new Web3Provider(transport, network)
    providers.set(client, provider)
    return provider
  }
}

/** Hook to convert a viem Client to an ethers.js Provider with a default disconnected Network fallback. */
export function useEthersProvider({ chainId }: { chainId?: number } = {}) {
  // Use safe account wrapper to avoid errors when wagmi store isn't ready
  // Note: We must call hooks unconditionally, but we can handle errors gracefully
  const account = useAccount()
  
  // These hooks might fail if wagmi store isn't ready, but we can't conditionally call them
  // If they fail, React will handle it via error boundary, or we return undefined
  const connectorClientResult = useConnectorClient({ chainId })
  const disconnectedClient = useClient({ chainId })
  
  const client = connectorClientResult.data
  const accountChainId = account?.chainId

  return useMemo(
    () => {
      // If we don't have a client, return undefined
      const effectiveClient = accountChainId !== chainId ? disconnectedClient : (client ?? disconnectedClient)
      return clientToProvider(effectiveClient, chainId)
    },
    // Always provide a consistent dependency array structure
    [accountChainId, chainId, client, disconnectedClient],
  )
}

/** Hook to convert a connected viem Client to an ethers.js Provider. */
export function useEthersWeb3Provider({ chainId }: { chainId?: number } = {}) {
  const { data: client } = useConnectorClient({ chainId })
  return useMemo(() => clientToProvider(client, chainId), [chainId, client])
}
