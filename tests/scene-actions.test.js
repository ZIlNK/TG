const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.style = {}; this.attributes = {}; this._text = ''; this.classList = { add() {}, remove() {} }; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  set textContent(value) { this._text = String(value ?? ''); this.children.forEach((child) => { child.parentNode = null; }); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set innerHTML(value) { throw new Error('Model output must remain plain text: ' + value); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  get childNodes() { return this.children; }
  get isConnected() { return this.tagName === 'body' || !!this.parentNode?.isConnected; }
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  const macros = new Map(), events = new Map(), timers = [], requests = [], history = [], effects = [], world = [], errors = [], logs = [], toasts = [];
  const body = new Element('body');
  const state = { variables: { location: 'Street', position: { locationId: 'Street', areaId: 'food_stall' }, time: { day: 1, hour: 9, minute: 0 }, player: { name: '玩家甲', money: 25, stamina: 40, maxStamina: 80, health: 80, maxHealth: 100, hunger: 50, stress: 20, skills: { 感知: { value: 1, xp: 0 } } }, npcs: {}, characterCards: {}, generatedScenes: {}, llmSession: {}, activeNPCId: '' }, passage: 'DynamicScene', activeIndex: 1 };
  const context = {
    console: { log() {}, warn() {}, error() {} }, AbortController, Set,
    State: state, Config: { saves: {} }, setup: {},
    document: { body, createElement: (tag) => new Element(tag), createTextNode: (value) => { const node = new Element('#text'); node.textContent = value; return node; }, getElementById: () => null },
    jQuery: () => ({ on: (names, fn) => names.split(' ').forEach((name) => { const key = name.split('.')[0]; if (!events.has(key)) events.set(key, []); events.get(key).push(fn); }) }),
    Macro: { add: (name, value) => macros.set(name, value) },
    whenSugarCubeReady: (fn) => fn(), setTimeout: (fn) => { timers.push(fn); return timers.length; },
    passage: () => state.passage, Story: { has: () => true },
    Engine: { play: (name) => { state.passage = name; history.push(name); } },
    ModAPI: { on: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); }, trigger() {} },
    LLMEngine: { isAvailable: () => true },
    GameLogger: { debug: (event, data) => logs.push({ event, data }) },
    PromptBuilder: {
      sceneObjectPrompt: () => 'scene', scenePrompt: () => 'scene', npcPrompt: () => 'npc', optionsPrompt: () => 'options',
      hasProactiveDialogueCandidates: () => false, addToHistory: (...args) => history.push(args),
      worldEventPrompt: () => 'ambient', addWorldEvent: (...args) => world.push(args)
    },
    NarrativeUI: { createChatContainer: () => new Element('div'), showTyping() {}, hideTyping() {}, showError: (...args) => errors.push(args), showToast: (message) => toasts.push(message) },
    applyEffects: (value) => { effects.push(value); return []; },
    Math: Object.assign(Object.create(Math), { random: () => 0 })
  };
  context.$ = context.jQuery;
  ['chatRaw', 'chat', 'generate'].forEach((method) => { context.LLMEngine[method] = (input, options) => { const pending = deferred(); requests.push({ method, input, options, ...pending }); return pending.promise; }; });
  context.window = context;
  vm.createContext(context);
  function load(file) { vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/scripts/', file), 'utf8'), context); }
  load('llm-operation-scope.js'); load('llm-structured.js'); load('llm-macros.js'); load('scene-option-tools.js'); load('llm-tool-runner.js'); load('movement.js'); load('scene-actions.js');
  context.RegionSystem.ensure();
  return { context, state, requests, timers, history, effects, world, errors, logs, toasts, body, load,
    emit: (name) => (events.get(name) || []).forEach((fn) => fn({ type: name })),
    render: (name, args = []) => { const output = body.appendChild(new Element('div')); macros.get(name).handler.call({ args, output }); return output; }
  };
}

