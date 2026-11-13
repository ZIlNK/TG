const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.whenSugarCubeReady = function () {};
global.RegionSystem = { ensure() {} };
global.NarrativeUI = { messages: [], showToast(message) { this.messages.push(message); } };
global.Engine = { played: [], play(passage) { this.played.push(passage); } };
global.MoveTool = { invoke() { return Promise.resolve({ ok: true, navigated: true }); } };
global.State = {
  variables: {
    location: 'Park',
    position: { locationId: 'Park', areaId: 'park_entrance' },
    regions: {
      Park: { areas: { park_entrance: {}, park_path: {} }, connections: [] }
    },
    npcs: {
      realGiver: {
        id: 'realGiver', name: '林晚晴', location: 'Park', locationId: 'Park', areaId: 'park_entrance'
      }
    },
    quests: {},
    activeNPCId: ''
  }
};

require('../src/scripts/content.js');
require('../src/scripts/quest-engine.js');

const initialState = JSON.stringify(State.variables);
test.beforeEach(() => {
  State.variables = JSON.parse(initialState);
  State.variables.player = { money: 0, inventory: {} };
  State.variables.npcs.realGiver.actorId = 'card:linwanqing';
  Engine.played = [];
  NarrativeUI.messages = [];
  delete global.NPCAgency;
  delete global.NPCTools;
  global.applyQuestRewards = function () { State.variables.player.money += 7; return ['金钱 +7']; };
  global.addToInventory = function (name, count) {
    const inventory = State.variables.player.inventory;
    inventory[name] = (inventory[name] || 0) + count;
  };
  global.removeFromInventory = function (name, count) {
    const inventory = State.variables.player.inventory;
    if (!inventory[name] || inventory[name] < count) return false;
    inventory[name] -= count;
    if (!inventory[name]) delete inventory[name];
    return true;
  };
});

function readyQuest(overrides) {
  return Object.assign({
    id: 'photo-quest', title: '寻找照片', description: '找到并交还照片', giver: 'realGiver', location: 'Park',
    objectives: [{ id: 'return', text: '交还照片', type: 'deliver', actionId: 'return-photo', locations: ['Park'], areas: ['park_entrance'], required: 1, current: 1, completed: true }],
    rewards: [], status: 'ready_to_turn_in',
    turnIn: { type: 'npc', npcId: 'hallucinated-id', locationId: 'Park', areaId: 'park_path' }
  }, overrides || {});
}

test('new NPC quests bind turn-in to the real giver and giver sub-area', () => {
  const prepared = TaskEngine.prepareDefinition(readyQuest({ id: undefined, status: 'active' }), 'realGiver');
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.quest.turnIn, {
    type: 'npc', npcId: 'realGiver', locationId: 'Park', areaId: 'park_entrance'
  });
});

test('old saves repair a model-provided turn-in NPC to the existing giver', () => {
  State.variables.quests = { photo: readyQuest() };
  TaskEngine.ensure();
  assert.equal(State.variables.quests.photo.turnIn.npcId, 'realGiver');
  assert.equal(State.variables.quests.photo.turnIn.areaId, 'park_entrance');
});

test('missing turn-in NPC is rejected without opening the chat page', async () => {
  State.variables.npcs = {};
  State.variables.quests = {
    broken: readyQuest({ giver: 'missing-giver', turnIn: { type: 'npc', npcId: 'missing-target', locationId: 'Park' } })
  };
  Engine.played = [];
  NarrativeUI.messages = [];

  const result = await TaskEngine.navigateToTurnIn('broken');
  assert.equal(result.ok, false);
  assert.match(result.error, /交付 NPC 不存在/);
  assert.deepEqual(Engine.played, []);
  assert.equal(NarrativeUI.messages.length, 1);
});


function acceptPhotoQuest() {
  const prepared = TaskEngine.prepareDefinition(GameContent.photoQuestDefinition('realGiver'), 'realGiver');
  assert.equal(prepared.ok, true);
  State.variables.quests[prepared.quest.id] = prepared.quest;
  return prepared.quest;
}

