const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const config = { enabled: true, provider: 'ollama', model: 'fixture', temperature: 0.8, maxTokens: 64, apiKey: 'never-record-config' };
const response = (data, ok = true) => ({ ok, status: ok ? 200 : 502, text: async () => JSON.stringify(data) });
function load(context, file) { vm.runInContext(fs.readFileSync('src/scripts/' + file, 'utf8'), context); }
function harness(fetch) {
  const context = { JSON, AbortController, console, State: { variables: {} }, fetch: async (url, options) => {
    if (url === '/api/llm/config') return response({ ok: true, config });
    return fetch(url, options);
  } };
  context.window = context; vm.createContext(context);
  load(context, 'llm-trace.js'); load(context, 'llm-client.js');
  return context;
}
function latest(h) { return h.LLMTrace.get(h.LLMTrace.list()[0].id); }

test('trace captures actual request boundary, immutable snapshots and reply without config secrets', async () => {
  let sent;
  const h = harness((url, options) => { sent = JSON.parse(options.body); return response({ text: '<script>unsafe</script>', finishReason: 'stop', requestId: 'server-id' }); });
  const messages = [{ role: 'system', content: '规则\n=== 玩家 ===\n玩家信息' }, { role: 'user', content: 'hello' }];
  await h.LLMEngine.chat(messages, { operation: 'chat', maxTokens: 100 });
  messages[1].content = 'mutated';
  const entry = latest(h);
  assert.deepEqual(entry.payload, sent);
  assert.equal(entry.status, 'success');
  assert.equal(entry.response.text, '<script>unsafe</script>');
  assert.equal(entry.response.finishReason, 'stop');
  assert.equal(JSON.stringify(entry).includes('never-record-config'), false);
  entry.payload.messages[0].content = 'changed';
  assert.notEqual(latest(h).payload.messages[0].content, 'changed');
  assert.deepEqual(h.State.variables, { llmConfig: config }); // trace itself is not saved
});

test('generate prompt and chat string wrapping both capture exactly what the proxy receives', async () => {
  const h = harness(() => response({ text: 'ok' }));
  await h.LLMEngine.generate('scene'); assert.equal(latest(h).payload.prompt, 'scene');
  await h.LLMEngine.chat('hi'); assert.deepEqual(latest(h).payload.messages, [{ role: 'user', content: 'hi' }]);
});

test('two tool rounds correlate call arguments, rejection/staging results, replay history and final commit', async () => {
  let count = 0;
  const calls = [{ id: 'c1', type: 'function', function: { name: 'give', arguments: '{"amount":1}' } },
    { id: 'c2', type: 'function', function: { name: 'missing', arguments: '{}' } }];
  const h = harness(() => response(count++ ? { text: '请收下。' } : { text: '稍等', tool_calls: calls, message: { thinking: 'hidden-thought' } }));
  load(h, 'llm-tool-runner.js');
  const controller = new AbortController();
  const result = await h.LLMToolRunner.run({
    messages: [{ role: 'user', content: '谢谢' }], operation: 'npc-agency',
    promptAssembly: { source: 'fixture', rule: 'ordered' },
    tools: [{ type: 'function', function: { name: 'give' } }],
    scope: { signal: controller.signal, isCurrent: () => true },
    debugContext: { decisionId: 'd1' }, stage: () => ({ status: 'STAGED' })
  });
  assert.equal(result.status, 'completed');
  const list = h.LLMTrace.list(); assert.equal(list.length, 2);
  const first = h.LLMTrace.get(list[1].id), last = latest(h);
  assert.equal(first.traceContext.runId, last.traceContext.runId);
  assert.equal(first.traceContext.round, 1); assert.equal(last.traceContext.round, 2);
  assert.deepEqual(first.response.tool_calls, calls);
  assert.deepEqual(first.events.filter(e => e.name === 'npc-tool-result').map(e => e.detail.result.status), ['STAGED', 'REJECTED']);
  assert.deepEqual(last.payload.messages.map(m => m.role), ['user', 'assistant', 'tool', 'tool']);
  assert.equal(last.response.text, '请收下。');
  assert.equal(JSON.stringify(last).includes('hidden-thought'), false);
  assert.equal(last.assembly.source, 'fixture');
  h.LLMTrace.decision('d1', { ok: true });
  assert.equal(latest(h).decision.ok, true);
  assert.equal(h.LLMTrace.get(first.id).decision.ok, true);
});

