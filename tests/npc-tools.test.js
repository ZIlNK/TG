'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, clone, stage, staged, commit, money } = require('./helpers/npc-vm');

function rewardOffer(r, amount = 12, turn = 'reward:1') {
  const d = r.draft(turn);
  const key = staged(r, d, 'npc_offer_reward', money(amount));
  commit(r, d);
  return key;
}

function meeting(r) {
  return { locationId: 'Park', areaId: 'entrance', startAt: r.agency.now() + 60,
    endAt: r.agency.now() + 120, purpose: '聊聊照片' };
}

test('staging does not book money, expose offers, write dialogue or change relationships; final commit is atomic', () => {
  const r = createRuntime();
  const fact = r.fact();
  const before = r.save();
  const d = r.draft();
  const offer = staged(r, d, 'npc_offer_reward', money());
  staged(r, d, 'npc_update_impression', { summary: '有点失望', basisFactIds: [fact.id], relationshipDelta: -3 });
  assert.deepEqual(r.save(), before);
  assert.equal(r.tools.available(d.db, d.actorId).money, 18);
  commit(r, d, '我仍然想谢谢你。');
  assert.equal(r.state.player.money, 10);
  assert.equal(r.actor().resources.money, 30);
  assert.equal(r.db.offers[offer].status, 'pending');
  assert.equal(r.actor().impression, '有点失望');
  assert.equal(r.state.npcs.lin.relationship.value, 47);
  assert.equal(r.state.npcs.lin.disposition, -1);
  assert.equal(r.state.npcs.lin.dialogue.at(-1).content, '我仍然想谢谢你。');
  assert.equal(Object.values(r.db.receipts).filter((receipt) => receipt.type === 'turn_committed').length, 1);
  const committed = r.save();
  assert.equal(r.tools.commitTurn(d, '重复提交').ok, false);
  assert.deepEqual(r.save(), committed);
});

for (const content of ['', ' \t\n ', null]) {
  test(`empty final text ${JSON.stringify(content)} discards all staged actions`, () => {
    const r = createRuntime();
    const before = r.save();
    const d = r.draft();
    staged(r, d, 'npc_offer_reward', money());
    assert.equal(r.tools.commitTurn(d, content).ok, false);
    assert.deepEqual(r.save(), before);
  });
}

test('equivalent calls with reordered keys and different transport IDs reserve only once', () => {
  const r = createRuntime();
  const d = r.draft();
  const first = staged(r, d, 'npc_offer_reward', money(), 'provider-a:1');
  const result = r.tools.stage({ name: 'npc_offer_reward', id: 'provider-b:77',
    arguments: { message: money().message, reward: { amount: 12, kind: 'money' } } }, d);
  assert.equal(result.status, 'STAGED');
  assert.equal(result.reference, first);
  assert.equal(result.duplicate, true);
  assert.equal(Object.keys(d.db.offers).length, 1);
  assert.equal(r.tools.available(d.db, d.actorId).money, 18);
  commit(r, d);
  assert.equal(r.tools.resolveOffer(first, 'accepted').ok, true);
  const accepted = r.save();
  assert.equal(r.tools.resolveOffer(first, 'accepted').ok, false);
  assert.equal(r.tools.resolveOffer(first, 'declined').ok, false);
  assert.deepEqual(r.save(), accepted);
  assert.equal(r.state.player.money, 22);
  assert.equal(r.actor().resources.money, 18);
  assert.equal(Object.values(r.db.receipts).filter((receipt) => receipt.type === 'accepted').length, 1);
});

test('declining remembers the choice without transferring assets and releases reservations', () => {
  const r = createRuntime();
  const key = rewardOffer(r, 30);
  assert.equal(r.tools.available(r.db, r.actor().actorId).money, 0);
  assert.equal(r.tools.resolveOffer(key, 'declined').ok, true);
  assert.equal(r.tools.available(r.db, r.actor().actorId).money, 30);
  assert.equal(r.state.player.money, 10);
  assert.equal(r.actor().resources.money, 30);
  assert.equal(Object.values(r.db.facts).filter((fact) => fact.type === 'player_declined').length, 1);
});