function searchAcceptedPhoto() {
  const quest = acceptPhotoQuest();
  State.variables.position.areaId = 'park_path';
  assert.equal(TaskEngine.searchPhoto().ok, true);
  State.variables.position.areaId = 'park_entrance';
  return quest;
}

for (const mode of ['fixed', 'npc_discretionary', 'fixed_plus_npc']) {
  test('prepareDefinition retains and settles ' + mode + ' exactly once', () => {
    const prepared = TaskEngine.prepareDefinition(readyQuest({ id: 'test-rewards', title: '整理物件', description: '帮助整理物件', objectives: ['整理物件'], rewardMode: mode }), 'realGiver');
    assert.equal(prepared.ok, true);
    assert.equal(prepared.quest.rewardMode, mode);
    const quest = prepared.quest;
    State.variables.quests[quest.id] = quest;
    quest.objectives.forEach(objective => { objective.current = objective.required; objective.completed = true; });
    TaskEngine.recompute(quest);
    let calls = 0;
    NPCAgency = { onQuestSettled(actualQuest, context) {
      calls++;
      assert.equal(actualQuest.status, 'completed');
      assert.equal(actualQuest.rewardsClaimed, true);
      assert.equal(actualQuest.settlement.sourceEventId, 'quest:' + quest.id + ':settled');
      assert.deepEqual(context, { npcId: 'realGiver', sourceEventId: actualQuest.settlement.sourceEventId });
    } };
    assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, true);
    assert.equal(State.variables.player.money, mode === 'npc_discretionary' ? 0 : 7);
    assert.equal(quest.settlement.rewardMode, mode);
    assert.equal(quest.settlement.fixedRewards.length, mode === 'npc_discretionary' ? 0 : 1);
    assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, false);
    TaskEngine.ensure();
    TaskEngine.recomputeAll();
    TaskEngine.readyForNPC('realGiver');
    State.variables = JSON.parse(JSON.stringify(State.variables));
    TaskEngine.recomputeAll();
    assert.equal(calls, 1);
    assert.equal(State.variables.player.money, mode === 'npc_discretionary' ? 0 : 7);
  });
}

test('legacy quests default to fixed, preserve completed claims and repair default NPC turn-in', () => {
  const legacy = readyQuest({ id: 'legacy', turnIn: undefined });
  delete legacy.rewardMode;
  State.variables.quests.legacy = legacy;
  TaskEngine.ensure();
  assert.equal(legacy.rewardMode, 'fixed');
  assert.equal(legacy.turnIn.npcId, 'realGiver');
  assert.equal(TaskEngine.turnIn('legacy', { npcId: 'realGiver' }).ok, true);
  assert.equal(State.variables.player.money, 7);
  const completed = readyQuest({ id: 'old-completed', status: 'completed' });
  State.variables.quests = { completed };
  NPCAgency = { onQuestSettled() { assert.fail('legacy completions must not emit new events'); } };
  TaskEngine.ensure();
  TaskEngine.recomputeAll();
  assert.equal(completed.rewardsClaimed, true);
  assert.equal(completed.settlement, undefined);
  assert.equal(State.variables.player.money, 7);
});

test('invalid reward modes and conflicting promised rewards are rejected', () => {
  for (const rewardMode of ['', null, {}, 'discretionary', 7]) {
    assert.equal(TaskEngine.prepareDefinition(readyQuest({ rewardMode }), 'realGiver').ok, false);
  }
  for (const rewards of [['金钱+7'], [''], '金钱+7', {}]) {
    assert.equal(TaskEngine.prepareDefinition(readyQuest({ rewardMode: 'npc_discretionary', rewards }), 'realGiver').ok, false);
  }
  const prepared = TaskEngine.prepareDefinition(readyQuest({ title: '普通任务', description: '普通请求', objectives: ['执行行动'] }), 'realGiver');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.quest.rewardMode, 'fixed');
});

