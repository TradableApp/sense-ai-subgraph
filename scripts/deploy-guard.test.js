// Contract tests for the Studio deploy guard. Pure Node (node:test), no network, no Graph CLI:
// `run` takes the environment and a config reader, so the checks are exercised without touching
// config/*.json on disk except where the real files are the thing under test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const guard = require("./deploy-guard");

const VALID_ADDRESS = "0x4a0C7e5807f9174499a8F56F2C69c61b39a4c64D";
const resolvedConfig = {
  network: "base",
  EVMAIAgent: { address: VALID_ADDRESS, startBlock: 36720090 },
  EVMAIAgentEscrow: { address: VALID_ADDRESS, startBlock: 36720090 },
};
const placeholderConfig = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "config", "base-mainnet.json"),
    "utf8",
  ),
);

describe("checkVersionLabel", () => {
  it("accepts a vX.Y.Z label", () => {
    assert.equal(guard.checkVersionLabel({ SUBGRAPH_VERSION: "v0.4.0" }), null);
  });

  it("accepts a pre-release suffix", () => {
    assert.equal(
      guard.checkVersionLabel({ SUBGRAPH_VERSION: "v0.4.0-rc.1" }),
      null,
    );
  });

  it("rejects unset, empty and non-semver labels, naming the variable", () => {
    for (const env of [
      {},
      { SUBGRAPH_VERSION: "" },
      { SUBGRAPH_VERSION: "0.4.0" },
      { SUBGRAPH_VERSION: "latest" },
    ]) {
      const problem = guard.checkVersionLabel(env);
      assert.ok(problem, `expected a problem for ${JSON.stringify(env)}`);
      assert.match(problem, /SUBGRAPH_VERSION/);
    }
  });
});

describe("findPlaceholders", () => {
  it("returns nothing for a resolved config", () => {
    assert.deepEqual(guard.findPlaceholders(resolvedConfig), []);
  });

  it("flags the placeholder addresses and start blocks in config/base-mainnet.json as committed", () => {
    const problems = guard.findPlaceholders(placeholderConfig);
    assert.ok(problems.some((p) => p.includes("EVMAIAgent.address")));
    assert.ok(problems.some((p) => p.includes("EVMAIAgentEscrow.address")));
    assert.ok(problems.some((p) => p.includes("EVMAIAgent.startBlock")));
  });

  it("flags a well-formed address next to a placeholder start block", () => {
    const problems = guard.findPlaceholders({
      ...resolvedConfig,
      EVMAIAgentEscrow: { address: VALID_ADDRESS, startBlock: 12345678 },
    });
    assert.deepEqual(problems.length, 1);
    assert.match(problems[0], /EVMAIAgentEscrow\.startBlock/);
  });

  it("flags a missing data source rather than throwing", () => {
    const problems = guard.findPlaceholders({
      network: "base",
      EVMAIAgent: resolvedConfig.EVMAIAgent,
    });
    assert.ok(problems.some((p) => p.includes("EVMAIAgentEscrow")));
  });
});

describe("checkMainnetConfirmed", () => {
  it('passes only on exactly "1"', () => {
    assert.equal(
      guard.checkMainnetConfirmed({ DEPLOY_MAINNET_CONFIRMED: "1" }),
      null,
    );
    for (const value of [undefined, "", "true", "yes", " 1"]) {
      const problem = guard.checkMainnetConfirmed({
        DEPLOY_MAINNET_CONFIRMED: value,
      });
      assert.ok(problem, `expected a problem for ${JSON.stringify(value)}`);
      assert.match(problem, /DEPLOY_MAINNET_CONFIRMED=1/);
    }
  });
});

describe("run", () => {
  const readResolved = () => resolvedConfig;
  const readPlaceholder = () => placeholderConfig;

  it("testnet: needs only the version label", () => {
    const result = guard.run(
      "testnet",
      { SUBGRAPH_VERSION: "v0.4.0" },
      readResolved,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
  });

  it("testnet: fails without a version label and never asks for the mainnet confirm", () => {
    const result = guard.run("testnet", {}, readResolved);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("SUBGRAPH_VERSION")));
    assert.ok(
      !result.problems.some((p) => p.includes("DEPLOY_MAINNET_CONFIRMED")),
    );
  });

  it("mainnet: refuses while config/base-mainnet.json holds placeholders, even when confirmed", () => {
    const result = guard.run(
      "mainnet",
      { SUBGRAPH_VERSION: "v1.0.0", DEPLOY_MAINNET_CONFIRMED: "1" },
      readPlaceholder,
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("EVMAIAgent.address")));
  });

  it("mainnet: refuses a resolved config without DEPLOY_MAINNET_CONFIRMED=1", () => {
    const result = guard.run(
      "mainnet",
      { SUBGRAPH_VERSION: "v1.0.0" },
      readResolved,
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.problems.some((p) => p.includes("DEPLOY_MAINNET_CONFIRMED=1")),
    );
  });

  it("mainnet: passes with a resolved config, a version label and the confirm", () => {
    const result = guard.run(
      "mainnet",
      { SUBGRAPH_VERSION: "v1.0.0", DEPLOY_MAINNET_CONFIRMED: "1" },
      readResolved,
    );
    assert.equal(result.ok, true);
  });

  it("reads the mainnet config from config/base-mainnet.json and the testnet one from config/base-testnet.json", () => {
    assert.equal(
      guard.configPathFor("mainnet"),
      path.join("config", "base-mainnet.json"),
    );
    assert.equal(
      guard.configPathFor("testnet"),
      path.join("config", "base-testnet.json"),
    );
  });

  it("rejects an unknown target", () => {
    assert.throws(
      () => guard.run("localnet", {}, readResolved),
      /testnet\|mainnet/,
    );
  });
});

describe("package scripts", () => {
  const { scripts } = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );

  it("deploy:testnet runs the guard first and passes --version-label from SUBGRAPH_VERSION to the testnet slug", () => {
    const cmd = scripts["deploy:testnet"];
    assert.ok(cmd.startsWith("node scripts/deploy-guard.js testnet &&"), cmd);
    assert.match(
      cmd,
      /graph deploy sense-ai-testnet --version-label "\$SUBGRAPH_VERSION"/,
    );
  });

  it("deploy:mainnet runs the guard first and passes --version-label from SUBGRAPH_VERSION to the mainnet slug", () => {
    const cmd = scripts["deploy:mainnet"];
    assert.ok(cmd.startsWith("node scripts/deploy-guard.js mainnet &&"), cmd);
    assert.match(
      cmd,
      /graph deploy sense-ai --version-label "\$SUBGRAPH_VERSION"/,
    );
  });

  it("no Studio deploy prompts interactively for a version label", () => {
    for (const [name, cmd] of Object.entries(scripts)) {
      if (
        !cmd.includes("graph deploy") ||
        cmd.includes("--node http://localhost")
      )
        continue;
      assert.match(
        cmd,
        /--version-label/,
        `${name} would prompt for a version label`,
      );
    }
  });
});

describe("single source of truth for addresses", () => {
  it("networks.json is gone — config/*.json via mustache is the only address source", () => {
    assert.equal(
      fs.existsSync(path.join(__dirname, "..", "networks.json")),
      false,
    );
  });
});
