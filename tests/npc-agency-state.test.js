'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, initialState, clone, staged, commit } = require('./helpers/npc-vm');

test('legacy unique names migrate once and retain the complete card persona', () => {
  const variables = initialState();
  delete variables.npcs.lin.cardId;
  const r = createRuntime({ variables });
  assert.equal(r.actor().actorId, 'card:linwanqing');
  const profile = r.agency.buildContext('lin').profile;
  for (const field of ['personality', 'scenario', 'description']) {
    assert.equal(profile[field], variables.characterCards.linwanqing[field]);
  }
  r.actor().resources.money = 1;
  const before = r.save();
  r.agency.ensure();
  r.agency.ensure();
  assert.deepEqual(r.save(), before, 'migration must not replenish resources or duplicate actors');
});

test('explicit card links take precedence over matching names', () => {
  const variables = initialState();
  variables.characterCards.second = { name: '另一个名字', personality: '独立的人设' };
  variables.npcs.lin.cardId = 'second';
  const r = createRuntime({ variables });
  assert.equal(r.actor().actorId, 'card:second');
  assert.equal(r.agency.buildContext('lin').profile.personality, '独立的人设');
});

for (const ambiguity of ['cards', 'people']) {
  test(`ambiguous legacy ${ambiguity} never merge people or their memories`, () => {
    const variables = initialState();
    delete variables.npcs.lin.cardId;
    if (ambiguity === 'cards') variables.characterCards.twin = clone(variables.characterCards.linwanqing);
    else variables.npcs.other.name = variables.npcs.lin.name;
    const r = createRuntime({ variables });
    assert.equal(r.actor().actorId, 'npc:lin');
    assert.notEqual(r.actor().actorId, r.actor('other').actorId);
    r.fact();
    assert.equal(r.agency.buildContext('other').facts.length, 0);
  });
}

test('a saved actor survives rename and card re-instantiation under a new runtime ID', () => {
  const r = createRuntime();
  const identity = r.actor().actorId;
  const fact = r.fact();
  r.actor().resources.money = 7;
  const saved = r.save();
  saved.npcs.reborn = { ...saved.npcs.lin, id: 'reborn', name: '更改显示姓名' };
  delete saved.npcs.lin;
  r.load(saved);
  assert.equal(r.actor('reborn').actorId, identity);
  assert.equal(r.actor('reborn').resources.money, 7);
  assert.deepEqual(clone(r.agency.buildContext('reborn').facts).map((entry) => entry.id), [fact.id]);
});

test('solidifying a runtime NPC into a card preserves the explicit actor and facts', () => {
  const r = createRuntime();
  const actor = r.actor('other');
  const fact = r.fact('player_statement', { text: '你好' }, 'hello:other', 'other');
  r.state.characterCards.solidified = { name: '固化后的姓名', actorId: actor.actorId };
  r.state.npcs.other.profileRef = 'solidified';
  r.state.npcs.other.name = '固化后的姓名';
  r.agency.ensure();
  assert.equal(r.actor('other').actorId, actor.actorId);
  assert.equal(r.actor('other').knownFactIds[0], fact.id);
  assert.equal(Object.keys(r.db.actors).length, 2);
});

test('card-only legacy saves and unconfigured runtime NPCs do not create imaginary wealth or history', () => {
  const variables = initialState();
  variables.npcs = {};
  const r = createRuntime({ variables });
  assert.equal(Object.keys(r.db.actors).length, 0);
  assert.equal(Object.keys(r.db.facts).length, 0);
  r.state.npcs.stranger = { id: 'stranger', name: '陌生人' };
  assert.deepEqual(clone(r.actor('stranger').resources), { money: 0, items: {} });
});

test('facts deduplicate per event/type/knower and statements never become completion facts', () => {
  const r = createRuntime();
  const first = r.fact('player_statement', { text: '我已经找到照片了' }, 'statement:1');
  const replay = r.fact('player_statement', { text: '重复传输' }, 'statement:1');
  assert.equal(first.id, replay.id);
  assert.equal(first.data.text, '我已经找到照片了');
  r.fact('player_statement', { text: '我已经找到照片了' }, 'statement:1', 'other');
  assert.equal(Object.keys(r.db.facts).length, 2);
  assert.equal(r.agency.buildContext('lin').facts.length, 1);
  assert.equal(r.agency.buildContext('other').facts.length, 1);
  assert.equal(Object.values(r.db.facts).some((fact) => fact.type === 'quest_settled'), false);
});

test('drafts isolate all mutable business tables and are absent from save contents', () => {
  const r = createRuntime();
  const before = r.save();
  const d = r.draft();
  d.player.money = 999;
  d.npcs.lin.name = '覆盖';
  d.quests.injected = { status: 'completed' };
  d.db.actors[d.actorId].impression = '尚未提交';
  assert.deepEqual(r.save(), before);
  assert.equal(JSON.stringify(r.save()).includes('scope'), false);
});

test('important facts, promises and intentions survive dialogue trimming and JSON save/load', () => {
  const r = createRuntime();
  const fact = r.fact();
  const d = r.draft();
  const promise = staged(r, d, 'npc_make_promise', {
    benefit: { kind: 'reward', reward: { kind: 'money', amount: 5 } },
    dueAt: r.agency.now() + 1440, message: '明天给你。'
  });
  const intention = staged(r, d, 'npc_set_intention', {
    goal: '下次再感谢', anchorFactIds: [fact.id], reconsiderWhen: { kind: 'next_encounter' }
  });
  commit(r, d);
  for (let i = 0; i < 55; i++) commit(r, r.draft(`chat:${i}`), `闲聊 ${i}`);
  assert.equal(r.state.npcs.lin.dialogue.length, 50);
  const before = r.save();
  r.load(before);
  assert.deepEqual(r.save(), before);
  assert.equal(r.db.promises[promise].status, 'open');
  assert.equal(r.db.intentions[intention].status, 'pending');
  assert.equal(r.agency.buildContext('lin').facts[0].id, fact.id);
});

test('game-minute timestamps advance by one across midnight, independently of wall clock', () => {
  const r = createRuntime();
  r.state.time = { day: 1, hour: 23, minute: 59 };
  const first = r.fact('encounter', {}, 'before-midnight');
  r.state.time = { day: 2, hour: 0, minute: 0 };
  const second = r.fact('encounter', {}, 'after-midnight');
  assert.equal(second.at - first.at, 1);
});

test('quest settlement respects fixed mode and deduplicates discretionary facts and jobs', () => {
  const r = createRuntime({ director: true });
  const quest = { id: 'photo', title: '寻找照片', giver: 'lin', rewards: ['金钱+5'] };
  r.agency.onQuestSettled(quest);
  assert.equal(Object.keys(r.db.facts).length, 0);
  assert.equal(Object.keys(r.db.jobs).length, 0);
  quest.rewardMode = 'fixed_plus_npc';
  r.agency.onQuestSettled(quest);
  r.agency.onQuestSettled(quest);
  assert.equal(Object.keys(r.db.jobs).length, 1);
  assert.equal(Object.keys(r.db.facts).length, 1);
  assert.deepEqual(clone(Object.values(r.db.facts)[0].data.fixedRewards), ['金钱+5']);
  assert.equal(r.state.player.money, 10, 'agency does not settle fixed rewards a second time');
});
