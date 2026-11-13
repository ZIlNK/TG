'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, clone, staged, commit, money, deferred } = require('./helpers/npc-vm');

function modelOffer(request, amount = 12, id = 'transport:1') {
  const result = request.stage({ id, name: 'npc_offer_reward', arguments: money(amount) });
  assert.equal(result.status, 'STAGED', JSON.stringify(result));
  return result.reference;
}

function enqueue(r, source = 'chat:1') {
  return r.director.enqueue('lin', { type: 'chat', text: '我把照片还给你了。', sourceEventId: source });
}

test('source-event replay enqueues one job and one player statement, with no automatic social bonus', () => {
  const r = createRuntime({ director: true });
  const first = enqueue(r);
  assert.equal(enqueue(r).id, first.id);
  assert.equal(Object.keys(r.db.jobs).length, 1);
  assert.equal(Object.values(r.db.facts).filter((fact) => fact.type === 'player_statement').length, 1);
  assert.equal(r.state.npcs.lin.dialogue.length, 1);
  assert.equal(r.state.npcs.lin.relationship.value, 50);
  assert.equal(r.state.player.money, 10);
});

test('a complete no-reward response is valid, and committed job replay never calls the model again', async () => {
  const r = createRuntime({ director: true });
  const job = enqueue(r);
  assert.equal((await r.director.runDecision(job.id)).ok, true);
  assert.equal(r.db.jobs[job.id].status, 'committed');
  assert.equal(Object.keys(r.db.offers).length, 0);
  assert.equal(Object.keys(r.db.intentions).length, 0);
  assert.equal(r.state.player.money, 10);
  assert.equal(r.state.npcs.lin.relationship.value, 50);
  const before = r.save();
  assert.equal((await r.director.runDecision(job.id)).ok, true);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.save(), before);
  assert.equal(r.director.hasActiveRequest(), false);
});

test('double-clicking runDecision shares one pending request and commits its staged offer only after final text', async () => {
  const gate = deferred();
  let offer;
  const r = createRuntime({ director: true, runner(request) {
    offer = modelOffer(request);
    return gate.promise;
  } });
  const job = enqueue(r);
  const first = r.director.runDecision(job.id);
  const second = r.director.runDecision(job.id);
  assert.equal(r.calls.length, 1);
  assert.equal(r.director.hasActiveRequest(), true);
  assert.equal(Object.keys(r.db.offers).length, 0);
  assert.equal(r.state.npcs.lin.dialogue.filter((entry) => entry.role === 'assistant').length, 0);
  gate.resolve({ status: 'completed', content: '想送你一点心意。' });
  const results = await Promise.all([first, second]);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(r.db.offers[offer].status, 'pending');
  assert.equal(r.state.player.money, 10);
  assert.equal(Object.values(r.db.receipts).filter((receipt) => receipt.type === 'turn_committed').length, 1);
  assert.equal(r.state.npcs.lin.dialogue.filter((entry) => entry.role === 'assistant').length, 1);
  assert.equal(r.director.hasActiveRequest(), false);
});

for (const status of ['failed', 'cancelled', 'limit_reached']) {
  test(`runner ${status} after a successful tool leaves no partial business effects and is retryable`, async () => {
    const r = createRuntime({ director: true, runner(request, callNumber) {
      modelOffer(request, 12, `transport:${callNumber}`);
      return Promise.resolve(callNumber === 1
        ? { status, error: new Error('注入模型失败') }
        : { status: 'completed', content: '重新完整回答。' });
    } });
    const job = enqueue(r);
    const player = clone(r.state.player);
    const actor = clone(r.actor());
    assert.equal((await r.director.runDecision(job.id)).ok, false);
    assert.deepEqual(clone(r.state.player), player);
    assert.deepEqual(clone(r.actor()), actor);
    assert.equal(Object.keys(r.db.offers).length, 0);
    assert.equal(Object.keys(r.db.receipts).length, 0);
    assert.equal(r.state.npcs.lin.dialogue.length, 1);
    assert.equal(r.db.jobs[job.id].status, 'retryable');
    assert.equal((await r.director.resumePending('lin')).ok, true);
    assert.equal(r.calls.length, 2);
    assert.equal(Object.keys(r.db.offers).length, 1);
    assert.equal(r.state.npcs.lin.dialogue.filter((entry) => entry.role === 'user').length, 1);
    assert.equal(r.db.jobs[job.id].status, 'committed');
  });
}

