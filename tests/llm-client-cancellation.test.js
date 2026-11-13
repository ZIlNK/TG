const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const config = { enabled: true, model: 'fixture', temperature: 0.8, maxTokens: 64 };
function response(data, ok = true) { return { ok, status: ok ? 200 : 502, text: async () => JSON.stringify(data) }; }
function harness(fetch) {
  const context = { AbortController, console, fetch: async (...args) => fetch(...args), State: { variables: {} } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('src/scripts/llm-client.js', 'utf8'), context);
  return context.LLMEngine;
}
const abort = error => error.name === 'AbortError' && error.code === 'CANCELLED';

test('pre-aborted signals reject without config or model fetch', async () => {
  const engine = harness(() => { throw new Error('must not fetch'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(engine.chatRaw([], { signal: controller.signal }), abort);
});

test('cancellation during shared configuration settles promptly without model request or fallback', async () => {
  let resolveConfig; let started; const ready = new Promise(resolve => { started = resolve; });
  let modelCalls = 0;
  const engine = harness(url => {
    if (url === '/api/llm/config') return new Promise(resolve => { resolveConfig = resolve; started(); });
    modelCalls++; return response({ text: 'late' });
  });
  const controller = new AbortController();
  const result = engine.chat('你好', { signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(result, abort);
  resolveConfig(response({ ok: true, config }));
  await engine.loadConfig();
  assert.equal(modelCalls, 0);
});

test('independent concurrent request signals; late cancelled response never emits chunk', async () => {
  const pending = [];
  const chunks = [];
  let ready; const both = new Promise(resolve => { ready = resolve; });
  const engine = harness((url, options) => {
    if (url === '/api/llm/config') return response({ ok: true, config });
    return new Promise(resolve => { pending.push({ resolve, signal: options.signal }); if (pending.length === 2) ready(); });
  });
  const controller = new AbortController();
  const first = engine.chat('first', { signal: controller.signal, onChunk: text => chunks.push(text) });
  const second = engine.chat('second');
  await both; controller.abort();
  await assert.rejects(first, abort);
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(pending[1].signal.aborted, false);
  pending[0].resolve(response({ text: 'late' }));
  pending[1].resolve(response({ text: 'second' }));
  assert.equal(await second, 'second');
  assert.deepEqual(chunks, []);
});

test('cancel during response body read rejects; legacy abort works during configuration', async () => {
  let started; const ready = new Promise(resolve => { started = resolve; });
  const engine = harness(url => url === '/api/llm/config' ? response({ ok: true, config })
    : { ok: true, status: 200, text() { started(); return new Promise(() => {}); } });
  const controller = new AbortController();
  const request = engine.generate('hi', { signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(request, abort);
  const blocked = harness(() => new Promise(() => {}));
  const legacy = blocked.generate('hi'); blocked.abort();
  await assert.rejects(legacy, abort);
});

test('empty responses and config errors reject; tool-only is valid only for chatRaw', async () => {
  for (const data of [{ text: '' }, { text: '  ', tool_calls: [] }, {}]) {
    const engine = harness(url => response(url === '/api/llm/config' ? { ok: true, config } : data));
    await assert.rejects(engine.chatRaw([]), error => error.code === 'EMPTY_RESPONSE');
  }
  const tool = { function: { name: 'give', arguments: {} } };
  const engine = harness(url => response(url === '/api/llm/config' ? { ok: true, config } : { tool_calls: [tool] }));
  const options = Object.freeze({ operation: 'npc-agency' });
  assert.equal((await engine.chatRaw([], options)).tool_calls.length, 1);
  await assert.rejects(engine.chat([]), error => error.code === 'EMPTY_RESPONSE');
  let calls = 0;
  const failed = harness(() => { calls++; throw new Error('config unavailable'); });
  await assert.rejects(failed.chat([]), /config unavailable/);
  assert.equal(calls, 1);
});

test('old generate/chat text response and HTTP errors remain compatible', async () => {
  const payloads = [];
  const engine = harness((url, options) => {
    if (url === '/api/llm/config') return response({ ok: true, config });
    payloads.push(JSON.parse(options.body));
    return response({ text: '你好' });
  });
  assert.equal(await engine.generate('a'), '你好');
  assert.equal(await engine.chat('b'), '你好');
  assert.equal(payloads[0].prompt, 'a');
  assert.equal(payloads[1].messages[0].content, 'b');
  const failed = harness(url => url === '/api/llm/config' ? response({ ok: true, config }) : response({ error: 'upstream failed' }, false));
  await assert.rejects(failed.chat([]), error => error.status === 502 && /upstream failed/.test(error.message));
});
