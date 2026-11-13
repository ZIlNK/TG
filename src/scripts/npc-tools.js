/* NPC capabilities stage in an isolated draft. Only commit/resolve transfer state. */
(function () {
  'use strict';
  function debug(event, data) {
    try { if (typeof GameLogger !== 'undefined' && GameLogger.debug) GameLogger.debug(event, data); } catch (_) { /* diagnostics never change gameplay */ }
  }

  var text = { type: 'string', minLength: 1, maxLength: 800 };
  var ref = { type: 'string', minLength: 1, maxLength: 150 };
  var minute = { type: 'integer', minimum: 0 };
  function object(properties, required) { return { type: 'object', properties: properties, required: required || Object.keys(properties), additionalProperties: false }; }
  var reward = { oneOf: [object({ kind: { enum: ['money'] }, amount: { type: 'integer', minimum: 1 } }), object({ kind: { enum: ['existing_item'] }, itemId: ref, quantity: { type: 'integer', minimum: 1 } }), object({ kind: { enum: ['keepsake'] }, title: { type: 'string', minLength: 1, maxLength: 80 }, description: text })] };
  var meeting = object({ locationId: ref, areaId: ref, startAt: minute, endAt: minute, purpose: text });
  var trigger = object({ kind: { enum: ['next_encounter','game_time','offer_resolved'] }, notBefore: minute, offerId: ref }, ['kind']);
  var facts = { type: 'array', maxItems: 12, items: ref };
  function definitions() {
    var specs = [
      ['register_quest_area','仅在已有地点不适合任务时，暂存一个可达大区域的子地点；同名/别名复用已有地点，不移动玩家。必须使用返回的 ID 发布任务，随完整 NPC 回合提交。',object({ locationId: ref, proposedArea: object({ name: {type:'string',minLength:1,maxLength:60}, description: {type:'string',minLength:1,maxLength:300}, aliases: {type:'array',maxItems:8,items:ref}, tags: {type:'array',maxItems:8,items:ref} }, ['name','description']) })],
      ['npc_offer_reward','提出礼物并预留资源，玩家接受后才入账；可不回报。',object({ reward: reward, message: text, promiseId: ref, replaceOfferId: ref }, ['reward','message'])],
      ['npc_invite_player','邀请到本人当前登记的子区域见面，时间用绝对游戏分钟。',object({ locationId: ref, areaId: ref, startAt: minute, endAt: minute, purpose: text, message: text, promiseId: ref }, ['locationId','areaId','startAt','endAt','purpose','message'])],
      ['npc_make_promise','公开作出有资源支持的奖励或会面承诺。',object({ benefit: { oneOf: [object({ kind: { enum: ['reward'] }, reward: reward }), object({ kind: { enum: ['meeting'] }, meeting: meeting })] }, dueAt: minute, message: text })],
      ['npc_set_intention','记录或调整私下打算；不要向玩家展示私下分析。',object({ goal: text, anchorFactIds: facts, reconsiderWhen: trigger, replaceIntentionId: ref, status: { enum: ['pending','resolved','cancelled'] } }, ['goal','anchorFactIds','reconsiderWhen'])],
      ['npc_update_impression','根据已知事实更新主观印象，关系变化可负、零或正，每回合一次。',object({ summary: text, basisFactIds: facts, relationshipDelta: { type: 'integer', minimum: -5, maximum: 5 } })]
    ];
    var result = specs.map(function (s) { return { type: 'function', function: { name: s[0], description: s[1], parameters: s[2] } }; });
    if (typeof PromptBuilder !== 'undefined' && PromptBuilder.questTool) {
      var q = NPCAgency.copy(PromptBuilder.questTool());
      q.function.parameters.properties.objectives.maxItems = 8;
      q.function.parameters.properties.rewardMode = { enum: ['npc_discretionary'] };
      q.function.description = '提出可验证的任务，玩家接受后才生效。首批模型新任务只允许自主回报、rewards为空；已登记照片请求使用正式入口，不重复生成。';
      result.push(q);
    }
    return result;
  }
  function reject(code, message) { var e = new Error(message || code); e.code = code; throw e; }
  function validate(value, schema) {
    if (schema.oneOf) { var matches = schema.oneOf.filter(function (s) { try { validate(value, s); return true; } catch (_) { return false; } }); if (matches.length !== 1) reject('INVALID_ARGUMENTS','参数必须匹配唯一一种结构'); return; }
    if (schema.enum && schema.enum.indexOf(value) < 0) reject('INVALID_ARGUMENTS','未知枚举值');
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) reject('INVALID_ARGUMENTS','需要对象');
      (schema.required || []).forEach(function (k) { if (!NPCAgency.own(value, k)) reject('INVALID_ARGUMENTS','缺少 '+k); });
      Object.keys(value).forEach(function (k) { if (['__proto__','prototype','constructor'].indexOf(k) >= 0) reject('INVALID_ARGUMENTS'); if (schema.properties && NPCAgency.own(schema.properties, k)) validate(value[k],schema.properties[k]); else if (schema.additionalProperties === false) reject('INVALID_ARGUMENTS','未知字段 '+k); });
    }
    if (schema.type === 'array') { if (!Array.isArray(value) || value.length > (schema.maxItems || 40)) reject('INVALID_ARGUMENTS'); value.forEach(function (v) { validate(v,schema.items || {}); }); }
    if (schema.type === 'string' && (typeof value !== 'string' || value.trim().length < (schema.minLength || 0) || value.length > (schema.maxLength || 2000))) reject('INVALID_ARGUMENTS','无效文字');
    if (schema.type === 'number' || schema.type === 'integer') { if (typeof value !== 'number' || !isFinite(value) || (schema.type === 'integer' && Math.floor(value) !== value) || value < (schema.minimum === undefined ? -Infinity : schema.minimum) || value > (schema.maximum === undefined ? Infinity : schema.maximum)) reject('INVALID_ARGUMENTS','无效数值'); }
  }
  function canonical(value) { if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']'; if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(function (k) { return JSON.stringify(k)+':'+canonical(value[k]); }).join(',')+'}'; return JSON.stringify(value); }
  function reserveFor(r) { if (r.kind === 'money') return { money: r.amount, items: {} }; var items = {}; items[r.kind === 'keepsake' ? 'blank-paper' : r.itemId] = r.quantity || 1; return { money: 0, items: items }; }
  function available(db, actorId) {
    var actor = db.actors[actorId], left = NPCAgency.copy(actor.resources); left.items = left.items || {};
    function deduct(row) { if (row.actorId !== actorId || !row.reserve) return; left.money -= row.reserve.money || 0; Object.keys(row.reserve.items).forEach(function (k) { left.items[k] = (left.items[k] || 0) - row.reserve.items[k]; }); }
    Object.keys(db.offers).forEach(function (key) { var o=db.offers[key]; if (o.status === 'pending') deduct(o); });
    Object.keys(db.promises).forEach(function (key) { var p=db.promises[key]; if (p.status === 'open' && !p.offerId) deduct(p); });
    return left;
  }
  function assertResources(db, actorId) { var a=available(db,actorId); if (!isFinite(a.money) || a.money < 0 || Object.keys(a.items).some(function (key) { return !isFinite(a.items[key]) || a.items[key] < 0; })) reject('INSUFFICIENT_RESOURCE','可用资源不足，请改用实际可执行的行为'); }
  function checkReward(r, db) { validate(r,reward); if (r.kind === 'existing_item' && !NPCAgency.own(db.itemDefinitions,r.itemId)) reject('UNKNOWN_ITEM','只能赠送已登记物品'); if (r.kind === 'keepsake' && !NPCAgency.own(db.itemDefinitions,'blank-paper')) reject('UNKNOWN_ITEM','没有可制作纪念品的纸材定义'); }
  function checkMeeting(m, npc) { validate(m,meeting); if (m.locationId !== (npc.locationId || npc.location) || m.areaId !== npc.areaId) reject('INVALID_LOCATION','只能邀请到本人登记所在的子区域'); var region=(State.variables.regions || {})[m.locationId]; if (!region || !NPCAgency.own(region.areas,m.areaId)) reject('INVALID_LOCATION'); if (m.startAt < NPCAgency.now() || m.endAt <= m.startAt || m.endAt > NPCAgency.now()+30*1440) reject('INVALID_TIME','会面时间必须是未来30天内的有效窗口'); }
  function checkFacts(ids,d) { ids.forEach(function (key) { var f=d.db.facts[key]; if (!NPCAgency.own(d.db.facts,key) || f.knownBy.indexOf(d.actorId)<0) reject('UNKNOWN_FACT','不能引用未获知的事实'); }); }
  function owned(table,key,d) { if (!NPCAgency.own(table,key) || table[key].actorId !== d.actorId) reject('UNKNOWN_REFERENCE'); return table[key]; }
  function offer(d, kind, payload, message, extra) {
    var db=d.db, key=NPCAgency.nextId(db,'offer'), row={ id:key, actorId:d.actorId, npcId:d.npcId, decisionId:d.decisionId, cause:d.cause || d.decisionId, kind:kind, payload:payload, message:message, status:'pending', createdAt:NPCAgency.now(), expiresAt:NPCAgency.now()+3*1440 };
    extra=extra || {};
    if (extra.replaceOfferId) { var old=owned(db.offers,extra.replaceOfferId,d); if (old.status !== 'pending' || old.promiseId) reject('INVALID_STATE'); old.status='withdrawn'; }
    if (Object.keys(db.offers).some(function (k) { var old=db.offers[k]; return old.actorId===d.actorId && old.cause===row.cause && old.kind===kind && old.status==='pending'; })) reject('DUPLICATE_ACTION','该事由已有同类待处理提议');
    if (kind==='reward') row.reserve=reserveFor(payload);
    if (kind==='invitation') row.expiresAt=payload.endAt;
    if (extra.promiseId) {
      var p=owned(db.promises,extra.promiseId,d);
      if (p.status!=='open' || p.offerId || p.dueAt < NPCAgency.now()) reject('INVALID_STATE','承诺不可重复履行或已过期');
      var wanted=kind==='reward' ? {kind:'reward',reward:payload} : {kind:'meeting',meeting:payload};
      if (canonical(p.benefit)!==canonical(wanted)) reject('PROMISE_MISMATCH','履行内容必须符合已公开承诺');
      p.offerId=key; row.promiseId=p.id; row.expiresAt=Math.min(row.expiresAt,p.dueAt);
    }
    db.offers[key]=row; assertResources(db,d.actorId); return key;
  }
  function stage(call,d) {
    var saved=NPCAgency.copy(d.db), savedRegions=NPCAgency.copy(d.regions || {}), oldImpression=d.impressionUpdated;
    try {
      if (d.scope && !d.scope.isCurrent()) reject('STALE','当前互动已失效');
      var name=call.name || (call.function && call.function.name), args=call.arguments === undefined ? call.function && call.function.arguments : call.arguments;
      if (typeof args==='string') args=JSON.parse(args);
      var def=definitions().filter(function (t) { return t.function.name===name; })[0]; if (!def) reject('UNKNOWN_TOOL'); validate(args,def.function.parameters);
      var sig=name+canonical(args); if (d.signatures.indexOf(sig)>=0) { var prior=d.results[sig]; if(name==='register_quest_area')return {status:'STAGED',reference:prior,locationId:prior.split('/')[0],areaId:prior.split('/')[1],duplicate:true}; return {status:'STAGED',reference:prior,duplicate:true}; }
      var key, db=d.db;
      if (name==='register_quest_area') {
        if (!window.RegionSystem) reject('UNAVAILABLE','地点系统不可用');
        var registered = RegionSystem.registerQuestArea(args, d.regions, (State.variables.position || {}).locationId);
        if (!registered.ok) reject('INVALID_LOCATION', registered.error);
        key = registered.locationId + '/' + registered.areaId;
        d.signatures.push(sig); d.results[sig]=key;
        return {status:'STAGED',reference:key,locationId:registered.locationId,areaId:registered.areaId,area:registered.area,created:registered.created};
      }
      else if (name==='npc_offer_reward') { checkReward(args.reward,db); key=offer(d,'reward',args.reward,args.message,args); }
      else if (name==='npc_invite_player') { var m={locationId:args.locationId,areaId:args.areaId,startAt:args.startAt,endAt:args.endAt,purpose:args.purpose}; checkMeeting(m,d.npcs[d.npcId]); key=offer(d,'invitation',m,args.message,args); }
      else if (name==='npc_make_promise') {
        if (args.dueAt<=NPCAgency.now() || args.dueAt>NPCAgency.now()+30*1440) reject('INVALID_TIME');
        if (args.benefit.kind==='reward') checkReward(args.benefit.reward,db); else { checkMeeting(args.benefit.meeting,d.npcs[d.npcId]); if (args.dueAt<args.benefit.meeting.endAt) reject('INVALID_TIME'); }
        if (Object.keys(db.promises).some(function (k) { var p=db.promises[k]; return p.actorId===d.actorId && p.status==='open' && canonical(p.benefit)===canonical(args.benefit); })) reject('DUPLICATE_ACTION');
        key=NPCAgency.nextId(db,'promise'); db.promises[key]={id:key,actorId:d.actorId,npcId:d.npcId,status:'open',benefit:args.benefit,dueAt:args.dueAt,message:args.message,reserve:args.benefit.kind==='reward'?reserveFor(args.benefit.reward):null}; assertResources(db,d.actorId);
      } else if (name==='npc_set_intention') {
        checkFacts(args.anchorFactIds,d);
        if (args.reconsiderWhen.kind==='game_time' && args.reconsiderWhen.notBefore===undefined) reject('INVALID_TIME');
        if (args.reconsiderWhen.kind==='offer_resolved') owned(db.offers,args.reconsiderWhen.offerId,d);
        if (args.replaceIntentionId) { var old=owned(db.intentions,args.replaceIntentionId,d); if (old.status==='resolved' || old.status==='cancelled') reject('INVALID_STATE'); key=old.id; }
        else { if (args.status && args.status!=='pending') reject('INVALID_STATE'); key=NPCAgency.nextId(db,'intention'); }
        db.intentions[key]={id:key,actorId:d.actorId,status:args.status || 'pending',goal:args.goal,anchorFactIds:args.anchorFactIds,reconsiderWhen:args.reconsiderWhen,createdAt:NPCAgency.now(),createdEncounter:db.encounters[d.actorId] && db.encounters[d.actorId].id};
      } else if (name==='npc_update_impression') {
        if (d.impressionUpdated) reject('DUPLICATE_ACTION','每回合只能更新一次印象'); checkFacts(args.basisFactIds,d);
        db.actors[d.actorId].impression=args.summary; d.relationshipDelta=args.relationshipDelta; d.impressionUpdated=true; key=d.actorId;
      } else if (name==='issue_quest') {
        if ((args.rewardMode && args.rewardMode!=='npc_discretionary') || (args.rewards || []).length) reject('INVALID_REWARD_MODE','新自主任务不能创造固定奖励');
        var q=NPCAgency.copy(args); q.rewardMode='npc_discretionary'; q.rewards=[]; key=prepareQuestOffer(d,q);
      }
      d.signatures.push(sig); d.results[sig]=key;
      return {status:'STAGED',reference:key,message:'仅暂存；完整答复提交后提议才可见，礼物尚未入账。'};
    } catch(e) { d.db=saved; d.regions=savedRegions; d.impressionUpdated=oldImpression; return {status:'REJECTED',code:e.code || 'INVALID_ARGUMENTS',message:e.message}; }
  }
  function prepareQuestOffer(d,q) {
    if (Object.keys(d.quests).some(function (k) { var old=d.quests[k]; return old.giver===d.npcId && (old.title===q.title || (old.id===q.id)); })) reject('DUPLICATE_ACTION','相同任务已存在');
    q.id=q.id || NPCAgency.nextId(d.db,'npc-quest'); q.giver=d.npcId; q.status='active';
    if (q.turnIn && q.turnIn.type==='npc') q.turnIn.npcId=d.npcId;
    var p=TaskEngine.prepareDefinition(q,d.npcId,{regions:d.regions,eventDriven:true}); if (!p.ok) reject('INVALID_QUEST',p.error);
    return offer(d,'quest',p.quest,'请求：'+p.quest.title);
  }
  function scopeCurrent(d) { return (!d.scope || d.scope.isCurrent()) && NPCAgency.fingerprint()===d.base; }
  function commitTurn(d,content) {
    if (!content || !content.trim()) return {ok:false,error:'缺少最终答复'};
    if (window.normalizeLLMText) content = normalizeLLMText(content);
    if (!scopeCurrent(d)) return {ok:false,status:'stale',error:'世界或互动已改变，请重新回应'};
    var unusedArea = Object.keys(d.regions || {}).some(function (locationId) {
      var prior = (State.variables.regions || {})[locationId];
      return Object.keys(d.regions[locationId].areas || {}).some(function (areaId) {
        if (prior && NPCAgency.own(prior.areas,areaId)) return false;
        return !Object.keys(d.db.offers).some(function (key) {
          var row=d.db.offers[key];
          return row.kind==='quest' && row.decisionId===d.decisionId && row.payload.objectives.some(function(o){return o.locations.indexOf(locationId)>=0 && o.areas.indexOf(areaId)>=0;});
        });
      });
    });
    if (unusedArea) return {ok:false,error:'新地点未被本回合的有效任务引用，地点与回合均未提交，请重试'};
    assertResources(d.db,d.actorId);
    var actor=d.db.actors[d.actorId], npc=d.npcs[d.npcId]; actor.revision++;
    if (d.impressionUpdated) {
      npc.relationship=npc.relationship || {value:0,history:[]}; npc.relationship.value=Math.max(0,Math.min(100,(npc.relationship.value || 0)+d.relationshipDelta));
      npc.relationship.history=npc.relationship.history || []; npc.relationship.history.push({sourceEventId:d.decisionId,delta:d.relationshipDelta,day:(State.variables.time || {}).day});
      npc.disposition=Math.max(-10,Math.min(10,(npc.disposition || 0)+Math.sign(d.relationshipDelta)));
      if (typeof updateRelationshipTier==='function') updateRelationshipTier(npc);
    }
    npc.dialogue=npc.dialogue || []; npc.dialogue.push({role:'assistant',content:content,messageId:d.decisionId,gameMinute:NPCAgency.now()}); npc.dialogue=npc.dialogue.slice(-50);
    if (npc.relationship) npc.relationship.lastMetDay=(State.variables.time || {}).day || 1;
    d.db.decisions[d.decisionId]={id:d.decisionId,actorId:d.actorId,status:'committed',content:content,at:NPCAgency.now()};
    if (d.db.jobs[d.decisionId]) d.db.jobs[d.decisionId].status='committed';
    var receipt=NPCAgency.nextId(d.db,'receipt'); d.db.receipts[receipt]={id:receipt,decisionId:d.decisionId,actorId:d.actorId,type:'turn_committed',references:Object.keys(d.results).map(function(k){return d.results[k];})};
    var beforePlayer=State.variables.player;
    var st=State.variables; st.npcAgency=d.db; st.npcs=d.npcs; st.player=d.player; st.quests=d.quests; st.regions=d.regions;
    if (typeof maybeSolidifyNPC==='function') maybeSolidifyNPC(d.npcId);
    debug('npc-turn-committed', { decisionId: d.decisionId, actorId: d.actorId, npcId: d.npcId,
      content: content, receipt: d.db.receipts[receipt], actor: actor, relationship: npc.relationship,
      playerBefore: { money: beforePlayer.money, inventory: beforePlayer.inventory },
      playerAfter: { money: d.player.money, inventory: d.player.inventory },
      actions: Object.keys(d.results).map(function (key) { var id=d.results[key]; return d.db.offers[id] || d.db.promises[id] || d.db.intentions[id] || {reference:id}; }) });
    return {ok:true,status:'completed',content:content};
  }
  function present(npcId) { var st=State.variables,npc=(st.npcs || {})[npcId],pos=st.position || {}; return npc && (npc.locationId || npc.location)===pos.locationId && npc.areaId===pos.areaId; }
  function currentNpcId(actorId) {
    var db = NPCAgency.ensure(), actor = db.actors[actorId];
    var npc = actor && (State.variables.npcs || {})[actor.npcId];
    return npc && npc.actorId === actorId ? actor.npcId : null;
  }
  function atMeeting(place, npcId) {
    var pos = State.variables.position || {}, npc = (State.variables.npcs || {})[npcId];
    return npc && pos.locationId === place.locationId && pos.areaId === place.areaId && present(npcId);
  }
  function transaction() { NPCAgency.ensure(); return {db:NPCAgency.copy(State.variables.npcAgency),player:NPCAgency.copy(State.variables.player),quests:NPCAgency.copy(State.variables.quests || {})}; }
  function inventory(player) { if (Array.isArray(player.inventory)) { var obj={}; player.inventory.forEach(function (k) {obj[k]=(obj[k]||0)+1;}); player.inventory=obj; } return player.inventory || (player.inventory={}); }
  function resolveOffer(key,choice) {
    try {
      if (choice!=='accepted' && choice!=='declined') reject('INVALID_CHOICE');
      var t=transaction(),o=t.db.offers[key]; if (!NPCAgency.own(t.db.offers,key) || o.status!=='pending') reject('INVALID_STATE','提议已处理');
      if (o.expiresAt<=NPCAgency.now()) reject('EXPIRED','提议已过期'); o.npcId = currentNpcId(o.actorId); if (!present(o.npcId)) reject('NOT_PRESENT','需要当面处理提议');
      if (choice === 'accepted' && o.kind === 'invitation' && !atMeeting(o.payload, o.npcId)) reject('INVALID_LOCATION','邀请地点已不可用');
      if (choice==='accepted') {
        if (o.kind==='reward') {
          assertResources(t.db,o.actorId); var actor=t.db.actors[o.actorId],r=o.payload;
          actor.resources.money-=o.reserve.money;
          Object.keys(o.reserve.items).forEach(function (k) { actor.resources.items[k]-=o.reserve.items[k]; });
          if (r.kind==='money') t.player.money+=r.amount;
          else { var item=r.itemId; if (r.kind==='keepsake') { item=NPCAgency.nextId(t.db,'keepsake'); t.db.itemDefinitions[item]={title:r.title,description:r.description,kind:'keepsake',sellable:false}; } var inv=inventory(t.player); inv[item]=(inv[item]||0)+(r.quantity||1); }
        } else if (o.kind==='quest') {
          if (NPCAgency.own(t.quests,o.payload.id)) reject('DUPLICATE_ACTION');
          o.payload.giver = o.npcId;
          if (o.payload.turnIn && o.payload.turnIn.type === 'npc') o.payload.turnIn.npcId = o.npcId;
          var prepared=TaskEngine.prepareDefinition(o.payload,o.npcId,{eventDriven:!!o.payload.eventDriven}); if (!prepared.ok) reject('INVALID_QUEST',prepared.error); t.quests[o.payload.id]=prepared.quest;
        } else if (o.kind==='invitation') o.appointmentStatus='scheduled';
      }
      o.status=choice;
      if (o.promiseId) t.db.promises[o.promiseId].status=choice==='declined'?'released':(o.kind==='reward'?'fulfilled':'open');
      var source='offer:'+key+':'+choice;
      NPCAgency.recordFact(t.db,o.actorId,'player_'+choice,{offerId:key,kind:o.kind,payload:o.payload},source);
      t.db.receipts[source]={id:source,actorId:o.actorId,offerId:key,type:choice,at:NPCAgency.now()};
      t.db.actors[o.actorId].revision++;
      var beforePlayer=State.variables.player;
      State.variables.npcAgency=t.db; State.variables.player=t.player; State.variables.quests=t.quests;
      debug('npc-offer-resolved', { offerId:key, actorId:o.actorId, choice:choice, offer:o, receipt:t.db.receipts[source], resources:t.db.actors[o.actorId].resources, playerBefore:{money:beforePlayer.money,inventory:beforePlayer.inventory}, playerAfter:{money:t.player.money,inventory:t.player.inventory} });
      if (typeof NPCDirector!=='undefined') NPCDirector.enqueue(o.npcId,{type:'offer_resolved',sourceEventId:source,offerId:key,resolution:choice,questId:o.kind==='quest'?o.payload.id:null});
      return {ok:true};
    } catch(e) { debug('npc-offer-rejected', {offerId:key,choice:choice,error:e.message,code:e.code}); return {ok:false,error:e.message,code:e.code}; }
  }
  function advanceTime() {
    var db=NPCAgency.ensure(),time=NPCAgency.now();
    Object.keys(db.offers).forEach(function (key) {
      var o=db.offers[key];
      if (o.status==='pending' && o.expiresAt<=time) { o.status='expired';
        var promise = o.promiseId && db.promises[o.promiseId];
        // An expired proposal does not discharge a promise that is still due.
        if (promise && promise.status === 'open' && promise.offerId === key && promise.dueAt > time) delete promise.offerId;
        NPCAgency.recordFact(db,o.actorId,'offer_expired',{offerId:key},'expire:'+key); }
      if (o.status==='accepted' && o.kind==='invitation' && o.appointmentStatus==='scheduled' && o.payload.endAt<=time) { o.appointmentStatus='missed'; NPCAgency.recordFact(db,o.actorId,'appointment_missed',{offerId:key},'missed:'+key); }
    });
    Object.keys(db.promises).forEach(function (key) { var p=db.promises[key]; if (p.status==='open' && p.dueAt<=time) { p.status='broken'; NPCAgency.recordFact(db,p.actorId,'promise_broken',{promiseId:key},'broken:'+key); } });
    Object.keys(db.intentions).forEach(function (key) { var i=db.intentions[key],tr=i.reconsiderWhen; if(i.status!=='pending')return; if(tr.notBefore && tr.notBefore>time)return; if(tr.kind==='game_time' || (tr.kind==='offer_resolved' && db.offers[tr.offerId] && db.offers[tr.offerId].status!=='pending')) i.status='eligible'; });
  }
  function attend(key) {
    var db=NPCAgency.ensure(),o=db.offers[key],time=NPCAgency.now();
    var npcId = o && currentNpcId(o.actorId);
    if (!NPCAgency.own(db.offers,key) || o.kind!=='invitation' || o.status!=='accepted' || o.appointmentStatus!=='scheduled' || time<o.payload.startAt || time>=o.payload.endAt || !atMeeting(o.payload, npcId)) return {ok:false,error:'当前无法赴约'};
    o.npcId = npcId;
    o.appointmentStatus='attended'; if(o.promiseId)db.promises[o.promiseId].status='fulfilled';
    debug('npc-appointment-attended', {offerId:key,actorId:o.actorId,offer:o});
    NPCAgency.recordFact(db,o.actorId,'appointment_attended',{offerId:key},'attend:'+key);
    if(typeof NPCDirector!=='undefined')NPCDirector.enqueue(o.npcId,{type:'appointment_attended',sourceEventId:'attend:'+key}); return {ok:true};
  }
  function offerQuest(npcId,q) {
    try { var d=NPCAgency.createTurnDraft(npcId,'formal-quest',null); d.cause='formal-quest:'+q.id; var key=prepareQuestOffer(d,NPCAgency.copy(q)); if(!scopeCurrent(d))reject('STALE'); State.variables.npcAgency=d.db; return {ok:true,offerId:key}; } catch(e){return {ok:false,error:e.message};}
  }
  window.NPCTools={definitions:definitions,stage:stage,commitTurn:commitTurn,resolveOffer:resolveOffer,offerQuest:offerQuest,advanceTime:advanceTime,attend:attend,available:available,isPresent:present,validate:validate};
}());