function registration(args, requestId = 'registration') { return { text: '', requestId, tool_calls: [{ id: 'register-1', type: 'function', function: { name: 'register_scene_options', arguments: JSON.stringify(args) } }] }; }
const plain = (value) => JSON.parse(JSON.stringify(value));
const observe = () => ({ label: '打量摊位', action: { type: 'scene_action', intent: '留意摊位上的价目表和人群动静' } });
const buy = () => ({ label: '买煎饼配豆浆', action: { type: 'scene_action', intent: '买一份煎饼配豆浆，坐下吃完', purchase: { productId: 'breakfast-combo' } } });
const move = () => ({ label: '到便利店门口', tool: { name: 'move_player', arguments: { locationId: 'street', areaId: 'convenience_store_entrance' } } });
const talk = () => ({ label: '和周岚搭话', tool: { name: 'start_dialogue', arguments: { npcName: '周岚', openingLine: '早上好' } } });
const choices = () => [observe(), move()];
const resultArgs = (effects = {}) => ({ description: '你吃完早餐，热气逐渐散去。', options: choices(), effects });
const response = (args, id = 'resolve-1') => ({ text: '', tool_calls: [{ id, type: 'function', function: { name: 'resolve_scene_action', arguments: JSON.stringify(args) } }] });
const click = (node) => node.listeners.click({ preventDefault() {} });
function ready(h, option = buy()) {
  assert.equal(h.context.SceneActions.begin(option, { text: '铁板冒着热气。<img src=x> <<set $player.money=999>>', title: '早餐摊', returnTo: { passage: 'DynamicScene', dynamicSceneId: 'source' } }).ok, true);
  return h.context.SceneActions.run();
}
function npcAvailable(h) {
  h.context.PromptBuilder.hasProactiveDialogueCandidates = () => true;
  h.context.NPCState = { currentPosition: () => h.state.variables.position, resolveSpeaker: () => ({ present: { id: 'zhoulan' } }) };
}

test('original reply exposes each rejection and fixes only the registered movement ID without mutating raw options', () => {
  const h = harness(); npcAvailable(h);
  const raw = [buy(), talk(), observe(), move()];
  for (const i of [0, 2]) { delete raw[i].action; raw[i].tool = { name: 'start_dialogue', arguments: { npcName: '', openingLine: '' } }; }
  const before = JSON.stringify(raw), meta = {};
  const normalized = h.context.SceneOptions.normalize(raw, meta);
  assert.equal(normalized.length, 2); assert.equal(meta.report.generated, 4); assert.equal(meta.report.rejected, 2);
  assert.match(meta.report.entries[0].reason, /npcName/);
  assert.equal(normalized[1].tool.arguments.locationId, 'Street');
  assert.deepEqual(plain(meta.report.entries[3].corrections), [{ field: 'locationId', from: 'street', to: 'Street' }]);
  assert.equal(JSON.stringify(raw), before); assert.equal(h.logs.at(-1).event, 'scene-options-normalized');
});

test('new four-route scene travels through generation, storage and safe rendering with no render-time settlement', async () => {
  const h = harness(); const initial = JSON.stringify(h.state.variables.player);
  h.context.PromptBuilder.dialogueTool = () => ({ type: 'function', function: { name: 'start_dialogue' } }); npcAvailable(h);
  const original = { id: 'breakfast', title: '早餐摊', text: '人群与铁板', options: [buy(), observe(), talk(), move()] };
  h.render('llmscene2'); h.requests[0].resolve(registration(original, 'req-breakfast')); await flush();
  const stored = h.state.variables.generatedScenes.breakfast; assert.ok(stored); assert.equal(stored.options.length, 4);
  h.state.variables.dynamicSceneId = 'breakfast'; const output = h.render('sceneoptions'), root = output.children[0];
  assert.deepEqual(root.children.map((node) => node.textContent), original.options.map((option) => option.label));
  assert.equal(JSON.stringify(h.state.variables.player), initial); assert.equal(h.effects.length, 0);
  assert.equal(h.logs.find((log) => log.event === 'scene-options-stored').data.options.length, 4);
  assert.equal(h.logs.at(-1).data.count, 4);
  click(root.children[0]); click(root.children[0]);
  assert.equal(h.state.variables.sceneActionSequence, 1); assert.equal(h.state.passage, 'SceneAction'); assert.equal(h.state.variables.player.money, 25);
});

test('scenechoices remain clickable when SugarCube moves macro children out of a detached fragment', () => {
  const h = harness(); h.state.variables.dynamicSceneId = 'saved';
  h.state.variables.generatedScenes.saved = { id: 'saved', options: [observe()], text: '现场' };
  const output = h.render('sceneoptions'); const root = output.children[0];
  output.removeChild(root); h.body.appendChild(root); output.remove();
  assert.equal(output.isConnected, false); click(root.children[0]); assert.equal(h.state.passage, 'SceneAction');
});

