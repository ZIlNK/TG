const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runtime() {
  const handlers = new Map();
  const rendered = [];
  const played = [];
  const queued = [];
  const context = {
    State: { variables: {
      location: 'Park', position: { locationId: 'Park', areaId: 'park_entrance' },
      time: { day: 1, hour: 8, minute: 0 }, player: { money: 25, inventory: {} }, npcs: {}, quests: {}
    } },
    document: {}, Macro: { add() {} },
    whenSugarCubeReady(callback) { callback(); },
    jQuery() { return { on(name, handler) { handlers.set(name, handler); } }; },
    Wikifier: function (output, markup) { rendered.push({ output, markup }); },
    Engine: { play(passage) { played.push(passage); } },
    NPCDirector: { enqueue(npcId, event) { queued.push({ npcId, event }); } },
    addToInventory(name, count) {
      const inventory = context.State.variables.player.inventory;
      inventory[name] = (inventory[name] || 0) + count;
    },
    removeFromInventory(name, count) {
      const inventory = context.State.variables.player.inventory;
      if (!inventory[name] || inventory[name] < count) return false;
      inventory[name] -= count;
      if (!inventory[name]) delete inventory[name];
      return true;
    }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['content.js', 'movement.js', 'quest-engine.js', 'npc-agency-state.js', 'npc-tools.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/scripts', file), 'utf8'), context, { filename: file });
  }
  context.GameContent.ensure();
  context.RegionSystem.ensure();
  const card = context.State.variables.characterCards.linwanqing;
  context.State.variables.npcs.wanqing = Object.assign({}, JSON.parse(JSON.stringify(card)), { id: 'wanqing', profileRef: 'linwanqing' });
  context.NPCAgency.ensure();
  context.TaskEngine.ensure();
  return { context, handlers, rendered, played, queued };
}

test('real NPC offer acceptance and movement lead to one evidence-backed photo settlement', async () => {
  const { context: c, played, queued } = runtime();
  const offered = c.TaskEngine.offerPhotoQuest('wanqing');
  assert.equal(offered.ok, true, offered.error);
  assert.equal(c.TaskEngine.offerPhotoQuest('wanqing').ok, false);
  assert.equal(c.TaskEngine.photoQuest(), null);
  assert.equal(c.TaskEngine.searchPhoto().ok, false);
  assert.equal(c.NPCTools.resolveOffer(offered.offerId, 'accepted').ok, true);
  const quest = c.TaskEngine.photoQuest();
  assert.equal(quest.status, 'active');
  assert.equal(quest.contentKey, 'linwanqing-photo');
  assert.equal(c.NPCTools.resolveOffer(offered.offerId, 'accepted').ok, false);
  const movement = await c.MoveTool.invoke({ locationId: 'Park', areaId: 'park_path' }, { source: 'quest-test' });
  assert.equal(movement.ok, true);
  assert.equal(played.at(-1), 'AreaScene');
  assert.equal(c.TaskEngine.searchPhoto().ok, true);
  assert.equal((await c.TaskEngine.navigateToTurnIn(quest.id)).ok, true);
  assert.equal(c.State.variables.position.areaId, 'park_entrance');
  assert.equal((await c.TaskEngine.navigateToTurnIn(quest.id)).ok, true);
  assert.equal(played.at(-1), 'NPCChat');
  assert.equal(c.TaskEngine.turnIn(quest.id, { npcId: 'wanqing' }).ok, true);
  const source = 'quest:' + quest.id + ':settled';
  assert.equal(quest.settlement.type, 'photo_returned');
  assert.equal(quest.photoProof.holder, 'wanqing');
  const facts = Object.values(c.State.variables.npcAgency.facts).filter(fact => fact.sourceEventId === source);
  assert.ok(facts.length > 0);
  assert.equal(queued.filter(job => job.event.sourceEventId === source).length, 1);
  assert.equal(c.State.variables.player.money, 25);
  assert.equal(Object.keys(c.State.variables.player.inventory).length, 0);
  assert.equal(c.NPCAgency.resolveActor('wanqing').resources.money, 35);
  c.State.variables = JSON.parse(JSON.stringify(c.State.variables));
  c.TaskEngine.recomputeAll();
  assert.equal(c.TaskEngine.turnIn(quest.id, { npcId: 'wanqing' }).ok, false);
  assert.equal(c.TaskEngine.offerPhotoQuest('wanqing').ok, false);
  assert.equal(queued.filter(job => job.event.sourceEventId === source).length, 1);
});