test('a rejected network promise after staging is reported as failure, not an empty success', async () => {
  const r = createRuntime({ director: true, runner(request) {
    modelOffer(request);
    return Promise.reject(new Error('network dropped after first tool'));
  } });
  const job = enqueue(r);
  const result = await r.director.runDecision(job.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /network dropped/);
  assert.equal(Object.keys(r.db.offers).length, 0);
  assert.equal(Object.keys(r.db.decisions).length, 0);
  assert.equal(r.db.jobs[job.id].status, 'retryable');
});

for (const content of ['', ' \n\t ']) {
  test(`runner completed with ${JSON.stringify(content)} cannot commit staged tools`, async () => {
    const r = createRuntime({ director: true, runner(request) {
      modelOffer(request);
      return Promise.resolve({ status: 'completed', content });
    } });
    const job = enqueue(r);
    assert.equal((await r.director.runDecision(job.id)).ok, false);
    assert.equal(Object.keys(r.db.offers).length, 0);
    assert.equal(Object.keys(r.db.receipts).length, 0);
    assert.equal(r.db.jobs[job.id].status, 'retryable');
  });
}

for (const [label, mutate] of [
  ['passage change', (r) => { r.context.State.passage = 'Park'; }],
  ['movement', (r) => { r.state.position.areaId = 'path'; }],
  ['time advance', (r) => { r.state.time.minute++; }],
  ['active NPC switch', (r) => { r.state.activeNPCId = 'other'; }],
  ['player assets', (r) => { r.state.player.money++; }]
]) {
  test(`late final response after ${label} cannot overwrite state`, async () => {
    const gate = deferred();
    const r = createRuntime({ director: true, runner(request) { modelOffer(request); return gate.promise; } });
    const job = enqueue(r);
    const run = r.director.runDecision(job.id);
    mutate(r);
    const current = r.save();
    gate.resolve({ status: 'completed', content: '这是旧位置的决定。' });
    const result = await run;
    assert.equal(result.ok, false);
    assert.equal(result.status, 'stale');
    assert.deepEqual(r.save(), current, 'including job metadata, stale callbacks must not write into the changed context');
    assert.equal(r.director.hasActiveRequest(), false);
  });
}

for (const outcome of ['completed', 'failed']) {
  test(`save load before a delayed ${outcome} result protects even an identical same-ID save branch`, async () => {
    const gate = deferred();
    const r = createRuntime({ director: true, runner(request) { modelOffer(request); return gate.promise; } });
    const job = enqueue(r);
    const run = r.director.runDecision(job.id);
    const savedWhileRunning = r.save();
    r.load(savedWhileRunning);
    const loaded = r.save();
    gate.resolve({ status: outcome, content: '旧分支的结果', error: new Error('旧分支失败') });
    assert.equal((await run).ok, false);
    assert.deepEqual(r.save(), loaded);
    assert.equal(Object.keys(r.db.offers).length, 0);
    assert.equal(r.director.hasActiveRequest(), false);
  });
}

test('a saved running job resumes in a fresh runtime without saving its staged draft', async () => {
  const gate = deferred();
  const original = createRuntime({ director: true, runner(request) { modelOffer(request); return gate.promise; } });
  const job = enqueue(original);
  const oldRun = original.director.runDecision(job.id);
  const saved = original.save();
  assert.equal(saved.npcAgency.jobs[job.id].status, 'running');
  assert.equal(Object.keys(saved.npcAgency.offers).length, 0);
  original.context.LLMOperationScope.invalidate('save-load');
  gate.resolve({ status: 'completed', content: '旧请求' });
  await oldRun;
  const restored = createRuntime({ variables: saved, director: true });
  assert.equal((await restored.director.resumePending('lin')).ok, true);
  assert.equal(restored.db.jobs[job.id].status, 'committed');
  assert.equal(restored.state.npcs.lin.dialogue.length, 2);
  assert.equal(restored.calls.length, 1);
  const completed = createRuntime({ variables: restored.save(), director: true });
  assert.equal((await completed.director.runDecision(job.id)).ok, true);
  assert.equal(completed.calls.length, 0, 'restored committed decision is not rerolled');
});

test('unavailable models preserve retryable work; absent NPCs defer without a transport request', async () => {
  const r = createRuntime({ director: true });
  const job = enqueue(r);
  r.context.LLMEngine.isAvailable = () => false;
  assert.equal((await r.director.runDecision(job.id)).ok, false);
  assert.equal(r.db.jobs[job.id].status, 'retryable');
  r.context.LLMEngine.isAvailable = () => true;
  r.state.position.areaId = 'path';
  assert.equal((await r.director.runDecision(job.id)).status, 'deferred');
  assert.equal(r.calls.length, 0);
  r.state.position.areaId = 'entrance';
  assert.equal((await r.director.resumePending('lin')).ok, true);
  assert.equal(r.calls.length, 1);
});

