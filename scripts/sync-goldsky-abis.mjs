#!/usr/bin/env node

/**
 * ABI Sync Script for Goldsky Subgraph
 * 
 * Syncs ABIs from the contracts repo to the interface repo's agroswap-subgraph/abis/ directory.
 * Extracts only the ABI array from Hardhat artifacts and validates required events.
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONTRACTS_REPO = process.env.CONTRACTS_REPO;
const INTERFACE_REPO_ROOT = resolve(__dirname, '..');
const TARGET_ABI_DIR = join(INTERFACE_REPO_ROOT, 'agroswap-subgraph', 'abis');

// Contract mappings: artifact filename -> output filename -> validation rules
const CONTRACT_MAPPINGS = {
  'UniswapV3Factory.json': {
    output: 'UniswapV3Factory.json',
    requiredEvents: ['PoolCreated'], // Will match PoolCreated(address,address,uint24,int24,address)
  },
  'UniswapV3Pool.json': {
    output: 'UniswapV3Pool.json',
    requiredEvents: ['Swap', 'Mint', 'Burn', 'Collect'], // Event names only
  },
  'NonfungiblePositionManager.json': {
    output: 'NonfungiblePositionManager.json',
    requiredEvents: ['IncreaseLiquidity', 'DecreaseLiquidity', 'Collect', 'Transfer'], // Event names only
  },
  'UniswapV3Staker.json': {
    output: 'UniswapV3Staker.json',
    requiredEvents: [], // Skip validation - check if ABI has events
  },
};

// ERC20 minimal ABI (events only) - used as fallback
const ERC20_MINIMAL_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'owner', type: 'address' },
      { indexed: true, name: 'spender', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Approval',
    type: 'event',
  },
];

/**
 * Recursively find all files matching a pattern
 */
async function findFiles(dir, filename, visited = new Set()) {
  const results = [];
  const realPath = await stat(dir).then(s => s.isSymbolicLink() ? dir : dir).catch(() => null);
  
  if (!realPath || visited.has(realPath)) return results;
  visited.add(realPath);

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip node_modules and common build directories
        if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        const subResults = await findFiles(fullPath, filename, visited);
        results.push(...subResults);
      } else if (entry.isFile() && entry.name === filename) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    // Ignore permission errors
    if (err.code !== 'EACCES' && err.code !== 'EPERM') {
      console.warn(`Warning: Could not read directory ${dir}: ${err.message}`);
    }
  }
  
  return results;
}

/**
 * Find ERC20 artifact (try multiple names)
 */
async function findERC20Artifact(contractsRepo) {
  const erc20Names = ['FakeEURO.json', 'FakeUSDT.json', 'CPRVerde01.json', 'ERC20.json'];
  
  for (const name of erc20Names) {
    const files = await findFiles(contractsRepo, name);
    if (files.length > 0) {
      return files[0];
    }
  }
  
  return null;
}

/**
 * Load and validate Hardhat artifact
 */
async function loadArtifact(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    const artifact = JSON.parse(content);
    
    if (!artifact.abi || !Array.isArray(artifact.abi)) {
      throw new Error(`Invalid artifact: missing or invalid 'abi' field`);
    }
    
    return artifact.abi;
  } catch (err) {
    throw new Error(`Failed to load artifact ${filePath}: ${err.message}`);
  }
}

/**
 * Get event signature from ABI item
 */
function getEventSignature(event) {
  if (event.type !== 'event' || !event.name) return null;
  
  const params = (event.inputs || []).map(input => {
    const type = input.type || '';
    return type;
  }).join(',');
  
  return `${event.name}(${params})`;
}

/**
 * Validate ABI has required events
 */
function validateABI(abi, requiredEvents, contractName) {
  if (requiredEvents.length === 0) {
    // For contracts without specific requirements, just check if it has events
    const hasEvents = abi.some(item => item.type === 'event');
    if (!hasEvents) {
      console.warn(`Warning: ${contractName} ABI has no events (this may be expected)`);
    }
    return { valid: true, missing: [] };
  }
  
  const eventSignatures = new Set();
  abi.forEach(item => {
    if (item.type === 'event') {
      const sig = getEventSignature(item);
      if (sig) {
        eventSignatures.add(sig);
      }
    }
  });
  
  const missing = [];
  for (const required of requiredEvents) {
    // Extract event name from signature (e.g., "PoolCreated" from "PoolCreated(address,...)")
    const requiredName = required.split('(')[0];
    
    // Check for exact signature match or name match
    const found = Array.from(eventSignatures).some(sig => {
      const sigName = sig.split('(')[0];
      return sig === required || sigName === requiredName;
    });
    
    if (!found) {
      missing.push(required);
    }
  }
  
  return { valid: missing.length === 0, missing };
}

