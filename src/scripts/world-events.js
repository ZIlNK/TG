/* World events: probabilistically generate ambient world events on time advance. */
(function () {
  'use strict';

  var WORLD_EVENT_CHANCE = 0.25; // 每次时间推进触发世界事件的概率
  var SOCIAL_EVENT_CHANCE = 0.15; // 时间推进触发社交偶遇的概率
  var inFlight = null;

  function npcResponsePending() {
    if (typeof NPCDirector !== 'undefined' && NPCDirector.hasActiveRequest && NPCDirector.hasActiveRequest()) return true;
    var st = State.variables;
    if (State.passage === 'NPCChat' || State.passage === 'RequestQuest') return true;
    var jobs = st.npcAgency && st.npcAgency.jobs || {};
    return Object.keys(jobs).some(function (id) { return jobs[id].status === 'running'; });
  }

  function maybeGenerateEvent() {
    // Social encounters have one authority; no relationship parsing or second chat request.
    if (typeof NPCDirector !== 'undefined' && NPCDirector.onEncounter && Math.random() <= SOCIAL_EVENT_CHANCE) {
      NPCDirector.onEncounter();
    }
    if (inFlight || npcResponsePending()) return;
    if (typeof LLMEngine === 'undefined' || !LLMEngine.isAvailable()) return;
    if (typeof PromptBuilder === 'undefined' || typeof LLMOperationScope === 'undefined') return;
    var chance = (typeof getDifficultyModifier === 'function') ? getDifficultyModifier().eventChance : WORLD_EVENT_CHANCE;
    if (Math.random() > chance) return;

    var time = JSON.stringify(State.variables.time);
    var player = JSON.stringify(State.variables.player);
    var scope = LLMOperationScope.create({ validate: function () {
      return !npcResponsePending() && JSON.stringify(State.variables.time) === time &&
        JSON.stringify(State.variables.player) === player;
    } });
    inFlight = scope;
    var prompt = PromptBuilder.worldEventPrompt('ambient');

    LLMEngine.generate(prompt, { stream: false, operation: 'world-event-ambient', signal: scope.signal }).then(function (text) {
      if (!scope.isCurrent()) return;
      var clean = (text || '').trim();
      if (!clean) return;

      // Parse optional inline effect hints like [效果: 压力 +5]
      var effectMatch = clean.match(/\[效果:\s*([^\[\]]+)\]/);
      var effects = {};
      if (effectMatch) {
        clean = clean.replace(effectMatch[0], '').trim();
        var effectText = effectMatch[1];
        var statMap = {
          '生命': 'health', '体力': 'stamina', '压力': 'stress', '创伤': 'trauma',
          '饥饿': 'hunger', '自控': 'control', '欲望': 'arousal'
        };
        var parts = effectText.split(/[，,、]\s*/);
        parts.forEach(function (part) {
          var m = part.match(/(.+?)\s*([+-]\d+)/);
          if (m && statMap[m[1].trim()]) {
            effects[statMap[m[1].trim()]] = Math.max(-100, Math.min(100, parseInt(m[2], 10)));
          }
        });
      }

      PromptBuilder.addWorldEvent(clean, 'ambient');
      if (Object.keys(effects).length > 0 && typeof applyEffects === 'function') {
        var msgs = applyEffects(effects);
        if (msgs.length > 0) {
          var note = '世界事件：' + clean + '（' + msgs.join('，') + '）';
          if (typeof UI !== 'undefined' && UI.notify) UI.notify(note);
          else if (typeof NarrativeUI !== 'undefined' && NarrativeUI.showToast) NarrativeUI.showToast(note);
        }
      }
      if (typeof ModAPI !== 'undefined' && ModAPI.trigger) {
        ModAPI.trigger('worldEventAdded', { text: clean, effects: effects });
      }
    }).catch(function (err) {
      // Cancellation is not a fallback world event.
      if (scope.isCurrent() && (!err || err.name !== 'AbortError')) {
        console.warn('[WorldEvents] generation failed:', err && err.message ? err.message : err);
      }
    }).finally(function () {
      if (inFlight === scope) inFlight = null;
      scope.release();
    });
  }

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      if (typeof ModAPI !== 'undefined' && ModAPI.on) {
        ModAPI.on('timeAdvanced', maybeGenerateEvent);
        console.log('[WorldEvents] Loaded. Listening on timeAdvanced (chance ' + WORLD_EVENT_CHANCE + ').');
      }
    });
  }
}());
