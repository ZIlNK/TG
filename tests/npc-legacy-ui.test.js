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
  const macros = new Map(), events = new Map(), timers = [], requests = [], history = [], effects = [], world = [], errors = [];
  const body = new Element('body');
  const state = { variables: { location: 'Park', position: { locationId: 'Park', areaId: 'bench' }, time: { day: 1, hour: 9, minute: 0 }, player: { name: '玩家甲', money: 1 }, npcs: {}, characterCards: {}, generatedScenes: {}, llmSession: {}, activeNPCId: '' }, passage: 'Park', activeIndex: 1 };
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
    PromptBuilder: {
      sceneObjectPrompt: () => 'scene', scenePrompt: () => 'scene', npcPrompt: () => 'npc', optionsPrompt: () => 'options',
      hasProactiveDialogueCandidates: () => false, addToHistory: (...args) => history.push(args),
      worldEventPrompt: () => 'ambient', addWorldEvent: (...args) => world.push(args)
    },
    NarrativeUI: { createChatContainer: () => new Element('div'), showTyping() {}, hideTyping() {}, showError: (...args) => errors.push(args), showToast() {} },
    applyEffects: (value) => { effects.push(value); return []; },
    Math: Object.assign(Object.create(Math), { random: () => 0 })
  };
  context.$ = context.jQuery;
  ['chatRaw', 'chat', 'generate'].forEach((method) => { context.LLMEngine[method] = (input, options) => { const pending = deferred(); requests.push({ method, input, options, ...pending }); return pending.promise; }; });
  context.window = context;
  vm.createContext(context);
  function load(file) { vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/scripts/', file), 'utf8'), context); }
  load('llm-operation-scope.js'); load('llm-structured.js'); load('llm-macros.js'); load('scene-option-tools.js');
  return { context, state, requests, timers, history, effects, world, errors, body, load,
    emit: (name) => (events.get(name) || []).forEach((fn) => fn({ type: name })),
    render: (name, args = []) => { const output = body.appendChild(new Element('div')); macros.get(name).handler.call({ args, output }); return output; }
  };
}

function registration(args, requestId = 'registration') { return { text: '', requestId, tool_calls: [{ id: 'register-1', type: 'function', function: { name: 'register_scene_options', arguments: JSON.stringify(args) } }] }; }
const scene = (effects = {}) => ({ id: 'scene-1', title: '场景', text: '风吹过<<set $player.money=999>>', options: [{ label: '看看', target: 'Park', ...(Object.keys(effects).length ? { effects } : {}) }, { label: '离开', target: 'Street' }] });
const npc = () => ({ id: 'linwanqing', actorId: 'card:linwanqing', cardId: 'linwanqing', profileRef: 'linwanqing', name: '林晚晴', role: '画师', location: 'Park', traits: [], memory: '<img src=x onerror=alert(1)>' });

test('legacy macros render without player events; only explicit quest click enqueues once', () => {
  const h = harness(), calls = [];
  h.state.variables.npcs.n = npc();
  h.context.LLMEngine.isAvailable = () => false;
  h.context.NPCDirector = { renderChat: (output, id) => calls.push(['render', id]), enqueue: (id, event) => calls.push(['enqueue', id, event]) };
  h.render('npcchat', ['n']);
  const output = h.render('llmquest', ['n', '本地问题']);
  h.render('llmquest', ['n', '本地问题']);
  assert.deepEqual(calls.map((call) => call[0]), ['render', 'render', 'render']);
  assert.equal(h.history.length, 0); assert.equal(h.requests.length, 0);
  const button = output.children.find((node) => node.textContent === '询问是否需要帮忙');
  assert.ok(button); button.listeners.click(); button.listeners.click();
  const enqueued = calls.filter((call) => call[0] === 'enqueue');
  assert.equal(enqueued.length, 1); assert.equal(enqueued[0][2].type, 'chat');
  assert.match(enqueued[0][2].text, /帮忙.*本地问题/); assert.ok(enqueued[0][2].sourceEventId);
  assert.equal(h.state.variables.activeNPCId, 'n'); assert.deepEqual(h.history, ['NPCChat']);
  h.render('llmquest', ['missing']);
  assert.equal(calls.filter((call) => call[0] === 'enqueue').length, 1);
});

