'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRuntime, clone } = require('./helpers/npc-vm');

function loadContent(runtime) {
  const filename = path.resolve(__dirname, '../src/scripts/content.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), runtime.context, { filename });
  runtime.context.GameContent.ensure();
}

test('old saves gain missing authored cards without replacing existing characters or replenishing assets', () => {
  const r = createRuntime();
  const existingCard = r.state.characterCards.linwanqing;
  existingCard.personality = '存档中保留的人设';
  existingCard.agencyResources.money = 0;
  r.actor().resources.money = 0;
  r.state.npcs.lin.dialogue.push({ role: 'assistant', content: '记得你上次的帮助。' });
  r.fact('encounter', { day: 1 }, 'old-encounter');
  r.state.quests.old = { id: 'old', status: 'completed' };
  r.state.characterCards.custom = { name: '玩家保存的角色', personality: '自定义设定' };
  const before = r.save();

  loadContent(r);
  assert.equal(r.state.characterCards.linwanqing, existingCard);
  assert.equal(existingCard.personality, before.characterCards.linwanqing.personality);
  assert.deepEqual(clone(existingCard.agencyResources), before.characterCards.linwanqing.agencyResources);
  for (const key of ['npcs', 'npcAgency', 'quests', 'player']) {
    assert.deepEqual(clone(r.state[key]), before[key], key + ' must survive migration');
  }
  assert.deepEqual(clone(r.state.characterCards.custom), before.characterCards.custom);
  assert.equal(r.state.characterCards.hunter.actorId, 'card:hunter');
  assert.equal(r.state.characterCards.hunter.areaId, 'park_entrance');

  const hunter = r.state.characterCards.hunter;
  hunter.personality = '玩家调整后的亨特人设';
  hunter.proactiveDialogue.usedByArea['Park|park_entrance'] = 1;
  r.context.GameContent.ensure();
  assert.equal(r.state.characterCards.hunter, hunter);
  assert.equal(r.context.GameContent.defaults.characterCards.hunter.proactiveDialogue.usedByArea['Park|park_entrance'], undefined);
  assert.notEqual(r.context.GameContent.defaults.characterCards.hunter.personality, hunter.personality);
  // The game initializes agency identities before saving; do the same here.
  r.agency.ensure();
  const saved = r.save();
  r.load(saved);
  assert.deepEqual(clone(r.state.characterCards.hunter), saved.characterCards.hunter);
  assert.deepEqual(clone(r.state.npcs), saved.npcs);
  assert.equal(r.actor().resources.money, 0);
});

test('Hunter agency requests receive the adapted profile and real history without importing community lore or example memories', async () => {
  const r = createRuntime({ director: true });
  loadContent(r);
  const card = r.state.characterCards.hunter;
  r.state.position = { locationId: 'Park', areaId: 'park_entrance' };
  r.state.npcs.hunter = Object.assign(clone(card), {
    id: 'hunter', profileRef: 'hunter', cardId: 'hunter',
    dialogue: [{ role: 'assistant', content: card.greeting }],
    relationship: { value: 0, history: [] }, disposition: 0
  });
  r.state.activeNPCId = 'hunter';
  r.agency.ensure();
  const context = r.agency.buildContext('hunter');
  assert.equal(context.profile.personality, card.personality);
  assert.equal(context.facts.length, 0);
  const message = '我也喜欢画画，可以聊聊吗？';
  const job = r.director.enqueue('hunter', { type: 'chat', text: message, sourceEventId: 'hunter-chat:1' });
  assert.equal((await r.director.runDecision(job.id)).ok, true);
  const request = r.calls[0];
  const system = request.messages[0].content;
  assert.ok(system.includes(JSON.stringify(card.personality)));
  assert.match(system, /示例，不代表已经发生的经历/);
  assert.doesNotMatch(system, /照片寻找与交付使用正式任务入口/);
  const sections = request.promptAssembly.sections;
  const personaSection = sections.find((section) => section.label === '人物设定');
  const stateSection = sections.find((section) => section.label === '当前处境与已知事实');
  const examplesSection = sections.find((section) => section.label === '语气示例（非经历）');
  assert.ok(examplesSection.content.includes(JSON.stringify(card.dialogueExamples)));
  assert.equal(personaSection.content.includes(card.dialogueExamples[0].assistant), false);
  assert.equal(stateSection.content.includes(card.dialogueExamples[0].assistant), false);
  assert.equal(sections.map((section) => section.content).join('\n'), system);
  assert.doesNotMatch(system, /Camp Buddy|Keitaro|Hiro|Natsumi|Yoichi|Taiga|营地考试/);
  assert.deepEqual(clone(request.messages.slice(1).map((entry) => entry.content)), [card.greeting, message]);
  const facts = r.agency.buildContext('hunter').facts;
  assert.equal(facts.filter((fact) => fact.type === 'player_statement').length, 1);
  assert.equal(facts.find((fact) => fact.type === 'player_statement').data.text, message);
});

test('untouched legacy Hunter persona upgrades on load while actor history and resources survive', () => {
  const r = createRuntime({ director: true });
  const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/hunter-personality-v1.json'), 'utf8')).join('\n\n');
  r.state.characterCards.hunter = { name: '亨特', personality: legacy, agencyResources: { money: 0, items: {} } };
  r.state.npcs.hunter = {
    id: 'hunter', cardId: 'hunter', personality: legacy, locationId: 'Park', areaId: 'park_entrance',
    dialogue: [{ role: 'assistant', content: '上次的书还没读完。' }]
  };
  r.state.position.areaId = 'park_entrance';
  r.fact('player_statement', { text: '我喜欢水彩。' }, 'old-hunter-chat', 'hunter');
  r.actor('hunter').impression = '聊过绘画，但还不熟悉。';
  r.actor('hunter').resources.money = 3;
  const before = r.save();
  loadContent(r);
  const upgraded = r.state.characterCards.hunter;
  const source = r.context.GameContent.defaults.characterCards.hunter;
  assert.equal(upgraded.personality, source.personality);
  assert.notEqual(upgraded.personality, legacy);
  assert.deepEqual(clone(upgraded.dialogueExamples), clone(source.dialogueExamples));
  for (const key of ['npcAgency', 'npcs', 'quests', 'player']) assert.deepEqual(clone(r.state[key]), before[key]);
  const saved = r.save();
  r.load(saved);
  assert.deepEqual(r.save(), saved, 'reloading does not repeat migration or alter saved gameplay');
  const job = r.director.enqueue('hunter', { type: 'chat', text: '你好' });
  const system = r.director.messagesFor('hunter', job)[0].content;
  assert.ok(system.includes(JSON.stringify(source.personality)), 'the saved runtime NPC uses its updated linked card');
  assert.ok(system.includes(JSON.stringify(source.dialogueExamples)));
});

test('edited Hunter profiles and custom examples survive the authored prompt upgrade', () => {
  const r = createRuntime();
  const custom = [{ situation: '自定义情境', user: '玩家话语', assistant: '自定义示例' }];
  r.state.characterCards.hunter = { name: '亨特', personality: '玩家自定义性格', dialogueExamples: custom };
  loadContent(r);
  assert.equal(r.state.characterCards.hunter.personality, '玩家自定义性格');
  assert.deepEqual(clone(r.state.characterCards.hunter.dialogueExamples), custom);
  assert.notEqual(r.state.characterCards.hunter.personality, r.context.GameContent.defaults.characterCards.hunter.personality);
});
