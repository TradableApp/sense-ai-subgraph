# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Graph subgraph for indexing SenseAI on-chain data. Provides a GraphQL API for querying blockchain events and state related to the SenseAI protocol (deployed on Base). Written in AssemblyScript.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run config:localnet` | Generate config/localnet.json from env vars (see below) |
| `npm run prepare:localnet` | Generate subgraph.yaml for local network |
| `npm run prepare:testnet` | Generate subgraph.yaml for Base Sepolia testnet |
| `npm run prepare:mainnet` | Generate subgraph.yaml for Base mainnet |
| `npm run codegen` | Generate AssemblyScript types from schema |
| `npm run build` | Build the subgraph |
| `npm run create-local` | Create subgraph on local Graph node |
| `npm run remove-local` | Remove subgraph from local Graph node |
| `npm run deploy-local` | Prepare + codegen + build + deploy locally |
| `npm run deploy:testnet` | Deploy to The Graph Studio (testnet) |
| `npm run deploy:mainnet` | Deploy to The Graph Studio (mainnet) |
| `npm run test` | Run all subgraph tests (matchstick-as) |

There is no single-test command — `graph test` runs all tests via matchstick-as.

**Required order for any schema or ABI change:**
```
npm run prepare:<network> && npm run codegen && npm run build
```

### Localnet Config Regeneration

The `config/localnet.json` file is regenerable from environment variables. Use this when deploying to a fresh Hardhat node with new contract addresses:

```bash
# Regenerate config with default addresses (Hardhat deterministic)
npm run config:localnet

# Regenerate with custom contract addresses
EVMAI_AGENT_ADDRESS=0x... EVMAI_AGENT_ESCROW_ADDRESS=0x... START_BLOCK=100 npm run config:localnet
```

Environment variables (all optional, defaults provided):
- `EVMAI_AGENT_ADDRESS`: EVMAIAgent proxy address (default: `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`)
- `EVMAI_AGENT_ESCROW_ADDRESS`: EVMAIAgentEscrow proxy address (default: `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707`)
- `START_BLOCK`: Block height to start indexing from (default: `0`)

The generator (`scripts/gen-localnet-config.js`) validates address format and block number before writing.

## Architecture

### Two contract data sources

`subgraph.template.yaml` defines two Ethereum data sources that feed into a single GraphQL schema:

- **EVMAIAgent** (`src/evmai-agent.ts`) — chat and conversation logic: conversations, messages, search deltas, prompt requests, branching, metadata updates
- **EVMAIAgentEscrow** (`src/evmai-agent-escrow.ts`) — financial logic: payments (escrow lifecycle), spending limits (per-user plans), prompt cancellations

Both handlers write to the shared `Activity` entity to produce a unified audit log.

### Multi-network config

`subgraph.yaml` is generated (not hand-edited) from `subgraph.template.yaml` + a Mustache config:

| File | Network |
|------|---------|
| `config/localnet.json` | Local Graph node |
| `config/base-testnet.json` | Base Sepolia (current testnet deployment) |
| `config/base-mainnet.json` | Base mainnet |

Contract addresses and `startBlock` values live in these config files.

### Schema entity relationships

```
Conversation (mutable)
  ├── messages: [Message] (immutable)
  │     └── searchDelta: SearchDelta (immutable, optional)
  ├── promptRequests: [PromptRequest] (mutable)
  └── branchedFrom: Conversation (optional)

Payment (mutable) — keyed by escrowId
SpendingLimit (mutable) — keyed by user address (one per user)
Activity (immutable) — keyed by txHash-logIndex
```

### Key design invariants