test('refreshes are not new encounters, while a real return or a new day can trigger without an explicit intention', () => {
  const r = createRuntime({ director: true });
  r.director.onEncounter();
  const first = r.save();
  r.director.onEncounter();
  r.director.onEncounter();
  assert.deepEqual(r.save(), first);
  const firstJobs = Object.keys(r.db.jobs).length;
  assert.equal(r.calls.length, 0, 'encounter queueing never forces an invisible model request');
  r.state.position.areaId = 'path';
  r.emit('playerMoved', { from: { locationId: 'Park', areaId: 'entrance' }, to: clone(r.state.position) });
  r.director.onEncounter();
  assert.equal(Object.keys(r.db.jobs).length, firstJobs);
  r.state.position.areaId = 'entrance';
  r.director.onEncounter();
  assert.equal(Object.keys(r.db.jobs).length, firstJobs * 2);
  r.state.time.day++;
  r.director.onEncounter();
  assert.equal(Object.keys(r.db.jobs).length, firstJobs * 3);
  assert.equal(Object.keys(r.db.intentions).length, 0);
});

test('next-encounter intentions do not activate on refresh and respect notBefore', () => {
  const r = createRuntime({ director: true });
  r.director.onEncounter();
  const d = r.draft();
  const key = staged(r, d, 'npc_set_intention', {
    goal: '明天相遇再问', anchorFactIds: [],
    reconsiderWhen: { kind: 'next_encounter', notBefore: r.agency.now() + 1440 }
  });
  commit(r, d);
  r.director.onEncounter();
  assert.equal(r.db.intentions[key].status, 'pending');
  r.state.position.areaId = 'path';
  r.emit('playerMoved', {});
  r.state.position.areaId = 'entrance';
  r.director.onEncounter();
  assert.equal(r.db.intentions[key].status, 'pending');
  r.state.time.day++;
  r.director.onEncounter();
  assert.equal(r.db.intentions[key].status, 'eligible');
});

test('decision prompts use actor-owned long-term facts, not another actor with the same display name', () => {
  const r = createRuntime({ director: true });
  r.state.npcs.other.name = '林晚晴';
  r.fact('quest_settled', { title: '己方的重要照片' }, 'known');
  r.fact('player_statement', { text: '对另一位NPC保密的话语' }, 'secret', 'other');
  const job = enqueue(r);
  const messages = r.director.messagesFor('lin', job);
  const system = messages.find((message) => message.role === 'system').content;
  assert.match(system, /己方的重要照片/);
  assert.match(system, /谨慎且重视承诺/);
  assert.equal(system.includes('对另一位NPC保密的话语'), false);
  assert.equal(messages.filter((message) => message.role === 'user').length, 1);
});

test('resuming prioritizes concrete delivery/choice work ahead of ambient encounter jobs', async () => {
  const r = createRuntime({ director: true });
  r.director.onEncounter();
  const priority = r.director.enqueue('lin', { type: 'quest_settled', sourceEventId: 'quest:photo:settled' });
  assert.equal((await r.director.resumePending('lin')).ok, true);
  assert.equal(r.db.jobs[priority.id].status, 'committed');
  assert.equal(Object.values(r.db.jobs).filter((job) => job.npcId === 'lin' && job.type === 'encounter')[0].status, 'queued');
});

test('acceptance during model latency survives the stale response and does not duplicate the reward', async () => {
  const gate = deferred();
  const r = createRuntime({ director: true, runner(request) { modelOffer(request, 5); return gate.promise; } });
  const d = r.draft('existing-offer');
  const offer = staged(r, d, 'npc_offer_reward', money(12));
  commit(r, d);
  const job = enqueue(r);
  const running = r.director.runDecision(job.id);
  assert.equal(r.tools.resolveOffer(offer, 'accepted').ok, true);
  const accepted = r.save();
  gate.resolve({ status: 'completed', content: '迟到的第二份礼物。' });
  assert.equal((await running).ok, false);
  assert.deepEqual(r.save(), accepted);
  assert.equal(r.state.player.money, 22);
  assert.equal(r.actor().resources.money, 18);
  assert.equal(Object.keys(r.db.offers).length, 1);
});