for (const change of ['epoch', 'detached', 'load', 'npc']) test('retired quest button cannot create an event: ' + change, () => {
  const h = harness(), calls = [];
  h.state.variables.npcs.n = npc();
  h.context.NPCDirector = { renderChat() {}, enqueue: (...args) => calls.push(args) };
  const output = h.render('llmquest', ['n']);
  const button = output.children.find((node) => node.textContent === '询问是否需要帮忙');
  if (change === 'epoch') h.emit(':passageinit');
  if (change === 'detached') output.remove();
  if (change === 'load') h.state.variables = JSON.parse(JSON.stringify(h.state.variables));
  if (change === 'npc') h.state.variables.npcs.n = npc();
  button.listeners.click();
  assert.equal(calls.length, 0); assert.equal(h.history.length, 0);
});

test('card instantiation retains full profile and authoritative card identity', async () => {
  const h = harness(), card = { ...npc(), personality: '温柔', description: '人物描述', scenario: '寻找照片', areaId: 'bench' };
  const record = { id: 'linwanqing', npc: card, type: 'card' };
  h.context.NPCState = { currentPosition: () => h.state.variables.position, resolveSpeaker: () => ({ known: true, present: record, card: record, records: [record] }), ensure() {} };
  const result = await h.context.DialogueTool.invoke({ npcName: card.name, openingLine: '你好' }, { confirm: false });
  const created = h.state.variables.npcs[result.npcId];
  assert.equal(result.navigated, true);
  for (const key of ['actorId', 'cardId', 'profileRef', 'personality', 'description', 'scenario']) assert.equal(created[key], card[key]);
});

test('ambiguous same-name actors cannot steal a card dialogue', async () => {
  const h = harness(), card = { ...npc(), areaId: 'bench' }, other = { ...card, actorId: 'npc:other' };
  const records = [{ id: 'linwanqing', npc: card, type: 'card' }, { id: 'other', npc: other, type: 'runtime' }];
  h.context.NPCState = { currentPosition: () => h.state.variables.position, resolveSpeaker: () => ({ known: true, present: records[1], card: records[0], runtime: records[1], records }) };
  const result = await h.context.DialogueTool.invoke({ npcName: card.name, openingLine: '你好' }, { confirm: false });
  assert.equal(result.ok, false); assert.equal(h.history.length, 0);
});

test('Hunter fixed entry creates one local actor, survives reload and respects the current sub-area', async () => {
  const h = harness();
  h.load('content.js'); h.load('npc-state.js'); h.load('npc-agency-state.js');
  h.context.GameContent.ensure();
  h.state.variables.position.areaId = 'park_entrance';
  const card = h.state.variables.characterCards.hunter;
  // Execute the authored click body, with SugarCube's variable prefixes expanded.
  const scenes = fs.readFileSync(path.join(__dirname, '../src/passages/scenes.twee'), 'utf8');
  const markup = scenes.match(/<<link "与亨特交谈">>([\s\S]*?)<<\/link>>/)[1];
  const resolve = markup.match(/<<set _hunter to ([\s\S]*?)>>/)[1];
  const invoke = markup.match(/<<run ([\s\S]*?)>>/)[1].replace(/\$characterCards/g, 'State.variables.characterCards');
  async function click() {
    h.context._hunter = vm.runInContext(resolve, h.context);
    return vm.runInContext(invoke, h.context);
  }

  const first = await click();
  assert.equal(first.navigated, true);
  assert.equal(h.state.passage, 'NPCChat');
  const created = h.state.variables.npcs[first.npcId];
  assert.equal(created.actorId, 'card:hunter');
  assert.equal(created.profileRef, 'hunter');
  assert.equal(created.personality, card.personality);
  assert.equal(created.dialogue[0].content, card.greeting);
  assert.equal(h.context.NPCAgency.buildContext(first.npcId).profile.personality, card.personality);

  created.dialogue.push({ role: 'user', content: '我也喜欢画画。' });
  h.state.variables = JSON.parse(JSON.stringify(h.state.variables));
  h.context.GameContent.ensure();
  h.state.passage = 'Park';
  const next = await click();
  assert.equal(next.npcId, first.npcId);
  assert.equal(Object.keys(h.state.variables.npcs).length, 1);
  const dialogue = h.state.variables.npcs[next.npcId].dialogue;
  assert.equal(dialogue.filter((entry) => entry.content === card.greeting).length, 1);
  assert.ok(dialogue.some((entry) => entry.content === '我也喜欢画画。'));
  assert.equal(dialogue.at(-1).content, '你好。');

  h.state.passage = 'AreaScene';
  h.state.variables.position.areaId = 'park_path';
  const blocked = await click();
  assert.equal(blocked.ok, false);
  assert.equal(h.state.passage, 'AreaScene');
});

