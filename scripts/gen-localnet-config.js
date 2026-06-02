#!/usr/bin/env node

/**
 * Generate config/localnet.json for a fresh Hardhat deployment.
 *
 * Address / start-block sources, in precedence order (first wins):
 *   1. explicit env vars — EVMAI_AGENT_ADDRESS, EVMAI_AGENT_ESCROW_ADDRESS, START_BLOCK
 *   2. ADDRESSES_FILE — path to the canonical flat addresses.json the e2e
 *      orchestrator (sense-ai-e2e) writes, e.g.
 *      { "chainId": 31337, "ABLE": "0x..", "EVMAIAgent": "0x..", "EVMAIAgentEscrow": "0x.." }
 *   3. Hardhat deterministic defaults (a Warning is logged whenever a default is used)
 *
 * Writes to config/localnet.json.
 *
 * Usage:
 *   node scripts/gen-localnet-config.js
 *   EVMAI_AGENT_ADDRESS=0x... EVMAI_AGENT_ESCROW_ADDRESS=0x... START_BLOCK=100 node scripts/gen-localnet-config.js
 *   ADDRESSES_FILE=/abs/path/addresses.json node scripts/gen-localnet-config.js
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

// Optional canonical source: a flat addresses.json written by the e2e
// orchestrator (sense-ai-e2e). Explicit env vars still take precedence, so a
// one-off override works without editing the file.
let fileAddrs = {};
const addressesFile = process.env.ADDRESSES_FILE;
if (addressesFile) {
  try {
    fileAddrs = JSON.parse(fs.readFileSync(addressesFile, 'utf8'));
  } catch (err) {
    console.error(`Error reading ADDRESSES_FILE (${addressesFile}): ${err.message}`);
    process.exit(1);
  }
}

const agentAddress =
  process.env.EVMAI_AGENT_ADDRESS || fileAddrs.EVMAIAgent || DEFAULT_AGENT_ADDRESS;
const escrowAddress =
  process.env.EVMAI_AGENT_ESCROW_ADDRESS || fileAddrs.EVMAIAgentEscrow || DEFAULT_ESCROW_ADDRESS;
const startBlock = parseInt(
  process.env.START_BLOCK || fileAddrs.startBlock || DEFAULT_START_BLOCK,
  10,
);

// A missing input must never silently masquerade as success: warn loudly when
// an address falls all the way back to a hardcoded Hardhat default.
if (!process.env.EVMAI_AGENT_ADDRESS && !fileAddrs.EVMAIAgent) {
  console.warn(
    `Warning: EVMAIAgent address not supplied (env or ADDRESSES_FILE) — using Hardhat default ${DEFAULT_AGENT_ADDRESS}`,
  );
}
if (!process.env.EVMAI_AGENT_ESCROW_ADDRESS && !fileAddrs.EVMAIAgentEscrow) {
  console.warn(
    `Warning: EVMAIAgentEscrow address not supplied (env or ADDRESSES_FILE) — using Hardhat default ${DEFAULT_ESCROW_ADDRESS}`,
  );
}

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