for (const variant of ['money', 'keepsake', 'thanks-then-invitation']) {
  test(`real runner and scope integration: scripted model chooses ${variant}, not a hardcoded reward`, async () => {
    let responseIndex = 0;
    let round = 0;
    let r;
    const requests = [];
    r = createRuntime({ director: true, chatRaw(history, options) {
      requests.push(clone(history));
      assert.ok(options.signal);
      assert.ok(options.tools.some((tool) => tool.function.name === 'npc_offer_reward'));
      responseIndex++;
      if (variant === 'thanks-then-invitation' && round === 0) {
        return Promise.resolve({ text: '你能帮我找回照片，我已经很感激了。', tool_calls: [] });
      }
      if (responseIndex % 2 === 1 || (variant === 'thanks-then-invitation' && responseIndex === 2)) {
        let name = 'npc_offer_reward';
        let args = money(7);
        if (variant === 'keepsake') args = {
          reward: { kind: 'keepsake', title: '公园小画', description: '画着那天树下的光。' }, message: '送给你。'
        };
        if (variant === 'thanks-then-invitation') {
          name = 'npc_invite_player';
          args = { locationId: 'Park', areaId: 'entrance', startAt: r.agency.now() + 30,
            endAt: r.agency.now() + 60, purpose: '继续聊照片', message: '稍后再聊聊好吗？' };
        }
        return Promise.resolve({ text: '', tool_calls: [
          { id: 'transport:scripted', type: 'function', function: { name, arguments: JSON.stringify(args) } }
        ] });
      }
      const result = history.at(-1);
      assert.equal(result.role, 'tool');
      assert.equal(JSON.parse(result.content).status, 'STAGED');
      assert.equal(Object.keys(r.db.offers).length, 0, 'even the real loop must not publish a staged offer');
      return Promise.resolve({ text: '这是我想做的事，你可以选择接受或拒绝。', tool_calls: [] });
    } });
    const first = enqueue(r);
    assert.equal((await r.director.runDecision(first.id)).ok, true);
    if (variant === 'thanks-then-invitation') {
      assert.equal(Object.keys(r.db.offers).length, 0);
      assert.equal(Object.keys(r.db.intentions).length, 0);
      round++;
      r.state.time.day++;
      r.director.onEncounter();
      assert.equal((await r.director.resumePending('lin')).ok, true);
    }
    const offers = Object.values(r.db.offers);
    assert.equal(offers.length, 1);
    assert.equal(offers[0].kind, variant === 'thanks-then-invitation' ? 'invitation' : 'reward');
    assert.equal(r.state.player.money, 10);
    assert.equal(r.tools.resolveOffer(offers[0].id, 'accepted').ok, true);
    if (variant === 'money') assert.equal(r.state.player.money, 17);
    if (variant === 'keepsake') {
      const id = Object.keys(r.state.player.inventory)[0];
      assert.equal(r.db.itemDefinitions[id].title, '公园小画');
      assert.equal(r.actor().resources.items['blank-paper'], 0);
    }
    assert.ok(requests.length >= 2);
  });
}

test('queued work remains resumable by stable actor after a saved runtime ID changes', async () => {
  const r = createRuntime({ director: true });
  const job = enqueue(r);
  const saved = r.save();
  saved.npcs.reborn = { ...saved.npcs.lin, id: 'reborn' };
  delete saved.npcs.lin;
  saved.activeNPCId = 'reborn';
  const loaded = createRuntime({ director: true, variables: saved });
  const result = await loaded.director.resumePending('reborn');
  assert.equal(result.ok, true);
  assert.equal(loaded.db.jobs[job.id].status, 'committed', 'stable actor work must not be silently left on an obsolete NPC ID');
  assert.equal(loaded.calls.length, 1);
});

