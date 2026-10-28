// Contract tests for the indexing-parity probe. Pure Node (node:test), no network: the
// fixture is a RECORDING of Base Sepolia — every log the agent and escrow emitted over
// blocks 48212900-48216700 (two prompts, their answers and their payments) and exactly what
// Studio had indexed for that window. Failure cases are mutations of that recording.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');

const { keccak_256 } = require('@noble/hashes/sha3.js');

const probe = require('./parity-probe');

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'parity-base-sepolia-48212900-48216700.json'),
    'utf8',
  ),
);
const ADDRESSES = { agent: FIXTURE.agent, escrow: FIXTURE.escrow };

const clone = (x) => JSON.parse(JSON.stringify(x));
const decoded = () => probe.decodeLogs(FIXTURE.logs, ADDRESSES);

/** keccak256 of an event's canonical signature, from the committed Hardhat artifact. */
function topicFromAbi(artifactFile, eventName) {
  const { abi } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'abis', artifactFile), 'utf8'));
  const ev = abi.find((e) => e.type === 'event' && e.name === eventName);
  const sig = `${eventName}(${ev.inputs.map((i) => i.type).join(',')})`;
  return `0x${Buffer.from(keccak_256(new TextEncoder().encode(sig))).toString('hex')}`;
}

describe('EVENTS', () => {
  it('topic hashes are the keccak of the committed ABI signatures', () => {
    assert.equal(probe.EVENTS.PromptSubmitted.topic, topicFromAbi('EVMAIAgent.json', 'PromptSubmitted'));
    assert.equal(probe.EVENTS.AnswerMessageAdded.topic, topicFromAbi('EVMAIAgent.json', 'AnswerMessageAdded'));
    assert.equal(probe.EVENTS.PaymentEscrowed.topic, topicFromAbi('EVMAIAgentEscrow.json', 'PaymentEscrowed'));
    assert.equal(probe.EVENTS.PaymentFinalized.topic, topicFromAbi('EVMAIAgentEscrow.json', 'PaymentFinalized'));
  });
});

describe('decodeLogs', () => {
  it('extracts the four event families from a real recording and ignores the rest', () => {
    const d = decoded();
    assert.deepEqual(d.promptSubmitted.map((e) => e.answerMessageId), ['95', '97']);
    assert.deepEqual(d.promptSubmitted.map((e) => e.promptMessageId), ['94', '96']);
    assert.deepEqual(d.answerAdded.map((e) => e.messageId), ['95', '97']);
    assert.deepEqual(d.paymentEscrowed.map((e) => e.escrowId), ['95', '97']);
    assert.deepEqual(d.paymentFinalized.map((e) => e.escrowId), ['95', '97']);
    assert.equal(d.ignored, FIXTURE.logs.length - 8);
  });

  it('decodes addresses lower-cased and amounts as decimal strings, matching the indexed entities', () => {
    const d = decoded();
    const pay95 = FIXTURE.entities.payments.find((p) => p.id === '95');
    const esc95 = d.paymentEscrowed.find((e) => e.escrowId === '95');
    assert.equal(esc95.amount, pay95.amount);
    assert.equal(esc95.user, pay95.user.toLowerCase());
    const ps95 = d.promptSubmitted.find((e) => e.answerMessageId === '95');
    assert.equal(ps95.user, FIXTURE.entities.promptRequests.find((p) => p.id === '95').user.toLowerCase());
    assert.equal(typeof ps95.blockNumber, 'number');
  });

  it('ignores a log from an unexpected address even when its topic matches', () => {
    const stray = clone(FIXTURE.logs.find((l) => l.topics[0] === probe.EVENTS.PromptSubmitted.topic));
    stray.address = '0x000000000000000000000000000000000000dEaD';
    const d = probe.decodeLogs([...FIXTURE.logs, stray], ADDRESSES);
    assert.equal(d.promptSubmitted.length, 2);
    assert.equal(d.ignored, FIXTURE.logs.length - 8 + 1);
  });
});