test('independent offers compete for finite resources; rejected actions leave no partial draft mutation', () => {
  const r = createRuntime();
  rewardOffer(r, 20);
  const d = r.draft('reward:2');
  const before = clone(d.db);
  const rejected = stage(r, d, 'npc_offer_reward', money(11));
  assert.equal(rejected.code, 'INSUFFICIENT_RESOURCE');
  assert.deepEqual(clone(d.db), before);
  const corrected = staged(r, d, 'npc_offer_reward', money(10));
  commit(r, d);
  assert.equal(r.tools.available(r.db, r.actor().actorId).money, 0);
  assert.equal(r.tools.resolveOffer(corrected, 'accepted').ok, true);
  assert.equal(r.actor().resources.money, 20);
  assert.equal(r.tools.available(r.db, r.actor().actorId).money, 0);
});

test('two concurrent drafts cannot overwrite the first committed reservation', () => {
  const r = createRuntime();
  const a = r.draft('a');
  const b = r.draft('b');
  staged(r, a, 'npc_offer_reward', money(25));
  staged(r, b, 'npc_offer_reward', money(25));
  commit(r, a);
  const before = r.save();
  assert.equal(r.tools.commitTurn(b, '另一个回合').status, 'stale');
  assert.deepEqual(r.save(), before);
});

test('explicit replacement withdraws the prior offer and reuses its reservation atomically', () => {
  const r = createRuntime();
  const old = rewardOffer(r, 30);
  const d = r.draft('replacement');
  const replacement = staged(r, d, 'npc_offer_reward', money(15, { replaceOfferId: old }));
  assert.equal(r.db.offers[old].status, 'pending');
  commit(r, d);
  assert.equal(r.db.offers[old].status, 'withdrawn');
  assert.equal(r.tools.available(r.db, r.actor().actorId).money, 15);
  assert.equal(r.tools.resolveOffer(old, 'accepted').ok, false);
  assert.equal(r.tools.resolveOffer(replacement, 'accepted').ok, true);
  assert.equal(r.state.player.money, 25);
});

for (const inventory of [{ tea: 1 }, ['tea']]) {
  test(`registered items transfer exactly once with ${Array.isArray(inventory) ? 'legacy array' : 'object'} inventory`, () => {
    const r = createRuntime();
    r.state.player.inventory = clone(inventory);
    const d = r.draft();
    const key = staged(r, d, 'npc_offer_reward', {
      reward: { kind: 'existing_item', itemId: 'tea', quantity: 2 }, message: '送你两包茶。'
    });
    commit(r, d);
    assert.equal(r.tools.resolveOffer(key, 'accepted').ok, true);
    assert.equal(r.state.player.inventory.tea, 3);
    assert.equal(r.actor().resources.items.tea, 0);
    assert.equal(r.state.player.money, 10);
  });
}

test('original keepsake consumes registered paper only on acceptance and creates a persistent non-saleable item', () => {
  const r = createRuntime();
  const d = r.draft();
  const key = staged(r, d, 'npc_offer_reward', {
    reward: { kind: 'keepsake', title: '纸上落日', description: '<script>不是可执行脚本</script> <<set $money=999>>' },
    message: '这是一张我画的小画。'
  });
  commit(r, d);
  assert.equal(r.actor().resources.items['blank-paper'], 1);
  assert.equal(Object.keys(r.state.player.inventory).length, 0);
  assert.equal(r.tools.resolveOffer(key, 'accepted').ok, true);
  const item = Object.keys(r.state.player.inventory)[0];
  assert.equal(r.state.player.inventory[item], 1);
  assert.equal(r.actor().resources.items['blank-paper'], 0);
  assert.equal(r.db.itemDefinitions[item].title, '纸上落日');
  assert.equal(r.db.itemDefinitions[item].sellable, false);
  assert.equal(r.db.itemDefinitions[item].effects, undefined);
  const before = r.save();
  r.load(before);
  assert.deepEqual(r.save(), before);
  assert.equal(r.tools.resolveOffer(key, 'accepted').ok, false);
  assert.equal(r.state.player.money, 10);
});