test('settlement supersedes only that quest acceptance, including old saves, without fabricating a result', async () => {
  const r = createRuntime({ director:true });
  const actorId = r.actor().actorId;
  r.db.offers.old = {id:'old',actorId,npcId:'lin',kind:'quest',status:'accepted',payload:{id:'soy'}};
  const old = r.director.enqueue('lin',{type:'offer_resolved',sourceEventId:'offer:old:accepted'});
  const unrelated = r.director.enqueue('lin',{type:'offer_resolved',questId:'other',resolution:'accepted'});
  const chat = r.director.enqueue('lin',{type:'chat',text:'明天见'});
  r.state.quests.soy = {id:'soy',title:'挑选酱油',giver:'lin',status:'completed',rewardMode:'npc_discretionary',objectives:[{id:'read',text:'读取标签',completed:true}],settlement:{sourceEventId:'quest:soy:settled',npcId:'lin',actorId}};
  const loaded = createRuntime({ director:true, variables:r.save() });
  await loaded.director.resumePending('lin');
  assert.equal(loaded.db.jobs[old.id].status,'superseded');
  assert.equal(loaded.db.jobs[unrelated.id].status,'queued');
  assert.equal(loaded.db.jobs[chat.id].status,'queued');
  const snapshot = loaded.agency.buildContext('lin').questStates[0];
  assert.equal(snapshot.status,'completed');
  assert.equal(snapshot.result,undefined);
  assert.equal(snapshot.objectives[0].lastAction,undefined);
  const settlementJobs = Object.values(loaded.db.jobs).filter(j => j.type === 'quest_settled');
  assert.equal(settlementJobs.length,1);
  assert.equal(settlementJobs[0].status,'committed');
  assert.equal((await loaded.director.runDecision(old.id)).status,'superseded');
  assert.equal(loaded.calls.length,1);
});

test('NPC prompt inspection pieces reproduce the actual system prompt and preserve history rules', async () => {
  const r = createRuntime({ director: true });
  const job = enqueue(r, 'trace-fixture');
  const assembly = {};
  const messages = r.director.messagesFor('lin', job, assembly);
  assert.equal(assembly.source, 'NPCDirector.messagesFor');
  assert.equal(assembly.sections.map(part => part.content).join('\n'), messages[0].content);
  assert.deepEqual(clone(assembly.sections.map(part => part.label)), [
    '角色表演', '事实与行动边界', '人物设定', '当前处境与已知事实', '照片任务入口', '本回合触发事件'
  ]);
  assert.equal(messages.at(-1).content, job.text);
  await r.director.runDecision(job.id);
  assert.equal(r.calls[0].promptAssembly.source, 'NPCDirector.messagesFor');
  assert.ok(r.calls[0].debugContext.traceAttemptId > 0);
});

test('prompt layers preserve all known facts and pending obligations without updating memory', () => {
  const r = createRuntime({ director: true });
  const anchor = r.fact('quest_settled', { questId: 'old', title: '早先的帮助' }, 'old-help');
  for (let i = 0; i < 25; i++) r.fact('player_statement', { text: `历史话语 ${i}` }, `history:${i}`);
  const d = r.draft();
  staged(r, d, 'npc_make_promise', { benefit: { kind: 'reward', reward: { kind: 'money', amount: 5 } }, dueAt: r.agency.now() + 1440, message: '明天给你。' });
  staged(r, d, 'npc_set_intention', { goal: '下次再感谢', anchorFactIds: [anchor.id], reconsiderWhen: { kind: 'next_encounter' } });
  commit(r, d);
  r.state.characterCards.linwanqing.dialogueExamples = [{
    situation: '只属于示例的场景', user: '只属于示例的问题', assistant: '只属于示例的回答', memory: '额外字段不能进入提示词'
  }];
  const job = enqueue(r), expected = clone(r.agency.buildContext('lin')), before = r.save(), assembly = {};
  const messages = r.director.messagesFor('lin', job, assembly);
  const layer = assembly.sections.find(part => part.label === '当前处境与已知事实');
  const state = JSON.parse(layer.content.slice(layer.content.indexOf('\n') + 1));
  for (const key of ['facts', 'offers', 'promises', 'intentions', 'questStates', 'questLocations', 'impression']) {
    assert.deepEqual(state[key], expected[key], key + ' is preserved, not selected or rewritten');
  }
  assert.equal(layer.content.includes('只属于示例'), false);
  assert.equal(messages[0].content.includes('额外字段不能进入提示词'), false);
  assert.deepEqual(r.save(), before, 'assembling the prompt does not update persistent memory');
});

test('photo-specific guidance follows stable identity or the relevant quest, not the display name', () => {
  const r = createRuntime({ director: true });
  r.state.npcs.other.name = '林晚晴';
  const job = r.director.enqueue('other', { type: 'chat', text: '你好' });
  assert.doesNotMatch(r.director.messagesFor('other', job)[0].content, /照片寻找与交付使用正式任务入口/);
  r.state.quests['linwanqing-photo'] = { id: 'linwanqing-photo', title: '遗失的照片', giver: 'other', objectives: [] };
  assert.match(r.director.messagesFor('other', job)[0].content, /照片寻找与交付使用正式任务入口/);
});