- **`PromptRequest.id` = `answerMessageId`** — this is the only ID available at cancellation time, so it's used as the primary key instead of `promptMessageId`. The escrowId also maps to `answerMessageId`, enabling cross-referencing between the two contracts.
- **`Conversation.lastMessageCreatedAt` is bumped on any state change** (new message, cancellation, refund, metadata update) so the sync service always picks up the change.
- **`Activity` is the unified audit trail** — every billable user action creates one. `amount` is negative for costs and positive for refunds (in wei). Types: `CONVERSATION`, `BRANCH`, `CANCEL`, `REFUND`, `PLAN_UPDATE`, `PLAN_REVOKE`, `METADATA_UPDATE`.
- **`createActivity()` is duplicated** in both mapping files — this is intentional due to AssemblyScript's lack of cross-file shared helpers in The Graph's module system.
- **Fees are read from contract state at index time** (e.g., `escrow.branchFee()`, `contract.cancellationFee()`) so the Activity reflects the actual fee charged.

### Testing

Tests use `matchstick-as` (The Graph's unit testing framework). Test files live in `tests/`:
- `evmai-agent.test.ts` — handler tests using mock events
- `evmai-agent-utils.ts` — mock event factory helpers

### Event → Handler Map

| Event | Contract | Handler | Key Side Effect |
|-------|----------|---------|----------------|
| `ConversationAdded` | EVMAIAgent | `handleConversationAdded` | Creates `Conversation` entity |
| `PromptSubmitted` | EVMAIAgent | `handlePromptSubmitted` | Creates `PromptRequest` (id = `answerMessageId`) + `Message` |
| `AnswerMessageAdded` | EVMAIAgent | `handleAnswerMessageAdded` | Updates `PromptRequest.isAnswered = true`; creates answer `Message` |
| `PromptCancelled` | EVMAIAgent | `handlePromptCancelled` (Agent) | Sets `PromptRequest.isCancelled = true` |
| `PromptCancelled` | EVMAIAgentEscrow | `handlePromptCancelled` (Escrow) | Creates `Activity` only — does NOT touch `PromptRequest` |
| `PaymentEscrowed` | EVMAIAgentEscrow | `handlePaymentEscrowed` | Creates `Payment` (id = `answerMessageId`) |
| `PaymentFinalized` | EVMAIAgentEscrow | `handlePaymentFinalized` | Sets `PromptRequest.isAnswered = true`; finalises `Payment` |
| `PaymentRefunded` | EVMAIAgentEscrow | `handlePaymentRefunded` | Sets `PromptRequest.isRefunded = true`; updates `Payment` |
| `SpendingLimitSet` | EVMAIAgentEscrow | `handleSpendingLimitSet` | Upserts `SpendingLimit` (id = user address) |
| `SpendingLimitCancelled` | EVMAIAgentEscrow | `handleSpendingLimitCancelled` | `store.remove('SpendingLimit', userAddress)` |
| `BranchRequested` | EVMAIAgent | `handleBranchRequested` | Creates branched `Conversation`; reads `escrow.branchFee()` for Activity |
| `MetadataUpdateRequested` | EVMAIAgent | `handleMetadataUpdateRequested` | Updates `Conversation` metadata; reads `escrow.metadataUpdateFee()` |

### `isDeleted` Invariant

`Conversation.isDeleted` is **never set to `true`** by any subgraph handler. Soft-delete is handled by the dApp at the CID level — the contract emits a metadata update with a deletion flag encoded in the CID, which the dApp interprets locally. The `isDeleted: false` filter in `sense-ai-dapp` queries is a permanent no-op (always matches). This is intentional by design, not a bug.

## Cross-Repo Context

| Sibling | Relationship |
|---------|-------------|
| `tokenized-ai-agent` | Source of truth for contract events; `abis/` must match compiled artifacts from this repo |
| `sense-ai-dapp` | Consumes this subgraph's GraphQL API for all read queries; writes go directly to contracts |
| `able-contracts` | AbleToken events are not currently indexed by this subgraph |

### ABI Sync

ABIs in `abis/` are copied from `tokenized-ai-agent/artifacts/contracts/`. When contracts change:

```bash
# In tokenized-ai-agent root
npm run compile

# Copy updated ABIs here
cp artifacts/contracts/EVMAIAgent.sol/EVMAIAgent.json ../sense-ai-subgraph/abis/
cp artifacts/contracts/EVMAIAgentEscrow.sol/EVMAIAgentEscrow.json ../sense-ai-subgraph/abis/

# Then regenerate
npm run prepare:testnet && npm run codegen && npm run build
```

**ABI Status (as of 29 May 2026):**
- `abis/EVMAIAgent.json`: In sync with `tokenized-ai-agent` (event list verified)
- `abis/EVMAIAgentEscrow.json`: In sync with `tokenized-ai-agent` (event list verified)

Stale ABIs will cause mismatched event fingerprints and silent indexing failures.

### Deployed Addresses (Base Sepolia)

| Contract | Proxy Address |
|----------|--------------|
| EVMAIAgent | `0x4a0C7e5807f9174499a8F56F2C69c61b39a4c64D` |
| EVMAIAgentEscrow | `0x36ec08471F2b995024967204D7542713cFaf5Fa4` |

These must match `config/base-testnet.json`. The `startBlock` in that config must be ≤ the block the proxy contracts were first deployed at.

### dApp Polling Pattern

`sense-ai-dapp` uses TanStack Query to poll this subgraph. Key queries:
- `GET_USER_UPDATES_QUERY` — polls `promptRequests(where: { isAnswered: false })` to detect new answers
- `GET_RECENT_ACTIVITY_QUERY` — queries the `Activity` entity for spending history

The `Activity.amount` field is negative for costs and positive for refunds (in wei).

## Local E2E Deployment (Fresh Hardhat)

This section describes the orchestrator's workflow for deploying the subgraph against a freshly deployed Hardhat network.

### Prerequisites
- Hardhat node running on `localhost:8545` with EVMAIAgent and EVMAIAgentEscrow contracts deployed
- Contract addresses and deployment block height known

### Orchestration Steps

```bash
# 1. In sense-ai-subgraph root, regenerate config with deployed addresses
EVMAI_AGENT_ADDRESS=0x<deployed-agent> EVMAI_AGENT_ESCROW_ADDRESS=0x<deployed-escrow> START_BLOCK=<block> npm run config:localnet

# 2. Bring up the Graph node stack (postgres, ipfs, graph-node)
docker-compose up -d

# 3. Prepare + codegen + build (static validation — no live node needed yet)
npm run prepare:localnet && npm run codegen && npm run build

# 4. Create the subgraph on the local Graph node
npm run create-local

# 5. Deploy the subgraph to the local Graph node
npm run deploy-local
```

### Expected Results

- Graph node logs (visible via `docker-compose logs graph-node -f`) should show indexing progress
- GraphQL endpoint available at `http://localhost:8000/subgraphs/name/sense-ai`
- dApp can query the subgraph using:
  ```graphql
  {
    conversations(first: 10) { id user conversationId }
    promptRequests(where: { isAnswered: false }) { id isAnswered }
  }
  ```

### Host-Container Networking

The graph-node container reaches the host Hardhat node via `host.docker.internal:8545` (configured in `docker-compose.yml`). This works on macOS and Windows with Docker Desktop.

**Linux users:** Must replace `host.docker.internal` with the host machine's IP or use `--network host` (trade-off: less isolation).

## Key Notes

- `deploy:mainnet` is the production The Graph Studio deployment — confirm before running
- Local Graph node must be running (docker-compose) for `deploy-local`
- `networks.json` at root is used by Graph CLI for multi-network deployments (separate from `config/*.json`)
- `generated/` and `build/` are output directories — never edit manually
- `createActivity()` is intentionally duplicated in both `evmai-agent.ts` and `evmai-agent-escrow.ts` — AssemblyScript's module system in The Graph does not allow cross-file shared helpers

## MCP Tools

Tradable ClickUp MCP is available in this project for task management.