const invalidCalls = [
  ['zero money', 'npc_offer_reward', money(0), 'INVALID_ARGUMENTS'],
  ['fractional money', 'npc_offer_reward', money(1.5), 'INVALID_ARGUMENTS'],
  ['empty message', 'npc_offer_reward', money(1, { message: '   ' }), 'INVALID_ARGUMENTS'],
  ['unknown target', 'npc_offer_reward', money(1, { actorId: 'npc:other' }), 'INVALID_ARGUMENTS'],
  ['unregistered item', 'npc_offer_reward', { reward: { kind: 'existing_item', itemId: 'magic-key', quantity: 1 }, message: '给你' }, 'UNKNOWN_ITEM'],
  ['forged item effects', 'npc_offer_reward', { reward: { kind: 'keepsake', title: '纸', description: '纸', effects: { money: 100 } }, message: '给你' }, 'INVALID_ARGUMENTS'],
  ['unknown tool', 'accept_offer', { offerId: 'anything' }, 'UNKNOWN_TOOL']
];
for (const [label, name, args, code] of invalidCalls) {
  test(`reject ${label} without changing draft or live state`, () => {
    const r = createRuntime();
    const d = r.draft();
    const before = r.save();
    const draftBefore = clone(d.db);
    assert.equal(stage(r, d, name, args).code, code);
    assert.deepEqual(clone(d.db), draftBefore);
    assert.deepEqual(r.save(), before);
  });
}

test('malformed JSON and non-finite numeric arguments fail at the tool boundary', () => {
  const r = createRuntime();
  const d = r.draft();
  for (const args of ['{bad json', { reward: { kind: 'money', amount: Infinity }, message: '给你' }]) {
    assert.equal(r.tools.stage({ name: 'npc_offer_reward', arguments: args }, d).status, 'REJECTED');
  }
  assert.equal(Object.keys(d.db.offers).length, 0);
});

for (const change of [
  ['player money', (r) => { r.state.player.money++; }],
  ['inventory', (r) => { r.state.player.inventory.tea = 1; }],
  ['NPC resource', (r) => { r.actor().resources.money--; }],
  ['time', (r) => { r.state.time.minute++; }],
  ['location', (r) => { r.state.position.areaId = 'path'; }],
  ['quest state', (r) => { r.state.quests.newQuest = { status: 'active' }; }]
]) {
  test(`state change during a staged turn (${change[0]}) blocks stale commit without reverting new state`, () => {
    const r = createRuntime();
    const d = r.draft();
    staged(r, d, 'npc_offer_reward', money());
    change[1](r);
    const current = r.save();
    assert.equal(r.tools.commitTurn(d, '迟到的回应').status, 'stale');
    assert.deepEqual(r.save(), current);
  });
}

test('accepting an existing card invalidates an in-flight draft, preserving the accepted transaction', () => {
  const r = createRuntime();
  const offer = rewardOffer(r);
  const d = r.draft('late');
  staged(r, d, 'npc_offer_reward', money(5));
  assert.equal(r.tools.resolveOffer(offer, 'accepted').ok, true);
  const accepted = r.save();
  assert.equal(r.tools.commitTurn(d, '过期').status, 'stale');
  assert.deepEqual(r.save(), accepted);
});

test('acceptance revalidates available assets and presence without partial payment or receipts', () => {
  const r = createRuntime();
  const offer = rewardOffer(r, 20);
  r.actor().resources.money = 19;
  let before = r.save();
  assert.equal(r.tools.resolveOffer(offer, 'accepted').code, 'INSUFFICIENT_RESOURCE');
  assert.deepEqual(r.save(), before);
  r.actor().resources.money = 30;
  r.state.position.areaId = 'path';
  before = r.save();
  assert.equal(r.tools.resolveOffer(offer, 'accepted').code, 'NOT_PRESENT');
  assert.deepEqual(r.save(), before);
});

test('known-fact permissions protect impressions and intentions against another actor or invented evidence', () => {
  const r = createRuntime();
  const secret = r.fact('player_statement', { text: '只告诉另一位访客' }, 'secret', 'other');
  for (const factId of [secret.id, 'fact:invented']) {
    const d = r.draft();
    assert.equal(stage(r, d, 'npc_update_impression', {
      summary: '凭空知道秘密', basisFactIds: [factId], relationshipDelta: 3
    }).code, 'UNKNOWN_FACT');
    assert.equal(stage(r, d, 'npc_set_intention', {
      goal: '依据秘密行动', anchorFactIds: [factId], reconsiderWhen: { kind: 'next_encounter' }
    }).code, 'UNKNOWN_FACT');
    assert.equal(d.db.actors[d.actorId].impression, '');
    assert.equal(Object.keys(d.db.intentions).length, 0);
  }
});