test('autocompletion records an event without assuming that the giver knows', () => {
  const quest = readyQuest({ id: 'auto', status: 'active', rewardMode: 'fixed_plus_npc', turnIn: { type: 'automatic' } });
  State.variables.quests.auto = quest;
  TaskEngine.ensure();
  const contexts = [];
  NPCAgency = { onQuestSettled(q, context) { contexts.push(context); } };
  TaskEngine.recomputeAll();
  TaskEngine.recomputeAll();
  assert.deepEqual(contexts, [{ npcId: null, sourceEventId: 'quest:auto:settled' }]);
  assert.equal(quest.settlement.npcId, null);
  assert.equal(State.variables.player.money, 7);
});

test('failed/missing NPC director cannot roll back completion or trigger another notification', async () => {
  const quest = readyQuest({ id: 'notify', rewardMode: 'npc_discretionary' });
  State.variables.quests.notify = quest;
  NPCAgency = { onQuestSettled() { throw new Error('offline'); } };
  assert.equal(TaskEngine.turnIn('notify', { npcId: 'realGiver' }).ok, true);
  assert.equal(quest.status, 'completed');
  assert.equal(quest.settlement.sourceEventId, 'quest:notify:settled');
  NPCAgency = { onQuestSettled() { assert.fail('must resume from source event, not replay settlement'); } };
  TaskEngine.recomputeAll();
  const second = readyQuest({ id: 'async-notify', rewardMode: 'npc_discretionary' });
  State.variables.quests[second.id] = second;
  NPCAgency = { onQuestSettled() { return Promise.reject(new Error('cancelled')); } };
  assert.equal(TaskEngine.turnIn(second.id, { npcId: 'realGiver' }).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(second.status, 'completed');
  assert.equal(State.variables.player.money, 0);
});

test('photo request creates an offer, not an active quest, and needs the real nearby actor', () => {
  let offered;
  NPCTools = { offerQuest(npcId, definition) { offered = { npcId, definition }; return { ok: true, offerId: 'photo-offer' }; } };
  assert.equal(TaskEngine.searchPhoto().ok, false);
  assert.equal(TaskEngine.offerPhotoQuest('realGiver').ok, true);
  assert.equal(offered.npcId, 'realGiver');
  assert.equal(offered.definition.id, 'linwanqing-photo');
  assert.equal(offered.definition.rewardMode, 'npc_discretionary');
  assert.deepEqual(State.variables.quests, {});
  assert.equal(TaskEngine.searchPhoto().ok, false);
  State.variables.npcs.impostor = { name: '林晚晴', locationId: 'Park', areaId: 'park_entrance' };
  assert.equal(TaskEngine.offerPhotoQuest('impostor').ok, false);
  State.variables.position.areaId = 'park_path';
  assert.equal(TaskEngine.offerPhotoQuest('realGiver').ok, false);
  State.variables.position.areaId = 'park_entrance';
  delete global.NPCTools;
  assert.equal(TaskEngine.offerPhotoQuest('realGiver').ok, false);
});

test('formal photo path verifies and consumes one genuine item, then notifies once', () => {
  const quest = acceptPhotoQuest();
  assert.equal(TaskEngine.searchPhoto().ok, false);
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, false);
  State.variables.position.areaId = 'park_path';
  assert.equal(TaskEngine.searchPhoto().ok, true);
  assert.equal(quest.status, 'ready_to_turn_in');
  assert.equal(quest.objectives[1].completed, false);
  assert.equal(TaskEngine.searchPhoto().ok, false);
  const item = quest.photoProof.itemName;
  assert.equal(State.variables.player.inventory[item], 1);
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, false);
  State.variables.position.areaId = 'park_entrance';
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'other' }).ok, false);
  assert.equal(State.variables.player.inventory[item], 1);
  let notified = 0;
  NPCAgency = { onQuestSettled(q, context) {
    notified++;
    assert.equal(q.settlement.type, 'photo_returned');
    assert.equal(q.settlement.evidenceId, q.photoProof.id);
    assert.equal(q.photoProof.holder, 'realGiver');
    assert.equal(context.npcId, 'realGiver');
    assert.equal(State.variables.player.inventory[item], undefined);
    assert.equal(q.objectives.every(objective => objective.completed), true);
  } };
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, true);
  assert.equal(State.variables.player.money, 0);
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, false);
  assert.equal(TaskEngine.offerPhotoQuest('realGiver').ok, false);
  assert.equal(TaskEngine.prepareDefinition(GameContent.photoQuestDefinition('realGiver'), 'realGiver').ok, false);
  State.variables = JSON.parse(JSON.stringify(State.variables));
  TaskEngine.recomputeAll();
  assert.equal(TaskEngine.searchPhoto().ok, false);
  assert.equal(notified, 1);
});