test('NPC prompt projects legacy nested records and never exposes off-screen task progress', () => {
  const r = createRuntime({ director:true }), secret='隐秘过程标记_玩家撬窗后藏起信件';
  const quest={id:'private',title:'探望街坊',giver:'lin',status:'ready_to_turn_in',rewardMode:'npc_discretionary',
    objectives:[{id:'visit',text:'看看街坊是否平安',required:1,current:1,completed:true,lastAction:{result:{summary:secret}}}],
    result:{events:[{summary:secret,description:secret,history:[{input:secret}]}]},eventScenes:{visit:{description:secret}},
    turnIn:{type:'npc',npcId:'lin'}};
  r.state.quests.private=quest;
  const profile=r.state.characterCards.linwanqing;
  profile.memory=secret;profile.dialogue=[{role:'assistant',content:secret}];profile.internalState={secret};
  r.state.npcs.lin.memory=secret;
  const fact=r.fact('quest_settled',{questId:'private',title:quest.title,task:quest,result:quest.result,settlement:{result:quest.result}},'old-fact');
  r.db.offers.old={id:'old',actorId:r.actor().actorId,kind:'quest',status:'accepted',payload:clone(quest)};
  r.fact('player_accepted',{offerId:'old',kind:'quest',payload:clone(quest)},'old-accept');
  const stranger=r.fact('player_statement',{text:'只有另一人听过的秘密'},'stranger','other');
  r.actor().knownFactIds.push(stranger.id); // Corrupt old index must not override knownBy.
  r.db.itemDefinitions.strangerItem={title:secret};
  const job=r.director.enqueue('lin',{type:'chat',text:'你好'});job.internalTask=clone(quest);job.error=secret;
  let ctx=r.agency.buildContext('lin');
  assert.equal(ctx.questStates[0].status,'active');
  assert.equal(ctx.questStates[0].objectives[0].current,undefined);
  assert.equal(ctx.questStates[0].objectives[0].completed,undefined);
  assert.equal(ctx.profile.memory,undefined);assert.equal(ctx.items.strangerItem,undefined);
  let prompt=JSON.stringify(r.director.messagesFor('lin',job));
  assert.equal(prompt.includes(secret),false);assert.equal(prompt.includes('只有另一人听过的秘密'),false);
  assert.match(prompt,/谨慎且重视承诺/);assert.match(prompt,/看看街坊是否平安/);
  quest.status='completed';quest.settlement={sourceEventId:'quest:private:settled',npcId:'lin',actorId:r.actor().actorId,result:quest.result,objectives:clone(quest.objectives)};
  ctx=r.agency.buildContext('lin');assert.equal(ctx.questStates[0].status,'completed');
  assert.ok(ctx.questStates[0].settlement);assert.equal(ctx.questStates[0].settlement.result,undefined);
  prompt=JSON.stringify(r.director.messagesFor('lin',job));assert.equal(prompt.includes(secret),false);
  assert.equal(r.db.facts[fact.id].data.task.result.events[0].summary,secret,'read projection preserves save/debug evidence');
  assert.equal(r.agency.buildContext('other').questStates.length,0);
});

test('runtime-only NPC persona excludes memory/state but retains own direct dialogue and reports', () => {
  const r=createRuntime({director:true});
  r.state.npcs.other.personality='沉默寡言';r.state.npcs.other.memory='自动汇总的离场秘密';
  r.state.npcs.other.dialogue=[{role:'assistant',content:'昨天我们在这里谈过。'}];
  const job=r.director.enqueue('other',{type:'chat',text:'我想告诉你：他看上去很好。'});
  const prompt=JSON.stringify(r.director.messagesFor('other',job));
  assert.match(prompt,/沉默寡言/);assert.match(prompt,/昨天我们在这里谈过/);assert.match(prompt,/我想告诉你/);
  assert.equal(prompt.includes('自动汇总的离场秘密'),false);assert.match(prompt,/玩家说法/);
});

test('a giver does not learn a later delivery to a different NPC', () => {
  const r=createRuntime({director:true});
  r.state.quests.private={id:'private',title:'传个口信',giver:'lin',status:'completed',objectives:[],turnIn:{npcId:'other'},settlement:{npcId:'other',actorId:r.actor('other').actorId}};
  assert.equal(r.agency.buildContext('lin').questStates[0].status,'active');
  assert.equal(r.agency.buildContext('lin').questStates[0].settlement,null);
  assert.equal(r.agency.buildContext('other').questStates[0].status,'completed');
});