describe('compare', () => {
  const entities = () => clone(FIXTURE.entities);

  it('reports no gaps when the index matches the chain', () => {
    const r = probe.compare(decoded(), entities());
    assert.deepEqual(r.gaps, []);
    assert.deepEqual(r.counts, {
      promptSubmitted: 2, promptRequests: 2, answerAdded: 2, assistantMessages: 2,
      paymentEscrowed: 2, payments: 2, paymentFinalized: 2,
    });
  });

  it('names a PromptSubmitted whose PromptRequest was never indexed', () => {
    const e = entities();
    e.promptRequests = e.promptRequests.filter((p) => p.id !== '97');
    const { gaps } = probe.compare(decoded(), e);
    assert.deepEqual(gaps.map((g) => [g.kind, g.id]), [['prompt-request-missing', '97']]);
  });

  it('names a PromptRequest the chain never emitted (extra)', () => {
    const e = entities();
    e.promptRequests.push({ ...e.promptRequests[0], id: '99', promptMessageId: '98' });
    const { gaps } = probe.compare(decoded(), e);
    assert.deepEqual(gaps.map((g) => [g.kind, g.id]), [['prompt-request-extra', '99']]);
  });

  it('names a PromptRequest whose fields disagree with the event', () => {
    const e = entities();
    e.promptRequests.find((p) => p.id === '95').promptMessageId = '1';
    const { gaps } = probe.compare(decoded(), e);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].kind, 'prompt-request-mismatch');
    assert.equal(gaps[0].id, '95');
    assert.match(gaps[0].detail, /promptMessageId/);
  });

  it('names an answered prompt the index still shows unanswered', () => {
    const e = entities();
    e.promptRequests.find((p) => p.id === '97').isAnswered = false;
    const { gaps } = probe.compare(decoded(), e);
    assert.deepEqual(gaps.map((g) => [g.kind, g.id]), [['prompt-request-not-answered', '97']]);
  });

  it('names an AnswerMessageAdded with no assistant Message, and does not count user messages', () => {
    const e = entities();
    e.messages = e.messages.filter((m) => m.id !== '95');
    const { gaps } = probe.compare(decoded(), e);
    assert.deepEqual(gaps.map((g) => [g.kind, g.id]), [['answer-message-missing', '95']]);
    const e2 = entities();
    e2.messages = e2.messages.filter((m) => m.role !== 'user');
    assert.deepEqual(probe.compare(decoded(), e2).gaps, []);
  });

  it('names an assistant Message the chain never emitted (extra)', () => {
    const e = entities();
    e.messages.push({ ...e.messages.find((m) => m.role === 'assistant'), id: '101', messageId: '101' });
    const { gaps } = probe.compare(decoded(), e);
    assert.deepEqual(gaps.map((g) => [g.kind, g.id]), [['answer-message-extra', '101']]);
  });

  it('names payments missing, extra, mismatched and not finalized', () => {
    const e = entities();
    e.payments = e.payments.filter((p) => p.id !== '95');
    assert.deepEqual(probe.compare(decoded(), e).gaps.map((g) => [g.kind, g.id]), [['payment-missing', '95']]);

    const e2 = entities();
    e2.payments.push({ ...e2.payments[0], id: '77' });
    assert.deepEqual(probe.compare(decoded(), e2).gaps.map((g) => [g.kind, g.id]), [['payment-extra', '77']]);

    const e3 = entities();
    e3.payments.find((p) => p.id === '97').amount = '1';
    const g3 = probe.compare(decoded(), e3).gaps;
    assert.deepEqual(g3.map((g) => [g.kind, g.id]), [['payment-mismatch', '97']]);
    assert.match(g3[0].detail, /amount/);

    const e4 = entities();
    e4.payments.find((p) => p.id === '97').status = 'PENDING';
    assert.deepEqual(probe.compare(decoded(), e4).gaps.map((g) => [g.kind, g.id]), [['payment-not-finalized', '97']]);
  });
});

describe('blockRanges', () => {
  it('splits an inclusive range into chunks no wider than the limit', () => {
    assert.deepEqual(probe.blockRanges(100, 1000, 200), [[100, 299], [300, 499], [500, 699], [700, 899], [900, 1000]]);
    assert.deepEqual(probe.blockRanges(5, 5, 200), [[5, 5]]);
  });
  it('rejects an inverted range', () => {
    assert.throws(() => probe.blockRanges(10, 9, 200), /FROM_BLOCK/);
  });
});

