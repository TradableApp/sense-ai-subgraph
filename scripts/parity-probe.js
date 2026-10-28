#!/usr/bin/env node

/**
 * Indexing-parity probe for a live network.
 *
 * Pulls the four escrow/agent events that drive the money path from the chain over a block
 * range — PromptSubmitted, AnswerMessageAdded, PaymentEscrowed, PaymentFinalized — and compares
 * their ids and fields against the PromptRequest, Message and Payment entities the subgraph
 * indexed for the same window (by createdAt, since entities carry no block number). Gaps are
 * reported in BOTH directions: an event the index never saw, and an entity the chain never
 * emitted. Ids are the decimal strings the mappings use (`BigInt.toString()`), and escrowId ==
 * answerMessageId == the assistant Message id by contract design.
 *
 * Environment (first wins):
 *   RPC_URL      | TESTNET_RPC_URL          JSON-RPC endpoint (never printed beyond its host)
 *   GRAPH_URL    | TESTNET_GRAPH_URL        subgraph query endpoint
 *   FROM_BLOCK   | TESTNET_RUN_FROM_BLOCK   first block of the window (inclusive)
 *   TO_BLOCK                                last block (inclusive); default: the chain head
 *   NETWORK                                 config/<network>.json for the addresses (default base-testnet)
 *   PARITY_LOG_CHUNK                        eth_getLogs span per request (default 200: the public
 *                                           Base Sepolia RPC refuses anything wider)
 *   PARITY_HEAD_WAIT_MS / PARITY_HEAD_POLL_MS  how long to wait for the subgraph head to reach
 *                                           TO_BLOCK before failing (default 180 s / 5 s)
 *   PARITY_REPORT_FILE                      optional JSON report path
 *
 * Exit codes: 0 parity · 1 gaps (every missing/extra id named) or the head never caught up ·
 * 2 configuration or network error.
 *
 * Usage:
 *   bun run parity:testnet                      (the sense-ai-e2e run-day runner's stage)
 *   FROM_BLOCK=48212900 TO_BLOCK=48216700 RPC_URL=… GRAPH_URL=… node scripts/parity-probe.js
 */

const fs = require('fs');
const path = require('path');

const { keccak_256 } = require('@noble/hashes/sha3.js');

const DEFAULT_NETWORK = 'base-testnet';
const DEFAULT_LOG_CHUNK = 200;
const DEFAULT_HEAD_WAIT_MS = 180_000;
const DEFAULT_HEAD_POLL_MS = 5_000;
const GRAPH_PAGE = 1000;
/** graph-node refuses `skip` above this; past it the window has to be narrowed, not paged. */
const GRAPH_SKIP_LIMIT = 5000;

const topicOf = (signature) =>
  `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature))).toString('hex')}`;

/** The four events, keyed by name; `source` says which contract emits them. */
const EVENTS = Object.fromEntries(
  [
    ['PromptSubmitted', 'agent', 'PromptSubmitted(address,uint256,uint256,uint256,bytes,bytes)'],
    ['AnswerMessageAdded', 'agent', 'AnswerMessageAdded(uint256,uint256,string)'],
    ['PaymentEscrowed', 'escrow', 'PaymentEscrowed(uint256,address,uint256)'],
    ['PaymentFinalized', 'escrow', 'PaymentFinalized(uint256)'],
  ].map(([name, source, signature]) => [name, { source, signature, topic: topicOf(signature) }]),
);

// ── ABI words ──────────────────────────────────────────────────────────────────────────────────
const wordToDecimal = (word) => BigInt(word).toString();
const wordToAddress = (word) => `0x${word.slice(-40).toLowerCase()}`;
/** The n-th 32-byte head word of a log's data field (0-based). */
const dataWord = (data, n) => `0x${data.slice(2 + n * 64, 2 + (n + 1) * 64)}`;

/**
 * Decode the four event families out of raw `eth_getLogs` results. Anything else — other events,
 * other addresses — is counted in `ignored`.
 */