test('purchase is staged until the final confirmation then debits once and applies authored consumable effects only', async () => {
  const h = harness(), pending = ready(h); await flush();
  assert.equal(h.requests[0].options.operation, 'scene-action');
  assert.match(h.requests[0].input[1].content, /铁板冒着热气/); assert.match(h.requests[0].input[1].content, /坐下吃完/);
  const assembly = h.requests[0].options.promptAssembly; assert.equal(assembly.source, 'SceneActions.messagesFor'); assert.equal(assembly.sections[1].messageIndex, 1);
  h.requests[0].resolve(response(resultArgs())); await flush();
  assert.equal(h.state.variables.player.money, 25); assert.equal(Object.keys(h.state.variables.generatedScenes).length, 0);
  assert.match(h.requests[1].input.at(-1).content, /STAGED/);
  h.requests[1].resolve({ text: '已完成。' }); const result = await pending;
  assert.equal(result.ok, true); assert.equal(h.state.variables.player.money, 17);
  assert.equal(h.state.variables.player.stamina, 48); assert.equal(h.state.variables.player.hunger, 30); assert.equal(h.state.variables.player.stress, 17);
  assert.equal(h.state.variables.sceneAction.status, 'completed');
  const duplicate = await h.context.SceneActions.run(); assert.equal(duplicate.duplicate, true); assert.equal(h.requests.length, 2); assert.equal(h.state.variables.player.money, 17);
  assert.equal(h.logs.filter((entry) => entry.event === 'scene-action-committed').length, 1);
  assert.equal(h.state.variables.npcAgency, undefined); assert.equal(h.state.variables.questEvents, undefined);
});

for (const invalid of ['balance', 'unknown-product', 'injected-price', 'wrong-place', 'ambiguous-route']) test('rejects ' + invalid + ' before a purchase request', () => {
  const h = harness(), option = buy();
  if (invalid === 'balance') h.state.variables.player.money = 7;
  if (invalid === 'unknown-product') option.action.purchase.productId = 'free-gold';
  if (invalid === 'injected-price') option.action.purchase.price = 0;
  if (invalid === 'wrong-place') h.state.variables.position.areaId = 'street_main';
  if (invalid === 'ambiguous-route') option.tool = talk().tool;
  const before = JSON.stringify(h.state.variables);
  const result = invalid === 'ambiguous-route' ? h.context.SceneOptions.normalize([option]) : h.context.SceneActions.begin(option);
  assert.equal(invalid === 'ambiguous-route' ? result.length : result.ok, invalid === 'ambiguous-route' ? 0 : false);
  assert.equal(JSON.stringify(h.state.variables), before); assert.equal(h.requests.length, 0);
});

test('observation applies bounded existing skill XP, safely normalizes text, and ignores option-side rewards', async () => {
  const h = harness(); h.context.normalizeLLMText = (text) => text.replace(/\\n/g, '\n');
  const option = observe(); option.effects = { money: 999, skills: { 感知: 999 } };
  const normalized = h.context.SceneOptions.normalize([option])[0]; assert.deepEqual(plain(normalized.effects), {});
  const pending = ready(h, normalized); await flush(); const args = resultArgs({ skills: { 感知: 4 } });
  args.description = '<img src=x>\\n<<set $player.money=999>>';
  h.requests[0].resolve(response(args)); await flush(); h.requests[1].resolve({ text: '完成' }); const result = await pending;
  assert.equal(result.ok, true); assert.equal(h.state.variables.player.money, 25); assert.equal(h.state.variables.player.skills.感知.xp, 4);
  assert.equal(h.state.variables.generatedScenes[result.sceneId].text, '<img src=x>\n<<set $player.money=999>>');
});

for (const invalid of [{ money: 50 }, { skills: { 未知: 4 } }, { skills: { 感知: 5 } }, { stamina: 11 }, { hunger: 1.5 }]) test('rejected effect can be repaired within tool loop: ' + JSON.stringify(invalid), async () => {
  const h = harness(), pending = ready(h, observe()); await flush();
  h.requests[0].resolve(response(resultArgs(invalid))); await flush();
  assert.match(h.requests[1].input.at(-1).content, /REJECTED/); assert.equal(h.state.variables.player.money, 25);
  h.requests[1].resolve(response(resultArgs({ stress: -2 }), 'repaired')); await flush();
  assert.match(h.requests[2].input.at(-1).content, /STAGED/);
  h.requests[2].resolve({ text: '完成' }); assert.equal((await pending).ok, true); assert.equal(h.state.variables.player.stress, 18);
});