test('zero relationship delta is valid and a second distinct update cannot stack in the same turn', () => {
  const r = createRuntime();
  const fact = r.fact();
  const d = r.draft();
  staged(r, d, 'npc_update_impression', { summary: '保持看法', basisFactIds: [fact.id], relationshipDelta: 0 });
  assert.equal(stage(r, d, 'npc_update_impression', {
    summary: '再加一次', basisFactIds: [fact.id], relationshipDelta: 5
  }).code, 'DUPLICATE_ACTION');
  commit(r, d);
  assert.equal(r.state.npcs.lin.relationship.value, 50);
  assert.equal(r.state.npcs.lin.relationship.history.length, 1);
  assert.equal(r.actor().impression, '保持看法');
});

for (const choice of ['accepted', 'declined']) {
  test(`a reward promise reuses its reservation and becomes ${choice === 'accepted' ? 'fulfilled' : 'released'} on ${choice}`, () => {
    const r = createRuntime();
    const d = r.draft('promise');
    const key = staged(r, d, 'npc_make_promise', {
      benefit: { kind: 'reward', reward: { kind: 'money', amount: 30 } },
      dueAt: r.agency.now() + 60, message: '这笔钱留给你。'
    });
    commit(r, d);
    assert.equal(r.tools.available(r.db, r.actor().actorId).money, 0);
    const next = r.draft('fulfill');
    const before = clone(next.db);
    assert.equal(stage(r, next, 'npc_offer_reward', money(29, { promiseId: key })).code, 'PROMISE_MISMATCH');
    assert.deepEqual(clone(next.db), before);
    const offer = staged(r, next, 'npc_offer_reward', money(30, { promiseId: key }));
    commit(r, next);
    assert.equal(r.tools.available(r.db, r.actor().actorId).money, 0, 'promise-to-offer must not double-reserve');
    assert.equal(r.tools.resolveOffer(offer, choice).ok, true);
    assert.equal(r.db.promises[key].status, choice === 'accepted' ? 'fulfilled' : 'released');
    assert.equal(r.state.player.money, choice === 'accepted' ? 40 : 10);
    assert.equal(r.tools.available(r.db, r.actor().actorId).money, choice === 'accepted' ? 0 : 30);
  });
}

test('invitation acceptance does not move, spend or advance time; attendance fulfills a matching meeting promise exactly once', () => {
  const r = createRuntime();
  const m = meeting(r);
  let d = r.draft('promise');
  const key = staged(r, d, 'npc_make_promise', {
    benefit: { kind: 'meeting', meeting: m }, dueAt: m.endAt, message: '我会等你。'
  });
  commit(r, d);
  d = r.draft('invitation');
  const offer = staged(r, d, 'npc_invite_player', { ...m, message: '明天见。', promiseId: key });
  commit(r, d);
  const position = clone(r.state.position);
  const now = r.agency.now();
  assert.equal(r.tools.resolveOffer(offer, 'accepted').ok, true);
  assert.deepEqual(clone(r.state.position), position);
  assert.equal(r.agency.now(), now);
  assert.equal(r.state.player.money, 10);
  assert.equal(r.tools.attend(offer).ok, false);
  r.setMinute(m.startAt);
  r.state.position.areaId = 'path';
  assert.equal(r.tools.attend(offer).ok, false);
  r.state.position.areaId = 'entrance';
  assert.equal(r.tools.attend(offer).ok, true);
  assert.equal(r.db.promises[key].status, 'fulfilled');
  assert.equal(r.db.offers[offer].appointmentStatus, 'attended');
  assert.equal(r.tools.attend(offer).ok, false);
  assert.equal(Object.values(r.db.facts).filter((fact) => fact.type === 'appointment_attended').length, 1);
});

test('meeting validation rejects unregistered or non-resident locations and invalid time windows', () => {
  const r = createRuntime();
  for (const patch of [
    { areaId: 'path' }, { locationId: 'Nowhere' }, { areaId: 'unregistered' },
    { startAt: r.agency.now() - 1 }, { endAt: r.agency.now() }, { endAt: r.agency.now() + 31 * 1440 }
  ]) {
    const d = r.draft();
    assert.equal(stage(r, d, 'npc_invite_player', { ...meeting(r), ...patch, message: '一起见面' }).status, 'REJECTED');
    assert.equal(Object.keys(d.db.offers).length, 0);
  }
});