function decodeLogs(logs, { agent, escrow }) {
  const agentAddr = agent.toLowerCase();
  const escrowAddr = escrow.toLowerCase();
  const out = { promptSubmitted: [], answerAdded: [], paymentEscrowed: [], paymentFinalized: [], ignored: 0 };
  const sorted = [...logs].sort(
    (a, b) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) || parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16),
  );
  for (const log of sorted) {
    const address = String(log.address).toLowerCase();
    const topic = String(log.topics[0]).toLowerCase();
    const common = { blockNumber: parseInt(log.blockNumber, 16), txHash: log.transactionHash };
    if (address === agentAddr && topic === EVENTS.PromptSubmitted.topic) {
      out.promptSubmitted.push({
        ...common,
        user: wordToAddress(log.topics[1]),
        conversationId: wordToDecimal(log.topics[2]),
        promptMessageId: wordToDecimal(log.topics[3]),
        answerMessageId: wordToDecimal(dataWord(log.data, 0)),
      });
    } else if (address === agentAddr && topic === EVENTS.AnswerMessageAdded.topic) {
      out.answerAdded.push({ ...common, conversationId: wordToDecimal(log.topics[1]), messageId: wordToDecimal(log.topics[2]) });
    } else if (address === escrowAddr && topic === EVENTS.PaymentEscrowed.topic) {
      out.paymentEscrowed.push({
        ...common,
        escrowId: wordToDecimal(log.topics[1]),
        user: wordToAddress(log.topics[2]),
        amount: wordToDecimal(log.topics[3]),
      });
    } else if (address === escrowAddr && topic === EVENTS.PaymentFinalized.topic) {
      out.paymentFinalized.push({ ...common, escrowId: wordToDecimal(log.topics[1]) });
    } else {
      out.ignored += 1;
    }
  }
  return out;
}

// ── Graph paging ───────────────────────────────────────────────────────────────────────────────
/**
 * Fetch every entity of one type in a window, page by page.
 *
 * Offset paging (`skip`), NOT an `id_gt` cursor: entity ids here are decimal strings ("95",
 * "100") and The Graph compares `ID` values lexicographically, so a cursor of "97" would skip
 * "100" and every longer id after it — a silent gap in the one tool whose job is finding gaps.
 * `orderBy: createdAt` is stable across pages (createdAt never changes; graph-node breaks ties by
 * id). graph-node caps `skip` at GRAPH_SKIP_LIMIT, so a window with more than
 * GRAPH_SKIP_LIMIT + GRAPH_PAGE entities fails loudly instead of truncating.
 */
async function pageAll(graph, { entity, fields, where }) {
  const all = [];
  for (let skip = 0; ; skip += GRAPH_PAGE) {
    if (skip > GRAPH_SKIP_LIMIT)
      throw new Error(
        `parity: more than ${GRAPH_SKIP_LIMIT + GRAPH_PAGE} ${entity} in the window — graph-node caps skip at ${GRAPH_SKIP_LIMIT}; narrow the block window (FROM_BLOCK/TO_BLOCK) and run the probe per slice`,
      );
    const data = await graph(`{ ${entity}(first: ${GRAPH_PAGE}, skip: ${skip}, orderBy: createdAt, orderDirection: asc, where: { ${where} }) { ${fields} } }`);
    const page = data[entity] || [];
    all.push(...page);
    if (page.length < GRAPH_PAGE) break;
  }
  // Same-block entities share a createdAt; graph-node orders ties by id, but that is its SQL, not a
  // documented guarantee. If a page boundary ever split a tie group unstably, the result would be
  // a duplicate (dropped here) or a skip (reported as a gap, i.e. loudly) — never a silent pass.
  return [...new Map(all.map((e) => [String(e.id), e])).values()];
}

// ── Comparison ─────────────────────────────────────────────────────────────────────────────────
const byId = (list) => new Map(list.map((e) => [String(e.id), e]));
const lower = (s) => String(s).toLowerCase();

/**
 * Compare decoded chain events with the indexed entities for the same window. Returns every gap
 * with a stable `kind`, the id it concerns and a human detail, plus the counts on both sides.
 */