test('purchase refuses model-supplied effects even when bodily changes would be allowed for observation', async () => {
  const h = harness(), pending = ready(h); await flush();
  h.requests[0].resolve(response(resultArgs({ stamina: 3 }))); await flush(); assert.match(h.requests[1].input.at(-1).content, /REJECTED/);
  h.requests[1].resolve({ text: '算了' }); assert.equal((await pending).ok, false); assert.equal(h.state.variables.player.money, 25);
});

for (const failure of ['empty-final', 'truncated', 'cancel', 'load', 'leave', 'time', 'player-changed', 'world-changed']) test('staged purchase cannot commit after ' + failure, async () => {
  const h = harness(), pending = ready(h); await flush();
  h.requests[0].resolve(response(resultArgs())); await flush();
  if (failure === 'cancel') h.context.SceneActions.leave();
  if (failure === 'load') h.state.variables = plain(h.state.variables);
  if (failure === 'leave') { h.state.passage = 'Street'; h.emit(':passageinit'); }
  if (failure === 'time') h.state.variables.time.hour++;
  if (failure === 'player-changed') h.state.variables.player.stamina++;
  if (failure === 'world-changed') h.state.variables.regions.Street.name = '另一个世界';
  h.requests[1].resolve({ text: failure === 'empty-final' ? '' : '完成', finishReason: failure === 'truncated' ? 'length' : 'stop' });
  const result = await pending; assert.equal(result.ok, false); assert.equal(h.state.variables.player.money, 25);
  assert.equal(Object.keys(h.state.variables.generatedScenes).length, 0); assert.notEqual(h.state.variables.sceneAction.status, 'completed');
});

test('invalid next options are repaired before settlement, never silently lost', async () => {
  const h = harness(), pending = ready(h); await flush();
  const broken = resultArgs(); broken.options[0] = { label: '坏选项', tool: { name: 'start_dialogue', arguments: { npcName: '', openingLine: '' } } };
  h.requests[0].resolve(response(broken)); await flush();
  assert.match(h.requests[1].input.at(-1).content, /请修复选项/); assert.equal(h.state.variables.player.money, 25);
  h.requests[1].resolve(response(resultArgs(), 'fixed')); await flush(); h.requests[2].resolve({ text: '完成' }); assert.equal((await pending).ok, true);
});

test('history logging failure cannot turn a committed purchase into a reported transaction failure', async () => {
  const h = harness(); h.context.PromptBuilder.addToHistory = () => { throw new Error('history unavailable'); };
  const pending = ready(h); await flush(); h.requests[0].resolve(response(resultArgs())); await flush(); h.requests[1].resolve({ text: '完成' });
  assert.equal((await pending).ok, true); assert.equal(h.state.variables.player.money, 17);
  assert.ok(h.logs.find((entry) => entry.event === 'scene-action-history-failed'));
});

test('partial and completely invalid saved options visibly offer regeneration; no render-time effects', () => {
  for (const partial of [false, true]) {
    const h = harness(); h.state.variables.dynamicSceneId = 'broken';
    h.state.variables.generatedScenes.broken = { id: 'broken', text: '现场', options: [{ label: '坏选项', tool: { name: 'start_dialogue', arguments: {} } }].concat(partial ? [observe()] : []) };
    const output = h.render('sceneoptions'); assert.match(output.textContent, partial ? /部分行动生成无效/ : /行动选项生成无效/);
    assert.match(output.textContent, /重新生成行动选项/); assert.equal(h.effects.length, 0); assert.equal(h.requests.length, 0);
  }
});

test('options-only retry preserves settled state and guards duplicate clicks and truncated responses', async () => {
  const h = harness(); const scene = { id: 'settled', text: '吃过早餐后的现场', options: [] };
  h.state.variables.generatedScenes.settled = scene; h.state.variables.player.money = 17;
  const root = h.body.appendChild(new Element('div'));
  const pending = h.context.SceneActions.retryOptions(scene, root); await h.context.SceneActions.retryOptions(scene, root);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].options.operation, 'scene-options-retry');
  h.requests[0].resolve({ text: JSON.stringify(choices()), finishReason: 'length' }); await pending;
  assert.equal(scene.options.length, 0); assert.match(h.toasts.at(-1), /截断/);
  const next = h.context.SceneActions.retryOptions(scene, root); h.requests[1].resolve(registration({ options: choices() }, 'retry-2')); await next;
  assert.equal(scene.options.length, 2); assert.equal(scene.requestId, 'retry-2'); assert.equal(h.state.variables.player.money, 17);
  assert.equal(h.state.variables.sceneAction, undefined);
});