test('photo objectives never appear in model options or accept forged questAction progress', () => {
  const quest = acceptPhotoQuest();
  State.variables.position.areaId = 'park_path';
  const objective = quest.objectives[0];
  const action = { questId: quest.id, objectiveId: objective.id, actionId: objective.actionId, amount: 100 };
  assert.equal(TaskEngine.validateAction(action).ok, false);
  assert.equal(TaskEngine.progress(action).ok, false);
  assert.equal(TaskEngine.progress(action, { trusted: true, source: 'photo-search' }).ok, false);
  assert.deepEqual(TaskEngine.eligibleObjectives(), []);
  assert.equal(TaskEngine.promptContext(), '');
  assert.deepEqual(TaskEngine.ensureQuestOption([], 4, 'Park'), []);
  assert.deepEqual(State.variables.player.inventory, {});
  assert.equal(quest.photoProof, undefined);
});

test('model-supplied progress, evidence and synonymous photo definitions cannot forge the formal task', () => {
  const args = {
    id: 'another-photo', title: '帮晚晴归还照片', description: '我已经找到照片并交还', rewardMode: 'fixed', rewards: ['金钱+999'],
    objectives: [{ id: 'fake', text: '已经交还', completed: true, current: 1 }],
    photoProof: { holder: 'player' }, turnIn: { type: 'automatic' }
  };
  const result = TaskEngine.prepareDefinition(args, 'realGiver');
  assert.equal(result.ok, true);
  const quest = result.quest;
  assert.equal(quest.id, 'linwanqing-photo');
  assert.equal(quest.rewardMode, 'npc_discretionary');
  assert.deepEqual(quest.rewards, []);
  assert.equal(quest.photoProof, undefined);
  assert.equal(quest.objectives.every(objective => !objective.completed && objective.current === 0), true);
  assert.equal(quest.turnIn.type, 'npc');
  State.variables.quests[quest.id] = quest;
  assert.equal(TaskEngine.prepareDefinition(args, 'realGiver').ok, false);
  quest.objectives.forEach(objective => { objective.completed = true; objective.current = 1; });
  quest.turnIn = { type: 'automatic' };
  TaskEngine.recomputeAll();
  assert.equal(quest.status, 'active');
  assert.equal(quest.settlement, undefined);
  assert.equal(State.variables.player.money, 0);
});

test('an identically named inventory item or ready flag cannot replace search evidence', () => {
  const quest = acceptPhotoQuest();
  State.variables.player.inventory['林晚晴与母亲的合影（任务凭证）'] = 1;
  quest.status = 'ready_to_turn_in';
  quest.objectives.forEach(objective => { objective.completed = true; });
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, false);
  assert.equal(quest.settlement, undefined);
  assert.equal(State.variables.player.inventory['林晚晴与母亲的合影（任务凭证）'], 1);
});

test('missing possession, missing recipient and failed consumption do not partially settle a photo', () => {
  const quest = searchAcceptedPhoto();
  const inventory = State.variables.player.inventory;
  const item = quest.photoProof.itemName;
  delete inventory[item];
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, false);
  inventory[item] = 1;
  const npc = State.variables.npcs.realGiver;
  delete State.variables.npcs.realGiver;
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, false);
  State.variables.npcs.realGiver = npc;
  global.removeFromInventory = () => false;
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, false);
  assert.equal(inventory[item], 1);
  assert.equal(quest.photoProof.holder, 'player');
  assert.equal(quest.photoProof.consumedAt, undefined);
  assert.equal(quest.settlement, undefined);
  assert.equal(quest.objectives[1].completed, false);
});