function compare(chain, entities) {
  const gaps = [];
  const gap = (kind, id, detail) => gaps.push({ kind, id: String(id), detail });

  const promptRequests = byId(entities.promptRequests || []);
  const assistantMessages = byId((entities.messages || []).filter((m) => m.role === 'assistant'));
  const payments = byId(entities.payments || []);

  const submittedIds = new Set();
  for (const ev of chain.promptSubmitted) {
    submittedIds.add(ev.answerMessageId);
    const pr = promptRequests.get(ev.answerMessageId);
    if (!pr) {
      gap('prompt-request-missing', ev.answerMessageId, `PromptSubmitted in block ${ev.blockNumber} (tx ${ev.txHash}) has no PromptRequest`);
      continue;
    }
    const diffs = [];
    if (String(pr.promptMessageId) !== ev.promptMessageId) diffs.push(`promptMessageId ${pr.promptMessageId} ≠ ${ev.promptMessageId}`);
    if (lower(pr.user) !== ev.user) diffs.push(`user ${pr.user} ≠ ${ev.user}`);
    if (diffs.length) gap('prompt-request-mismatch', ev.answerMessageId, diffs.join('; '));
  }
  for (const id of promptRequests.keys()) {
    if (!submittedIds.has(id)) gap('prompt-request-extra', id, 'PromptRequest indexed in the window with no PromptSubmitted on chain');
  }

  const answeredIds = new Set();
  for (const ev of chain.answerAdded) {
    answeredIds.add(ev.messageId);
    const pr = promptRequests.get(ev.messageId);
    if (pr && pr.isAnswered === false) gap('prompt-request-not-answered', ev.messageId, `AnswerMessageAdded in block ${ev.blockNumber} but PromptRequest.isAnswered is false`);
    if (!assistantMessages.has(ev.messageId)) gap('answer-message-missing', ev.messageId, `AnswerMessageAdded in block ${ev.blockNumber} (tx ${ev.txHash}) has no assistant Message`);
  }
  for (const id of assistantMessages.keys()) {
    if (!answeredIds.has(id)) gap('answer-message-extra', id, 'assistant Message indexed in the window with no AnswerMessageAdded on chain');
  }

  const escrowedIds = new Set();
  for (const ev of chain.paymentEscrowed) {
    escrowedIds.add(ev.escrowId);
    const pay = payments.get(ev.escrowId);
    if (!pay) {
      gap('payment-missing', ev.escrowId, `PaymentEscrowed in block ${ev.blockNumber} (tx ${ev.txHash}) has no Payment`);
      continue;
    }
    const diffs = [];
    if (String(pay.amount) !== ev.amount) diffs.push(`amount ${pay.amount} ≠ ${ev.amount}`);
    if (lower(pay.user) !== ev.user) diffs.push(`user ${pay.user} ≠ ${ev.user}`);
    if (diffs.length) gap('payment-mismatch', ev.escrowId, diffs.join('; '));
  }
  for (const id of payments.keys()) {
    if (!escrowedIds.has(id)) gap('payment-extra', id, 'Payment indexed in the window with no PaymentEscrowed on chain');
  }
  for (const ev of chain.paymentFinalized) {
    const pay = payments.get(ev.escrowId);
    if (pay && pay.status !== 'COMPLETE') gap('payment-not-finalized', ev.escrowId, `PaymentFinalized in block ${ev.blockNumber} but Payment.status is ${pay.status}`);
  }

  return {
    gaps,
    counts: {
      promptSubmitted: chain.promptSubmitted.length,
      promptRequests: promptRequests.size,
      answerAdded: chain.answerAdded.length,
      assistantMessages: assistantMessages.size,
      paymentEscrowed: chain.paymentEscrowed.length,
      payments: payments.size,
      paymentFinalized: chain.paymentFinalized.length,
    },
  };
}

// ── Ranges and configuration ───────────────────────────────────────────────────────────────────
function blockRanges(from, to, chunk) {
  if (from > to) throw new Error(`FROM_BLOCK ${from} is greater than TO_BLOCK ${to}`);
  const ranges = [];
  for (let a = from; a <= to; a += chunk) ranges.push([a, Math.min(a + chunk - 1, to)]);
  return ranges;
}

const parseBlock = (raw) => (/^\d+$/.test(String(raw)) ? Number(raw) : NaN);

function defaultReadConfig(network) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', `${network}.json`), 'utf8'));
}

/**
 * Resolve the probe's configuration from the environment. Every problem is collected and
 * reported once, by variable NAME — never by value, because the RPC URL carries a provider key.
 */