for (const change of ['load', 'passage', 'time', 'actor']) test('late scene response cannot write after ' + change, async () => {
  const h = harness(); h.render('llmscene2');
  if (change === 'load') h.state.variables = JSON.parse(JSON.stringify(h.state.variables));
  if (change === 'passage') { h.state.passage = 'Bedroom'; h.emit(':passageinit'); }
  if (change === 'time') h.state.variables.time.hour++;
  if (change === 'actor') h.state.variables.activeNPCId = 'other';
  h.requests[0].resolve(registration(scene())); await flush();
  assert.deepEqual(Object.keys(h.state.variables.generatedScenes), []);
  assert.equal(h.timers.length, 0); assert.equal(h.errors.length, 0);
});

test('scene delayed navigation remains owned by its originating page', async () => {
  const h = harness(); h.render('llmscene2'); h.requests[0].resolve(registration(scene())); await flush();
  assert.ok(h.state.variables.generatedScenes['scene-1']); assert.equal(h.timers.length, 1);
  h.emit(':passageinit'); h.timers.shift()();
  assert.equal(h.state.variables.dynamicSceneId, undefined);
  assert.equal(h.history.filter((entry) => typeof entry === 'string').length, 0);
});

test('generated effects cannot give money, identity, relationships, items or quest evidence', async () => {
  const h = harness();
  const dangerous = { money: 999, relationship_change: { npcId: 'n', delta: 5 }, npcDisposition: 5, items: ['晚晴的照片'], questObjective: 0, skills: { persuasion: 999 }, health: -2, stress: '100' };
  h.render('llmscene2'); h.requests[0].resolve(registration(scene(dangerous))); await flush();
  assert.equal(h.state.variables.generatedScenes['scene-1'], undefined);
  assert.match(h.requests[1].input.at(-1).content, /effects/);
  h.requests[1].resolve(registration(scene())); await flush();
  assert.equal(JSON.stringify(h.state.variables.generatedScenes['scene-1'].options[0].effects), '{}');
  assert.equal(h.effects.length, 0);
  h.state.variables.dynamicSceneId = 'saved';
  h.state.variables.generatedScenes.saved = scene(dangerous);
  h.state.variables.generatedScenes.saved.options[0].questAction = { questId: 'linwanqing-photo' };
  h.emit(':passageinit');
  assert.equal(JSON.stringify(h.state.variables.generatedScenes.saved.options[0].effects), '{"health":-2}');
  assert.equal(h.state.variables.generatedScenes.saved.options[0].questAction, undefined);
});

test('generated NPC cannot claim card identity or overwrite an existing ID; text stays literal', async () => {
  const h = harness(); const prior = { ...npc(), memory: '原有人物' }; h.state.variables.npcs.linwanqing = prior;
  const output = h.render('llmnpc'); h.requests[0].resolve(JSON.stringify({ ...npc(), agencyResources: { money: 999999 }, dialogue: [{ role: 'assistant', content: '已发奖' }] })); await flush();
  assert.equal(h.state.variables.npcs.linwanqing, prior);
  const id = Object.keys(h.state.variables.npcs).find((key) => key !== 'linwanqing');
  const created = h.state.variables.npcs[id];
  assert.equal(created.actorId, 'npc:' + id); assert.equal(created.cardId, undefined); assert.equal(created.profileRef, undefined);
  assert.equal(created.agencyResources, undefined); assert.equal(created.dialogue.length, 0);
  assert.ok(output.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.equal(h.state.variables.activeNPCId, '');
  const button = output.children[0].children.find((node) => node.tagName === 'button'); button.listeners.click();
  assert.equal(h.state.variables.activeNPCId, id); assert.equal(h.state.passage, 'NPCChat');
});

test('cancelled NPC generation neither falls back nor writes or displays an error', async () => {
  const h = harness(); h.render('llmnpc'); h.emit(':passageinit');
  h.requests[0].resolve('not JSON'); await flush();
  assert.deepEqual(Object.keys(h.state.variables.npcs), []); assert.equal(h.errors.length, 0);
  const second = harness(); const cancelledOutput = second.render('llmnpc'); const error = new Error('cancelled'); error.name = 'AbortError';
  second.requests[0].reject(error); await flush(); assert.deepEqual(Object.keys(second.state.variables.npcs), []); assert.equal(second.errors.length, 0); assert.ok(cancelledOutput.textContent.includes('请求已取消'));
});

test('hub cancellation does not start options; late options never populate cache', async () => {
  const h = harness(); h.render('hubscene'); h.emit(':passageinit'); h.requests[0].resolve({ text: '旧文字' }); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.errors.length, 0);
  const second = harness(); second.render('hubscene'); second.requests[0].resolve({ text: '新文字' }); await flush();
  assert.equal(second.requests.length, 2); assert.equal(second.requests[0].options.signal, second.requests[1].options.signal);
  second.state.variables.time.day++; second.requests[1].resolve(JSON.stringify(scene().options)); await flush();
  assert.equal(Object.values(second.state.variables.hubCache)[0].options, undefined);
  assert.equal(second.errors.length, 0);
});

