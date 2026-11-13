/* Structured quest objectives, deterministic progress and turn-in handling. */
(function () {
  'use strict';

  var REWARD_MODES = ['fixed', 'npc_discretionary', 'fixed_plus_npc'];
  var PHOTO_QUEST_ID = 'linwanqing-photo';
  var PHOTO_ITEM = '林晚晴与母亲的合影（任务凭证）';

  var TYPES = ['visit', 'action', 'collect', 'talk', 'deliver', 'purchase', 'skill', 'flag'];

  function state() {
    return typeof State !== 'undefined' && State.variables ? State.variables : null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clean(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit || 200) : '';
  }

  function idPart(value, fallback) {
    var result = clean(value, 80).toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return result || fallback;
  }

  function uniqueStrings(value, limit) {
    if (!Array.isArray(value)) return [];
    var seen = {};
    return value.filter(function (item) {
      item = clean(item, 80);
      if (!item || seen[item]) return false;
      seen[item] = true;
      return true;
    }).slice(0, limit || 12).map(function (item) { return clean(item, 80); });
  }

  function currentPosition() {
    var st = state();
    if (typeof RegionSystem !== 'undefined' && RegionSystem.ensure) RegionSystem.ensure();
    return st && st.position
      ? { locationId: st.position.locationId, areaId: st.position.areaId }
      : { locationId: st && st.location || '', areaId: '' };
  }

  function objectiveId(questId, objective, index, used) {
    var base = idPart(objective && objective.id, 'objective-' + (index + 1));
    var id = base;
    var suffix = 2;
    while (used[id]) id = base + '-' + suffix++;
    used[id] = true;
    return id;
  }

  function normalizeObjective(quest, value, index, used) {
    var source = typeof value === 'string' ? { text: value } : (value && typeof value === 'object' ? value : {});
    var required = Number(source.required);
    if (!isFinite(required) || required <= 0) required = 1;
    required = Math.min(999, Math.max(1, Math.floor(required)));
    var current = Number(source.current);
    if (!isFinite(current) || current < 0) current = source.completed ? required : 0;
    current = Math.min(required, Math.floor(current));
    var locations = uniqueStrings(source.locations, 8);
    if (!locations.length && clean(source.location, 80)) locations = [clean(source.location, 80)];
    if (!locations.length && clean(quest.location, 80)) locations = [clean(quest.location, 80)];
    var type = TYPES.indexOf(source.type) !== -1 ? source.type : 'action';
    var id = objectiveId(quest.id, source, index, used);
    return {
      id: id,
      text: clean(source.text, 300) || ('任务目标 ' + (index + 1)),
      type: type,
      actionId: clean(source.actionId || source.target, 100) || (quest.id + ':' + id),
      locations: locations,
      areas: uniqueStrings(source.areas, 12),
      required: required,
      current: current,
      completed: !!source.completed || current >= required,
      lastAction: source.lastAction ? clone(source.lastAction) : null,
      optional: !!source.optional,
      prerequisites: uniqueStrings(source.prerequisites, 12),
      promptHint: clean(source.promptHint, 300) || clean(source.text, 300) || ('推进目标 ' + (index + 1))
    };
  }

  function defaultTurnIn(quest) {
    var st = state();
    var giver = quest.giver && st && st.npcs ? st.npcs[quest.giver] : null;
    if (quest.giver) {
      return { type: 'npc', npcId: quest.giver, locationId: (giver && giver.location) || quest.location || currentPosition().locationId };
    }
    if (quest.location) return { type: 'location', locationId: quest.location };
    return { type: 'automatic' };
  }

  function normalizeTurnIn(quest) {
    var st = state();
    var source = quest.turnIn && typeof quest.turnIn === 'object' ? quest.turnIn : defaultTurnIn(quest);
    var type = ['npc', 'location', 'automatic'].indexOf(source.type) !== -1 ? source.type : defaultTurnIn(quest).type;
    if (type === 'automatic') return { type: 'automatic' };
    var giver = quest.giver && st && st.npcs ? st.npcs[quest.giver] : null;
    var result = {
      type: type,
      locationId: clean((giver && (giver.locationId || giver.location)) || source.locationId || quest.location, 80) || currentPosition().locationId
    };
    var areaId = clean((giver && giver.areaId) || source.areaId, 80);
    if (areaId) result.areaId = areaId;
    if (type === 'npc') result.npcId = clean((giver && quest.giver) || source.npcId || quest.giver, 100);
    return result;
  }

  function normalizeQuest(quest, key) {
    if (!quest || typeof quest !== 'object') return null;
    quest.id = clean(quest.id, 100) || clean(key, 100) || ('quest-' + Date.now());
    quest.title = clean(quest.title, 160) || '未命名任务';
    quest.description = clean(quest.description, 1000);
    var npcs = (state() || {}).npcs || {}, giver = npcs[quest.giver];
    if (!quest.giverActorId && giver && giver.actorId) quest.giverActorId = giver.actorId;
    if (quest.giverActorId && (!giver || giver.actorId !== quest.giverActorId)) {
      var matches = Object.keys(npcs).filter(function (id) { return npcs[id].actorId === quest.giverActorId; });
      if (matches.length === 1) quest.giver = matches[0];
    }
    if (!Array.isArray(quest.rewards)) quest.rewards = [];
    if (!quest.rewardMode) quest.rewardMode = 'fixed';
    var used = {};
    quest.objectives = (Array.isArray(quest.objectives) ? quest.objectives : []).map(function (objective, index) {
      return normalizeObjective(quest, objective, index, used);
    });
    quest.turnIn = normalizeTurnIn(quest);
    if (!quest.status) quest.status = 'active';
    if (typeof quest.rewardsClaimed !== 'boolean') quest.rewardsClaimed = quest.status === 'completed';
    return quest;
  }

  function ensure() {
    var st = state();
    if (!st) return null;
    if (!st.quests || typeof st.quests !== 'object') st.quests = {};
    Object.keys(st.quests).forEach(function (id) { normalizeQuest(st.quests[id], id); });
    return st;
  }

  function findObjective(quest, id) {
    return quest && quest.objectives ? quest.objectives.find(function (objective) { return objective.id === id; }) : null;
  }

  function prerequisitesMet(quest, objective) {
    return objective.prerequisites.every(function (id) {
      var required = findObjective(quest, id);
      return required && required.completed;
    });
  }

  function positionAllowed(objective, position) {
    if (objective.locations.length && objective.locations.indexOf(position.locationId) === -1) return false;
    if (objective.areas.length && objective.areas.indexOf(position.areaId) === -1) return false;
    return true;
  }

  // Only an unambiguous terminal return to the actual recipient is delivery.
  // Investigation conversations, other recipients and intermediate steps remain events.
  function isTurnInObjective(quest, objective) {
    if (!requiresEvent(quest) || !objective || !quest.turnIn || quest.turnIn.type !== 'npc') return false;
    var target = quest.turnIn, npc = (state().npcs || {})[target.npcId];
    if (!npc || !npc.name || ['talk', 'deliver'].indexOf(objective.type) < 0 || objective.required !== 1) return false;
    if (!objective.prerequisites.length || quest.objectives.some(function (o) { return o.prerequisites.indexOf(objective.id) >= 0; })) return false;
    if (objective.locations.length !== 1 || objective.locations[0] !== target.locationId) return false;
    if (objective.areas.length && (objective.areas.length !== 1 || objective.areas[0] !== target.areaId)) return false;
    var text = objective.text;
    var recipient = npc.name;
    var reporting = ['向','跟'].some(function (prefix) {
      return ['汇报','报告','说明'].some(function (verb) { return text.indexOf(prefix + recipient + verb) >= 0; });
    }) || (text.indexOf('告诉' + recipient) >= 0 && /情况|结果/.test(text));
    var returning = ['交还给','交还','归还给','归还','交给','交付给','送还给','还给'].some(function (verb) {
      return text.indexOf(verb + recipient) >= 0;
    });
    return reporting || returning;
  }

  function eligibleObjectives() {
    var st = ensure();
    if (!st) return [];
    var position = currentPosition();
    var result = [];
    Object.keys(st.quests).forEach(function (questId) {
      var quest = st.quests[questId];
      if (!quest || quest.status !== 'active' || isPhotoQuest(quest)) return;
      quest.objectives.forEach(function (objective) {
        if (!objective.completed && !isTurnInObjective(quest, objective) && prerequisitesMet(quest, objective) && positionAllowed(objective, position)) {
          result.push({ quest: quest, objective: objective });
        }
      });
    });
    return result;
  }

  function validateAction(value) {
    var st = ensure();
    if (!value || typeof value !== 'object') return { ok: false, error: 'questAction 必须是对象' };
    var questId = clean(value.questId, 100);
    var objectiveIdValue = clean(value.objectiveId, 100);
    var actionId = clean(value.actionId, 100);
    var quest = st && st.quests[questId];
    if (!quest || quest.status !== 'active') return { ok: false, error: '任务不存在或不在进行中' };
    if (isPhotoQuest(quest)) return { ok: false, error: '照片任务只能通过实地寻找和凭证交付推进' };
    var objective = findObjective(quest, objectiveIdValue);
    if (!objective || objective.completed) return { ok: false, error: '任务目标不存在或已完成' };
    if (isTurnInObjective(quest, objective)) return { ok: false, error: '此步骤请在 NPC 对话中交付，不再生成独立现场' };
    if (!prerequisitesMet(quest, objective)) return { ok: false, error: '前置目标尚未完成' };
    if (!positionAllowed(objective, currentPosition())) return { ok: false, error: '当前位置不能推进该目标' };
    if (!actionId || actionId !== objective.actionId) return { ok: false, error: 'actionId 与任务目标不匹配' };
    var amount = Number(value.amount);
    if (!isFinite(amount) || amount <= 0) amount = 1;
    amount = Math.min(100, Math.max(1, Math.floor(amount)));
    return { ok: true, quest: quest, objective: objective, action: { questId: questId, objectiveId: objective.id, actionId: actionId, amount: amount } };
  }

  function settle(quest) {
    if (quest.rewardsClaimed || quest.status === 'completed' || quest.settlement) return [];
    var mode = quest.rewardMode || 'fixed';
    var messages = mode !== 'npc_discretionary' && typeof applyQuestRewards === 'function' ? applyQuestRewards(quest) : [];
    quest.rewardsClaimed = true; // Fixed reward leg only; never an NPC gift receipt.
    quest.completedAt = quest.completedAt || Date.now();
    quest.status = 'completed';
    var npcId = quest.turnIn.type === 'npc' ? quest.turnIn.npcId : null;
    quest.settlement = {
      sourceEventId: 'quest:' + quest.id + ':settled',
      type: isPhotoQuest(quest) ? 'photo_returned' : 'quest_settled',
      questId: quest.id,
      npcId: npcId,
      actorId: npcId && state().npcs[npcId] ? state().npcs[npcId].actorId : null,
      rewardMode: mode,
      fixedRewards: messages.slice(),
      completedAt: quest.completedAt,
      objectives: JSON.parse(JSON.stringify(quest.objectives || [])),
      result: quest.result ? JSON.parse(JSON.stringify(quest.result)) : null
    };
    if (isPhotoQuest(quest)) quest.settlement.evidenceId = quest.photoProof.id;
    // Commit before dispatch. A missing/failing director must not undo the task;
    // its persisted source event remains available for the director to resume.
    if (window.NPCAgency && typeof window.NPCAgency.onQuestSettled === 'function') {
      try {
        var pending = window.NPCAgency.onQuestSettled(quest, { npcId: npcId, sourceEventId: quest.settlement.sourceEventId });
        if (pending && typeof pending.catch === 'function') pending.catch(logSettlementError);
      } catch (error) { logSettlementError(error); }
    }
    return messages;
  }

  function logSettlementError(error) {
    if (typeof window.log === 'function') window.log('warn', 'quest-settlement-notification-failed', { error: String(error && error.message || error) });
  }

  function recompute(quest) {
    if (!quest || ['active', 'ready_to_turn_in'].indexOf(quest.status) === -1) return [];
    if (isPhotoQuest(quest)) {
      // Completion flags (including model-provided ones) cannot replace a receipt.
      quest.status = hasPhotoProof(quest) ? 'ready_to_turn_in' : 'active';
      return [];
    }
    var required = quest.objectives.filter(function (objective) { return !objective.optional; });
    var allDone = required.length > 0 && required.every(function (objective) { return objective.completed || (isTurnInObjective(quest, objective) && prerequisitesMet(quest, objective)); });
    if (!allDone) {
      if (quest.status === 'ready_to_turn_in') quest.status = 'active';
      return [];
    }
    if (quest.turnIn.type === 'automatic') {
      var rewards = settle(quest);
      return ['任务完成：' + quest.title + (rewards.length ? '（' + rewards.join('，') + '）' : '')];
    }
    quest.status = 'ready_to_turn_in';
    return ['任务目标已完成：' + quest.title + '，请前往交付。'];
  }

  function progress(value, options) {
    options = options || {};
    var checked = validateAction(value);
    if (!checked.ok) {
      if (!options.silent && typeof window.log === 'function') window.log('warn', 'quest-action-rejected', { error: checked.error, questId: value && value.questId, objectiveId: value && value.objectiveId });
      return { ok: false, error: checked.error, messages: [] };
    }
    if (requiresEvent(checked.quest) && options.eventPermit !== eventPermit) return {ok:false,error:'需要先经历任务事件并提交具体结果',messages:[]};
    var objective = checked.objective;
    var before = objective.current;
    objective.current = Math.min(objective.required, objective.current + checked.action.amount);
    objective.completed = objective.current >= objective.required;
    if (objective.current !== before) objective.lastAction = {
      actionId: objective.actionId, amount: objective.current - before,
      position: JSON.parse(JSON.stringify(currentPosition())),
      gameTime: JSON.parse(JSON.stringify(state().time || {})), recordedAt: Date.now()
    };
    if (options.eventResult && objective.lastAction) objective.lastAction.result = clone(options.eventResult);
    var messages = [];
    if (objective.current !== before) messages.push('任务进度：' + objective.text + ' ' + objective.current + '/' + objective.required);
    messages = messages.concat(recompute(checked.quest));
    if (typeof window.log === 'function') window.log('info', 'quest-action-applied', { questId: checked.quest.id, objectiveId: objective.id, actionId: objective.actionId, amount: objective.current - before, completed: objective.completed });
    if (!options.silent && messages.length && typeof NarrativeUI !== 'undefined' && NarrativeUI.showToast) NarrativeUI.showToast(messages.join('\n'));
    return { ok: true, quest: checked.quest, objective: objective, messages: messages };
  }

  var eventPermit = {};
  function requiresEvent(quest) {
    return !!quest && !isPhotoQuest(quest) && (quest.eventDriven || quest.rewardMode === 'npc_discretionary');
  }
  function commitEvent(value, result) {
    var checked = validateAction(value);
    if (!checked.ok) return checked;
    if (!result || typeof result.id !== 'string' || typeof result.summary !== 'string' || !result.summary.trim()) return {ok:false,error:'缺少有效事件结果'};
    var quest = checked.quest;
    var previous = quest.result && Array.isArray(quest.result.events) ? quest.result.events : [];
    if (previous.some(function (e) { return e.id === result.id; })) return {ok:false,error:'事件已提交'};
    var saved = clone(result);
    quest.result = {events:previous.concat([saved]).slice(-100)};
    var applied = progress({questId:quest.id,objectiveId:checked.objective.id,actionId:checked.objective.actionId,amount:1}, {eventPermit:eventPermit,eventResult:saved});
    return applied;
  }

  function recomputeAll() {
    var st = ensure();
    var messages = [];
    if (!st) return messages;
    Object.keys(st.quests).forEach(function (id) { messages = messages.concat(recompute(st.quests[id])); });
    return messages;
  }

  function turnIn(questId, context) {
    var st = ensure();
    var quest = st && st.quests[questId];
    if (quest && quest.turnIn.type === 'npc') recompute(quest);
    if (!quest || quest.status !== 'ready_to_turn_in' || quest.rewardsClaimed || quest.settlement) return { ok: false, error: '任务尚不可交付', messages: [] };
    var position = currentPosition();
    var target = quest.turnIn;
    if (target.locationId && target.locationId !== position.locationId) return { ok: false, error: '尚未到达交付地点', messages: [] };
    if (target.areaId && target.areaId !== position.areaId) return { ok: false, error: '尚未到达交付区域', messages: [] };
    if (target.type === 'npc' && (!target.npcId || !st.npcs || !st.npcs[target.npcId])) return { ok: false, error: '交付 NPC 不存在', messages: [] };
    if (target.type === 'npc' && target.npcId !== ((context && context.npcId) || st.activeNPCId)) return { ok: false, error: '需要交给指定 NPC', messages: [] };
    if (isPhotoQuest(quest)) {
      if (!hasPhotoProof(quest) || target.type !== 'npc' || !isPhotoGiver(target.npcId)) {
        return { ok: false, error: '必须持有实地找到的照片凭证，并交还给晚晴', messages: [] };
      }
      if (typeof removeFromInventory !== 'function' || !removeFromInventory(PHOTO_ITEM, 1)) {
        return { ok: false, error: '照片凭证无法移交', messages: [] };
      }
      quest.photoProof.holder = target.npcId;
      quest.photoProof.consumedAt = Date.now();
      quest.objectives.forEach(function (objective) { objective.current = objective.required; objective.completed = true; });
    } else if (!quest.objectives.filter(function (objective) { return !objective.optional; }).every(function (objective) { return objective.completed || (isTurnInObjective(quest, objective) && prerequisitesMet(quest, objective)); })) {
      return { ok: false, error: '任务目标尚未完成', messages: [] };
    }
    quest.objectives.forEach(function (objective) {
      if (!objective.completed && isTurnInObjective(quest, objective) && prerequisitesMet(quest, objective)) {
        objective.current = objective.required; objective.completed = true;
        objective.lastAction = { actionId: objective.actionId, source: 'npc-turn-in', position: clone(position) };
      }
    });
    // The optional report is the player's claim, never a copy of off-screen evidence.
    quest.turnInReport = clean(context && context.report, 2000);
    var rewards = settle(quest);
    var messages = ['任务完成：' + quest.title];
    if (rewards.length) messages.push('获得奖励：' + rewards.join('、'));
    if (typeof window.log === 'function') window.log('info', 'quest-turned-in', { questId: quest.id, turnInType: target.type, npcId: target.npcId || null });
    if (typeof NarrativeUI !== 'undefined' && NarrativeUI.showToast) NarrativeUI.showToast(messages.join('\n'));
    return { ok: true, quest: quest, messages: messages };
  }

  function readyForNPC(npcId) {
    var st = ensure();
    if (!st) return [];
    return Object.keys(st.quests).map(function (id) { return st.quests[id]; }).filter(function (quest) {
      if (quest.turnIn.type === 'npc') recompute(quest);
      return quest.status === 'ready_to_turn_in' && quest.turnIn.type === 'npc' && quest.turnIn.npcId === npcId;
    });
  }

  function promptContext() {
    var eligible = eligibleObjectives();
    if (!eligible.length) return '';
    var lines = [
      '=== 当前场景可推进的任务步骤 ===',
      '只有下列步骤允许生成任务相关选项。相关选项必须原样附带 questAction；这是进入任务现场的入口，不代表已经执行。不得在场景或选项中提前叙述探望、调查结果或宣布任务完成。'
    ];
    eligible.forEach(function (entry) {
      var o = entry.objective;
      lines.push('- ' + entry.quest.title + ' / ' + o.text + '：' + o.promptHint);
      lines.push('  questAction=' + JSON.stringify({ questId: entry.quest.id, objectiveId: o.id, actionId: o.actionId, amount: 1 }));
    });
    return lines.join('\n');
  }

  function ensureQuestOption(options, count, target) {
    var eligible = eligibleObjectives();
    if (!eligible.length || options.some(function (option) { return option.questAction; })) return options;
    var entry = eligible[0];
    var fallback = {
      label: entry.objective.promptHint.slice(0, 80),
      tooltip: '推进任务「' + entry.quest.title + '」',
      target: target,
      effects: {},
      questAction: { questId: entry.quest.id, objectiveId: entry.objective.id, actionId: entry.objective.actionId, amount: 1 }
    };
    var result = options.slice(0, count || options.length);
    if (result.length >= (count || 1)) result[result.length - 1] = fallback;
    else result.push(fallback);
    return result;
  }

  function isPhotoGiver(npcId) {
    var st = state();
    var npc = st && st.npcs && st.npcs[npcId];
    return !!npc && (npc.actorId === 'card:linwanqing' || npcId === 'linwanqing');
  }

  function isPhotoQuest(quest) {
    return !!quest && (quest.id === PHOTO_QUEST_ID || quest.contentKey === PHOTO_QUEST_ID);
  }

  function photoQuest() {
    var st = state();
    var quests = st && st.quests || {};
    return Object.keys(quests).map(function (id) { return quests[id]; }).find(isPhotoQuest) || null;
  }

  function hasPhotoProof(quest) {
    var proof = quest && quest.photoProof;
    var st = state();
    var inventory = st && st.player && st.player.inventory;
    var count = Array.isArray(inventory) ? inventory.filter(function (item) { return item === PHOTO_ITEM; }).length : inventory && inventory[PHOTO_ITEM];
    return !!proof && proof.id === 'quest:' + quest.id + ':photo' && proof.holder === 'player' &&
      !proof.consumedAt && proof.locationId === 'Park' && proof.areaId === 'park_path' && Number(count) >= 1;
  }

  function offerPhotoQuest(npcId) {
    if (!isPhotoGiver(npcId)) return { ok: false, error: '这不是晚晴的照片请求' };
    if (photoQuest()) return { ok: false, error: '照片请求已经接受或处理，不能重复领取' };
    var npc = state().npcs[npcId];
    var position = currentPosition();
    if ((npc.locationId || npc.location) !== position.locationId || npc.areaId !== position.areaId) {
      return { ok: false, error: '需要当面向晚晴询问照片的事' };
    }
    if (!window.GameContent || typeof window.GameContent.photoQuestDefinition !== 'function' ||
        !window.NPCTools || typeof window.NPCTools.offerQuest !== 'function') {
      return { ok: false, error: '任务提议功能尚未就绪' };
    }
    // Only the offer executor may insert the quest after the player accepts.
    return window.NPCTools.offerQuest(npcId, window.GameContent.photoQuestDefinition(npcId));
  }

  function searchPhoto() {
    var st = ensure();
    var quest = photoQuest();
    if (!quest || quest.status !== 'active') return { ok: false, error: '请先接受晚晴的照片请求，已找到的照片不能重复领取' };
    var position = currentPosition();
    if (position.locationId !== 'Park' || position.areaId !== 'park_path') return { ok: false, error: '请到公园的林间小径寻找' };
    if (quest.photoProof) return { ok: false, error: '这张照片已经找到，不能再次生成' };
    if (!st.player || typeof addToInventory !== 'function') return { ok: false, error: '背包尚未就绪' };
    addToInventory(PHOTO_ITEM, 1);
    quest.photoProof = {
      id: 'quest:' + quest.id + ':photo', itemName: PHOTO_ITEM, holder: 'player',
      locationId: 'Park', areaId: 'park_path', acquiredAt: Date.now()
    };
    var objective = findObjective(quest, 'find-photo');
    if (objective) { objective.current = objective.required; objective.completed = true; }
    quest.status = 'ready_to_turn_in';
    return { ok: true, quest: quest, messages: ['你在林间小径的长椅下找到一张合影，仔细收好。', '获得照片凭证，请当面交还给晚晴。'] };
  }

  function prepareDefinition(args, giverId, options) {
    options = options || {};
    if (!args || typeof args !== 'object') return { ok: false, error: '参数必须是对象' };
    if (args.rewardMode !== undefined && REWARD_MODES.indexOf(args.rewardMode) === -1) return { ok: false, error: '未知 rewardMode' };
    if (args.rewardMode === 'npc_discretionary' && args.rewards != null && (!Array.isArray(args.rewards) || args.rewards.length > 0)) {
      return { ok: false, error: '自主回报任务不能承诺既定 rewards' };
    }
    var resolvedGiver = clean(giverId || args.giver, 100);
    var photoRequest = isPhotoQuest(args) || (isPhotoGiver(resolvedGiver) && /照片|合影|photo/i.test(JSON.stringify([args.title, args.description, args.objectives])));
    if (photoRequest) {
      if (!isPhotoGiver(resolvedGiver)) return { ok: false, error: '照片请求必须由晚晴发起' };
      if (photoQuest()) return { ok: false, error: '照片请求已经接受或处理，不能重复创建' };
      if (!window.GameContent || typeof window.GameContent.photoQuestDefinition !== 'function') return { ok: false, error: '照片任务内容尚未就绪' };
      // A model may request this content, but cannot redefine its evidence,
      // progress, delivery target, reward mode or one-per-story identity.
      args = window.GameContent.photoQuestDefinition(resolvedGiver);
    }
    if (!clean(args.title, 160) || !clean(args.description, 1000)) return { ok: false, error: 'title 和 description 必须是非空字符串' };
    if (!Array.isArray(args.objectives) || !args.objectives.length) return { ok: false, error: 'objectives 必须是非空数组' };
    var st = ensure();
    var base = idPart(args.id || args.title, 'quest');
    var id = base;
    var suffix = 2;
    while (st.quests[id]) id = base + '-' + suffix++;
    var quest = {
      id: id,
      contentKey: photoRequest ? PHOTO_QUEST_ID : undefined,
      title: clean(args.title, 160),
      description: clean(args.description, 1000),
      giver: clean(giverId || args.giver, 100),
      location: clean(args.location, 80) || currentPosition().locationId,
      objectives: clone(args.objectives),
      rewardMode: args.rewardMode || 'fixed',
      rewards: Array.isArray(args.rewards) ? args.rewards.map(function (reward) { return clean(reward, 120); }).filter(Boolean).slice(0, 12) : [],
      deadlineDay: typeof args.deadlineDay === 'number' ? args.deadlineDay : undefined,
      turnIn: args.turnIn && typeof args.turnIn === 'object' ? clone(args.turnIn) : undefined,
      status: 'active',
      eventDriven: !photoRequest && !!options.eventDriven,
      rewardsClaimed: false
    };
    quest.objectives.forEach(function (o) { if (o && typeof o === 'object') { delete o.lastAction; delete o.current; delete o.completed; } });
    normalizeQuest(quest, id);
    if (!quest.objectives.length) return { ok: false, error: '没有有效任务目标' };
    var regions = options.regions || st.regions || {};
    for (var i = 0; i < quest.objectives.length; i++) {
      var objective = quest.objectives[i];
      if (quest.eventDriven && (objective.locations.length !== 1 || objective.areas.length !== 1)) return {ok:false,error:'每个事件目标必须绑定恰好一个已有大区域和子地点；新地点先调用 register_quest_area'};
      for (var j = 0; j < objective.locations.length; j++) {
        if (!regions[objective.locations[j]]) return { ok: false, error: '未知任务大区域：' + objective.locations[j] };
      }
      for (var k = 0; k < objective.areas.length; k++) {
        var areaFound = objective.locations.some(function (locationId) {
          return regions[locationId] && regions[locationId].areas && regions[locationId].areas[objective.areas[k]];
        });
        if (!areaFound) return { ok: false, error: '任务子区域不属于目标大区域：' + objective.areas[k] };
      }
      for (var p = 0; p < objective.prerequisites.length; p++) {
        if (objective.prerequisites[p] === objective.id || !findObjective(quest, objective.prerequisites[p])) {
          return { ok: false, error: '无效的前置目标：' + objective.prerequisites[p] };
        }
      }
    }
    if (quest.eventDriven) {
      var reachable = {}, queue = [currentPosition().locationId];
      while (queue.length) {
        var next = queue.shift();
        if (reachable[next] || !Object.prototype.hasOwnProperty.call(regions,next)) continue;
        reachable[next] = true; queue = queue.concat(regions[next].connections || []);
      }
      if (quest.objectives.some(function (o) { return !reachable[o.locations[0]]; })) return {ok:false,error:'任务目标地点无法从当前位置到达'};
      var visited = {}, visiting = {};
      function cyclic(o) {
        if (visiting[o.id]) return true;
        if (visited[o.id]) return false;
        visiting[o.id] = true;
        if (o.prerequisites.some(function (id) { return cyclic(findObjective(quest,id)); })) return true;
        delete visiting[o.id]; visited[o.id] = true; return false;
      }
      if (quest.objectives.some(cyclic)) return {ok:false,error:'任务前置目标不能循环依赖'};
    }
    if (quest.turnIn.locationId && !regions[quest.turnIn.locationId]) return { ok: false, error: '未知交付大区域：' + quest.turnIn.locationId };
    if (quest.turnIn.areaId && (!regions[quest.turnIn.locationId].areas || !regions[quest.turnIn.locationId].areas[quest.turnIn.areaId])) {
      return { ok: false, error: '未知交付子区域：' + quest.turnIn.areaId };
    }
    return { ok: true, quest: quest };
  }

  function navigateToTurnIn(questId) {
    var st = ensure();
    var quest = st && st.quests[questId];
    if (quest && quest.turnIn.type === 'npc') recompute(quest);
    if (!quest || quest.status !== 'ready_to_turn_in') return Promise.resolve({ ok: false, error: '任务尚不可交付' });
    var target = quest.turnIn;
    if (target.type === 'npc' && (!target.npcId || !st.npcs[target.npcId])) {
      var error = '交付 NPC 不存在，无法前往交付';
      if (typeof window.log === 'function') window.log('warn', 'quest-turn-in-npc-missing', { questId: quest.id, npcId: target.npcId || null, giver: quest.giver || null });
      if (typeof NarrativeUI !== 'undefined' && NarrativeUI.showToast) NarrativeUI.showToast(error);
      return Promise.resolve({ ok: false, error: error });
    }
    var pos = currentPosition();
    if (target.locationId !== pos.locationId) {
      var regions = st.regions || {};
      var queue = [pos.locationId];
      var previous = {};
      previous[pos.locationId] = null;
      while (queue.length && previous[target.locationId] === undefined) {
        var current = queue.shift();
        var connections = regions[current] && Array.isArray(regions[current].connections) ? regions[current].connections : [];
        connections.forEach(function (next) {
          if (regions[next] && previous[next] === undefined) {
            previous[next] = current;
            queue.push(next);
          }
        });
      }
      if (previous[target.locationId] === undefined) return Promise.resolve({ ok: false, error: '没有通往交付地点的路线' });
      var step = target.locationId;
      while (previous[step] && previous[step] !== pos.locationId) step = previous[step];
      return MoveTool.invoke({ locationId: step }, { source: 'quest-turn-in' });
    }
    if (target.areaId && target.areaId !== pos.areaId) {
      return MoveTool.invoke({ locationId: target.locationId, areaId: target.areaId }, { source: 'quest-turn-in' });
    }
    if (target.type === 'npc') {
      st.activeNPCId = target.npcId;
      Engine.play('NPCChat');
      return Promise.resolve({ ok: true, navigated: true });
    }
    return Promise.resolve(turnIn(questId));
  }

  function handleVisit(event) {
    var st = ensure();
    if (!st || !event || !event.to) return;
    Object.keys(st.quests).forEach(function (questId) {
      var quest = st.quests[questId];
      if (!quest || quest.status !== 'active' || requiresEvent(quest)) return;
      quest.objectives.forEach(function (objective) {
        if (objective.type !== 'visit' || objective.completed || !prerequisitesMet(quest, objective)) return;
        if (positionAllowed(objective, event.to)) {
          progress({ questId: quest.id, objectiveId: objective.id, actionId: objective.actionId, amount: objective.required }, { silent: false });
        }
      });
    });
  }

  window.TaskEngine = {
    ensure: ensure,
    normalizeQuest: normalizeQuest,
    prepareDefinition: prepareDefinition,
    validateAction: validateAction,
    progress: progress,
    requiresEvent: requiresEvent,
    isTurnInObjective: isTurnInObjective,
    commitEvent: commitEvent,
    recompute: recompute,
    recomputeAll: recomputeAll,
    turnIn: turnIn,
    readyForNPC: readyForNPC,
    eligibleObjectives: eligibleObjectives,
    promptContext: promptContext,
    ensureQuestOption: ensureQuestOption,
    navigateToTurnIn: navigateToTurnIn,
    offerPhotoQuest: offerPhotoQuest,
    searchPhoto: searchPhoto,
    photoQuest: photoQuest
  };

  function register() {
    // Existing child areas render AreaScene rather than Park. Attach only the
    // authored action passage; rendering it never creates evidence or settles.
    if (typeof jQuery !== 'undefined') jQuery(document).on(':passagerender.questPhoto', function (event) {
      var position = currentPosition();
      if (!event.passage || event.passage.title !== 'AreaScene' || position.locationId !== 'Park' || position.areaId !== 'park_path') return;
      var actions = event.content && event.content.querySelector('.scene-fixed-actions');
      if (actions) new Wikifier(actions, '<<include "QuestPhotoActions">>');
    });
    if (typeof ModAPI !== 'undefined' && ModAPI.on) ModAPI.on('playerMoved', handleVisit);
    Macro.add('questturnins', {
      handler: function () {
        var npcId = this.args[0] || State.variables.activeNPCId;
        var output = this.output;
        var variables = State.variables, passage = State.passage, npc = variables.npcs[npcId];
        readyForNPC(npcId).forEach(function (quest) {
          var report = document.createElement('input');
          report.type = 'text'; report.maxLength = 2000;
          report.placeholder = '可选：交付时想告诉对方的话（不会自动汇报经过）';
          report.setAttribute('aria-label', '交付说明：' + quest.title);
          output.appendChild(report);
          var link = document.createElement('a');
          link.className = 'action-link';
          link.textContent = '交付：' + quest.title;
          link.title = '向当前 NPC 交付已完成的任务';
          link.addEventListener('click', function (event) {
            event.preventDefault();
            if (!link.isConnected || State.variables !== variables || State.passage !== passage || variables.npcs[npcId] !== npc) return;
            var result = turnIn(quest.id, { npcId: npcId, report: report.value });
            if (result.ok) Engine.play('NPCChat');
            else { var error = document.createElement('p'); error.className = 'llm-error-banner'; error.textContent = result.error; output.appendChild(error); }
          });
          output.appendChild(link);
        });
      }
    });
  }

  if (typeof whenSugarCubeReady === 'function') whenSugarCubeReady(register);
  else setTimeout(register, 0);
}());