function resolveConfig(env, { readConfig = defaultReadConfig } = {}) {
  const problems = [];
  const network = env.NETWORK || DEFAULT_NETWORK;
  const cfg = readConfig(network);
  const rpcUrl = env.RPC_URL || env.TESTNET_RPC_URL;
  const graphUrl = env.GRAPH_URL || env.TESTNET_GRAPH_URL;
  const fromRaw = env.FROM_BLOCK ?? env.TESTNET_RUN_FROM_BLOCK;
  if (!rpcUrl) problems.push('RPC_URL (or TESTNET_RPC_URL) is not set');
  if (!graphUrl) problems.push('GRAPH_URL (or TESTNET_GRAPH_URL) is not set');
  if (fromRaw === undefined || fromRaw === '') problems.push('FROM_BLOCK (or TESTNET_RUN_FROM_BLOCK) is not set');
  const fromBlock = fromRaw === undefined ? NaN : parseBlock(fromRaw);
  if (fromRaw !== undefined && fromRaw !== '' && Number.isNaN(fromBlock)) problems.push('FROM_BLOCK must be a non-negative integer');
  let toBlock = null;
  if (env.TO_BLOCK !== undefined && env.TO_BLOCK !== '') {
    toBlock = parseBlock(env.TO_BLOCK);
    if (Number.isNaN(toBlock)) problems.push('TO_BLOCK must be a non-negative integer');
  }
  const chunk = env.PARITY_LOG_CHUNK ? parseBlock(env.PARITY_LOG_CHUNK) : DEFAULT_LOG_CHUNK;
  if (Number.isNaN(chunk) || chunk < 1) problems.push('PARITY_LOG_CHUNK must be a positive integer');
  // Validated like the block params, and `!== ''` rather than truthiness: "0" is a legitimate
  // "do not wait", and an unparseable value must fail here — NaN would silently skip the wait loop.
  const given = (name) => env[name] !== undefined && env[name] !== '';
  const headWaitMs = given('PARITY_HEAD_WAIT_MS') ? parseBlock(env.PARITY_HEAD_WAIT_MS) : DEFAULT_HEAD_WAIT_MS;
  if (Number.isNaN(headWaitMs)) problems.push('PARITY_HEAD_WAIT_MS must be a non-negative integer (milliseconds)');
  const headPollMs = given('PARITY_HEAD_POLL_MS') ? parseBlock(env.PARITY_HEAD_POLL_MS) : DEFAULT_HEAD_POLL_MS;
  if (Number.isNaN(headPollMs) || headPollMs < 1) problems.push('PARITY_HEAD_POLL_MS must be a positive integer (milliseconds)');
  // The network config is a file, not an env var, but a missing key fails the same way: by name,
  // in the same throw, instead of a TypeError after the env checks passed.
  const agent = cfg?.EVMAIAgent?.address;
  const escrow = cfg?.EVMAIAgentEscrow?.address;
  if (!agent) problems.push(`config/${network}.json is missing EVMAIAgent.address`);
  if (!escrow) problems.push(`config/${network}.json is missing EVMAIAgentEscrow.address`);
  if (problems.length) throw new Error(`parity: configuration —\n  ${problems.join('\n  ')}`);
  return {
    network,
    rpcUrl,
    graphUrl,
    fromBlock,
    toBlock,
    agent,
    escrow,
    chunk,
    headWaitMs,
    headPollMs,
    reportFile: env.PARITY_REPORT_FILE || null,
  };
}

/** scheme://host/… — a provider URL embeds its API key in the path. */
function redactUrl(url) {
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return '<invalid url>';
  }
}

// ── The probe ──────────────────────────────────────────────────────────────────────────────────
const toHex = (n) => `0x${n.toString(16)}`;