test('world social branch calls director and ambient yields to an active NPC request', async () => {
  const h = harness(); let encounters = 0, active = true;
  h.context.NPCDirector = { onEncounter: () => encounters++, hasActiveRequest: () => active };
  h.load('world-events.js'); h.emit('timeAdvanced'); assert.equal(encounters, 1); assert.equal(h.requests.length, 0);
  active = false; h.emit('timeAdvanced'); assert.equal(h.requests.length, 1); assert.ok(h.requests[0].options.signal);
  active = true; h.requests[0].resolve('收到礼物 [效果: 金钱 +100, 压力 +5] [关系变化: +2]'); await flush();
  assert.equal(h.effects.length, 0); assert.equal(h.world.length, 0);
});

test('ambient commits only current safe stat hints, never money or relationship', async () => {
  const h = harness(); h.context.NPCDirector = { onEncounter() {}, hasActiveRequest: () => false };
  h.load('world-events.js'); h.emit('timeAdvanced'); h.requests[0].resolve('微风 [效果: 金钱 +100, 压力 -2] [关系变化: +2]'); await flush();
  assert.equal(h.world.length, 1); assert.equal(JSON.stringify(h.effects), '[{"stress":-2}]');
  h.emit('timeAdvanced'); h.emit(':passageinit'); h.requests[1].resolve('旧事件 [效果: 压力 +5]'); await flush();
  assert.equal(h.world.length, 1); assert.equal(h.effects.length, 1);
});

test('a pending dialogue invitation closes on lifecycle cancellation without consuming an acceptance', async () => {
  const h = harness();
  const response = h.context.DialogueTool.invoke({ npcName: '路人', openingLine: '<script>不执行</script>' });
  await flush(); assert.equal(h.body.children.length, 1);
  h.emit(':passageinit'); const result = await response;
  assert.equal(result.status, 'cancelled'); assert.equal(h.body.children.length, 0);
  assert.equal(Object.keys(h.state.variables.npcs).length, 0); assert.equal(h.history.length, 0);
});

test('the actual director UI offers the formal photo entry only for the matching actor, not name', () => {
  for (const actorId of ['card:linwanqing', 'npc:impostor']) {
    const h = harness(), offered = [];
    h.state.variables.npcs.n = { ...npc(), actorId, dialogue: [{ role: 'assistant', content: '你好<<set $player.money=999>>' }] };
    const db = { offers: {}, promises: {}, jobs: {} };
    h.context.NPCAgency = { ensure: () => db, resolveActor: () => ({ actorId }), now: () => 1980 };
    h.context.TaskEngine = { offerPhotoQuest: (id) => { offered.push(id); return { ok: true, offerId: 'photo-offer' }; } };
    h.context.NPCTools = {};
    h.load('npc-director.js');
    const output = h.render('npcchat', ['n']); h.timers.shift()();
    assert.ok(output.textContent.includes('你好<<set $player.money=999>>'));
    const root = output.children[0], photoButton = root.children.find((node) => node.textContent === '询问遗失的照片');
    assert.equal(!!photoButton, actorId === 'card:linwanqing');
    if (photoButton) { photoButton.listeners.click(); assert.deepEqual(offered, ['n']); }
    assert.equal(h.requests.length, 0);
  }
});