test('hub malformed options are visibly rejected instead of replaced with canned choices', async () => {
  const h = harness(); h.render('hubscene'); h.requests[0].resolve({ text: '早餐摊冒着热气' }); await flush();
  h.requests[1].resolve({ text: 'not json', requestId: 'bad-hub' }); await flush();
  const cached = Object.values(h.state.variables.hubCache)[0]; assert.equal(cached.options.length, 0); assert.ok(cached.optionDiagnostics.error);
  assert.match(h.body.textContent, /行动选项生成无效/); assert.match(h.body.textContent, /重新生成行动选项/);
});

test('malformed scene reports retry rather than fabricating a fallback scene', async () => {
  const h = harness(); h.render('llmscene2'); h.requests[0].resolve({ text: 'not JSON' }); await flush();
  assert.equal(Object.keys(h.state.variables.generatedScenes).length, 0); assert.equal(h.errors.length, 1);
  assert.ok(h.logs.find((entry) => entry.data.report && entry.data.report.error));
});

test('movement option executes corrected IDs once on click', async () => {
  const h = harness(); const options = h.context.SceneOptions.normalize([move()]), root = h.body.appendChild(new Element('div'));
  h.context.SceneOptions.render(root, options, {}); click(root.children[0]); click(root.children[0]); await flush();
  assert.equal(h.state.variables.position.locationId, 'Street'); assert.equal(h.state.variables.position.areaId, 'convenience_store_entrance');
  assert.deepEqual(h.history, ['AreaScene']);
});

test('action page starts the selected action on display, and concurrent requests share one settlement', async () => {
  const h = harness(); assert.equal(h.context.SceneActions.begin(buy(), { text: '早餐摊' }).ok, true);
  const output = h.render('sceneaction'); assert.equal(h.requests.length, 0);
  h.emit(':passagedisplay'); await flush(); assert.match(output.textContent, /尚未扣款/);
  const duplicate = h.context.SceneActions.run(); await flush(); assert.equal(h.requests.length, 1);
  h.requests[0].resolve(response(resultArgs())); await flush(); h.requests[1].resolve({ text: '完成' });
  assert.equal((await duplicate).ok, true); await flush(); assert.equal(h.state.passage, 'DynamicScene'); assert.equal(h.state.variables.player.money, 17);
});

test('failed action retries under the same selection without double charging', async () => {
  const h = harness(), first = ready(h); await flush();
  h.requests[0].resolve({ text: '没有调用工具' }); assert.equal((await first).ok, false);
  const actionId = h.state.variables.sceneAction.id;
  const second = h.context.SceneActions.run(); await flush(); h.requests[1].resolve(response(resultArgs())); await flush(); h.requests[2].resolve({ text: '完成' });
  assert.equal((await second).ok, true); assert.equal(h.state.variables.sceneAction.id, actionId); assert.equal(h.state.variables.player.money, 17);
});

test('real scene prompt builds before the operation snapshot and retains the tool result contract', async () => {
  const h = harness(); h.load('llm-prompts.js');
  const pending = ready(h, observe()); await flush();
  assert.equal(h.requests.length, 1); assert.match(h.requests[0].input[0].content, /最终必须调用 resolve_scene_action/);
  assert.doesNotMatch(h.requests[0].input[0].content, /只返回选项数组/);
  h.requests[0].resolve(response(resultArgs())); await flush(); h.requests[1].resolve({ text: '完成' }); assert.equal((await pending).ok, true);
});

test('a mandatory task entry is appended without replacing any valid model option', async () => {
  const h = harness();
  h.context.TaskEngine = {
    validateAction: (action) => ({ ok: true, action }),
    ensureQuestOption: (options, count, target) => {
      if (options.some((option) => option.questAction)) return options;
      const result = options.slice(0, count), task = { label: '进入任务现场', target, questAction: { questId: 'task' } };
      if (result.length >= count) result[result.length - 1] = task; else result.push(task);
      return result;
    }
  };
  const options = [observe(), buy(), move(), { label: '等待片刻', action: { type: 'scene_action', intent: '等待片刻' } }];
  h.render('llmscene2'); h.requests[0].resolve(registration({ id: 'with-task', title: '现场', text: '现场', options })); await flush();
  const stored = h.state.variables.generatedScenes['with-task'];
  assert.deepEqual(plain(stored.options.slice(0, 4).map((option) => option.label)), options.map((option) => option.label));
  assert.equal(stored.options.length, 5); assert.equal(stored.options[4].label, '进入任务现场');
});