async function postJson(fetchImpl, url, body, label) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} from ${redactUrl(url)}`);
  return res.json();
}

async function runProbe(config, { fetchImpl = globalThis.fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  let rpcId = 0;
  const rpc = async (method, params = []) => {
    const json = await postJson(fetchImpl, config.rpcUrl, { jsonrpc: '2.0', id: (rpcId += 1), method, params }, `RPC ${method}`);
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message || 'unknown error'}`);
    return json.result;
  };
  const graph = async (query) => {
    const json = await postJson(fetchImpl, config.graphUrl, { query }, 'Graph');
    if (json.errors) throw new Error(`Graph: ${json.errors.map((e) => e.message).join('; ')}`);
    return json.data;
  };

  log(`parity: chain via ${redactUrl(config.rpcUrl)}, index at ${redactUrl(config.graphUrl)} (${config.network || 'network from config'})`);
  const head = parseInt(await rpc('eth_blockNumber'), 16);
  let toBlock = config.toBlock ?? head;
  if (toBlock > head) {
    log(`parity: TO_BLOCK ${toBlock} is past the chain head ${head}; using the head`);
    toBlock = head;
  }
  const { fromBlock } = config;
  if (fromBlock > toBlock) throw new Error(`parity: FROM_BLOCK ${fromBlock} is greater than TO_BLOCK ${toBlock}`);
  log(`parity: window blocks ${fromBlock}-${toBlock} (${toBlock - fromBlock + 1} blocks), chain head ${head}`);

  // The index must have reached the end of the window before it can be judged.
  const started = now();
  let graphHead = (await graph('{ _meta { block { number } } }'))._meta.block.number;
  while (graphHead < toBlock && now() - started < config.headWaitMs) {
    log(`parity: subgraph head ${graphHead} < ${toBlock}, waiting…`);
    await sleep(config.headPollMs);
    graphHead = (await graph('{ _meta { block { number } } }'))._meta.block.number;
  }
  const report = { recordedAt: new Date(now()).toISOString(), network: config.network, fromBlock, toBlock, chainHead: head, graphHead };
  if (graphHead < toBlock) {
    log(`parity FAILED — subgraph head ${graphHead} is still behind TO_BLOCK ${toBlock} after ${Math.round((now() - started) / 1000)} s; nothing compared`);
    return finish({ ...report, headLag: toBlock - graphHead, gaps: [], exitCode: 1 }, config, log);
  }

  // eth_getBlockByNumber answers null for a block the node does not have — TO_BLOCK was the head a
  // moment ago and a reorg can have taken it. Name the block rather than dereferencing null.
  const blockTimestamp = async (n) => {
    const block = await rpc('eth_getBlockByNumber', [toHex(n), false]);
    if (!block) throw new Error(`parity: block ${n} not found on the node — the chain may have reorganised; re-run`);
    return parseInt(block.timestamp, 16);
  };
  const [fromTs, toTs] = await Promise.all([fromBlock, toBlock].map(blockTimestamp));

  const logs = [];
  for (const [a, b] of blockRanges(fromBlock, toBlock, config.chunk)) {
    logs.push(...(await rpc('eth_getLogs', [{ address: [config.agent, config.escrow], fromBlock: toHex(a), toBlock: toHex(b) }])));
  }

  const window = `createdAt_gte: ${fromTs}, createdAt_lte: ${toTs}`;
  const fetchAll = (entity, fields) => pageAll(graph, { entity, fields, where: window });
  const entities = {
    promptRequests: await fetchAll('promptRequests', 'id promptMessageId user isAnswered isCancelled isRefunded createdAt transactionHash'),
    messages: await fetchAll('messages', 'id messageId role createdAt transactionHash'),
    payments: await fetchAll('payments', 'id user amount status createdAt finalizedAt txHash'),
  };

  const chain = decodeLogs(logs, config);
  const { gaps, counts } = compare(chain, entities);
  log(
    `parity: chain ${counts.promptSubmitted} PromptSubmitted / ${counts.answerAdded} AnswerMessageAdded / ` +
      `${counts.paymentEscrowed} PaymentEscrowed / ${counts.paymentFinalized} PaymentFinalized (${chain.ignored} other logs); ` +
      `index ${counts.promptRequests} PromptRequest / ${counts.assistantMessages} assistant Message / ${counts.payments} Payment ` +
      `in ${fromTs}-${toTs}`,
  );
  for (const g of gaps) log(`parity: GAP ${g.kind} id=${g.id} — ${g.detail}`);
  if (gaps.length) log(`parity FAILED — ${gaps.length} gap(s) between chain and index`);
  else log(`parity ok — every event in blocks ${fromBlock}-${toBlock} is indexed and nothing extra is`);
  return finish(
    { ...report, fromTimestamp: fromTs, toTimestamp: toTs, logs: logs.length, ignoredLogs: chain.ignored, counts, gaps, exitCode: gaps.length ? 1 : 0 },
    config,
    log,
  );
}

function finish(report, config, log) {
  if (config.reportFile) {
    fs.mkdirSync(path.dirname(config.reportFile), { recursive: true });
    fs.writeFileSync(config.reportFile, `${JSON.stringify(report, null, 2)}\n`);
    log(`parity: report written to ${config.reportFile}`);
  }
  return { exitCode: report.exitCode, report };
}

async function main() {
  const config = resolveConfig(process.env);
  const { exitCode } = await runProbe(config);
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}

module.exports = { EVENTS, decodeLogs, compare, blockRanges, pageAll, resolveConfig, redactUrl, runProbe };
