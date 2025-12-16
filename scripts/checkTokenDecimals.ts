#!/usr/bin/env ts-node
/**
 * Token Decimals Verification Script
 * 
 * Checks on-chain decimals for FEUR and FUSDT tokens on Base Sepolia
 * to verify they match UI metadata.
 * 
 * Usage:
 *   CHAIN_ID=84532 pnpm ts-node scripts/checkTokenDecimals.ts
 */

import { createPublicClient, http, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'

// ERC20 ABI
const ERC20_ABI = [
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'name',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

interface TokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
  uiDecimals: number
  match: boolean
}

async function checkTokenDecimals(
  publicClient: ReturnType<typeof createPublicClient>,
  address: string,
  uiDecimals: number,
): Promise<TokenInfo> {
  const [symbol, decimals, name] = await Promise.all([
    publicClient.readContract({
      address: address as Address,
      abi: ERC20_ABI,
      functionName: 'symbol',
    }),
    publicClient.readContract({
      address: address as Address,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }),
    publicClient.readContract({
      address: address as Address,
      abi: ERC20_ABI,
      functionName: 'name',
    }),
  ])

  const onChainDecimals = Number(decimals)
  const match = onChainDecimals === uiDecimals

  return {
    address,
    symbol,
    name,
    decimals: onChainDecimals,
    uiDecimals,
    match,
  }
}

async function main() {
  const chainId = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : 84532

  if (chainId !== 84532) {
    console.error('Error: This script is designed for Base Sepolia (chainId 84532)')
    process.exit(1)
  }

  // Create public client
  const rpcUrl = 'https://sepolia.base.org'
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  })

  // Token addresses and UI decimals from base-sepolia.ts
  const tokens = [
    {
      address: '0xe0671aA8Ec0523f5b9247E51bF41e42AcC85ccfe',
      symbol: 'FEUR',
      uiDecimals: 18,
    },
    {
      address: '0xf4094ba16Bc9Ee080a8bFb201bCCC3cc23892C7B',
      symbol: 'FUSDT',
      uiDecimals: 6,
    },
  ]

  console.log('='.repeat(80))
  console.log('TOKEN DECIMALS VERIFICATION')
  console.log('='.repeat(80))
  console.log(`Chain: Base Sepolia (${chainId})`)
  console.log(`RPC: ${rpcUrl}\n`)

  const results: TokenInfo[] = []

  for (const token of tokens) {
    console.log(`Checking ${token.symbol} (${token.address})...`)
    try {
      const info = await checkTokenDecimals(publicClient, token.address, token.uiDecimals)
      results.push(info)

      console.log(`  On-chain decimals: ${info.decimals}`)
      console.log(`  UI metadata decimals: ${info.uiDecimals}`)
      console.log(`  Match: ${info.match ? '✅ YES' : '❌ NO'}`)
      if (!info.match) {
        console.log(`  ⚠️  MISMATCH DETECTED!`)
        console.log(`     This will cause amounts to be off by ${10 ** Math.abs(info.decimals - info.uiDecimals)}x`)
      }
      console.log(`  Symbol: ${info.symbol}`)
      console.log(`  Name: ${info.name}`)
      console.log()
    } catch (error) {
      console.error(`  ❌ Error checking ${token.symbol}:`, error)
      console.log()
    }
  }

  console.log('='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))
  const mismatches = results.filter((r) => !r.match)
  if (mismatches.length === 0) {
    console.log('✅ All token decimals match UI metadata')
  } else {
    console.log(`❌ Found ${mismatches.length} mismatch(es):`)
    for (const token of mismatches) {
      console.log(`  - ${token.symbol}: on-chain=${token.decimals}, UI=${token.uiDecimals}`)
    }
  }
  console.log('='.repeat(80))
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})