test('failed dialogue entry is visible and does not permanently lock the other scene choices', async () => {
  const h = harness(); npcAvailable(h); const root = h.body.appendChild(new Element('div'));
  h.context.SceneOptions.render(root, h.context.SceneOptions.normalize([talk(), observe()]), {});
  h.context.DialogueTool.invoke = async () => ({ ok: false, navigated: false, error: 'NPC 已离开' });
  click(root.children[0]); await flush(); assert.equal(h.toasts.at(-1), 'NPC 已离开');
  click(root.children[1]); assert.equal(h.state.passage, 'SceneAction');
});

test('hub retry regenerates only options and preserves the existing narration', async () => {
  const h = harness(); h.state.passage = 'AreaScene';
  h.render('hubscene'); h.requests[0].resolve({ text: '早餐摊冒着热气' }); await flush();
  h.requests[1].resolve({ text: 'not json' }); await flush();
  const output = h.body.children[0], optionsBox = output.children.find((node) => node.className === 'llm-options-container');
  click(optionsBox.children.find((node) => node.tagName === 'button'));
  assert.equal(h.requests.length, 3); assert.equal(h.requests[2].options.operation, 'scene-options-retry');
  h.requests[2].resolve(registration({ options: choices() }, 'hub-retry')); await flush();
  assert.equal(h.state.passage, 'AreaScene');
  const cached = Object.values(h.state.variables.hubCache)[0]; assert.equal(cached.narration, '早餐摊冒着热气'); assert.equal(cached.options.length, 2);
  h.render('hubscene'); assert.equal(h.requests.length, 3, 'narration and options cache reused');
});

test('loading a pending action while its old request unwinds restores a retry button instead of a permanent spinner', async () => {
  const h = harness(), original = ready(h); await flush();
  const oldOutput = h.render('sceneaction');
  h.state.variables = plain(h.state.variables); oldOutput.remove(); h.emit(':passageinit');
  const loadedOutput = h.render('sceneaction'); h.emit(':passagedisplay'); assert.match(loadedOutput.textContent, /正在生成/);
  assert.equal((await original).ok, false); await flush();
  assert.doesNotMatch(loadedOutput.textContent, /正在生成/); assert.match(loadedOutput.textContent, /重试行动/);
  assert.equal(h.state.variables.player.money, 25);
  const retry = loadedOutput.children[0].children.find((node) => node.textContent === '重试行动'); click(retry); await flush();
  h.requests[1].resolve(response(resultArgs())); await flush(); h.requests[2].resolve({ text: '完成' }); await flush();
  assert.equal(h.state.passage, 'DynamicScene'); assert.equal(h.state.variables.player.money, 17);
});

test('same-area movement restores choices without replaying the selected legacy effects', async () => {
  const h = harness(), root = h.body.appendChild(new Element('div'));
  const option = { label: '留在摊前', tool: { name: 'move_player', arguments: { locationId: 'Street', areaId: 'food_stall' } }, effects: { stamina: 10 } };
  h.context.SceneOptions.render(root, h.context.SceneOptions.normalize([option, observe()]), {});
  click(root.children[0]); await flush(); click(root.children[0]); await flush();
  assert.equal(h.effects.length, 1); assert.deepEqual(plain(h.effects[0]), { stamina: 10 });
  assert.equal(h.state.passage, 'DynamicScene'); click(root.children[1]); assert.equal(h.state.passage, 'SceneAction');
});

