const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const hooks = new Map();
  const context = { AbortController, Set, Map, console, document: {}, State: {
    variables: { location: 'Park', position: { areaId: 'path' }, time: { day: 1 }, player: { money: 1, inventory: {} } },
    passage: 'NPCChat', activeIndex: 1
  } };
  context.window = context;
  context.jQuery = () => ({ on(names, callback) { names.split(' ').forEach(name => hooks.set(name.split('.')[0], callback)); } });
  context.Config = { saves: { onLoad() { context.previousLoads = (context.previousLoads || 0) + 1; } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('src/scripts/llm-operation-scope.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('src/scripts/llm-tool-runner.js', 'utf8'), context);
  return { context, scope: context.LLMOperationScope.create({ actorId: 'actor', npcId: 'npc' }), emit(type) { hooks.get(type)({ type }); } };
}

const tools = [{ type: 'function', function: { name: 'give', parameters: { type: 'object' } } }];
const call = (args, id) => ({ id, type: 'function', function: { name: 'give', arguments: args } });
function run(h, responses, extra = {}) {
  return h.context.LLMToolRunner.run({ messages: [{ role: 'user', content: '谢谢' }], tools, scope: h.scope,
    stage: () => ({ status: 'STAGED' }), chatRaw: async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    }, ...extra });
}

test('ordered staging, object/string args, preserved/generated IDs and full assistant/tool history', async () => {
  const h = harness();
  const input = [{ role: 'user', content: '谢谢' }];
  const draft = [];
  const seen = [];
  let requests = 0;
  const result = await run(h, [], { messages: input, draft, stage: async (c, d) => {
    assert.equal(d, draft);
    assert.equal(c.callSlot, d.length);
    await Promise.resolve();
    d.push(c.arguments.amount);
    return { status: 'STAGED', count: d.length };
  }, chatRaw: async (messages, options) => {
    assert.equal(options.tools, tools);
    assert.equal(options.signal.aborted, false);
    seen.push(JSON.parse(JSON.stringify(messages)));
    return requests++ === 0 ? { text: '', tool_calls: [call('{"amount":1}', 'provider-id'), call({ amount: 2 })], message: { thinking: '考虑' } }
      : { text: '请收下。', tool_calls: [] };
  } });
  assert.equal(result.status, 'completed');
  assert.equal(result.content, '请收下。');
  assert.deepEqual(draft, [1, 2]);
  assert.equal(input.length, 1);
  const history = seen[1];
  assert.equal(history[1].thinking, '考虑');
  assert.equal(history[1].tool_calls[0].id, 'provider-id');
  assert.equal(history[2].tool_call_id, history[1].tool_calls[0].id);
  assert.equal(history[3].tool_call_id, history[1].tool_calls[1].id);
  assert.notEqual(history[2].tool_call_id, history[3].tool_call_id);
  assert.equal(result.messages.at(-1).content, result.content);
});

test('format, unknown tool and business rejections are repairable; repeated invalid arguments do not re-stage', async () => {
  const h = harness();
  const invoked = [];
  const result = await run(h, [
    { tool_calls: [call('{', 'bad-json'), { function: { name: 'move_player', arguments: {} } }, call({ amount: -1 }, 'bad1')] },
    { tool_calls: [call('{"amount":-1}', 'bad2'), call({ amount: 2 }, 'good')] },
    { text: '好的。' }
  ], { stage(c) {
    invoked.push(c.arguments.amount);
    return c.arguments.amount < 0 ? { status: 'REJECTED', error: '金额不能为负' } : { status: 'STAGED' };
  } });
  assert.equal(result.status, 'completed');
  assert.deepEqual(invoked, [-1, 2]);
  assert.deepEqual(Array.from(result.toolResults, row => row.result.status), ['REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'STAGED']);
});

test('empty final, network failure after staging and invalid stage contract cannot expose a completed turn', async () => {
  for (const ending of [{ text: '  ' }, new Error('network failed')]) {
    const h = harness();
    const input = [{ role: 'user', content: '你好' }];
    const result = await run(h, [{ tool_calls: [call({})] }, ending], { messages: input });
    assert.equal(result.status, 'failed');
    assert.equal(result.content, '');
    assert.equal(result.messages.length, 0);
    assert.equal(input.length, 1);
    assert.equal(result.callCount, 1);
  }
  const result = await run(harness(), [{ tool_calls: [call({})] }], { stage: () => ({ ok: true }) });
  assert.equal(result.error.code, 'INVALID_STAGE_RESULT');
});

test('round and call limits are explicit failures; oversized batches are not partially staged', async () => {
  for (const limits of [{ maxRounds: 1 }, { maxCalls: 1 }]) {
    let staged = 0;
    const result = await run(harness(), [{ tool_calls: [call({}), call({})] }], {
      ...limits, stage() { staged++; return { status: 'STAGED' }; }
    });
    assert.equal(result.status, 'limit_reached');
    assert.equal(result.content, '');
    assert.equal(staged, 0);
  }
  const result = await run(harness(), [{ tool_calls: [call({})] }, { tool_calls: [call({})] }], { maxRounds: 2 });
  assert.equal(result.status, 'limit_reached');
  assert.equal(result.callCount, 1);
});

test('cancel while request or stage is pending settles promptly and aborts per-run transport', async () => {
  for (const duringStage of [false, true]) {
    const h = harness();
    const external = new AbortController();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let transport;
    const promise = run(h, [], { signal: external.signal,
      chatRaw: async (messages, options) => {
        transport = options.signal;
        if (duringStage) return { tool_calls: [call({})] };
        started();
        return new Promise(() => {});
      }, stage() { started(); return new Promise(() => {}); }
    });
    await ready;
    external.abort();
    const result = await promise;
    assert.equal(result.status, 'cancelled');
    assert.equal(transport.aborted, true);
  }
});

test('save load and history navigation invalidate a late model response and old delayed callbacks', async () => {
  for (const action of ['save', ':historyupdate', ':passageinit']) {
    const h = harness();
    let respond;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const promise = run(h, [], { chatRaw: () => new Promise(resolve => { respond = resolve; started(); }) });
    await ready;
    if (action === 'save') h.context.Config.saves.onLoad({});
    else h.emit(action);
    respond({ text: '太迟了' });
    const result = await promise;
    assert.equal(result.status, 'stale');
    assert.equal(h.scope.isCurrent(), false);
    assert.equal(h.scope.signal.aborted, true);
    if (action === 'save') assert.equal(h.context.previousLoads, 1);
    assert.equal(h.context.LLMOperationScope.create({}).isCurrent(), true);
  }
});

test('scope rejects same-page state replacement, resource/time changes and custom revision mismatch', () => {
  const changes = [h => { h.context.State.variables = { ...h.context.State.variables }; },
    h => { h.context.State.variables.player.money++; }, h => { h.context.State.variables.time.day++; },
    h => { h.context.State.variables.position.areaId = 'other'; }, h => { h.context.State.variables.activeNPCId = 'other'; }];
  for (const change of changes) {
    const h = harness(); change(h);
    assert.equal(h.scope.isCurrent(), false);
    assert.equal(h.scope.signal.reason.code, 'STALE_SCOPE');
  }
  const h = harness(); let revision = 1;
  const scope = h.context.LLMOperationScope.create({ npcId: 'npc', revision, validate: s => s.revision === revision });
  assert.equal(scope.npcId, 'npc');
  revision++;
  assert.equal(scope.isCurrent(), false);
  assert.equal(JSON.stringify(h.context.State.variables).includes('sessionEpoch'), false);
});

test('manual invalidation and AbortError are cancellation, truncation is failure, text-only is valid', async () => {
  const h = harness(); h.scope.invalidate('用户取消');
  assert.equal((await run(h, [{ text: '不应返回' }])).status, 'cancelled');
  const aborted = new Error('aborted'); aborted.name = 'AbortError';
  assert.equal((await run(harness(), [aborted])).status, 'cancelled');
  assert.equal((await run(harness(), [{ text: '未完成', finishReason: 'length' }])).status, 'failed');
  assert.equal((await run(harness(), [{ text: '只道谢，不送礼。' }])).status, 'completed');
});

test('a stage invalidating its own context prevents later tools and final request', async () => {
  const h = harness(); let staged = 0;
  const result = await run(h, [{ tool_calls: [call({}), call({})] }, { text: 'no' }], { stage() {
    staged++; h.context.LLMOperationScope.invalidate('load'); return { status: 'STAGED' };
  } });
  assert.equal(staged, 1);
  assert.equal(result.status, 'stale');
});

test('scope hooks work with bundled SugarCube State.create/goTo/unmarshalForSave (not simulated events)', () => {
  const h = harness();
  const raw = fs.readFileSync('tools/storyformats/sugarcube-2/format.js', 'utf8');
  const format = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  assert.equal(format.version, '2.30.0');
  const start = format.source.indexOf('State=function()');
  const end = format.source.indexOf(',Scripting=function()', start);
  assert.ok(start > 0 && end > start);
  Object.assign(h.context, {
    session: { set() {}, delete() {}, has() { return false; } },
    clone: value => JSON.parse(JSON.stringify(value)),
    _typeof: value => typeof value,
    _toConsumableArray: value => Array.from(value),
    Patterns: { variableSigil: '[$_]', identifier: '[a-z]+', identifierFirstChar: '[a-z]' },
    Diff: { diff: () => ({}) }
  });
  h.context.Config.history = { maxStates: 40 };
  h.context.jQuery.event = { trigger: type => h.emit(type) };
  vm.runInContext(format.source.slice(start, end) + ';', h.context);
  const state = h.context.State;
  state.create('One');
  state.variables.location = 'Park';
  const one = h.context.LLMOperationScope.create({});
  state.create('Two');
  assert.equal(one.signal.aborted, true);
  const two = h.context.LLMOperationScope.create({});
  state.goTo(0);
  assert.equal(two.signal.aborted, true);
  const backward = h.context.LLMOperationScope.create({});
  state.goTo(1);
  assert.equal(backward.signal.aborted, true);
  const saved = state.marshalForSave();
  const beforeLoad = h.context.LLMOperationScope.create({});
  state.unmarshalForSave(saved);
  assert.equal(beforeLoad.signal.aborted, true);
  assert.equal(beforeLoad.isCurrent(), false);
  const beforeReset = h.context.LLMOperationScope.create({});
  state.reset();
  assert.equal(beforeReset.isCurrent(), false);
});
