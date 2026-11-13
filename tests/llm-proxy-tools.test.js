const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const { EventEmitter } = require('node:events');

// Constructed protocol fixtures (not captured live model output), checked
// against Ollama tool-calling and OpenAI Chat Completions official docs.
const tools = [{ type: 'function', function: { name: 'give', description: '暂存礼物', parameters: { type: 'object' } } }];
function harness(provider, replies, endpoint) {
  const sent = [];
  const nativeRequire = createRequire(path.resolve('server/llm-proxy.js'));
  const context = { module: { exports: {} }, __dirname: path.resolve('server'), console, URL, AbortController,
    process: { env: { LLM_PROVIDER: provider, LLM_ENDPOINT: endpoint || 'http://fixture', LLM_CONFIG_FILE: 'unused' } },
    require(name) {
      if (name === './logger') return { write() {} };
      if (name === 'fs') return { existsSync: () => false };
      return nativeRequire(name);
    }, async fetch(url, options) {
      sent.push({ url, payload: JSON.parse(options.body), headers: options.headers });
      const data = replies.shift();
      if (typeof data === 'function') return data(options);
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(data) };
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('server/llm-proxy.js', 'utf8'), context);
  return { sent, proxy: context.module.exports, async handle(body) {
    const res = { writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
    await context.module.exports.handle({}, res, body, 'request-fixture');
    return res;
  } };
}

for (const provider of ['ollama', 'openai']) {
  test(provider + ' forwards tools and round-trips assistant/tool history without mutating input', async () => {
    const reply = provider === 'ollama'
      ? { message: { role: 'assistant', content: '', thinking: '考虑礼物', tool_calls: [{ function: { name: 'give', arguments: { amount: 2 } } }] }, done_reason: 'stop' }
      : { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'upstream-id', type: 'function', function: { name: 'give', arguments: '{"amount":2}' } }] }, finish_reason: 'tool_calls' }] };
    const finalReply = provider === 'ollama' ? { message: { content: '请收下' } } : { choices: [{ message: { content: '请收下' }, finish_reason: 'stop' }] };
    const h = harness(provider, [reply, finalReply]);
    const first = await h.handle({ messages: [{ role: 'user', content: '谢谢' }], tools });
    assert.equal(first.status, 200);
    assert.deepEqual(h.sent[0].payload.tools, tools);
    const call = first.body.tool_calls[0];
    assert.equal(typeof call.id, 'string');
    assert.deepEqual(JSON.parse(call.function.arguments), { amount: 2 });
    if (provider === 'openai') assert.equal(call.id, 'upstream-id');
    assert.equal(first.body.message.tool_calls[0].id, call.id);
    const history = [{ role: 'user', content: '谢谢' }, first.body.message,
      { role: 'tool', tool_call_id: call.id, content: '{"status":"STAGED"}' }];
    const original = JSON.stringify(history);
    const second = await h.handle({ messages: history, tools });
    assert.equal(second.status, 200);
    assert.equal(second.body.text, '请收下');
    assert.equal(JSON.stringify(history), original);
    const outbound = h.sent[1].payload.messages;
    if (provider === 'ollama') {
      assert.match(h.sent[0].url, /\/api\/chat$/);
      assert.deepEqual(outbound[1].tool_calls[0], { function: { name: 'give', arguments: { amount: 2 } } });
      assert.equal(outbound[1].thinking, '考虑礼物');
      assert.equal(outbound[2].tool_name, 'give');
      assert.equal('tool_call_id' in outbound[2], false);
    } else {
      assert.match(h.sent[0].url, /\/v1\/chat\/completions$/);
      assert.equal(outbound[1].tool_calls[0].id, call.id);
      assert.equal(outbound[2].tool_call_id, call.id);
      assert.equal('tool_name' in outbound[2], false);
    }
  });

  test(provider + ' accepts other provider argument shape, preserves IDs, and supports tool-free requests', async () => {
    const calls = [{ id: 'id-1', function: { name: 'give', arguments: provider === 'ollama' ? '{"amount":1}' : { amount: 1 } } }];
    const reply = provider === 'ollama' ? { message: { content: '', tool_calls: calls } } : { choices: [{ message: { tool_calls: calls } }] };
    const h = harness(provider, [reply, provider === 'ollama' ? { response: '旧文本', done_reason: 'stop' }
      : { choices: [{ message: { content: [{ type: 'text', text: '旧文本' }] } }] }]);
    const first = await h.handle({ messages: [], tools });
    assert.equal(first.body.tool_calls[0].id, 'id-1');
    assert.deepEqual(JSON.parse(first.body.tool_calls[0].function.arguments), { amount: 1 });
    const second = await h.handle({ prompt: 'legacy' });
    assert.equal(second.body.text, '旧文本');
    assert.equal('tools' in h.sent[1].payload, false);
    if (provider === 'ollama') assert.match(h.sent[1].url, /\/api\/generate$/);
    else assert.deepEqual(h.sent[1].payload.messages, [{ role: 'user', content: 'legacy' }]);
  });
}