describe('resolveConfig', () => {
  const readConfig = (network) => {
    assert.equal(network, 'base-testnet');
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'base-testnet.json'), 'utf8'));
  };

  it('reads the probe variables and the network addresses', () => {
    const c = probe.resolveConfig(
      { RPC_URL: 'https://rpc.example/v2/key', GRAPH_URL: 'https://graph.example/q', FROM_BLOCK: '100', TO_BLOCK: '200', NETWORK: 'base-testnet' },
      { readConfig },
    );
    assert.equal(c.rpcUrl, 'https://rpc.example/v2/key');
    assert.equal(c.graphUrl, 'https://graph.example/q');
    assert.equal(c.fromBlock, 100);
    assert.equal(c.toBlock, 200);
    assert.equal(c.agent.toLowerCase(), FIXTURE.agent.toLowerCase());
    assert.equal(c.escrow.toLowerCase(), FIXTURE.escrow.toLowerCase());
    assert.equal(c.chunk, 200);
    assert.equal(c.toBlock, 200);
  });

  it("falls back to the run-day runner's TESTNET_* exports and leaves TO_BLOCK open", () => {
    const c = probe.resolveConfig(
      { TESTNET_RPC_URL: 'https://rpc.example', TESTNET_GRAPH_URL: 'https://graph.example', TESTNET_RUN_FROM_BLOCK: '4242', NETWORK: 'base-testnet', PARITY_LOG_CHUNK: '1000' },
      { readConfig },
    );
    assert.equal(c.rpcUrl, 'https://rpc.example');
    assert.equal(c.graphUrl, 'https://graph.example');
    assert.equal(c.fromBlock, 4242);
    assert.equal(c.toBlock, null);
    assert.equal(c.chunk, 1000);
  });

  it('fails once, naming every missing variable and never echoing a value', () => {
    assert.throws(
      () => probe.resolveConfig({ NETWORK: 'base-testnet', RPC_URL: 'https://rpc.example/v2/secretkey' }, { readConfig }),
      (err) => {
        assert.match(err.message, /GRAPH_URL/);
        assert.match(err.message, /FROM_BLOCK/);
        assert.doesNotMatch(err.message, /secretkey/);
        return true;
      },
    );
    assert.throws(() => probe.resolveConfig({ NETWORK: 'base-testnet', RPC_URL: 'x', GRAPH_URL: 'y', FROM_BLOCK: 'abc' }, { readConfig }), /FROM_BLOCK/);
  });
});