test('failed/empty HTTP responses and cancellation remain inspectable, with no late success overwrite', async () => {
  const failed = harness(() => response({ error: 'provider failed' }, false));
  await assert.rejects(failed.LLMEngine.chat('hi'), /provider failed/);
  assert.equal(latest(failed).status, 'failed'); assert.equal(latest(failed).error.status, 502);
  const empty = harness(() => response({ text: '' }));
  await assert.rejects(empty.LLMEngine.chat('hi'));
  assert.equal(latest(empty).error.code, 'EMPTY_RESPONSE');
  let resolveFetch, started; const ready = new Promise(resolve => { started = resolve; });
  const h = harness(() => new Promise(resolve => { resolveFetch = resolve; started(); }));
  const controller = new AbortController(); const pending = h.LLMEngine.chat('hi', { signal: controller.signal });
  await ready; assert.equal(latest(h).status, 'pending'); controller.abort();
  await assert.rejects(pending); resolveFetch(response({ text: 'late' }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(latest(h).status, 'cancelled');
});

test('concurrent requests do not mix events or replies', async () => {
  const pending = [];
  const h = harness((url, options) => new Promise(resolve => pending.push({ resolve, input: JSON.parse(options.body) })));
  const a = h.LLMEngine.chat('A'), b = h.LLMEngine.chat('B');
  await new Promise(resolve => setImmediate(resolve));
  pending[1].resolve(response({ text: 'reply B' })); await b;
  pending[0].resolve(response({ text: 'reply A' })); await a;
  h.LLMTrace.list().forEach(item => { const entry = h.LLMTrace.get(item.id); assert.equal(entry.response.text, 'reply ' + entry.payload.messages[0].content); });
});

test('bounded redacted history handles credentials, nested JSON strings, reasoning and very large inputs', () => {
  const h = harness(() => {}), trace = h.LLMTrace;
  for (let i = 0; i < 16; i++) trace.record('id' + i, { startedAt: i + 1, status: 'pending', payload: {
    messages: [{ role: 'user', content: 'secret="test-secret" authorization: Bearer test-token' }],
    tools: [{ function: { arguments: '{"password":"nested-secret","reasoning_content":"private"}' } }], thinking: 'private-thought', apiKey: 'key-secret'
  } });
  assert.equal(trace.list().length, 12);
  const value = JSON.stringify(latest(h));
  ['test-secret', 'test-token', 'nested-secret', 'private-thought', 'key-secret'].forEach(secret => assert.equal(value.includes(secret), false));
  trace.record('large', { startedAt: 20, payload: { messages: Array.from({ length: 30 }, () => ({ role: 'user', content: 'x'.repeat(100000) })), tools: [] } });
  assert.ok(JSON.stringify(latest(h)).includes('[truncated:'));
  assert.ok(Array.isArray(latest(h).payload.messages));
  for (let i = 0; i < 80; i++) trace.event('large', 'tool-result', { value: 'x'.repeat(20000) });
  assert.equal(latest(h).events.length, 60); assert.equal(latest(h).eventsTruncated, true);
});

test('diagnostic failures cannot prevent the actual model request', async () => {
  const h = harness(() => response({ text: 'ok' }));
  h.LLMTrace.record = () => { throw new Error('debug failure'); };
  assert.equal(await h.LLMEngine.chat('hi'), 'ok');
});

test('retries sharing a decision ID do not overwrite the earlier attempt outcome', () => {
  const h = harness(() => {});
  [1, 2].forEach(attempt => h.LLMTrace.record('attempt-' + attempt, { startedAt: attempt, traceContext: { context: { decisionId: 'same-id', traceAttemptId: attempt } } }));
  h.LLMTrace.decision('same-id', { ok: false }, 1);
  h.LLMTrace.decision('same-id', { ok: true }, 2);
  assert.equal(h.LLMTrace.get('attempt-1').decision.ok, false);
  assert.equal(h.LLMTrace.get('attempt-2').decision.ok, true);
});

test('history total-size trimming keeps newest request within the overall budget', () => {
  const h = harness(() => {});
  for (let i = 0; i < 12; i++) {
    h.LLMTrace.record('sized-' + i, { startedAt: i + 1, payload: { messages: [{ content: 'a'.repeat(80000) }, { content: 'b'.repeat(80000) }, { content: 'c'.repeat(80000) }] } });
    h.LLMTrace.record('sized-' + i, { response: { text: 'd'.repeat(80000), tool_calls: [{ function: { arguments: 'e'.repeat(80000) } }, { function: { arguments: 'f'.repeat(80000) } }] } });
  }
  const list = h.LLMTrace.list();
  assert.equal(list[0].id, 'sized-11');
  assert.ok(list.length < 12);
  assert.ok(list.reduce((sum, item) => sum + JSON.stringify(h.LLMTrace.get(item.id)).length, 0) <= 4000000);
});