test('a save loaded before delivery retains the proof and can be delivered once', () => {
  const quest = searchAcceptedPhoto();
  State.variables = JSON.parse(JSON.stringify(State.variables));
  TaskEngine.ensure();
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, true);
  assert.deepEqual(State.variables.player.inventory, {});
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, false);
});

test('late-loaded director can inspect the committed photo fact without a second reward', () => {
  const quest = searchAcceptedPhoto();
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, true);
  const receipt = JSON.stringify(quest.settlement);
  NPCAgency = { onQuestSettled() { assert.fail('render/normalization must not replay the hook'); } };
  TaskEngine.recomputeAll();
  assert.equal(JSON.stringify(quest.settlement), receipt);
  assert.equal(State.variables.player.money, 0);
});

test('late director gifts are separate from the fixed task claim', () => {
  const quest = readyQuest({ id: 'two-legs', rewardMode: 'fixed_plus_npc' });
  State.variables.quests[quest.id] = quest;
  NPCAgency = { onQuestSettled() { State.variables.pendingGift = { accepted: false, amount: 2 }; } };
  assert.equal(TaskEngine.turnIn(quest.id, { npcId: 'realGiver' }).ok, true);
  assert.equal(State.variables.player.money, 7);
  assert.equal(State.variables.pendingGift.accepted, false);
  State.variables.pendingGift.accepted = true;
  State.variables.player.money += State.variables.pendingGift.amount;
  TaskEngine.recomputeAll();
  assert.equal(State.variables.player.money, 9);
  assert.equal(quest.settlement.fixedRewards.length, 1);
});

test('content seeds finite resources, not a predetermined reward, and does not refill them on ensure', () => {
  GameContent.ensure();
  const card = State.variables.characterCards.linwanqing;
  assert.equal(card.actorId, 'card:linwanqing');
  assert.deepEqual(card.agencyResources, { money: 35, items: { 'blank-paper': 3 } });
  assert.deepEqual(card.agencyItemDefinitions['blank-paper'], { title: '空白纸', description: '可以写字或画画的纸。' });
  card.agencyResources.money = 0;
  card.agencyResources.items['blank-paper'] = 0;
  GameContent.ensure();
  assert.equal(card.agencyResources.money, 0);
  assert.equal(card.agencyResources.items['blank-paper'], 0);
  assert.deepEqual(GameContent.photoQuestDefinition('realGiver').rewards, []);
});

test('validated action evidence survives normalization, save/load and settlement without invented choices', () => {
  State.variables.quests.soy = readyQuest({id:'soy',title:'看标签',rewardMode:'fixed',status:'active',objectives:[{id:'read',text:'读标签',actionId:'read-label',locations:['Park'],areas:['park_entrance'],required:1,current:0}]});
  const result = TaskEngine.progress({questId:'soy',objectiveId:'read',actionId:'read-label',amount:1});
  assert.equal(result.ok,true);
  State.variables = JSON.parse(JSON.stringify(State.variables));
  TaskEngine.ensure();
  const action = State.variables.quests.soy.objectives[0].lastAction;
  assert.equal(action.actionId,'read-label');
  assert.equal(action.position.areaId,'park_entrance');
  assert.equal(TaskEngine.turnIn('soy',{npcId:'realGiver'}).ok,true);
  const settlement = State.variables.quests.soy.settlement;
  assert.deepEqual(settlement.objectives[0].lastAction,action);
  assert.equal(settlement.result,null);
  assert.equal(TaskEngine.turnIn('soy',{npcId:'realGiver'}).ok,false);
});

test('model-authored quest definitions cannot introduce action evidence', () => {
  const args = readyQuest({id:'soy',title:'看标签',objectives:[{id:'read',text:'读标签',lastAction:{actionId:'fake',recordedAt:1}}]});
  const result = TaskEngine.prepareDefinition(args,'realGiver');
  assert.equal(result.ok,true);
  assert.equal(result.quest.objectives[0].lastAction,null);
});
