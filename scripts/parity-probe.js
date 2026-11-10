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
 *                                           If the node refuses a span and states its own cap
 *                                           (Alchemy free tier: 10), the probe adopts it and carries on.
 *   PARITY_HEAD_WAIT_MS / PARITY_HEAD_POLL_MS  how long to wait for the subgraph head to reach
 *                                           TO_BLOCK before failing (default 180 s / 5 s)
 *   PARITY_LOG_PACE_MS                      minimum gap between eth_getLogs requests (default 0).
 *                                           A provider's HTTP 429 (Alchemy: "compute units per
 *                                           second") is retried with 1→2→4→8 s backoff (or its
 *                                           retry-after) up to 6 times, and from the first 429 on
 *                                           the walk is paced at ≥ 250 ms per request.
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
const DEFAULT_LOG_PACE_MS = 0;
/** Once a provider throttles, never send eth_getLogs faster than this (≈ 4 req/s: Alchemy's free
 *  tier allows 330 CU/s and prices eth_getLogs at 75 CU). */
const THROTTLED_LOG_PACE_MS = 250;
const LOG_RETRY_ATTEMPTS = 6;
const LOG_RETRY_BASE_MS = 1_000;
const LOG_RETRY_CAP_MS = 8_000;
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
  const logPaceMs = given('PARITY_LOG_PACE_MS') ? parseBlock(env.PARITY_LOG_PACE_MS) : DEFAULT_LOG_PACE_MS;
  if (Number.isNaN(logPaceMs)) problems.push('PARITY_LOG_PACE_MS must be a non-negative integer (milliseconds)');
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
    logPaceMs,
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
  if (!res.ok) {
    // Providers put their reason in a JSON-RPC error body even on HTTP 400 (Alchemy: "…up to a
    // 10 block range…"). Keep it on the error so the logs loop can read a stated limit.
    let detail = null;
    try { detail = (await res.json())?.error ?? null; } catch { /* body not JSON */ }
    const err = new Error(`${label}: HTTP ${res.status} from ${redactUrl(url)}${detail?.message ? ` — ${detail.message}` : ''}`);
    err.rpcError = detail;
    err.status = res.status;
    err.retryAfterMs = retryAfterMs(res);
    throw err;
  }
  return res.json();
}

/**
 * The block-range cap a provider names when refusing an eth_getLogs request, or null. Alchemy's
 * free tier: "you can make eth_getLogs requests with up to a 10 block range"; the public Base
 * Sepolia node: "eth_getLogs is limited to a 200 range".
 *
 * Alchemy refuses with HTTP 400, so the text arrives on `err.rpcError` (set by postJson). The
 * public node answers HTTP 200 with a JSON-RPC error, which rpc() rethrows as
 * "RPC eth_getLogs: <provider text>" with no rpcError — the `err.message` fallback relies on that
 * prefix leaving the provider text intact. With PARITY_LOG_CHUNK above 200 the logs loop adapts
 * downward through this second path too.
 */
function statedLogLimit(err) {
  const m = /(?:up to a|limited to a) (\d+) (?:block )?range/i.exec(err?.rpcError?.message || err?.message || '');
  return m ? Number(m[1]) : null;
}

/** The `retry-after` header in milliseconds when a provider sends one (delay-seconds form), else null. */
function retryAfterMs(res) {
  const raw = typeof res?.headers?.get === 'function' ? res.headers.get('retry-after') : null;
  if (raw === null || raw === undefined || raw === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** True for a provider throttle: HTTP 429, or the JSON-RPC 429 code some providers use on HTTP 200. */
function isThrottle(err) {
  return err?.status === 429 || err?.rpcError?.code === 429;
}

/** 1 s, 2 s, 4 s, 8 s, 8 s … for retry #1, #2, … — or the provider's retry-after when it states one. */
function throttleDelayMs(err, attempt) {
  if (err?.retryAfterMs !== null && err?.retryAfterMs !== undefined) return err.retryAfterMs;
  return Math.min(LOG_RETRY_BASE_MS * 2 ** (attempt - 1), LOG_RETRY_CAP_MS);
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

  // Walk the window in chunks. When the node refuses a span and states its cap (Alchemy's free
  // tier caps eth_getLogs at 10 blocks; PARITY_LOG_CHUNK defaults to the public node's 200), adopt
  // that cap and re-walk from the refused span — nothing before it is re-read, nothing is skipped.
  //
  // A throttle (HTTP 429 — Alchemy's compute-units-per-second cap, hit on 2026-11-10 when a
  // 33 471-block window at the 10-block cap meant ~3 350 back-to-back requests) is not a refusal
  // of the span: the same span is retried after a backoff (the provider's retry-after when it
  // states one, else 1→2→4→8 s), up to LOG_RETRY_ATTEMPTS times, and from the first throttle on
  // every request is paced so the walk stays under the cap instead of bouncing off it.
  const logs = [];
  let chunk = config.chunk;
  let cursor = fromBlock;
  let paceMs = config.logPaceMs ?? DEFAULT_LOG_PACE_MS;
  let retries = 0;
  let requests = 0;
  while (cursor <= toBlock) {
    const b = Math.min(cursor + chunk - 1, toBlock);
    if (paceMs > 0 && requests > 0) await sleep(paceMs);
    requests += 1;
    try {
      logs.push(...(await rpc('eth_getLogs', [{ address: [config.agent, config.escrow], fromBlock: toHex(cursor), toBlock: toHex(b) }])));
      cursor = b + 1;
      retries = 0;
    } catch (err) {
      if (isThrottle(err)) {
        if (retries >= LOG_RETRY_ATTEMPTS) throw err;
        retries += 1;
        const delay = throttleDelayMs(err, retries);
        paceMs = Math.max(paceMs, THROTTLED_LOG_PACE_MS);
        log(`parity: eth_getLogs throttled for blocks ${cursor}-${b} (HTTP 429); retry ${retries}/${LOG_RETRY_ATTEMPTS} in ${delay} ms, pacing requests at ${paceMs} ms`);
        await sleep(delay);
        requests = 0; // the backoff already covered the pace gap
        continue;
      }
      const limit = statedLogLimit(err);
      if (limit === null || limit < 1 || limit >= chunk) throw err;
      log(`parity: eth_getLogs refused for blocks ${cursor}-${b}; the node allows ${limit} per request — chunk ${chunk} → ${limit}`);
      chunk = limit;
    }
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

module.exports = { EVENTS, decodeLogs, compare, blockRanges, pageAll, resolveConfig, redactUrl, runProbe, statedLogLimit, retryAfterMs, isThrottle, throttleDelayMs };
