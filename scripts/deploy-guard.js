#!/usr/bin/env node

/**
 * Studio deploy guard — runs first in `deploy:testnet` and `deploy:mainnet`.
 *
 *   node scripts/deploy-guard.js testnet
 *   node scripts/deploy-guard.js mainnet
 *
 * Both targets:
 *   - SUBGRAPH_VERSION must be set and look like vX.Y.Z (optional -suffix). The deploy scripts pass
 *     it as `--version-label`, so `graph deploy` never prompts interactively and a run is
 *     reproducible from its environment.
 * mainnet only:
 *   - config/base-mainnet.json must hold real addresses and start blocks (the committed file
 *     ships with 0xYOUR_… placeholders and startBlock 12345678 until the mainnet contracts exist).
 *   - DEPLOY_MAINNET_CONFIRMED=1 must be exported — exactly "1" — mirroring
 *     REHEARSAL_MAINNET_CONFIRMED in tokenized-ai-agent. The `sense-ai` Studio slug is production.
 *
 * Exits 1 with every problem listed; exits 0 silently otherwise.
 */

const fs = require("fs");
const path = require("path");

const TARGETS = {
  testnet: {
    config: path.join("config", "base-testnet.json"),
    slug: "sense-ai-testnet",
  },
  mainnet: {
    config: path.join("config", "base-mainnet.json"),
    slug: "sense-ai",
  },
};
const DATA_SOURCES = ["EVMAIAgent", "EVMAIAgentEscrow"];
const VERSION_LABEL = /^v\d+\.\d+\.\d+(-[\w.]+)?$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PLACEHOLDER_START_BLOCK = 12345678;
const CONFIRM_VAR = "DEPLOY_MAINNET_CONFIRMED";

function checkVersionLabel(env) {
  const value = env.SUBGRAPH_VERSION;
  if (value === undefined || value === "") {
    return "SUBGRAPH_VERSION is not set; export the Studio version label, e.g. SUBGRAPH_VERSION=v0.4.0";
  }
  if (!VERSION_LABEL.test(value)) {
    return `SUBGRAPH_VERSION=${JSON.stringify(value)} must look like vX.Y.Z (optionally -suffix)`;
  }
  return null;
}

function findPlaceholders(config) {
  const problems = [];
  for (const name of DATA_SOURCES) {
    const source = config[name];
    if (!source || typeof source !== "object") {
      problems.push(`${name} is missing from the config`);
      continue;
    }
    if (!ADDRESS.test(String(source.address))) {
      problems.push(
        `${name}.address is a placeholder or malformed: ${JSON.stringify(source.address)}`,
      );
    }
    const block = source.startBlock;
    if (
      !Number.isInteger(block) ||
      block <= 0 ||
      block === PLACEHOLDER_START_BLOCK
    ) {
      problems.push(
        `${name}.startBlock is a placeholder or malformed: ${JSON.stringify(block)}`,
      );
    }
  }
  return problems;
}

function checkMainnetConfirmed(env) {
  if (env[CONFIRM_VAR] === "1") return null;
  const shown =
    env[CONFIRM_VAR] === undefined ? "unset" : JSON.stringify(env[CONFIRM_VAR]);
  return `${CONFIRM_VAR} is ${shown}; deploying the production slug needs exactly ${CONFIRM_VAR}=1 bun run deploy:mainnet`;
}

function configPathFor(target) {
  const spec = TARGETS[target];
  if (!spec)
    throw new Error(
      `deploy-guard: target must be testnet|mainnet (got ${JSON.stringify(target)})`,
    );
  return spec.config;
}

function run(target, env, readConfig) {
  const configPath = configPathFor(target);
  const problems = [];

  const label = checkVersionLabel(env);
  if (label) problems.push(label);

  if (target === "mainnet") {
    for (const problem of findPlaceholders(readConfig(configPath))) {
      problems.push(`${configPath}: ${problem}`);
    }
    const confirm = checkMainnetConfirmed(env);
    if (confirm) problems.push(confirm);
  }

  return {
    ok: problems.length === 0,
    problems,
    slug: TARGETS[target].slug,
    configPath,
  };
}

function main() {
  const target = process.argv[2];
  const readConfig = (relative) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, "..", relative), "utf8"));
  const result = run(target, process.env, readConfig);
  if (!result.ok) {
    console.error(`deploy:${target} refused (Studio slug ${result.slug}):`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}

module.exports = {
  checkVersionLabel,
  findPlaceholders,
  checkMainnetConfirmed,
  configPathFor,
  run,
};

if (require.main === module) {
  main();
}