test('expired unaccepted invitations are not missed appointments; accepted no-shows are recorded once', () => {
  const r = createRuntime();
  const m = meeting(r);
  let d = r.draft('unaccepted');
  const pending = staged(r, d, 'npc_invite_player', { ...m, message: '邀请一' });
  commit(r, d);
  d = r.draft('accepted');
  const accepted = staged(r, d, 'npc_invite_player', { ...m, message: '邀请二' });
  commit(r, d);
  assert.equal(r.tools.resolveOffer(accepted, 'accepted').ok, true);
  r.setMinute(m.endAt);
  r.tools.advanceTime();
  const once = r.save();
  r.tools.advanceTime();
  assert.deepEqual(r.save(), once);
  assert.equal(r.db.offers[pending].status, 'expired');
  assert.equal(r.db.offers[pending].appointmentStatus, undefined);
  assert.equal(r.db.offers[accepted].appointmentStatus, 'missed');
  assert.equal(r.tools.attend(accepted).ok, false);
  assert.equal(Object.values(r.db.facts).filter((fact) => fact.type === 'appointment_missed').length, 1);
});

test('midnight expiry releases offers and broken promises exactly once', () => {
  const r = createRuntime();
  r.state.time = { day: 1, hour: 0, minute: 0 };
  const offer = rewardOffer(r, 15);
  const d = r.draft('promise');
  const promise = staged(r, d, 'npc_make_promise', {
    benefit: { kind: 'reward', reward: { kind: 'money', amount: 15 } },
    dueAt: 4 * 1440, message: '会给你' });
  commit(r, d);
  r.setMinute(4 * 1440 - 1);
  r.tools.advanceTime();
  assert.equal(r.tools.available(r.db, r.actor().actorId).money, 0);
  r.setMinute(4 * 1440);
  assert.equal(r.tools.resolveOffer(offer, 'accepted').code, 'EXPIRED');
  r.tools.advanceTime();
  assert.equal(r.db.offers[offer].status, 'expired');
  assert.equal(r.db.promises[promise].status, 'broken');
  assert.equal(r.tools.available(r.db, r.actor().actorId).money, 30);
  const before = r.save();
  r.tools.advanceTime();
  assert.deepEqual(r.save(), before);
});

test('intentions become eligible on game-time and owned-offer resolution, and can be cancelled without changing facts', () => {
  const r = createRuntime();
  const fact = r.fact();
  const offer = rewardOffer(r);
  const d = r.draft('intentions');
  const timed = staged(r, d, 'npc_set_intention', {
    goal: '过一会再想', anchorFactIds: [fact.id], reconsiderWhen: { kind: 'game_time', notBefore: r.agency.now() + 60 }
  });
  const resolved = staged(r, d, 'npc_set_intention', {
    goal: '听听玩家的选择', anchorFactIds: [fact.id], reconsiderWhen: { kind: 'offer_resolved', offerId: offer }
  });
  commit(r, d);
  r.tools.advanceTime();
  assert.equal(r.db.intentions[timed].status, 'pending');
  assert.equal(r.db.intentions[resolved].status, 'pending');
  r.tools.resolveOffer(offer, 'declined');
  r.tools.advanceTime();
  assert.equal(r.db.intentions[resolved].status, 'eligible');
  r.setMinute(r.agency.now() + 60);
  r.tools.advanceTime();
  assert.equal(r.db.intentions[timed].status, 'eligible');
  const beforeFacts = clone(r.db.facts);
  const next = r.draft('cancel');
  staged(r, next, 'npc_set_intention', {
    goal: '不必再想', anchorFactIds: [fact.id], reconsiderWhen: { kind: 'next_encounter' },
    replaceIntentionId: timed, status: 'cancelled'
  });
  commit(r, next);
  assert.equal(r.db.intentions[timed].status, 'cancelled');
  assert.deepEqual(clone(r.db.facts), beforeFacts);
});

