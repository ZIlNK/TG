/* Engine core: ModAPI, ThemeEngine, time utility, action macro */
(function () {
  'use strict';

  // Helper: defer code until SugarCube globals are available.
  // Kept for robustness when scripts are loaded outside the SugarCube scope.
  window.whenSugarCubeReady = function (fn) {
    (function check() {
      if (typeof jQuery !== 'undefined' && typeof Macro !== 'undefined') {
        fn();
      } else {
        setTimeout(check, 10);
      }
    })();
  };

  // ModAPI: runtime mod loading hooks.
  window.ModAPI = {
    hooks: {},
    mods: [],
    on: function (event, fn) {
      if (!this.hooks[event]) this.hooks[event] = [];
      this.hooks[event].push(fn);
    },
    off: function (event, fn) {
      if (!this.hooks[event]) return;
      this.hooks[event] = this.hooks[event].filter(function (h) { return h !== fn; });
    },
    trigger: function (event, data) {
      if (!this.hooks[event]) return;
      this.hooks[event].forEach(function (fn) { fn(data); });
    },
    addPassage: function (name, content, tags) {
      if (typeof Story === 'undefined' || Story.has(name)) {
        console.warn('Passage already exists or Story not ready:', name);
        return;
      }
      console.log('Mod added passage:', name);
    },
    addStyle: function (css) {
      var style = document.createElement('style');
      style.textContent = css;
      style.setAttribute('data-mod-style', 'true');
      document.head.appendChild(style);
    },
    addScript: function (js) {
      var script = document.createElement('script');
      script.textContent = js;
      script.setAttribute('data-mod-script', 'true');
      document.head.appendChild(script);
    },
    registerMod: function (meta) {
      this.mods.push(meta);
      if (typeof State !== 'undefined' && Array.isArray(State.variables.modRegistry)) {
        State.variables.modRegistry.push(meta.name);
      }
    },
    getLoadedMods: function () {
      return this.mods;
    },
    loadModData: function (data) {
      if (data.name) this.registerMod(data);
      if (data.css) this.addStyle(data.css);
      if (data.script) this.addScript(data.script);
      if (data.hooks) {
        for (var ev in data.hooks) {
          this.on(ev, data.hooks[ev]);
        }
      }
      this.trigger('modLoaded', data);
    },
    getVar: function (name) {
      return State.variables[name];
    },
    setVar: function (name, value) {
      State.variables[name] = value;
    }
  };

  window.ThemeEngine = {
    themes: ['light', 'dark'],
    resources: {},
    addTheme: function (name) {
      if (this.themes.indexOf(name) === -1) this.themes.push(name);
    },
    normalizeThemeName: function (name) {
      // Backwards compatibility: old saves may still reference 'default' theme.
      if (name === 'default') return 'dark';
      return name;
    },
    setTheme: function (name) {
      name = this.normalizeThemeName(name);
      if (this.themes.indexOf(name) === -1) return;
      document.documentElement.setAttribute('data-theme', name);
      if (typeof State !== 'undefined') {
        State.variables.theme = name;
      }
      ModAPI.trigger('themeChanged', name);
    },
    registerResource: function (key, value) {
      this.resources[key] = value;
    },
    unregisterResource: function (key) {
      delete this.resources[key];
    },
    getResource: function (key) {
      return this.resources[key];
    }
  };

  // Inventory helpers: migrate old flat-array inventories to {name: qty} objects.
  window.addToInventory = function (itemName, quantity) {
    quantity = quantity || 1;
    var inv = State.variables.player.inventory;
    if (Array.isArray(inv)) {
      var newInv = {};
      inv.forEach(function (it) {
        newInv[it] = (newInv[it] || 0) + 1;
      });
      State.variables.player.inventory = newInv;
      inv = newInv;
    }
    inv[itemName] = (inv[itemName] || 0) + quantity;
  };

  window.removeFromInventory = function (itemName, quantity) {
    quantity = quantity || 1;
    var inv = State.variables.player.inventory;
    if (Array.isArray(inv)) return false;
    if (!inv[itemName] || inv[itemName] < quantity) return false;
    inv[itemName] -= quantity;
    if (inv[itemName] <= 0) delete inv[itemName];
    return true;
  };

  window.hasItem = function (itemName) {
    var inv = State.variables.player.inventory;
    if (Array.isArray(inv)) return inv.indexOf(itemName) !== -1;
    return !!inv[itemName];
  };

  window.formatInventory = function () {
    var inv = State.variables.player.inventory;
    if (Array.isArray(inv)) return inv.join('、') || '空';
    var parts = [];
    for (var k in inv) {
      if (inv.hasOwnProperty(k)) parts.push(k + ' x' + inv[k]);
    }
    return parts.join('、') || '空';
  };

  // Stat threshold consequences: called after any state change or time advance.
  window.checkStatThresholds = function () {
    var p = State.variables.player;
    if (!p) return [];
    var msgs = [];

    if (p.stamina <= 0) {
      p.health = Math.max(0, p.health - 5);
      p.trauma = Math.min(100, (p.trauma || 0) + 2);
      msgs.push('你精疲力竭，健康下降，创伤增加。');
    }
    if (p.stress >= 80) {
      p.control = Math.max(0, (p.control || 100) - 5);
      msgs.push('你压力巨大，自控下降。');
    }
    if (p.stress >= 100) {
      p.trauma = Math.min(100, (p.trauma || 0) + 10);
      p.stress = 90;
      msgs.push('你濒临崩溃，创伤加深。');
    }
    if ((p.hunger || 0) >= 80) {
      p.stamina = Math.max(0, p.stamina - 10);
      p.health = Math.max(0, p.health - 2);
      msgs.push('你饥肠辘辘，体力和健康下降。');
    }

    // Game over checks
    if (p.health <= 0) {
      State.variables.game.over = 'health';
      State.variables.game.overReason = '你因健康耗尽而倒下了。';
      msgs.push('GAME_OVER');
    } else if ((p.trauma || 0) >= 100) {
      State.variables.game.over = 'trauma';
      State.variables.game.overReason = '你的精神彻底崩溃了。';
      msgs.push('GAME_OVER');
    }

    return msgs;
  };

  // Skill helpers: XP accumulation, level queries, formatting.
  var SKILL_XP_THRESHOLD_BASE = 10; // xp needed = (value + 1) * BASE

  window.addSkillXP = function (skillName, xp) {
    var skills = State.variables.player.skills;
    if (!skills || !skills[skillName]) return 0;
    var skill = skills[skillName];
    skill.xp = (skill.xp || 0) + xp;
    var threshold = (skill.value + 1) * SKILL_XP_THRESHOLD_BASE;
    var levelsGained = 0;
    while (skill.xp >= threshold && skill.value < 100) {
      skill.xp -= threshold;
      skill.value = Math.min(100, skill.value + 1);
      levelsGained++;
      threshold = (skill.value + 1) * SKILL_XP_THRESHOLD_BASE;
    }
    if (levelsGained > 0) {
      var skillLabelMap = {
        运动: '运动', 学识: '学识', 社交: '社交', 潜行: '潜行',
        感知: '感知', 意志: '意志', 魅力: '魅力'
      };
      var name = skillLabelMap[skillName] || skillName;
      var msg = name + ' 技能提升！' + (skill.value - levelsGained) + ' → ' + skill.value;
      if (typeof NarrativeUI !== 'undefined' && NarrativeUI.showToast) {
        NarrativeUI.showToast(msg);
      }
    }
    return levelsGained;
  };

  window.getSkillLevel = function (skillName) {
    var skills = State.variables.player.skills;
    return (skills && skills[skillName]) ? skills[skillName].value : 0;
  };

  window.getTopSkills = function (n) {
    var skills = State.variables.player.skills;
    if (!skills) return [];
    n = n || 3;
    var entries = [];
    for (var k in skills) {
      if (skills.hasOwnProperty(k)) {
        entries.push({ name: k, value: skills[k].value, xp: skills[k].xp });
      }
    }
    entries.sort(function (a, b) { return b.value - a.value; });
    return entries.slice(0, n);
  };

  window.formatSkills = function () {
    var skills = State.variables.player.skills;
    if (!skills) return '无技能数据';
    var parts = [];
    for (var k in skills) {
      if (skills.hasOwnProperty(k)) {
        var s = skills[k];
        var pct = Math.round((s.value / 100) * 100);
        parts.push(k + '：' + s.value + '/' + pct + '%（经验 ' + s.xp + '）');
      }
    }
    return parts.join('，');
  };

  window.getSkillProgress = function (skillName) {
    var skills = State.variables.player.skills;
    if (!skills || !skills[skillName]) return 0;
    var s = skills[skillName];
    var threshold = (s.value + 1) * SKILL_XP_THRESHOLD_BASE;
    return threshold > 0 ? (s.xp / threshold) : 0;
  };

  // Apply a structured effects object to player state. Returns human-readable change messages.
  window.applyEffects = function (effects) {
    if (!effects || typeof effects !== 'object') return [];
    var p = State.variables.player;
    if (!p) return [];
    var msgs = [];

    function applyStat(key, val) {
      if (typeof val !== 'number') return;
      var old = p[key] || 0;
      var labelMap = {
        health: '生命',
        stamina: '体力',
        stress: '压力',
        trauma: '创伤',
        hunger: '饥饿',
        control: '自控',
        arousal: '欲望',
        allure: '魅力',
        money: '金钱',
        reputation: '声望'
      };
      if (key === 'health') p[key] = Math.max(0, Math.min(p.maxHealth || 100, p[key] + val));
      else if (key === 'stamina') p[key] = Math.max(0, Math.min(p.maxStamina || 80, p[key] + val));
      else if (key === 'stress' || key === 'trauma' || key === 'hunger' || key === 'arousal') {
        p[key] = Math.max(0, Math.min(100, (p[key] || 0) + val));
      } else if (key === 'control' || key === 'allure') {
        p[key] = Math.max(0, Math.min(100, (p[key] || 0) + val));
      } else if (key === 'money') {
        p[key] = Math.max(0, (p[key] || 0) + val);
      } else if (key === 'reputation') {
        p[key] = (p[key] || 0) + val;
      }
      if (val !== 0) {
        var sign = val > 0 ? '+' : '';
        msgs.push((labelMap[key] || key) + ' ' + sign + val);
      }
    }

    var statKeys = ['health', 'stamina', 'stress', 'trauma', 'hunger', 'control', 'arousal', 'allure', 'money', 'reputation'];
    statKeys.forEach(function (k) {
      if (effects[k] !== undefined) applyStat(k, effects[k]);
    });

    if (effects.items && Array.isArray(effects.items)) {
      effects.items.forEach(function (it) {
        if (it && it.name && typeof it.qty === 'number' && it.qty !== 0) {
          addToInventory(it.name, it.qty);
          msgs.push('获得 ' + it.name + ' x' + it.qty);
        }
      });
    }

    if (effects.timeAdvance && Array.isArray(effects.timeAdvance) && effects.timeAdvance.length >= 2) {
      advanceTime(effects.timeAdvance[0], effects.timeAdvance[1]);
      msgs.push('时间推进 ' + effects.timeAdvance[0] + '小时' + effects.timeAdvance[1] + '分');
    }

    if (effects.questObjective !== undefined && State.variables.activeQuestId) {
      var q = State.variables.quests[State.variables.activeQuestId];
      if (q && q.objectives && q.objectives[effects.questObjective]) {
        q.objectives[effects.questObjective].completed = true;
        msgs.push('任务目标完成：' + q.objectives[effects.questObjective].text);
      }
    }

    if (effects.npcDisposition && State.variables.activeNPCId) {
      var npc = State.variables.npcs[State.variables.activeNPCId];
      if (npc) {
        npc.disposition = Math.max(-10, Math.min(10, (npc.disposition || 0) + effects.npcDisposition));
        var dir = effects.npcDisposition > 0 ? '提升' : '下降';
        msgs.push(npc.name + ' 的态度' + dir + ' ' + Math.abs(effects.npcDisposition));
      }
    }

    // Process skill XP from effects
    if (effects.skills && typeof effects.skills === 'object') {
      for (var sk in effects.skills) {
        if (effects.skills.hasOwnProperty(sk) && typeof effects.skills[sk] === 'number') {
          var gained = addSkillXP(sk, effects.skills[sk]);
          if (gained > 0) msgs.push(sk + ' 技能提升！');
        }
      }
    }

    // Process relationship changes from effects
    if (effects.relationship_change && typeof effects.relationship_change === 'object') {
      var rc = effects.relationship_change;
      var npcId = rc.npcId;
      if (npcId && State.variables.npcs && State.variables.npcs[npcId]) {
        var rcNpc = State.variables.npcs[npcId];
        var delta = typeof rc.delta === 'number' ? rc.delta : 0;
        if (delta !== 0) {
          rcNpc.disposition = Math.max(-10, Math.min(10, (rcNpc.disposition || 0) + (delta > 0 ? 1 : -1)));
          if (!rcNpc.relationship) {
            rcNpc.relationship = { tier: '陌生人', value: 0, history: [], lastMetDay: 1, meetCount: 1 };
          }
          rcNpc.relationship.value = Math.max(0, Math.min(100, (rcNpc.relationship.value || 0) + delta));
          if (typeof updateRelationshipTier === 'function') updateRelationshipTier(rcNpc);
          msgs.push(rcNpc.name + ' 的关系值 ' + (delta > 0 ? '+' : '') + delta);
        }
      }
    }

    checkStatThresholds();
    showFeedback(msgs);
    checkGameOver();
    return msgs;
  };

  // Parse quest reward strings like "金钱 50" / "声望 5" / "物品 能量饮料" / "健康 10".
  window.applyQuestRewards = function (quest) {
    if (!quest || !quest.rewards) return [];
    var msgs = [];
    quest.rewards.forEach(function (reward) {
      var parts = String(reward).split(/\s+/);
      if (parts.length < 2) return;
      var type = parts[0];
      var val = parseInt(parts[1], 10) || 0;
      var name = parts.slice(2).join(' ') || parts[1];
      var p = State.variables.player;

      if (type === '金钱') {
        p.money += val;
        msgs.push('金钱 +' + val);
      } else if (type === '声望') {
        p.reputation = (p.reputation || 0) + val;
        msgs.push('声望 +' + val);
      } else if (type === '健康') {
        p.health = Math.min(p.maxHealth, p.health + val);
        msgs.push('健康 +' + val);
      } else if (type === '体力') {
        p.stamina = Math.min(p.maxStamina, p.stamina + val);
        msgs.push('体力 +' + val);
      } else if (type === '自控') {
        p.control = Math.min(100, (p.control || 100) + val);
        msgs.push('自控 +' + val);
      } else if (type === '物品') {
        addToInventory(name, val || 1);
        msgs.push('获得 ' + name + (val > 1 ? ' x' + val : ''));
      }
    });
    quest.status = 'completed';
    return msgs;
  };

  // Check all active quests; if objectives are complete, mark done and apply rewards.
  window.checkQuestCompletion = function () {
    var quests = State.variables.quests;
    var msgs = [];
    if (!quests) return msgs;
    for (var id in quests) {
      if (!quests.hasOwnProperty(id)) continue;
      var q = quests[id];
      if (!q || q.status !== 'active') continue;
      var allDone = q.objectives && q.objectives.every(function (o) { return o.completed; });
      if (allDone) {
        var rewardMsgs = applyQuestRewards(q);
        msgs.push('任务完成：' + q.title + (rewardMsgs.length ? '（' + rewardMsgs.join('，') + '）' : ''));
      }
    }
    return msgs;
  };

  // Difficulty modifier: returns multipliers used by mechanics.
  window.getDifficultyModifier = function () {
    var diff = (State.variables.game && State.variables.game.difficulty) || 'normal';
    if (diff === 'easy') {
      return { statDrain: 0.7, moneyGain: 1.3, eventChance: 0.15, maxDailyActions: 10 };
    }
    if (diff === 'hard') {
      return { statDrain: 1.3, moneyGain: 0.8, eventChance: 0.35, maxDailyActions: 6 };
    }
    return { statDrain: 1.0, moneyGain: 1.0, eventChance: 0.25, maxDailyActions: 8 };
  };

  // Helper for the tutorial quest: mark an objective complete and finish quest if all done.
  window.completeTutorialObjective = function (index) {
    var quests = State.variables.quests;
    if (!quests || !quests.tutorial || quests.tutorial.status !== 'active') return;
    var q = quests.tutorial;
    if (!q.objectives || !q.objectives[index] || q.objectives[index].completed) return;
    q.objectives[index].completed = true;
    var allDone = q.objectives.every(function (o) { return o.completed; });
    if (allDone) {
      var msgs = checkQuestCompletion();
      State.variables.game.tutorialComplete = true;
      if (typeof NarrativeUI !== 'undefined' && NarrativeUI.showToast && msgs.length > 0) {
        NarrativeUI.showToast(msgs.join('\n'));
      }
    }
  };

  // If game over is set, redirect to the GameOver passage (unless already there).
  window.checkGameOver = function () {
    var g = State.variables.game;
    if (g && g.over && typeof passage === 'function' && passage() !== 'GameOver') {
      setTimeout(function () { Engine.play('GameOver'); }, 50);
      return true;
    }
    return false;
  };

  // Show a brief toast feedback message if NarrativeUI is available.
  window.showFeedback = function (msgs) {
    if (!msgs || msgs.length === 0) return;
    if (typeof NarrativeUI !== 'undefined' && NarrativeUI.showToast) {
      NarrativeUI.showToast(msgs.join('，'));
    }
  };

  whenSugarCubeReady(function () {
    window.advanceTime = function (hours, minutes) {
      hours = hours || 0;
      minutes = minutes || 0;
      var t = State.variables.time;
      var p = State.variables.player;
      var totalMinutes = hours * 60 + minutes;

      t.minute += minutes;
      while (t.minute >= 60) {
        t.minute -= 60;
        t.hour += 1;
      }
      t.hour += hours;
      var oldDay = t.day;
      while (t.hour >= 24) {
        t.hour -= 24;
        t.day += 1;
        var days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        var idx = days.indexOf(t.dayName);
        t.dayName = days[(idx + 1) % 7];

        // Day rollover: reset daily action budget and weather.
        p.dailyActions = 0;
        var weathers = ['clear', 'rain', 'cloudy', 'fog'];
        State.variables.world.weather = weathers[Math.floor(Math.random() * weathers.length)];
        State.variables.world.temperature = Math.floor(Math.random() * 21) + 15;
      }

      // Hunger increases by 5 per 2 hours of elapsed time, scaled by difficulty.
      if (totalMinutes > 0 && p) {
        var diff = getDifficultyModifier();
        p.hunger = Math.min(100, (p.hunger || 0) + Math.round(Math.floor(totalMinutes / 120) * 5 * diff.statDrain));
        p.maxDailyActions = diff.maxDailyActions;
      }

      checkStatThresholds();
      ModAPI.trigger('timeAdvanced', t);

      // If the day rolled over, redirect to the daily reset passage.
      if (t.day > oldDay && typeof passage === 'function' && passage() !== 'DayReset') {
        setTimeout(function () { Engine.play('DayReset'); }, 50);
      }

      checkGameOver();
    };

    // Custom action macro: <<action "Label" "Passage" "Tooltip">>
    Macro.add('action', {
      handler: function () {
        var label = this.args[0];
        var target = this.args[1];
        var tooltip = this.args[2] || '';
        var el = document.createElement('a');
        el.className = 'action-link';
        el.setAttribute('data-passage', target);
        if (tooltip) el.title = tooltip;
        el.textContent = label;
        el.addEventListener('click', function (ev) {
          ev.preventDefault();
          Engine.play(target);
        });
        this.output.appendChild(el);
      }
    });

    // Event hooks
    $(document).on(':passagestart', function () {
      ModAPI.trigger('passageStart', Passage);
    });
    $(document).on(':passageend', function () {
      ModAPI.trigger('passageEnd', Passage);
    });
    $(document).on(':storyready', function () {
      var savedTheme = State.variables.theme;
      var theme;
      if (savedTheme && savedTheme !== 'default' && ThemeEngine.themes.indexOf(savedTheme) !== -1) {
        theme = savedTheme;
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        theme = 'dark';
      } else {
        theme = 'light';
      }
      ThemeEngine.setTheme(theme);

      // Sync daily action cap with current difficulty.
      var diff = getDifficultyModifier();
      State.variables.player.maxDailyActions = diff.maxDailyActions;

      ModAPI.trigger('storyReady', null);
    });
  });
}());
