/* Serializable NPC facts, identity and optimistic turn snapshots. No model effects here. */
(function () {
  'use strict';
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj || {}, key); }
  function now() { var t = State.variables.time || {}; return (t.day || 1) * 1440 + (t.hour || 0) * 60 + (t.minute || 0); }
  function id(db, prefix) { db.sequence = (db.sequence || 0) + 1; return prefix + ':' + db.sequence; }
  function ensure() {
    var st = State.variables;
    if (typeof GameContent !== 'undefined') GameContent.ensure();
    if (!st.npcAgency) st.npcAgency = { schemaVersion: 1, sequence: 0, actors: {}, facts: {}, jobs: {}, decisions: {}, offers: {}, promises: {}, intentions: {}, receipts: {}, encounters: {}, itemDefinitions: {} };
    var db = st.npcAgency;
    ['actors','facts','jobs','decisions','offers','promises','intentions','receipts','encounters','itemDefinitions'].forEach(function (key) { if (!db[key]) db[key] = {}; });
    var cards = st.characterCards || {}, npcs = st.npcs || {};
    Object.keys(cards).forEach(function (key) { var card = cards[key]; card.actorId = card.actorId || 'card:' + key; card.profileRef = card.profileRef || key; });
    Object.keys(npcs).forEach(function (key) {
      var npc = npcs[key];
      if (!npc.actorId) {
        var ref = npc.profileRef || npc.cardId;
        if (!ref) {
          // Legacy migration only: never merge ambiguous names or two runtime people.
          var matches = Object.keys(cards).filter(function (cid) { return cards[cid].name === npc.name; });
          var people = Object.keys(npcs).filter(function (nid) { return npcs[nid].name === npc.name; });
          if (matches.length === 1 && people.length === 1) ref = matches[0];
        }
        if (ref && own(cards, ref)) { npc.profileRef = ref; npc.actorId = cards[ref].actorId; }
        else npc.actorId = 'npc:' + key;
      }
      var profile = cards[npc.profileRef] || npc;
      if (!own(db.actors, npc.actorId)) {
        db.actors[npc.actorId] = { actorId: npc.actorId, npcId: key, profileRef: npc.profileRef || null, revision: 0, impression: '', knownFactIds: [], resources: copy(profile.agencyResources || { money: 0, items: {} }) };
        Object.keys(profile.agencyItemDefinitions || {}).forEach(function (item) { db.itemDefinitions[item] = copy(profile.agencyItemDefinitions[item]); });
      } else db.actors[npc.actorId].npcId = key;
    });
    return db;
  }
  function resolveActor(npcId) { var db = ensure(), npc = (State.variables.npcs || {})[npcId]; return npc && db.actors[npc.actorId] || null; }
  function recordFact(db, actorId, type, data, source) {
    var existing = Object.keys(db.facts).filter(function (key) { var f = db.facts[key]; return source && f.sourceEventId === source && f.type === type && f.knownBy.indexOf(actorId) !== -1; })[0];
    if (existing) return db.facts[existing];
    var key = id(db, 'fact'), fact = { id: key, type: type, data: copy(data || {}), sourceEventId: source || key, at: now(), knownBy: [actorId] };
    db.facts[key] = fact;
    if (db.actors[actorId]) db.actors[actorId].knownFactIds.push(key);
    return fact;
  }
  function fingerprint() {
    var s = State.variables;
    return JSON.stringify([s.npcAgency, s.player, s.npcs, s.quests, s.position, s.location, s.time, s.regions]);
  }
  function draft(npcId, decisionId, scope) {
    if (window.RegionSystem) RegionSystem.ensure();
    var actor = resolveActor(npcId);
    if (!actor) throw new Error('NPC 不存在');
    var st = State.variables;
    return { actorId: actor.actorId, npcId: npcId, decisionId: decisionId, scope: scope, base: fingerprint(), db: copy(st.npcAgency), player: copy(st.player), npcs: copy(st.npcs), quests: copy(st.quests || {}), regions: copy(st.regions || {}), signatures: [], results: {}, impressionUpdated: false };
  }
  function pick(value, keys) {
    var result = {};
    keys.forEach(function (key) { if (value && value[key] !== undefined) result[key] = copy(value[key]); });
    return result;
  }
  function questSnapshot(quest, npcId, actorId) {
    var settlement = quest.settlement;
    var witnessed = settlement && (settlement.actorId ? settlement.actorId === actorId :
      (settlement.npcId || (quest.turnIn || {}).npcId || quest.giver) === npcId);
    return {
      id: quest.id, title: quest.title, rewardMode: quest.rewardMode,
      // Engine readiness is not knowledge. Before an in-person delivery, only
      // the accepted commission is known; off-screen progress stays private.
      status: witnessed ? 'completed' : 'active',
      settlement: witnessed ? pick(settlement, ['sourceEventId','type','questId','fixedRewards']) : null,
      objectives: (quest.objectives || []).map(function (o) { return pick(o, ['id','text','required']); })
    };
  }
  function offerSnapshot(offer) {
    var result = pick(offer, ['id','kind','status','message','expiresAt','appointmentStatus']);
    result.payload = offer.kind === 'quest' ? {
      id: offer.payload.id, title: offer.payload.title, description: offer.payload.description,
      objectives: (offer.payload.objectives || []).map(function (o) { return pick(o, ['id','text','required','locations','areas']); })
    } : copy(offer.payload || {});
    return result;
  }
  function factSnapshot(fact) {
    var result = pick(fact, ['id','type','at']), data = fact.data || {};
    // Old saves contain entire task/settlement snapshots in a known fact.
    // Being allowed to know delivery does not grant access to those payloads.
    if (fact.type === 'player_statement') result.data = pick(data, ['text']);
    else if (fact.type === 'quest_settled' || fact.type === 'photo_returned') result.data = pick(data, ['questId','title','fixedRewards']);
    else {
      result.data = pick(data, ['offerId','promiseId','kind']);
      if (data.payload && /^player_(accepted|declined)$/.test(fact.type)) {
        result.data.payload = data.kind === 'quest' ? pick(data.payload, ['id','title']) : copy(data.payload);
      }
    }
    return result;
  }
  function context(npcId) {
    var actor = resolveActor(npcId), db = ensure(), st = State.variables;
    if (!actor) return null;
    var npc = st.npcs[npcId], profile = (st.characterCards || {})[actor.profileRef] || npc;
    function related(table) { return Object.keys(table).map(function (key) { return table[key]; }).filter(function (row) { return row.actorId === actor.actorId; }); }
    var items = {};
    Object.keys(actor.resources.items || {}).forEach(function (id) { if (db.itemDefinitions[id]) items[id] = copy(db.itemDefinitions[id]); });
    return {
      actorId: actor.actorId,
      profile: pick(profile, ['name','role','description','personality','traits','scenario','greeting']),
      dialogueExamples: Array.isArray(profile.dialogueExamples) ? profile.dialogueExamples.map(function (example) {
        return pick(example, ['situation','user','assistant']);
      }) : [],
      impression: actor.impression, resources: copy(actor.resources), gameMinute: now(), position: copy(st.position || {}),
      facts: actor.knownFactIds.filter(function (key) {
        return own(db.facts,key) && (db.facts[key].knownBy || []).indexOf(actor.actorId) >= 0;
      }).map(function (key) { return factSnapshot(db.facts[key]); }),
      offers: related(db.offers).map(offerSnapshot),
      promises: related(db.promises).map(function (p) { return pick(p, ['id','status','benefit','dueAt','message']); }),
      intentions: related(db.intentions).map(function (i) { return pick(i, ['id','status','goal','anchorFactIds','reconsiderWhen']); }),
      items: items,
      questStates: Object.keys(st.quests || {}).map(function (id) { return st.quests[id]; }).filter(function (q) {
        var settlement = q.settlement || {};
        return settlement.actorId === actor.actorId || q.giverActorId === actor.actorId || q.giver === npcId || (q.turnIn || {}).npcId === npcId;
      }).map(function (q) { return questSnapshot(q,npcId,actor.actorId); }),
      questLocations: window.RegionSystem ? RegionSystem.catalog() : copy(st.regions || {}),
      meetingLocations: [{ locationId: npc.locationId || npc.location, areaId: npc.areaId }]
    };
  }
  function onQuestSettled(quest, event) {
    event = event || {};
    if (own(event, 'npcId') && !event.npcId) return;
    var npcId = event.npcId || quest.giver, actor = resolveActor(npcId);
    var actorId = event.actorId || (quest.settlement || {}).actorId;
    if (actorId && (!actor || actor.actorId !== actorId)) {
      var known = ensure().actors[actorId];
      npcId = known && known.npcId;
      actor = resolveActor(npcId);
      if (actor && actor.actorId !== actorId) actor = null;
    }
    if (!actor || (quest.rewardMode || 'fixed') === 'fixed') return;
    var db = ensure(), source = event.sourceEventId || 'quest:' + quest.id + ':settled';
    recordFact(db, actor.actorId, quest.settlement && quest.settlement.type || 'quest_settled', { questId: quest.id, title: quest.title, fixedRewards: quest.rewardMode === 'fixed_plus_npc' ? quest.rewards : [] }, source);
    if (typeof NPCDirector !== 'undefined') NPCDirector.enqueue(npcId, { type: 'quest_settled', sourceEventId: source, questId: quest.id, text: quest.turnInReport || '' });
  }
  window.NPCAgency = { ensure: ensure, resolveActor: resolveActor, recordFact: recordFact, buildContext: context, createTurnDraft: draft, fingerprint: fingerprint, copy: copy, own: own, nextId: id, now: now, onQuestSettled: onQuestSettled };
}());
