const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRuntime } = require('./helpers/npc-vm');

function logger() {
  const requests = [];
  const context = { Blob, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    document: { addEventListener() {} }, addEventListener() {}, setTimeout() { return 1; },
    fetch(url, options) { requests.push({ url, ...options }); return Promise.resolve({ ok: true }); }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('src/scripts/logger.js', 'utf8'), context);
  return { context, requests };
}

test('debug logs preserve full dialogue and nested tool arguments, redact credentials and omit reasoning', () => {
  const h = logger();
  const content = '长对话'.repeat(10000);
  h.context.GameLogger.debug('npc-tool-call', { content, quotedCredentials: '"apiKey":"private"', nested: { a: { b: { arguments: { amount: 10, apiKey: 'private' } } } }, thinking: 'internal', reasoning_content: 'internal', authorization: 'Bearer private' });
  h.context.GameLogger.flush();
  const event = JSON.parse(h.requests[0].body).batch[0];
  assert.equal(event.level, 'debug'); assert.equal(event.data.content, content);
  assert.equal(event.data.nested.a.b.arguments.amount, 10);
  assert.equal(event.data.nested.a.b.arguments.apiKey, '[REDACTED]');
  assert.equal(event.data.quotedCredentials, '"apiKey":"[REDACTED]"');
  assert.equal(event.data.thinking, '[OMITTED]');
  assert.equal(event.data.reasoning_content, '[OMITTED]');
  assert.equal(event.data.authorization, '[REDACTED]');
  assert.equal(h.requests[0].keepalive, false);
  assert.ok(event.sessionId); assert.ok(event.seq);
});

test('ordinary logs retain preview limits', () => {
  const h = logger(); h.context.log('info', 'normal', { content: 'x'.repeat(6000) }); h.context.GameLogger.flush();
  assert.match(JSON.parse(h.requests[0].body).batch[0].content, /truncated/);
});

test('real NPC runner logs calls, rejection, staging, commit and separate player receipt', async () => {
  const entries = []; let round = 0;
  const r = createRuntime({ director: true, chatRaw: async () => {
    round++;
    if (round <= 2) return { text: '', tool_calls: [{ id: 'call-' + round, function: { name: 'npc_offer_reward', arguments: { reward: { kind: 'money', amount: round === 1 ? 9999 : 5 }, message: '请收下。' } } }] };
    return { text: '想请你喝茶。', tool_calls: [] };
  } });
  r.context.GameLogger = { debug(event, data) { entries.push({ event, data: JSON.parse(JSON.stringify(data)) }); } };
  const job = r.director.enqueue('lin', { type: 'chat', text: '你好，这是完整发言。' });
  const result = await r.director.runDecision(job.id); assert.equal(result.ok, true);
  assert.equal(entries.find(e => e.event === 'npc-job-enqueued').data.job.text, '你好，这是完整发言。');
  const calls = entries.filter(e => e.event === 'npc-tool-call'); assert.equal(calls.length, 2);
  assert.equal(calls[0].data.context.decisionId, job.id);
  assert.equal(calls[0].data.detail.arguments.reward.amount, 9999);
  assert.deepEqual(entries.filter(e => e.event === 'npc-tool-result').map(e => e.data.detail.result.status), ['REJECTED', 'STAGED']);
  const committed = entries.find(e => e.event === 'npc-turn-committed').data;
  assert.equal(committed.content, '想请你喝茶。');
  assert.equal(committed.playerBefore.money, committed.playerAfter.money);
  const offer = Object.values(r.db.offers)[0];
  assert.equal(r.tools.resolveOffer(offer.id, 'accepted').ok, true);
  const receipt = entries.find(e => e.event === 'npc-offer-resolved').data;
  assert.equal(receipt.playerAfter.money - receipt.playerBefore.money, 5);
  assert.equal(receipt.offer.status, 'accepted');
  assert.equal(r.tools.resolveOffer(offer.id, 'accepted').ok, false);
  assert.ok(entries.some(e => e.event === 'npc-offer-rejected'));
});

test('failed final reply never logs a committed turn and logger errors cannot alter gameplay', async () => {
  const events = [];
  const r = createRuntime({ director: true, chatRaw: async () => ({ text: '', tool_calls: [] }) });
  r.context.GameLogger = { debug(event) { events.push(event); } };
  const job = r.director.enqueue('lin', {text:'你好'});
  assert.equal((await r.director.runDecision(job.id)).ok, false);
  assert.ok(events.includes('npc-tool-run-ended')); assert.ok(!events.includes('npc-turn-committed'));
  const healthy = createRuntime({ director: true });
  healthy.context.GameLogger = { debug() { throw new Error('logging unavailable'); } };
  assert.equal((await healthy.director.runDecision(healthy.director.enqueue('lin', {text:'你好'}).id)).ok, true);
});