test('Ollama tools with prompt route to chat; name resolves legacy result while ambiguous/orphan IDs reject', async () => {
  const reply = { message: { content: '好' } };
  const h = harness('ollama', [reply, reply]);
  assert.equal((await h.handle({ prompt: 'hello', tools })).status, 200);
  assert.deepEqual(h.sent[0].payload.messages, [{ role: 'user', content: 'hello' }]);
  const calls = [{ function: { name: 'give', arguments: {} } }];
  const result = await h.handle({ messages: [{ role: 'assistant', tool_calls: calls }, { role: 'tool', tool_name: 'give', content: 'STAGED' }] });
  assert.equal(result.status, 200);
  assert.equal(h.sent[1].payload.messages[1].tool_name, 'give');
  assert.equal((await h.handle({ messages: [{ role: 'tool', tool_call_id: 'orphan', content: 'STAGED' }] })).status, 400);
  assert.equal((await h.handle({ messages: [{ role: 'assistant', tool_calls: [calls[0], calls[0]] }, { role: 'tool', tool_name: 'give', content: 'STAGED' }] })).status, 400);
});

test('OpenAI /v1 configured base avoids duplicate version; Ollama thinking does not leak into OpenAI payload', async () => {
  const h = harness('openai', [{ choices: [{ message: { content: '好' } }] }], 'http://fixture/v1/');
  await h.handle({ messages: [{ role: 'assistant', content: 'test', thinking: 'private', reasoning_content: 'compatible' }] });
  assert.equal(h.sent[0].url, 'http://fixture/v1/chat/completions');
  assert.equal('thinking' in h.sent[0].payload.messages[0], false);
  assert.equal(h.sent[0].payload.messages[0].reasoning_content, 'compatible');
});

test('malformed upstream tool envelope is a 502, not a successful empty response', async () => {
  const h = harness('ollama', [{ message: { tool_calls: [{ function: {} }] } }]);
  assert.equal((await h.handle({ messages: [], tools })).status, 502);
});

test('browser disconnect aborts only its own upstream request and removes lifecycle listeners', async () => {
  let started; const ready = new Promise(resolve => { started = resolve; });
  let signal;
  const h = harness('ollama', [options => new Promise((resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); });
    started();
  })]);
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.writeHead = () => assert.fail('must not write after disconnect');
  res.end = () => assert.fail('must not write after disconnect');
  const pending = h.proxy.handle(req, res, { messages: [], tools }, 'cancel-request');
  await ready;
  res.emit('close');
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(res.listenerCount('close'), 0);
  assert.equal(req.listenerCount('aborted'), 0);
});

test('runner + real Ollama adapter repairs malformed arguments without staging them or breaking history', async () => {
  const h = harness('ollama', [
    { message: { content: '', tool_calls: [{ function: { name: 'give', arguments: '{' } }] } },
    { message: { content: '', tool_calls: [{ function: { name: 'give', arguments: { amount: 3 } } }] } },
    { message: { content: '请收下。' }, done_reason: 'stop' }
  ]);
  const context = { AbortController, console }; context.window = context;
  vm.createContext(context);
  for (const file of ['llm-operation-scope.js', 'llm-tool-runner.js']) {
    vm.runInContext(fs.readFileSync('src/scripts/' + file, 'utf8'), context);
  }
  const staged = [];
  const result = await context.LLMToolRunner.run({ messages: [{ role: 'user', content: '谢谢' }], tools,
    scope: context.LLMOperationScope.create({}), stage(call) { staged.push(call.arguments.amount); return { status: 'STAGED' }; },
    async chatRaw(messages) {
      const response = await h.handle({ messages, tools });
      assert.equal(response.status, 200);
      return response.body;
    }
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(staged, [3]);
  assert.deepEqual(h.sent[1].payload.messages[1].tool_calls[0].function.arguments, {});
  assert.equal(JSON.parse(h.sent[1].payload.messages[2].content).status, 'REJECTED');
});
