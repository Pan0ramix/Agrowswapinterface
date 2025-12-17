# Goldsky Subgraph Setup Guide for Agroswap

This guide explains how to set up a Goldsky subgraph for Agroswap factory contracts and integrate it with the frontend application.

## Table of Contents

1. [What is Goldsky?](#what-is-goldsky)
2. [Why Use Goldsky?](#why-use-goldsky)
3. [Prerequisites](#prerequisites)
4. [Setting Up Goldsky](#setting-up-goldsky)
5. [Creating the Subgraph](#creating-the-subgraph)
6. [Deploying the Subgraph](#deploying-the-subgraph)
7. [Code Integration](#code-integration)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)

---

## What is Goldsky?

Goldsky is a blockchain indexing service that provides fast, reliable subgraph infrastructure. It allows you to index on-chain events and data from smart contracts and query them using GraphQL.

## Why Use Goldsky?

- **Performance**: Much faster than on-chain queries, especially for historical data
- **Reliability**: Pre-indexed data reduces RPC load and improves user experience
- **Rich Queries**: GraphQL allows complex queries with filtering, sorting, and pagination
- **Real-time Updates**: Automatically syncs with new blocks
- **Cost-effective**: Reduces on-chain RPC calls

---

## Prerequisites

Before setting up Goldsky, ensure you have:

1. **Goldsky Account**: Sign up at [https://goldsky.com](https://goldsky.com)
2. **Subgraph Schema**: Understanding of the data structure you want to index
3. **Factory Contract Address**: Your Agroswap V3 factory contract address
4. **Network Access**: Access to the blockchain network (Base Sepolia, Base, etc.)

### Required Information

- **Factory Contract Address**: `0xB1285002ce1173097A7E2A1a0aCa00fBb436370d` (Base Sepolia)
- **Chain ID**: `84532` (Base Sepolia)
- **Network RPC**: Base Sepolia RPC endpoint

## ABI Management

**Important:** The ABIs in `agroswap-subgraph/abis/` are automatically synced from the contracts repository to prevent ABI drift.

### Syncing ABIs

Before deploying or updating the subgraph, sync ABIs from the contracts repo:

```bash
CONTRACTS_REPO=/absolute/path/to/DexAgroswapSmartContracts/Agroswap pnpm sync:abis
```

**Important:** Always use an absolute path for `CONTRACTS_REPO`.

The sync script:
- Extracts ABIs from Hardhat artifacts in the contracts repo
- Validates that required events exist
- Writes only the ABI array (Goldsky-friendly format) to `agroswap-subgraph/abis/`

See `agroswap-subgraph/GOLDSKY_SETUP.md` for detailed ABI sync documentation.

---

## Setting Up Goldsky

### Step 1: Create a Goldsky Account

1. Go to [https://goldsky.com](https://goldsky.com)
2. Sign up for an account
3. Verify your email address
4. Complete the onboarding process

### Step 2: Create a New Project

1. In the Goldsky dashboard, click **"New Project"**
2. Enter project details:
   - **Project Name**: `Agroswap`
   - **Description**: `Agroswap V3 Pool Indexing`
   - **Network**: Select your network (Base Sepolia, Base, etc.)

### Step 3: Get Your Project Credentials

After creating the project, you'll receive:
- **Project ID**: Used in API URLs
- **API Endpoint**: Your subgraph GraphQL endpoint
- **Deployment Key**: For deploying subgraphs

Save these credentials securely - you'll need them later.

---

## Creating the Subgraph

### Step 1: Install The Graph CLI

```bash
npm install -g @graphprotocol/graph-cli
```

Or using yarn:

```bash
yarn global add @graphprotocol/graph-cli
```

### Step 2: Initialize Subgraph

Create a new directory for your subgraph:

```bash
mkdir agroswap-subgraph
cd agroswap-subgraph
graph init --protocol uniswap-v3 \
  --product hosted-service \
  --from-contract <FACTORY_ADDRESS> \
  --network base-sepolia \
  --contract-name UniswapV3Factory \
  --index-events
```

Replace `<FACTORY_ADDRESS>` with your factory contract address.

### Step 3: Configure Subgraph Schema

Edit `schema.graphql` to define your data structure:

```graphql
type Pool @entity {
  id: ID! # Pool address
  token0: Token!
  token1: Token!
  fee: BigInt!
  feeTier: BigInt!
  tickSpacing: BigInt!
  liquidity: BigInt!
  sqrtPriceX96: BigInt!
  tick: BigInt!
  totalValueLockedUSD: BigDecimal!
  totalValueLockedToken0: BigDecimal!
  totalValueLockedToken1: BigDecimal!
  volumeUSD: BigDecimal!
  volume1DayUSD: BigDecimal!
  volume7DayUSD: BigDecimal!
  txCount: BigInt!
  createdAtTimestamp: BigInt!
  createdAtBlockNumber: BigInt!
}

type Token @entity {
  id: ID! # Token address
  symbol: String!
  name: String!
  decimals: BigInt!
  totalSupply: BigInt!
  pools: [Pool!]! @derivedFrom(field: "token0")
  poolsAsToken1: [Pool!]! @derivedFrom(field: "token1")
}

type PoolCreated @entity {
  id: ID!
  pool: Pool!
  token0: Token!
  token1: Token!
  fee: BigInt!
  tickSpacing: BigInt!
  timestamp: BigInt!
  blockNumber: BigInt!
}
```

### Step 4: Write Mapping Handlers

Edit `src/mapping.ts` to handle events:

```typescript
import { BigInt } from "@graphprotocol/graph-ts"
import { PoolCreated } from "../generated/UniswapV3Factory/UniswapV3Factory"
import { Pool, Token, PoolCreated as PoolCreatedEntity } from "../generated/schema"
import { UniswapV3Pool } from "../generated/templates"

export function handlePoolCreated(event: PoolCreated): void {
  // Create or load tokens
  let token0 = Token.load(event.params.token0.toHexString())
  if (token0 == null) {
    token0 = new Token(event.params.token0.toHexString())
    // Fetch token metadata (you may need to call contract)
    token0.symbol = ""
    token0.name = ""
    token0.decimals = BigInt.fromI32(18)
    token0.totalSupply = BigInt.fromI32(0)
    token0.save()
  }

  let token1 = Token.load(event.params.token1.toHexString())
  if (token1 == null) {
    token1 = new Token(event.params.token1.toHexString())
    token1.symbol = ""
    token1.name = ""
    token1.decimals = BigInt.fromI32(18)
    token1.totalSupply = BigInt.fromI32(0)
    token1.save()
  }

  // Create pool
  let pool = new Pool(event.params.pool.toHexString())
  pool.token0 = token0.id
  pool.token1 = token1.id
  pool.fee = event.params.fee
  pool.feeTier = event.params.fee
  pool.tickSpacing = event.params.tickSpacing
  pool.liquidity = BigInt.fromI32(0)
  pool.sqrtPriceX96 = BigInt.fromI32(0)
  pool.tick = BigInt.fromI32(0)
  pool.totalValueLockedUSD = BigDecimal.fromString("0")
  pool.totalValueLockedToken0 = BigDecimal.fromString("0")
  pool.totalValueLockedToken1 = BigDecimal.fromString("0")
  pool.volumeUSD = BigDecimal.fromString("0")
  pool.volume1DayUSD = BigDecimal.fromString("0")
  pool.volume7DayUSD = BigDecimal.fromString("0")
  pool.txCount = BigInt.fromI32(0)
  pool.createdAtTimestamp = event.block.timestamp
  pool.createdAtBlockNumber = event.block.number
  pool.save()

  // Create PoolCreated entity
  let poolCreated = new PoolCreatedEntity(event.transaction.hash.toHexString())
  poolCreated.pool = pool.id
  poolCreated.token0 = token0.id
  poolCreated.token1 = token1.id
  poolCreated.fee = event.params.fee
  poolCreated.tickSpacing = event.params.tickSpacing
  poolCreated.timestamp = event.block.timestamp
  poolCreated.blockNumber = event.block.number
  poolCreated.save()

  // Start indexing the pool contract
  UniswapV3Pool.create(event.params.pool)
}
```

### Step 5: Configure Subgraph Manifest

Edit `subgraph.yaml`:

```yaml
specVersion: 0.0.5
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum
    name: UniswapV3Factory
    network: base-sepolia
    source:
      address: "0xB1285002ce1173097A7E2A1a0aCa00fBb436370d"
      abi: UniswapV3Factory
      startBlock: <DEPLOYMENT_BLOCK> # Set to factory deployment block
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - Pool
        - Token
        - PoolCreated
      abis:
        - name: UniswapV3Factory
          file: ./abis/UniswapV3Factory.json
        - name: UniswapV3Pool
          file: ./abis/UniswapV3Pool.json
        - name: ERC20
          file: ./abis/ERC20.json
      eventHandlers:
        - event: PoolCreated(indexed address,indexed address,indexed uint24,int24,address)
          handler: handlePoolCreated
      file: ./src/mapping.ts

templates:
  - kind: ethereum
    name: UniswapV3Pool
    network: base-sepolia
    source:
      abi: UniswapV3Pool
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - Pool
        - Swap
      abis:
        - name: UniswapV3Pool
          file: ./abis/UniswapV3Pool.json
        - name: ERC20
          file: ./abis/ERC20.json
      eventHandlers:
        - event: Swap(indexed address,indexed address,int256,int256,uint160,uint128,int24)
          handler: handleSwap
      file: ./src/pool-mapping.ts
```

---

## Deploying the Subgraph

### Step 1: Authenticate with Goldsky

```bash
graph auth --studio <GOLDSKY_DEPLOY_KEY>
```

Replace `<GOLDSKY_DEPLOY_KEY>` with your deployment key from the Goldsky dashboard.

### Step 2: Build the Subgraph

```bash
graph codegen
graph build
```

### Step 3: Deploy to Goldsky

```bash
graph deploy \
  --studio <SUBGRAPH_NAME> \
  --ipfs https://api.studio.thegraph.com/ipfs/ \
  --node https://api.studio.thegraph.com/deploy/
```

Or use Goldsky's deployment endpoint:

```bash
graph deploy \
  --product hosted-service \
  <GOLDSKY_USERNAME>/<SUBGRAPH_NAME> \
  --ipfs <GOLDSKY_IPFS_ENDPOINT> \
  --node <GOLDSKY_NODE_ENDPOINT>
```

### Step 4: Get Your Subgraph URL

After deployment, Goldsky will provide you with a GraphQL endpoint URL:

```
https://api.goldsky.com/api/public/project/<PROJECT_ID>/subgraphs/<SUBGRAPH_NAME>/<VERSION>/gn
```

Save this URL - you'll need it for integration.

---

## Code Integration

### Step 1: Add Environment Variable

Add your Goldsky subgraph URL to your environment configuration:

**For `apps/web/.env` or `.env.local`:**

```bash
REACT_APP_AGROSWAP_BASE_SEPOLIA_SUBGRAPH_URL=https://api.goldsky.com/api/public/project/YOUR_PROJECT_ID/subgraphs/agroswap-base-sepolia/VERSION/gn
```

### Step 2: Update Configuration

Edit `packages/uniswap/src/data/rest/agroswapPools.ts`:

```typescript
// Change this flag to true when Goldsky is ready
const USE_SUBGRAPH = true // Changed from false

// Add subgraph URL configuration
const GOLDSKY_SUBGRAPH_URLS: Record<UniverseChainId, string | null> = {
  [UniverseChainId.BaseSepolia]: process.env.REACT_APP_AGROSWAP_BASE_SEPOLIA_SUBGRAPH_URL || null,
  // Add other chains as needed
} as Record<UniverseChainId, string | null>
```

### Step 3: Implement Subgraph Query Function

Edit `packages/uniswap/src/data/rest/agroswapPoolsOnChain.ts`:

Replace the placeholder `queryPoolsFromSubgraph` function:

```typescript
import { gql, request } from 'graphql-request'

const POOLS_QUERY = gql`
  query TopPools($first: Int!, $orderBy: String!, $orderDirection: String!) {
    pools(
      first: $first
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { liquidity_gt: "0" }
    ) {
      id
      token0 {
        id
        symbol
        name
        decimals
      }
      token1 {
        id
        symbol
        name
        decimals
      }
      fee
      feeTier
      tickSpacing
      liquidity
      sqrtPriceX96
      tick
      totalValueLockedUSD
      totalValueLockedToken0
      totalValueLockedToken1
      volumeUSD
      volume1DayUSD
      txCount
      createdAtTimestamp
    }
  }
`

export async function queryPoolsFromSubgraph(
  chainId: UniverseChainId,
): Promise<OnChainPoolData[]> {
  const subgraphUrl = GOLDSKY_SUBGRAPH_URLS[chainId]
  
  if (!subgraphUrl) {
    throw new Error(`Subgraph URL not configured for chain ${chainId}`)
  }

  try {
    const data = await request<{
      pools: Array<{
        id: string
        token0: {
          id: string
          symbol: string
          name: string
          decimals: string
        }
        token1: {
          id: string
          symbol: string
          name: string
          decimals: string
        }
        fee: string
        feeTier: string
        tickSpacing: string
        liquidity: string
        sqrtPriceX96: string
        tick: string
        totalValueLockedUSD: string
        volume1DayUSD: string
      }>
    }>(subgraphUrl, POOLS_QUERY, {
      first: 100, // Adjust as needed
      orderBy: 'totalValueLockedUSD',
      orderDirection: 'desc',
    })

    return data.pools.map((pool) => ({
      poolAddress: pool.id.toLowerCase(),
      token0: {
        address: pool.token0.id.toLowerCase(),
        symbol: pool.token0.symbol,
        name: pool.token0.name,
        decimals: parseInt(pool.token0.decimals),
        balance: '0', // Not needed from subgraph
      },
      token1: {
        address: pool.token1.id.toLowerCase(),
        symbol: pool.token1.symbol,
        name: pool.token1.name,
        decimals: parseInt(pool.token1.decimals),
        balance: '0', // Not needed from subgraph
      },
      fee: parseInt(pool.fee),
      feeTier: parseInt(pool.feeTier),
      tickSpacing: parseInt(pool.tickSpacing),
      sqrtPriceX96: pool.sqrtPriceX96,
      tick: parseInt(pool.tick),
      liquidity: pool.liquidity,
      tvlUSD: parseFloat(pool.totalValueLockedUSD) || 0,
      volume24hUSD: parseFloat(pool.volume1DayUSD) || 0,
    }))
  } catch (error) {
    console.error('Error querying subgraph:', error)
    throw error
  }
}
```

### Step 4: Install GraphQL Dependencies

If not already installed, add GraphQL client:

```bash
bun add graphql-request graphql
```

Or using npm:

```bash
npm install graphql-request graphql
```

### Step 5: Update Query Configuration

In `packages/uniswap/src/data/rest/agroswapPools.ts`, update the query key and stale time:

```typescript
return useQuery({
  queryKey: ['agroswap-pools', chainId, 'subgraph-v1.0.0'], // Update version
  enabled: isBaseSepolia && enabled,
  staleTime: 30 * 1000, // 30 seconds (subgraph is faster than on-chain)
  queryFn: async (): Promise<ExploreStatsResponse> => {
    // ... existing code
  },
})
```

---

## Testing

### Step 1: Test Subgraph Query

You can test your subgraph using the GraphQL playground:

1. Go to your Goldsky dashboard
2. Click on your subgraph
3. Open the GraphQL playground
4. Try a test query:

```graphql
{
  pools(
    first: 10
    orderBy: totalValueLockedUSD
    orderDirection: desc
    where: { liquidity_gt: "0" }
  ) {
    id
    token0 {
      symbol
      name
    }
    token1 {
      symbol
      name
    }
    totalValueLockedUSD
    volume1DayUSD
  }
}
```

### Step 2: Test Frontend Integration

1. Start your development server:
   ```bash
   bun web dev
   ```

2. Navigate to the "Top pools by TVL" section
3. Verify pools are loading from the subgraph
4. Check browser console for any errors

### Step 3: Verify Data Accuracy

Compare subgraph data with on-chain data:
- Pool addresses should match
- Token information should be correct
- TVL and volume should be reasonable

---

## Troubleshooting

### Issue: Subgraph Not Syncing

**Symptoms**: No pools appearing in queries

**Solutions**:
1. Check if subgraph is synced in Goldsky dashboard
2. Verify start block is correct in `subgraph.yaml`
3. Check if factory contract address is correct
4. Review subgraph logs in Goldsky dashboard

### Issue: Missing Token Data

**Symptoms**: Token symbols/names are empty

**Solutions**:
1. Ensure ERC20 ABI is included in subgraph
2. Add token metadata fetching in mapping handlers
3. Consider using a token list as fallback

### Issue: Incorrect TVL/Volume

**Symptoms**: TVL or volume values seem wrong

**Solutions**:
1. Verify price oracle integration in subgraph
2. Check if swap events are being indexed correctly
3. Ensure calculations in mapping handlers are correct

### Issue: GraphQL Query Errors

**Symptoms**: Frontend shows GraphQL errors

**Solutions**:
1. Verify subgraph URL is correct in environment variables
2. Check GraphQL query syntax matches subgraph schema
3. Ensure all required fields are requested
4. Check CORS settings in Goldsky dashboard

### Issue: Slow Queries

**Solutions**:
1. Add pagination to queries (use `first` parameter)
2. Add filters to reduce result set
3. Use indexed fields for filtering
4. Consider caching query results

---

## Next Steps

After successful integration:

1. **Monitor Performance**: Track query times and optimize as needed
2. **Add More Chains**: Extend to other networks (Base, etc.)
3. **Enhance Schema**: Add more fields as needed (APR, fees, etc.)
4. **Add Caching**: Implement client-side caching for better performance
5. **Set Up Alerts**: Configure alerts in Goldsky for sync issues

---

## Additional Resources

- [Goldsky Documentation](https://docs.goldsky.com)
- [The Graph Documentation](https://thegraph.com/docs/)
- [GraphQL Best Practices](https://graphql.org/learn/best-practices/)
- [Uniswap V3 Subgraph Example](https://github.com/Uniswap/v3-subgraph)

---

## Support

If you encounter issues:

1. Check Goldsky dashboard for subgraph status
2. Review subgraph logs for errors
3. Verify contract addresses and network configuration
4. Consult Goldsky support or documentation

---

**Last Updated**: 2025-01-15
**Version**: 1.0.0