describe('runProbe (against the recording served by a fake network)', () => {
  const config = () => ({
    rpcUrl: 'https://rpc.example/v2/secretkey', graphUrl: 'https://graph.example/q',
    fromBlock: FIXTURE.fromBlock, toBlock: FIXTURE.toBlock, agent: FIXTURE.agent, escrow: FIXTURE.escrow,
    chunk: 200, headWaitMs: 0, headPollMs: 0, reportFile: null,
  });

  /** Fake fetch: a JSON-RPC node serving the recording and a Graph endpoint serving `entities`. */
  function fakeNetwork({ entities = clone(FIXTURE.entities), head = FIXTURE.graph_meta.block.number } = {}) {
    const calls = { rpc: [], graph: [] };
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      const json = (x) => ({ ok: true, status: 200, json: async () => x });
      if (new URL(url).host === 'rpc.example') {
        calls.rpc.push(body);
        const { method, params } = body;
        if (method === 'eth_blockNumber') return json({ jsonrpc: '2.0', id: body.id, result: `0x${(FIXTURE.toBlock + 10).toString(16)}` });
        if (method === 'eth_getBlockByNumber') {
          const n = parseInt(params[0], 16);
          const ts = n <= FIXTURE.fromBlock ? FIXTURE.fromTimestamp : FIXTURE.toTimestamp;
          return json({ jsonrpc: '2.0', id: body.id, result: { number: params[0], timestamp: `0x${ts.toString(16)}` } });
        }
        if (method === 'eth_getLogs') {
          const [{ fromBlock, toBlock }] = params;
          const a = parseInt(fromBlock, 16); const b = parseInt(toBlock, 16);
          if (b - a + 1 > 200) return json({ jsonrpc: '2.0', id: body.id, error: { message: 'eth_getLogs is limited to a 200 range' } });
          const result = FIXTURE.logs.filter((l) => { const n = parseInt(l.blockNumber, 16); return n >= a && n <= b; });
          return json({ jsonrpc: '2.0', id: body.id, result });
        }
        throw new Error(`fake rpc: unexpected ${method}`);
      }
      calls.graph.push(body.query);
      return json({ data: { _meta: { block: { number: head } }, promptRequests: entities.promptRequests, messages: entities.messages, payments: entities.payments } });
    };
    return { fetchImpl, calls };
  }

  it('exits 0 and reports the counts when the index matches the chain', async () => {
    const net = fakeNetwork();
    const lines = [];
    const r = await probe.runProbe(config(), { fetchImpl: net.fetchImpl, log: (s) => lines.push(s), sleep: async () => {} });
    assert.equal(r.exitCode, 0);
    assert.deepEqual(r.report.gaps, []);
    assert.equal(r.report.counts.promptSubmitted, 2);
    assert.ok(lines.some((l) => /parity ok/i.test(l)), lines.join('\n'));
  });

  it('never asks the node for more than the chunk, so a 200-block public RPC limit holds', async () => {
    const net = fakeNetwork();
    await probe.runProbe(config(), { fetchImpl: net.fetchImpl, log: () => {}, sleep: async () => {} });
    const ranges = net.calls.rpc.filter((c) => c.method === 'eth_getLogs').map((c) => parseInt(c.params[0].toBlock, 16) - parseInt(c.params[0].fromBlock, 16) + 1);
    assert.ok(ranges.length >= 19, `expected ≥ 19 chunked requests, got ${ranges.length}`);
    assert.ok(ranges.every((w) => w <= 200));
  });

  it('exits 1 and names every missing id when the index has gaps', async () => {
    const entities = clone(FIXTURE.entities);
    entities.payments = entities.payments.filter((p) => p.id !== '97');
    entities.promptRequests = entities.promptRequests.filter((p) => p.id !== '95');
    const net = fakeNetwork({ entities });
    const lines = [];
    const r = await probe.runProbe(config(), { fetchImpl: net.fetchImpl, log: (s) => lines.push(s), sleep: async () => {} });
    assert.equal(r.exitCode, 1);
    assert.deepEqual(r.report.gaps.map((g) => [g.kind, g.id]).sort(), [['payment-missing', '97'], ['prompt-request-missing', '95']]);
    const out = lines.join('\n');
    assert.match(out, /payment-missing.*97/);
    assert.match(out, /prompt-request-missing.*95/);
  });

  it('exits 1 naming the lag when the subgraph head never reaches TO_BLOCK', async () => {
    const net = fakeNetwork({ head: FIXTURE.toBlock - 500 });
    const lines = [];
    const r = await probe.runProbe(config(), { fetchImpl: net.fetchImpl, log: (s) => lines.push(s), sleep: async () => {} });
    assert.equal(r.exitCode, 1);
    assert.match(lines.join('\n'), /head/);
    assert.match(lines.join('\n'), new RegExp(String(FIXTURE.toBlock - 500)));
  });

  it('resolves an open TO_BLOCK to the chain head and never prints the RPC URL', async () => {
    const net = fakeNetwork();
    const lines = [];
    const r = await probe.runProbe({ ...config(), toBlock: null }, { fetchImpl: net.fetchImpl, log: (s) => lines.push(s), sleep: async () => {} });
    assert.equal(r.report.toBlock, FIXTURE.toBlock + 10);
    assert.doesNotMatch(lines.join('\n'), /secretkey/);
    assert.ok(lines.some((l) => l.includes('rpc.example')), 'the host is still named');
  });

  it('writes the JSON report when a path is given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
    const file = path.join(dir, 'parity-report.json');
    try {
      const net = fakeNetwork();
      await probe.runProbe({ ...config(), reportFile: file }, { fetchImpl: net.fetchImpl, log: () => {}, sleep: async () => {} });
      const written = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(written.exitCode, 0);
      assert.deepEqual(written.gaps, []);
      assert.equal(written.fromBlock, FIXTURE.fromBlock);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
