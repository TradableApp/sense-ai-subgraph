# SenseAI Subgraph

[![License](https://img.shields.io/github/license/TradableApp/sense-ai-subgraph.svg)](./LICENSE)

This subgraph indexes the **SenseAI** smart contracts (Agent & Escrow) on Base (Ethereum L2). It provides the data layer for the SenseAI dApp, allowing users to fetch their conversation history and usage limits efficiently.

## 📋 Prerequisites

- **Node.js** (v18+)
- **Docker Desktop** (Only required for Local Development)
- **Graph CLI** (`npm install -g @graphprotocol/graph-cli`)

## ⚙️ Configuration

This project uses **Mustache** templates to manage multi-network deployments. DO NOT edit `subgraph.yaml` directly; it is auto-generated.

**Edit these files instead:**

- **Template:** `subgraph.template.yaml` (The structure)
- **Configs:**
  - `config/localhost.json` (Local Hardhat)
  - `config/base-sepolia.json` (Testnet)
  - `config/base-mainnet.json` (Production)

## 🚀 Deployment Workflows

### 1. Local Development (Hardhat + Docker)

Use this to test the subgraph logic on your machine without waiting for public testnet block times.

1.  **Start the Blockchain:**
    Ensure your local Hardhat node is running from the `tokenized-ai-agent` repo:

    ```bash
    npx hardhat node
    ```

2.  **Start The Graph Node:**
    Start the local indexing infrastructure:

    ```bash
    docker-compose up
    ```

3.  **Deploy:**
    Run the following to generate the config, build, and deploy to your local Docker container:
    ```bash
    npm run create-local  # Only run this once to initialize
    npm run deploy-local  # Run this every time you change code
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
    graph auth --studio <YOUR_DEPLOY_KEY>
    ```

3.  **Deploy:**
    This script compiles the code using `config/base-sepolia.json` and pushes it to the Studio.

    ```bash
    npm run deploy:testnet
    ```

4.  **Update Frontend:**
    Copy the **Query URL** output by the terminal and paste it into your dApp's `.env.testnet` file:
    ```env
    VITE_GRAPH_API_URL="https://api.studio.thegraph.com/query/YOUR_ORG_ID/sense-ai-testnet/v0.0.1"
    ```

---

### 3. Mainnet Deployment (Base / Virtual Chain)

Deploys the production version using the slug **`sense-ai`**.

**Prerequisite:** Ensure `config/base-mainnet.json` contains the correct production contract addresses.

1.  **Create Subgraph:**
    Create a subgraph named **`sense-ai`** in the Studio (or your custom Graph Node).

2.  **Authenticate:**
    (Same as Testnet if using Studio)

    ```bash
    graph auth --studio <YOUR_DEPLOY_KEY>
    ```

3.  **Deploy:**

    ```bash
    npm run deploy:mainnet
    ```

4.  **Publish (Studio Only):**
    After deploying to the Studio, you can click "Publish" in the dashboard to migrate the subgraph to the decentralized network. This requires ETH (Base) and GRT.

## 📂 Project Structure

- `abis/`: Contract ABIs (copied from Hardhat artifacts).
- `config/`: Network-specific JSON variables.
- `schema.graphql`: The database schema definition.
- `src/`: AssemblyScript mapping logic.
  - `evmai-agent.ts`: Handles chat history events.
  - `evmai-agent-escrow.ts`: Handles payments and subscriptions.
- `subgraph.template.yaml`: The master configuration template.
- `tests/`: Unit tests for mapping logic (`npm run test`).