function agencyUI() {
  const h = harness(), runs = [];
  h.state.passage = 'NPCChat';
  Object.assign(h.state.variables, {
    activeNPCId: 'n', quests: {},
    player: { money: 25, inventory: {} },
    npcs: { n: { ...npc(), id: 'n', areaId: 'bench', dialogue: [], agencyResources: { money: 10, items: {} } } }
  });
  h.context.LLMToolRunner = { run(request) { const gate = deferred(); runs.push({ request, ...gate }); return gate.promise; } };
  ['quest-engine.js', 'npc-agency-state.js', 'npc-tools.js', 'npc-director.js'].forEach(h.load);
  h.context.NPCAgency.ensure();
  const q = {
    id: 'soy', title: '挑选酱油', description: '读取标签', giver: 'n', location: 'Park', rewardMode: 'npc_discretionary',
    status: 'ready_to_turn_in', rewards: [], turnIn: { type: 'npc', npcId: 'n', locationId: 'Park', areaId: 'bench' },
    objectives: [{ id: 'read', text: '读取标签', actionId: 'read-label', locations: ['Park'], areas: ['bench'], current: 1, required: 1, completed: true }]
  };
  h.state.variables.quests.soy = q;
  const db = h.context.NPCAgency.ensure(), actor = h.context.NPCAgency.resolveActor('n');
  db.offers['offer:old'] = { id:'offer:old', actorId:actor.actorId, npcId:'n', kind:'quest', status:'accepted', payload:JSON.parse(JSON.stringify(q)), message:'帮我看看标签', expiresAt:9999 };
  function render() { const output = h.render('npcchat', ['n']); while (h.timers.length) h.timers.shift()(); return output; }
  return { h, runs, q, render };
}

test('turn-in during an old acceptance request automatically responds after cancellation, never commits its staged gift', async () => {
  const { h, runs, q, render } = agencyUI();
  const d = h.context.NPCDirector;
  const old = d.enqueue('n', { type:'offer_resolved', sourceEventId:'offer:offer:old:accepted' }); // legacy save metadata
  const oldRun = d.runDecision(old.id);
  assert.equal(runs[0].request.stage({id:'gift',name:'npc_offer_reward',arguments:{reward:{kind:'money',amount:2},message:'给你两块'}}).status, 'STAGED');
  const output = h.render('questturnins', ['n']);
  output.children.find(el => el.tagName === 'a').listeners.click({ preventDefault() {} });
  assert.equal(q.status, 'completed');
  assert.equal(old.status, 'superseded');
  assert.equal(runs[0].request.scope.signal.aborted, true);
  h.emit(':passageinit');
  h.state.variables = JSON.parse(JSON.stringify(h.state.variables)); // SugarCube's next moment
  const chat = render(); h.emit(':passagedisplay');
  assert.match(chat.textContent, /已交付：挑选酱油/);
  assert.equal(runs.length, 1, 'wait for the runtime lock to retire');
  runs[0].resolve({status:'completed',content:'请开始去挑酱油。'});
  await oldRun; await flush();
  assert.equal(runs.length, 2, 'no Continue button required');
  assert.match(chat.textContent, /正在回应这次交付/);
  assert.equal(Object.values(h.state.variables.npcAgency.offers).filter(o => o.kind === 'reward').length, 0);
  assert.equal(h.state.variables.npcs.n.dialogue.length, 0);
  assert.match(runs[1].request.messages[0].content, /"status":"completed"/);
  runs[1].resolve({status:'completed',content:'谢谢你帮我看过标签。'}); await flush();
  assert.match(chat.textContent, /谢谢你帮我看过标签/);
  assert.doesNotMatch(chat.textContent, /请开始去挑酱油/);
  assert.match(chat.textContent, /任务状态：已完成并交付/);
  assert.equal(h.state.variables.player.money, 25);
  h.emit(':passagedisplay'); await flush();
  assert.equal(runs.length, 2, 'settlement replay does not generate or reward twice');
});

test('leaving a settlement request keeps completion and automatically resumes on return, but not while away', async () => {
  const {h, runs, render} = agencyUI();
  h.context.TaskEngine.turnIn('soy', {npcId:'n'});
  const output = render(); h.emit(':passagedisplay');
  assert.equal(runs.length, 1);
  h.emit(':passageinit'); h.state.passage = 'QuestLog'; output.remove(); h.emit(':passagedisplay');
  runs[0].resolve({status:'stale'}); await flush();
  assert.equal(runs.length, 1);
  assert.equal(h.state.variables.quests.soy.status, 'completed');
  assert.equal(h.state.variables.npcs.n.dialogue.length, 0);
  h.emit(':passageinit'); h.state.passage = 'NPCChat'; render(); h.emit(':passagedisplay');
  assert.equal(runs.length, 2);
  runs[1].resolve({status:'failed',error:new Error('模型离线')}); await flush();
  assert.equal(runs.length, 2, 'failure does not spin an automatic retry loop');
  assert.equal(h.state.variables.quests.soy.status, 'completed');
  h.emit(':passagedisplay');
  assert.equal(runs.length, 3, 'a new visit retries the preserved event');
  runs[2].resolve({status:'completed',content:'这次多谢你了。'}); await flush();
  assert.equal(h.state.variables.npcs.n.dialogue.length, 1);
});