test('park child-area rendering mounts authored actions without mutating task or player state', async () => {
  const { context: c, handlers, rendered } = runtime();
  const offered = c.TaskEngine.offerPhotoQuest('wanqing');
  assert.equal(offered.ok, true, offered.error);
  assert.equal(c.NPCTools.resolveOffer(offered.offerId, 'accepted').ok, true);
  await c.MoveTool.invoke({ locationId: 'Park', areaId: 'park_path' }, { source: 'quest-test' });
  const render = handlers.get(':passagerender.questPhoto');
  assert.equal(typeof render, 'function');
  const output = {};
  const event = { passage: { title: 'AreaScene' }, content: { querySelector(selector) { assert.equal(selector, '.scene-fixed-actions'); return output; } } };
  const before = JSON.stringify(c.State.variables);
  render(event);
  render(event);
  assert.equal(rendered.length, 2);
  assert.equal(rendered[0].output, output);
  assert.equal(rendered[0].markup, '<<include "QuestPhotoActions">>');
  assert.equal(JSON.stringify(c.State.variables), before);
  render({ passage: { title: 'NPCChat' }, content: event.content });
  assert.equal(rendered.length, 2);
  c.State.variables.position = { locationId: 'Street', areaId: 'street_main' };
  render(event);
  assert.equal(rendered.length, 2);
  const scenes = fs.readFileSync(path.join(__dirname, '../src/passages/scenes.twee'), 'utf8');
  const actions = scenes.split(':: QuestPhotoActions')[1];
  assert.ok(actions);
  assert.match(actions, /<<link "寻找晚晴遗失的照片">>[\s\S]*?TaskEngine.searchPhoto\(\)[\s\S]*?<<\/link>>/);
  assert.match(actions, /<<goto "AreaScene">>/);
});


test('authored restart clears old agency assets, promises, solidified cards and daily usage', () => {
  const { context: c } = runtime();
  const state = c.State.variables;
  state.npcAgency.promises.old = { status: 'open' };
  state.npcAgency.actors['card:linwanqing'].resources.money = 0;
  state.characterCards.linwanqing.agencyResources.money = 0;
  state.characterCards.solidified = { name: '旧存档人物' };
  state.proactiveDialogueUsage = { old: 1 };
  state.proactiveDialogueUsageDay = 8;
  state.position = { locationId: 'Park', areaId: 'park_path' };
  const scenes = fs.readFileSync(path.join(__dirname, '../src/passages/scenes.twee'), 'utf8');
  const restart = scenes.split(':: GameOver')[1].split(':: QuestPhotoActions')[0];
  const script = restart.match(/<<run([\s\S]*?)>>/);
  assert.ok(script, 'restart must execute its scoped agency reset');
  vm.runInContext(script[1], c);
  for (const key of ['npcAgency', 'characterCards', 'proactiveDialogueUsage', 'proactiveDialogueUsageDay']) {
    assert.equal(Object.hasOwn(state, key), false);
  }
  assert.equal(state.position.locationId, 'Bedroom');
  assert.equal(state.position.areaId, 'bedroom_main');
  c.GameContent.ensure();
  assert.equal(state.characterCards.solidified, undefined);
  assert.equal(state.characterCards.linwanqing.agencyResources.money, 35);
});

test('accepted photo request remains deliverable after the same actor changes runtime ID', async () => {
  const { context: c } = runtime();
  const offer = c.TaskEngine.offerPhotoQuest('wanqing');
  c.NPCTools.resolveOffer(offer.offerId, 'accepted');
  c.State.variables.npcs.returned = c.State.variables.npcs.wanqing;
  c.State.variables.npcs.returned.id = 'returned';
  delete c.State.variables.npcs.wanqing;
  c.NPCAgency.ensure();
  c.TaskEngine.ensure();
  const quest = c.TaskEngine.photoQuest();
  assert.equal(quest.giver, 'returned');
  assert.equal(quest.turnIn.npcId, 'returned');
  await c.MoveTool.invoke({ locationId: 'Park', areaId: 'park_path' });
  assert.equal(c.TaskEngine.searchPhoto().ok, true);
  await c.MoveTool.invoke({ locationId: 'Park', areaId: 'park_entrance' });
  assert.equal(c.TaskEngine.turnIn(quest.id, { npcId: 'returned' }).ok, true);
  assert.equal(quest.settlement.actorId, 'card:linwanqing');
});

for (const change of ['detached', 'load', 'npc-replaced']) {
  test(`stale quest turn-in DOM cannot settle or navigate after ${change}`, async () => {
    const { context: c, played } = runtime();
    const offer = c.TaskEngine.offerPhotoQuest('wanqing');
    c.NPCTools.resolveOffer(offer.offerId, 'accepted');
    await c.MoveTool.invoke({ locationId: 'Park', areaId: 'park_path' });
    c.TaskEngine.searchPhoto();
    await c.MoveTool.invoke({ locationId: 'Park', areaId: 'park_entrance' });
    c.State.passage = 'NPCChat';
    let macro, link, click;
    c.Macro.add = (name, value) => { if (name === 'questturnins') macro = value; };
    c.document.createElement = () => ({ isConnected: true, setAttribute() {}, addEventListener(name, handler) { click = handler; } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/scripts/quest-engine.js'), 'utf8'), c);
    macro.handler.call({ args: ['wanqing'], output: { appendChild(value) { link = value; } } });
    assert.ok(link);
    if (change === 'detached') link.isConnected = false;
    if (change === 'load') c.State.variables = JSON.parse(JSON.stringify(c.State.variables));
    if (change === 'npc-replaced') c.State.variables.npcs.wanqing = { ...c.State.variables.npcs.wanqing };
    const before = JSON.stringify(c.State.variables), navigations = played.length;
    click({ preventDefault() {} });
    assert.equal(JSON.stringify(c.State.variables), before);
    assert.equal(played.length, navigations);
  });
}
