# SenseAI Subgraph

[![CI](https://img.shields.io/github/actions/workflow/status/TradableApp/sense-ai-subgraph/ci.yml?branch=main&label=CI)](https://github.com/TradableApp/sense-ai-subgraph/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/TradableApp/sense-ai-subgraph.svg)](./LICENSE)

This subgraph indexes the **SenseAI** smart contracts (Agent & Escrow) on Base (Ethereum L2). It provides the data layer for the SenseAI dApp, allowing users to fetch their conversation history and usage limits efficiently.

## 📋 Prerequisites

- **Node.js** (v18+)
- **Docker Desktop** (Only required for Local Development)
- **Graph CLI** (`bun add -g @graphprotocol/graph-cli`)

## ⚙️ Configuration

This project uses **Mustache** templates to manage multi-network deployments. DO NOT edit `subgraph.yaml` directly; it is auto-generated.

**Edit these files instead:**

- **Template:** `subgraph.template.yaml` (The structure)
- **Configs:**
  - `config/localhost.json` (Local Hardhat)
  - `config/base-testnet.json` (Testnet)
  - `config/base-mainnet.json` (Production)

## 🚀 Deployment Workflows

### 1. Local Development (Hardhat + Docker)

Use this to test the subgraph logic on your machine without waiting for public testnet block times.

1.  **Start the Blockchain:**
    Ensure your local Hardhat node is running from the `tokenized-ai-agent` repo:

    ```bash
    bunx hardhat node
    ```

2.  **Start The Graph Node:**
    Start the local indexing infrastructure:

    ```bash
    docker-compose up
    ```

3.  **Deploy:**
    Run the following to generate the config, build, and deploy to your local Docker container:
    ```bash
    bun run create-local  # Only run this once to initialize
    bun run deploy-local  # Run this every time you change code
    ```
    _GraphQL Endpoint:_ `http://localhost:8000/subgraphs/name/sense-ai`

---

### 2. Testnet Deployment (Base Sepolia)

Deploys to **The Graph Studio** using the slug `sense-ai-testnet`.

1.  **Create Subgraph:**
    Go to The Graph Studio and create a subgraph named **`sense-ai-testnet`**.

2.  **Authenticate:**
    Get your Deploy Key from the dashboard.

    ```bash
    graph auth <YOUR_DEPLOY_KEY>
    ```

3.  **Deploy:**
    This script compiles the code using `config/base-testnet.json` and pushes it to the Studio. The version label comes from `SUBGRAPH_VERSION` (so nothing prompts, and the run is reproducible); the guard refuses if it is unset.

    ```bash
    SUBGRAPH_VERSION=v0.4.0 bun run deploy:testnet
    ```

4.  **Update Frontend:**
    Copy the **Query URL** output by the terminal and paste it into your dApp's `.env.testnet` file:
    ```env
    VITE_GRAPH_API_URL="https://api.studio.thegraph.com/query/YOUR_ORG_ID/sense-ai-testnet/v0.0.1"
    ```

---

### 3. Mainnet Deployment (Base / Virtual Chain)

Deploys the production version using the slug **`sense-ai`**.

**Prerequisite:** Ensure `config/base-mainnet.json` contains the correct production contract addresses and start blocks. The committed file holds `0xYOUR_…` placeholders and `startBlock: 12345678` until the mainnet contracts exist, and `scripts/deploy-guard.js` refuses to deploy while any remain.

1.  **Create Subgraph:**
    Create a subgraph named **`sense-ai`** in the Studio (or your custom Graph Node).

2.  **Authenticate:**
    (Same as Testnet if using Studio)

    ```bash
    graph auth <YOUR_DEPLOY_KEY>
    ```

3.  **Deploy:**
    The `sense-ai` slug is production, so the guard also needs an explicit confirm (exactly `1`; `true`/`yes` are rejected):

    ```bash
    DEPLOY_MAINNET_CONFIRMED=1 SUBGRAPH_VERSION=v1.0.0 bun run deploy:mainnet
    ```

4.  **Publish (Studio Only):**
    After deploying to the Studio, you can click "Publish" in the dashboard to migrate the subgraph to the decentralized network. This requires ETH (Base) and GRT.

## 🔍 Live indexing-parity probe

Matchstick tests the mappings offline; `scripts/parity-probe.js` checks a LIVE deployment. For a
block range it reads the four money-path events from the RPC (`PromptSubmitted`,
`AnswerMessageAdded`, `PaymentEscrowed`, `PaymentFinalized`) and compares them with what the
subgraph indexed (`PromptRequest`, assistant `Message`, `Payment`), naming every id that is
missing from the index or present without a chain event.

```bash
# Base Sepolia, explicit window
FROM_BLOCK=48212900 TO_BLOCK=48216700 \
RPC_URL=https://sepolia.base.org \
GRAPH_URL=https://api.studio.thegraph.com/query/<org>/sense-ai-testnet/version/latest \
node scripts/parity-probe.js

# The sense-ai-e2e run-day runner's stage (reads its TESTNET_* exports; TO_BLOCK = chain head)
bun run parity:testnet
```

Exit 0 means parity; 1 lists the gaps (or the subgraph head never reached the window's end within
`PARITY_HEAD_WAIT_MS`, default 3 min); 2 is a configuration or network error. `PARITY_REPORT_FILE`
writes the same result as JSON. Its contract tests (`bun run test:scripts`) run offline on a
recording of real Base Sepolia logs and the matching Studio entities in `scripts/fixtures/`.

## 📂 Project Structure

- `abis/`: Contract ABIs (copied from Hardhat artifacts).
- `config/`: Network-specific JSON variables.
- `schema.graphql`: The database schema definition.
- `src/`: AssemblyScript mapping logic.
  - `evmai-agent.ts`: Handles chat history events.
  - `evmai-agent-escrow.ts`: Handles payments and spending limits.
- `subgraph.template.yaml`: The master configuration template.
- `tests/`: Unit tests for mapping logic (`bun run test`).
- `scripts/`: Node tooling — localnet config generation and the live parity probe with its `node:test` suite and recorded fixture (`bun run test:scripts`).
