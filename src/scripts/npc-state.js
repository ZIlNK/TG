/* NPC sub-area presence and per-sub-area proactive dialogue quota. */
(function () {
  'use strict';

  var DEFAULT_PROACTIVE_LIMIT = 1;

  function state() {
    return typeof State !== 'undefined' && State.variables ? State.variables : null;
  }

  function cleanName(value) {
    return String(value == null ? '' : value).trim().toLocaleLowerCase();
  }

  function isReservedName(name) {
    var wanted = cleanName(name);
    var st = state() || {};
    var playerName = cleanName(st.player && st.player.name);
    var reserved = ['player', '玩家', '主角', '你', '我', '自己', '叙述者', 'narrator'];
    return !!wanted && (wanted === playerName || reserved.indexOf(wanted) !== -1);
  }

  function currentPosition() {
    var st = state() || {};
    var position = st.position || {};
    return {
      locationId: position.locationId || st.location || '',
      areaId: position.areaId || ''
    };
  }

  function positionKey(position) {
    return (position.locationId || '') + '|' + (position.areaId || '');
  }

  function defaultAreaId(locationId) {
    var st = state();
    var region = st && st.regions && st.regions[locationId];
    return region && region.defaultAreaId || '';
  }

  function findCardByName(name) {
    var st = state();
    var cards = st && st.characterCards || {};
    var wanted = cleanName(name);
    var matches = Object.keys(cards).filter(function (id) { return cards[id] && cleanName(cards[id].name) === wanted; });
    return matches.length === 1 ? { id: matches[0], npc: cards[matches[0]] } : null;
  }

  function ensureNPC(npc, fallbackPosition) {
    if (!npc || typeof npc !== 'object') return npc;
    var st = state() || {};
    var fallback = fallbackPosition || currentPosition();
    var profile = (st.characterCards || {})[npc.profileRef || npc.cardId];
    var matchingCard = profile ? { npc: profile } : (npc.areaId ? null : findCardByName(npc.name));
    var locationId = npc.locationId || npc.location || (matchingCard && (matchingCard.npc.locationId || matchingCard.npc.location)) || fallback.locationId;
    var areaId = npc.areaId || (matchingCard && matchingCard.npc !== npc && matchingCard.npc.areaId) || defaultAreaId(locationId);
    if (!areaId && locationId === fallback.locationId) areaId = fallback.areaId;

    npc.locationId = locationId;
    npc.location = locationId;
    npc.areaId = areaId;
    if (!npc.proactiveDialogue || typeof npc.proactiveDialogue !== 'object') npc.proactiveDialogue = {};
    if (typeof npc.proactiveDialogue.limitPerArea !== 'number') npc.proactiveDialogue.limitPerArea = DEFAULT_PROACTIVE_LIMIT;
    if (!npc.proactiveDialogue.usedByArea || typeof npc.proactiveDialogue.usedByArea !== 'object') {
      npc.proactiveDialogue.usedByArea = {};
    }
    return npc;
  }

  function samePosition(npc, position) {
    npc = ensureNPC(npc);
    position = position || currentPosition();
    return !!npc && !!position.locationId && !!position.areaId &&
      npc.locationId === position.locationId && npc.areaId === position.areaId;
  }

  function usageStore() {
    var st = state();
    if (!st) return {};
    var day = st.time && st.time.day;
    if (day !== undefined && st.proactiveDialogueUsageDay !== day) {
      st.proactiveDialogueUsageDay = day;
      st.proactiveDialogueUsage = {};
      [st.npcs || {}, st.characterCards || {}].forEach(function (records) {
        Object.keys(records).forEach(function (id) { if (records[id].proactiveDialogue) records[id].proactiveDialogue.usedByArea = {}; });
      });
    }
    if (!st.proactiveDialogueUsage || typeof st.proactiveDialogueUsage !== 'object') st.proactiveDialogueUsage = {};
    return st.proactiveDialogueUsage;
  }

  function usageKey(name, position) {
    return cleanName(name) + '|' + positionKey(position || currentPosition());
  }

  function usedCount(npc, position) {
    npc = ensureNPC(npc);
    position = position || currentPosition();
    usageStore();
    var own = npc && npc.proactiveDialogue.usedByArea[positionKey(position)] || 0;
    var shared = usageStore()[usageKey(npc && npc.name, position)] || 0;
    return Math.max(own, shared);
  }

  function remaining(npc, position) {
    npc = ensureNPC(npc);
    if (!npc) return 0;
    var limit = Math.max(0, npc.proactiveDialogue.limitPerArea);
    return Math.max(0, limit - usedCount(npc, position));
  }

  function namedRecords(name) {
    var st = state() || {};
    var wanted = cleanName(name);
    var result = [];
    var npcs = st.npcs || {};
    var cards = st.characterCards || {};
    var id;
    for (id in npcs) {
      if (npcs.hasOwnProperty(id) && npcs[id] && cleanName(npcs[id].name) === wanted) result.push({ id: id, npc: npcs[id], type: 'runtime' });
    }
    for (id in cards) {
      if (cards.hasOwnProperty(id) && cards[id] && cleanName(cards[id].name) === wanted) result.push({ id: id, npc: cards[id], type: 'card' });
    }
    return result;
  }

  function resolveSpeaker(name, position) {
    position = position || currentPosition();
    if (typeof NPCAgency !== 'undefined') NPCAgency.ensure();
    var records = namedRecords(name);
    var presentRuntime = null;
    var presentCard = null;
    records.forEach(function (record) {
      ensureNPC(record.npc);
      if (!samePosition(record.npc, position)) return;
      if (record.type === 'runtime' && !presentRuntime) presentRuntime = record;
      if (record.type === 'card' && !presentCard) presentCard = record;
    });
    return {
      ambiguous: ['runtime', 'card'].some(function (type) { var keys = {}; records.filter(function (r) { return r.type === type; }).forEach(function (r) { keys[r.npc.actorId || r.id] = true; }); return Object.keys(keys).length > 1; }),
      known: records.length > 0,
      present: presentRuntime || presentCard,
      runtime: presentRuntime,
      card: presentCard,
      records: records
    };
  }

  function canInviteByName(name, position) {
    position = position || currentPosition();
    if (isReservedName(name)) return { ok: false, reason: 'reserved-player-name', resolved: null };
    var resolved = resolveSpeaker(name, position);
    if (resolved.ambiguous) return { ok: false, reason: 'ambiguous-npc-name', resolved: resolved };
    if (!resolved.known) return { ok: false, reason: 'npc-not-registered', resolved: resolved };
    if (resolved.known && !resolved.present) return { ok: false, reason: 'npc-not-in-current-area', resolved: resolved };
    if (resolved.present && remaining(resolved.present.npc, position) <= 0) {
      return { ok: false, reason: 'proactive-dialogue-quota-exhausted', resolved: resolved };
    }
    return { ok: true, resolved: resolved };
  }

  function eligibleSpeakers(position) {
    position = position || currentPosition();
    var st = state() || {};
    var seen = {};
    var result = [];
    [st.npcs || {}, st.characterCards || {}].forEach(function (collection) {
      Object.keys(collection).forEach(function (id) {
        var npc = collection[id];
        var name = cleanName(npc && npc.name);
        if (!name || seen[name] || isReservedName(name)) return;
        if (samePosition(npc, position) && remaining(npc, position) > 0) {
          seen[name] = true;
          result.push(npc);
        }
      });
    });
    return result;
  }

  function consumeByName(name, position) {
    position = position || currentPosition();
    var check = canInviteByName(name, position);
    if (!check.ok) return check;
    var store = usageStore();
    var sharedKey = usageKey(name, position);
    store[sharedKey] = (store[sharedKey] || 0) + 1;
    check.resolved.records.forEach(function (record) {
      var npc = ensureNPC(record.npc);
      var key = positionKey(position);
      npc.proactiveDialogue.usedByArea[key] = Math.max(npc.proactiveDialogue.usedByArea[key] || 0, store[sharedKey]);
    });
    return { ok: true, remaining: check.resolved.present ? remaining(check.resolved.present.npc, position) : 0, resolved: check.resolved };
  }

  function ensureAll() {
    var st = state();
    if (!st) return;
    usageStore();
    var cards = st.characterCards || {};
    var npcs = st.npcs || {};
    var id;
    for (id in cards) if (cards.hasOwnProperty(id)) ensureNPC(cards[id]);
    for (id in npcs) if (npcs.hasOwnProperty(id)) ensureNPC(npcs[id]);
  }

  window.NPCState = {
    defaultProactiveLimit: DEFAULT_PROACTIVE_LIMIT,
    currentPosition: currentPosition,
    ensure: ensureNPC,
    ensureAll: ensureAll,
    isPresent: samePosition,
    remaining: remaining,
    eligibleSpeakers: eligibleSpeakers,
    hasEligibleSpeaker: function (position) { return eligibleSpeakers(position).length > 0; },
    isReservedName: isReservedName,
    resolveSpeaker: resolveSpeaker,
    canInviteByName: canInviteByName,
    consumeByName: consumeByName,
    findCardByName: findCardByName
  };
}());
