/* World events: probabilistically generate ambient world events on time advance. */
(function () {
  'use strict';

  var WORLD_EVENT_CHANCE = 0.25; // 每次时间推进触发世界事件的概率
  var SOCIAL_EVENT_CHANCE = 0.15; // 时间推进触发社交偶遇的概率
  var inFlight = false;

  function maybeGenerateEvent() {
    if (inFlight) return;
    if (typeof LLMEngine === 'undefined' || !LLMEngine.isAvailable()) return;
    if (typeof PromptBuilder === 'undefined') return;
    var chance = (typeof getDifficultyModifier === 'function') ? getDifficultyModifier().eventChance : WORLD_EVENT_CHANCE;
    if (Math.random() > chance) return;

    inFlight = true;
    var prompt = PromptBuilder.worldEventPrompt('ambient');

    LLMEngine.generate(prompt, { stream: false }).then(function (text) {
      inFlight = false;
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
          '金钱': 'money', '饥饿': 'hunger', '自控': 'control', '欲望': 'arousal',
          '魅力': 'allure', '声望': 'reputation'
        };
        var parts = effectText.split(/[，,、]\s*/);
        parts.forEach(function (part) {
          var m = part.match(/(.+?)\s*([+-]\d+)/);
          if (m && statMap[m[1].trim()]) {
            effects[statMap[m[1].trim()]] = parseInt(m[2], 10);
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
      inFlight = false;
      // 世界事件为非阻塞增强：失败时静默。
      console.warn('[WorldEvents] generation failed:', err && err.message ? err.message : err);
    });

    // Social encounter event (separate roll)
    setTimeout(function () {
      if (typeof State === 'undefined' || !State.variables.npcs) return;
      if (Math.random() > SOCIAL_EVENT_CHANCE) return;
      var loc = State.variables.location;
      var localNPCs = [];
      for (var sid in State.variables.npcs) {
        if (State.variables.npcs.hasOwnProperty(sid)) {
          var sn = State.variables.npcs[sid];
          if (sn.location === loc && sn.relationship && sn.relationship.value >= 10) {
            localNPCs.push(sn);
          }
        }
      }
      if (localNPCs.length === 0) return;
      var snpc = localNPCs[Math.floor(Math.random() * localNPCs.length)];
      var sprompt = PromptBuilder.worldEventPrompt('social');
      sprompt += '\n\n生成一个关于 ' + snpc.name + ' 的偶遇。如果关系增进，附加 [关系变化: +2]。只输出叙事。';
      LLMEngine.generate(sprompt, { stream: false }).then(function (text) {
        var ct = (text || '').trim();
        if (!ct) return;
        var rm = ct.match(/\[关系变化:\s*([+-]\d+)\]/);
        if (rm) {
          ct = ct.replace(rm[0], '').trim();
          var rd = parseInt(rm[1], 10) || 0;
          if (rd !== 0 && typeof applyEffects === 'function') {
            applyEffects({ relationship_change: { npcId: snpc.id, delta: rd } });
          }
        }
        PromptBuilder.addWorldEvent('社交偶遇：' + ct, 'social');
        ModAPI.trigger('worldEventAdded', { text: ct, type: 'social' });
      }).catch(function () { /* silent */ });
    }, 100);
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