test('registration is one tool request with no final round and no gameplay execution', async () => {
  const h = harness(); npcAvailable(h);
  const before = JSON.stringify(h.state.variables), scope = h.context.LLMOperationScope.create();
  const pending = h.context.SceneOptionTools.generate({ prompt: '保留现场', operation: 'hub-options', scope });
  assert.equal(h.requests[0].options.tools[0].function.name, 'register_scene_options');
  h.requests[0].resolve(registration({ options: [buy(), talk(), observe(), move()] }, 'registered'));
  const result = await pending;
  assert.equal(result.ok, true); assert.equal(result.options.length, 4); assert.equal(h.requests.length, 1);
  assert.equal(result.options[3].tool.arguments.locationId, 'Street');
  assert.equal(JSON.stringify(h.state.variables), before); assert.equal(h.effects.length, 0); assert.equal(h.history.length, 0);
  assert.equal(h.logs.find((log) => log.event === 'scene-options-tool-result').data.result.status, 'VALIDATED');
});

const invalidRegistrations = {
  'malformed JSON': () => { const value = registration({}); value.tool_calls[0].function.arguments = '{broken'; return value; },
  'empty NPC name': () => registration({ options: [{ label: '购买', tool: { name: 'start_dialogue', arguments: { npcName: '', openingLine: '' } } }] }),
  'unregistered place': () => registration({ options: [{ label: '移动', tool: { name: 'move_player', arguments: { locationId: 'Street', areaId: 'imaginary' } } }] }),
  'invalid purchase': () => registration({ options: [{ label: '免费获得', action: { type: 'scene_action', intent: '购买', purchase: { productId: 'free-gold' } } }] }),
  'injected effects': () => registration({ options: [{ ...observe(), effects: { money: 999 } }] }),
  'unknown tool': () => { const value = registration({ options: choices() }); value.tool_calls[0].function.name = 'grant_reward'; return value; },
  'multiple calls': () => { const value = registration({ options: choices() }); value.tool_calls.push(...plain(value.tool_calls)); return value; },
  'null option': () => registration({ options: [null] }),
  'malformed tool': () => registration({ options: [{ label: '搭话', tool: { name: 'start_dialogue', arguments: null } }] }),
  'null competing route': () => registration({ options: [{ ...observe(), tool: null }] }),
  'unknown field': () => registration({ options: choices(), money: 999 })
};
for (const [name, invalid] of Object.entries(invalidRegistrations)) test('registration feeds back ' + name + ' and allows exactly one repair', async () => {
  const h = harness(), before = JSON.stringify(h.state.variables);
  const pending = h.context.SceneOptionTools.generate({ prompt: '原现场', operation: 'hub-options', scope: h.context.LLMOperationScope.create() });
  const first = invalid(); h.requests[0].resolve(first); await flush();
  assert.equal(h.requests.length, 2); assert.equal(JSON.stringify(h.state.variables), before);
  const messages = h.requests[1].input, assistant = messages[2], results = messages.slice(3);
  assert.equal(assistant.role, 'assistant'); assert.equal(results.length, first.tool_calls.length);
  results.forEach((message, index) => {
    assert.equal(message.role, 'tool'); assert.equal(message.tool_call_id, assistant.tool_calls[index].id);
    const feedback = JSON.parse(message.content); assert.equal(feedback.status, 'REJECTED'); assert.equal(feedback.retriesRemaining, 1);
    assert.ok(feedback.errors.length); assert.ok(feedback.errors[0].path); assert.ok(feedback.errors[0].message);
  });
  assert.equal(new Set(assistant.tool_calls.map((call) => call.id)).size, assistant.tool_calls.length);
  assert.equal(h.requests[1].options.traceContext.runId, h.requests[0].options.traceContext.runId);
  assert.equal(h.requests[1].options.traceContext.round, 2);
  assert.equal(h.requests[1].options.tools[0].function.name, 'register_scene_options');
  h.requests[1].resolve(registration({ options: choices() }, 'repair-success'));
  const result = await pending; assert.equal(result.ok, true); assert.equal(result.requestId, 'repair-success'); assert.equal(h.requests.length, 2);
  assert.equal(JSON.stringify(h.state.variables), before);
  assert.equal(h.logs.find((log) => log.event === 'scene-options-tool-call').data.arguments, first.tool_calls[0].function.arguments);
});

test('two invalid batches never partially register or make a third request', async () => {
  const h = harness(); const pending = h.context.SceneOptionTools.generate({ prompt: '现场', operation: 'hub-options', scope: h.context.LLMOperationScope.create() });
  const rejected = assert.rejects(pending, (error) => {
    assert.match(error.message, /一次修正重试上限/); assert.equal(error.report.kept, 0); assert.equal(error.report.rejected, 2); return true;
  });
  const batch = registration({ options: [observe(), { label: '坏对话', tool: { name: 'start_dialogue', arguments: {} } }] });
  h.requests[0].resolve(batch); await flush(); h.requests[1].resolve(batch); await rejected;
  assert.equal(h.requests.length, 2); assert.equal(Object.keys(h.state.variables.generatedScenes).length, 0); assert.equal(h.state.variables.player.money, 25);
});