/**
 * Extract ERC20 ABI from artifact or use fallback
 */
async function extractERC20ABI(contractsRepo) {
  const erc20Path = await findERC20Artifact(contractsRepo);
  
  if (erc20Path) {
    console.log(`Found ERC20 artifact: ${erc20Path}`);
    const abi = await loadArtifact(erc20Path);
    
    // Filter to only Transfer and Approval events
    const erc20Events = abi.filter(item => 
      item.type === 'event' && 
      (item.name === 'Transfer' || item.name === 'Approval')
    );
    
    if (erc20Events.length >= 2) {
      return erc20Events;
    }
  }
  
  console.log('Using minimal ERC20 ABI (events only)');
  return ERC20_MINIMAL_ABI;
}

/**
 * Main sync function
 */
async function syncABIs() {
  // Validate CONTRACTS_REPO
  if (!CONTRACTS_REPO) {
    console.error('Error: CONTRACTS_REPO environment variable is required');
    console.error('Usage: CONTRACTS_REPO=/path/to/contracts pnpm sync:abis');
    process.exit(1);
  }
  
  const contractsRepo = resolve(CONTRACTS_REPO);
  
  try {
    const stats = await stat(contractsRepo);
    if (!stats.isDirectory()) {
      throw new Error('CONTRACTS_REPO is not a directory');
    }
  } catch (err) {
    console.error(`Error: Invalid CONTRACTS_REPO path: ${contractsRepo}`);
    console.error(`Details: ${err.message}`);
    process.exit(1);
  }
  
  console.log(`Contracts repo: ${contractsRepo}`);
  console.log(`Target ABI directory: ${TARGET_ABI_DIR}`);
  console.log('');
  
  const results = [];
  
  // Sync each contract
  for (const [artifactName, config] of Object.entries(CONTRACT_MAPPINGS)) {
    console.log(`Searching for ${artifactName}...`);
    
    const artifactFiles = await findFiles(contractsRepo, artifactName);
    
    if (artifactFiles.length === 0) {
      console.error(`Error: Could not find ${artifactName} in ${contractsRepo}`);
      process.exit(1);
    }
    
    const artifactPath = artifactFiles[0];
    if (artifactFiles.length > 1) {
      console.log(`Warning: Found multiple ${artifactName}, using: ${artifactPath}`);
    }
    
    console.log(`  Found: ${artifactPath}`);
    
    const abi = await loadArtifact(artifactPath);
    const validation = validateABI(abi, config.requiredEvents, config.output);
    
    if (!validation.valid) {
      console.error(`Error: ${config.output} is missing required events:`);
      validation.missing.forEach(event => console.error(`  - ${event}`));
      process.exit(1);
    }
    
    const outputPath = join(TARGET_ABI_DIR, config.output);
    const formattedABI = JSON.stringify(abi, null, 2);
    
    await writeFile(outputPath, formattedABI + '\n', 'utf-8');
    
    results.push({
      contract: config.output,
      source: artifactPath,
      output: outputPath,
      abiItems: abi.length,
      validation: '✅',
    });
    
    console.log(`  ✅ Written ${abi.length} ABI items to ${config.output}`);
  }
  
  // Handle ERC20 separately
  console.log('\nExtracting ERC20 ABI...');
  const erc20ABI = await extractERC20ABI(contractsRepo);
  const erc20Validation = validateABI(erc20ABI, ['Transfer', 'Approval'], 'ERC20.json');
  
  if (!erc20Validation.valid) {
    console.error('Error: ERC20 ABI is missing required events:');
    erc20Validation.missing.forEach(event => console.error(`  - ${event}`));
    process.exit(1);
  }
  
  const erc20OutputPath = join(TARGET_ABI_DIR, 'ERC20.json');
  const formattedERC20 = JSON.stringify(erc20ABI, null, 2);
  await writeFile(erc20OutputPath, formattedERC20 + '\n', 'utf-8');
  
  results.push({
    contract: 'ERC20.json',
    source: 'extracted or fallback',
    output: erc20OutputPath,
    abiItems: erc20ABI.length,
    validation: '✅',
  });
  
  console.log(`  ✅ Written ${erc20ABI.length} ABI items to ERC20.json`);
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Sync Summary');
  console.log('='.repeat(60));
  
  results.forEach(result => {
    console.log(`\n${result.contract}:`);
    console.log(`  Source: ${result.source}`);
    console.log(`  Output: ${result.output}`);
    console.log(`  ABI Items: ${result.abiItems}`);
    console.log(`  Validation: ${result.validation}`);
  });
  
  console.log('\n✅ All ABIs synced successfully!');
}

// Run the sync
syncABIs().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
