#!/usr/bin/env node

/**
 * Generate config/localnet.json from environment variables.
 *
 * Reads contract addresses and start block from env vars (all optional —
 * Hardhat deterministic defaults are used when unset):
 * - EVMAI_AGENT_ADDRESS: EVMAIAgent proxy address
 * - EVMAI_AGENT_ESCROW_ADDRESS: EVMAIAgentEscrow proxy address
 * - START_BLOCK: Block height at which to start indexing (default: 0)
 *
 * Writes to config/localnet.json.
 *
 * Usage:
 *   node scripts/gen-localnet-config.js
 *   # or with explicit env vars:
 *   EVMAI_AGENT_ADDRESS=0x... EVMAI_AGENT_ESCROW_ADDRESS=0x... START_BLOCK=100 node scripts/gen-localnet-config.js
 */

const fs = require('fs');
const path = require('path');

// Default addresses (Hardhat deterministic addresses from tokenized-ai-agent
// deployments — AbleToken first, then EVMAIAgent, then EVMAIAgentEscrow; see
// tokenized-ai-agent/docs/LOCALNET_SETUP.md). These MUST match the committed
// config/localnet.json so a no-env run does not corrupt it.
const DEFAULT_AGENT_ADDRESS = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const DEFAULT_ESCROW_ADDRESS = '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707';
const DEFAULT_START_BLOCK = 0;

const agentAddress = process.env.EVMAI_AGENT_ADDRESS || DEFAULT_AGENT_ADDRESS;
const escrowAddress = process.env.EVMAI_AGENT_ESCROW_ADDRESS || DEFAULT_ESCROW_ADDRESS;
const startBlock = parseInt(process.env.START_BLOCK || DEFAULT_START_BLOCK, 10);

// Validate addresses
if (!agentAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
  console.error(`Error: Invalid EVMAI_AGENT_ADDRESS format: ${agentAddress}`);
  process.exit(1);
}

if (!escrowAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
  console.error(`Error: Invalid EVMAI_AGENT_ESCROW_ADDRESS format: ${escrowAddress}`);
  process.exit(1);
}

if (isNaN(startBlock) || startBlock < 0) {
  console.error(`Error: Invalid START_BLOCK (must be non-negative integer): ${process.env.START_BLOCK}`);
  process.exit(1);
}

const config = {
  network: 'mainnet',
  EVMAIAgent: {
    address: agentAddress,
    startBlock: startBlock,
  },
  EVMAIAgentEscrow: {
    address: escrowAddress,
    startBlock: startBlock,
  },
};

const configPath = path.join(__dirname, '..', 'config', 'localnet.json');

try {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`Generated ${configPath}`);
  console.log(`  EVMAIAgent: ${agentAddress}`);
  console.log(`  EVMAIAgentEscrow: ${escrowAddress}`);
  console.log(`  startBlock: ${startBlock}`);
} catch (err) {
  console.error(`Error writing config: ${err.message}`);
  process.exit(1);
}