for (const mode of ['no-tool', 'truncated', 'network']) test('registration ' + mode + ' fails without a parameter retry', async () => {
  const h = harness(); const pending = h.context.SceneOptionTools.generate({ prompt: '现场', operation: 'hub-options', scope: h.context.LLMOperationScope.create() });
  const rejected = assert.rejects(pending);
  if (mode === 'network') h.requests[0].reject(new Error('offline'));
  else h.requests[0].resolve(mode === 'no-tool' ? { text: JSON.stringify({ options: choices() }) } : { ...registration({ options: choices() }), finishReason: 'length' });
  await rejected; assert.equal(h.requests.length, 1); assert.equal(h.state.variables.player.money, 25);
});

for (const change of ['cancel', 'passage', 'load']) for (const round of [0, 1]) test('registration stops after ' + change + ' in round ' + round, async () => {
  const h = harness(), scope = h.context.LLMOperationScope.create();
  const pending = h.context.SceneOptionTools.generate({ prompt: '现场', operation: 'hub-options', scope });
  const rejected = assert.rejects(pending, (error) => error.name === 'AbortError');
  if (round) { h.requests[0].resolve(invalidRegistrations['empty NPC name']()); await flush(); }
  if (change === 'cancel') scope.invalidate('cancelled');
  if (change === 'passage') { h.state.passage = 'Bedroom'; h.emit(':passageinit'); }
  if (change === 'load') h.state.variables = plain(h.state.variables);
  h.requests[round].resolve(round ? registration({ options: choices() }) : invalidRegistrations['empty NPC name']());
  await rejected; assert.equal(h.requests.length, round + 1); assert.equal(Object.keys(h.state.variables.generatedScenes).length, 0);
});

test('manual options retry retains existing good options and narration when both parameter attempts fail', async () => {
  const h = harness(), scene = { text: '不能改写的现场', options: choices() }, before = JSON.stringify(scene), root = h.body.appendChild(new Element('div'));
  const pending = h.context.SceneActions.retryOptions(scene, root);
  h.requests[0].resolve(invalidRegistrations['empty NPC name']()); await flush();
  h.requests[1].resolve(invalidRegistrations['injected effects']()); await pending;
  assert.equal(JSON.stringify(scene), before); assert.equal(h.state.variables.player.money, 25); assert.equal(h.history.length, 0);
  assert.match(h.toasts.at(-1), /一次修正重试上限/); assert.equal(root.sceneOptionsRetry, false);
});

test('dynamic scene repairs a bad batch before saving the entire scene', async () => {
  const h = harness(); h.load('llm-prompts.js'); h.render('llmscene2');
  const scene = { id: 'fixed', title: '新现场', text: '叙事', options: choices() };
  h.requests[0].resolve(registration({ ...scene, options: [observe(), { label: '坏选项', tool: { name: 'start_dialogue', arguments: {} } }] })); await flush();
  assert.equal(h.state.variables.generatedScenes.fixed, undefined); assert.match(h.requests[1].input.at(-1).content, /npcName/);
  h.requests[1].resolve(registration(scene)); await flush();
  assert.equal(h.state.variables.generatedScenes.fixed.options.length, 2); assert.equal(h.requests.length, 2); assert.equal(h.state.variables.player.money, 25);
});

test('hub registration repairs only options, preserving generated narration and exposing all accepted buttons', async () => {
  const h = harness(); h.load('llm-prompts.js'); h.render('hubscene');
  h.requests[0].resolve({ text: '早餐摊热气升腾' }); await flush();
  assert.match(h.requests[1].input[1].content, /早餐摊热气升腾/);
  h.requests[1].resolve(invalidRegistrations['empty NPC name']()); await flush();
  h.requests[2].resolve(registration({ options: choices() })); await flush();
  const cached = Object.values(h.state.variables.hubCache)[0];
  assert.equal(cached.narration, '早餐摊热气升腾'); assert.equal(cached.options.length, 2); assert.equal(h.requests.length, 3);
  choices().forEach((option) => assert.ok(h.body.textContent.includes(option.label)));
});