test('one actor cannot fulfil another actor promise or replace another actor intention', () => {
  const r = createRuntime();
  let d = r.draft('other', 'other');
  const promise = staged(r, d, 'npc_make_promise', {
    benefit: { kind: 'reward', reward: { kind: 'money', amount: 5 } }, dueAt: r.agency.now() + 60, message: '承诺'
  });
  const intention = staged(r, d, 'npc_set_intention', {
    goal: '自己的打算', anchorFactIds: [], reconsiderWhen: { kind: 'next_encounter' }
  });
  commit(r, d);
  d = r.draft('lin');
  assert.equal(stage(r, d, 'npc_offer_reward', money(5, { promiseId: promise })).code, 'UNKNOWN_REFERENCE');
  assert.equal(stage(r, d, 'npc_set_intention', {
    goal: '改别人的打算', anchorFactIds: [], reconsiderWhen: { kind: 'next_encounter' }, replaceIntentionId: intention
  }).code, 'UNKNOWN_REFERENCE');
});

test('reloading a post-acceptance save keeps receipts/assets consistent; loading an earlier branch permits its own one-time acceptance', () => {
  const r = createRuntime();
  const offer = rewardOffer(r);
  const pending = r.save();
  assert.equal(r.tools.resolveOffer(offer, 'accepted').ok, true);
  const accepted = r.save();
  r.load(accepted);
  assert.equal(r.tools.resolveOffer(offer, 'accepted').ok, false);
  assert.deepEqual(r.save(), accepted);
  r.load(pending);
  assert.equal(r.state.player.money, 10);
  assert.equal(r.tools.resolveOffer(offer, 'accepted').ok, true);
  assert.deepEqual(r.save(), accepted);
});

test('attendance requires the agreed location, not merely co-presence after both participants relocate', () => {
  const r = createRuntime();
  const m = meeting(r);
  const d = r.draft();
  const offer = staged(r, d, 'npc_invite_player', { ...m, message: '在入口见' });
  commit(r, d);
  assert.equal(r.tools.resolveOffer(offer, 'accepted').ok, true);
  r.setMinute(m.startAt);
  r.state.position.areaId = 'path';
  r.state.npcs.lin.areaId = 'path';
  const before = r.save();
  assert.equal(r.tools.attend(offer).ok, false, 'co-presence on the path must not fulfil an entrance appointment');
  assert.deepEqual(r.save(), before);
});

test('pending offers follow stable actor identity after save/load re-instantiates its runtime NPC', () => {
  const r = createRuntime();
  const offer = rewardOffer(r);
  const saved = r.save();
  saved.npcs.reborn = { ...saved.npcs.lin, id: 'reborn' };
  delete saved.npcs.lin;
  saved.activeNPCId = 'reborn';
  r.load(saved);
  assert.equal(r.actor('reborn').actorId, r.db.offers[offer].actorId);
  assert.equal(r.tools.resolveOffer(offer, 'accepted').ok, true, 'a live same-actor replacement must not strand the saved offer');
  assert.equal(r.state.player.money, 22);
  assert.equal(r.actor('reborn').resources.money, 18);
});

test('expired reward proposal restores an open promise reservation and permits another proposal', () => {
  const r = createRuntime();
  let d = r.draft('promise');
  const promise = staged(r, d, 'npc_make_promise', {
    benefit: { kind: 'reward', reward: { kind: 'money', amount: 30 } },
    dueAt: r.agency.now() + 10 * 1440, message: '十天内留给你。'
  });
  commit(r, d);
  d = r.draft('proposal');
  const first = staged(r, d, 'npc_offer_reward', money(30, { promiseId: promise }));
  commit(r, d);
  r.setMinute(r.db.offers[first].expiresAt);
  r.tools.advanceTime();
  assert.equal(r.db.promises[promise].status, 'open');
  assert.equal(r.db.promises[promise].offerId, undefined);
  assert.equal(r.tools.available(r.db, r.actor().actorId).money, 0);
  d = r.draft('proposal:retry');
  const second = staged(r, d, 'npc_offer_reward', money(30, { promiseId: promise }));
  commit(r, d);
  assert.equal(r.tools.resolveOffer(second, 'accepted').ok, true);
  assert.equal(r.state.player.money, 40);
  assert.equal(r.db.promises[promise].status, 'fulfilled');
});

test('invitation cannot be accepted when both participants have left its contracted area', () => {
  const r = createRuntime();
  const d = r.draft('invite');
  const key = staged(r, d, 'npc_invite_player', { ...meeting(r), message: '原地见。' });
  commit(r, d);
  r.state.position.areaId = 'path';
  r.state.npcs.lin.areaId = 'path';
  assert.equal(r.tools.resolveOffer(key, 'accepted').code, 'INVALID_LOCATION');
  assert.equal(r.db.offers[key].status, 'pending');
});
