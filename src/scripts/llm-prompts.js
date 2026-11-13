/* Prompt Builder: assembles structured prompts from game state */
(function () {
  'use strict';

  function getState() {
    return (typeof State !== 'undefined' && State.variables) ? State.variables : {};
  }

  function formatPlayer(stats) {
    if (!stats) return '未知角色。';
    var invText;
    if (typeof formatInventory === 'function') {
      invText = formatInventory();
    } else if (stats.inventory) {
      if (Array.isArray(stats.inventory)) {
        invText = stats.inventory.join('、') || '空';
      } else {
        var parts = [];
        for (var k in stats.inventory) {
          if (stats.inventory.hasOwnProperty(k)) parts.push(k + ' x' + stats.inventory[k]);
        }
        invText = parts.join('、') || '空';
      }
    } else {
      invText = '空';
    }
    var lines = [
      '姓名：' + (stats.name || '玩家'),
      '生命：' + stats.health + '/' + stats.maxHealth,
      '体力：' + stats.stamina + '/' + stats.maxStamina,
      '压力：' + stats.stress,
      '创伤：' + (stats.trauma || 0),
      '欲望：' + (stats.arousal || 0),
      '自控：' + (stats.control || 100),
      '魅力：' + (stats.allure || 0),
      '金钱：$' + stats.money,
      '饥饿：' + (stats.hunger || 0) + '/100',
      '声望：' + (stats.reputation || 0),
      '今日行动：' + (stats.dailyActions || 0) + '/' + (stats.maxDailyActions || 8),
      '背包：' + invText
    ];
    return lines.join('\n');
  }

  function formatTime(time) {
    if (!time) return '未知时间。';
    return time.dayName + '，第 ' + time.day + ' 天，' + time.hour + ':' + String(time.minute).padStart(2, '0');
  }

  function formatWorld(world) {
    if (!world) return '未知天气。';
    return '天气：' + world.weather + '，温度：' + world.temperature + '°C';
  }

  function formatLocation(location) {
    return location || '未知地点';
  }

  function formatCurrentPosition(st) {
    if (typeof RegionSystem !== 'undefined' && RegionSystem.formatPosition) return RegionSystem.formatPosition();
    return formatLocation(st.location);
  }

  function currentPositionIds(st) {
    var position = st.position || {};
    var locationId = position.locationId || st.location || 'unknown';
    return {
      locationId: locationId,
      areaId: position.locationId === locationId ? (position.areaId || '') : ''
    };
  }

  function npcCanProactivelyAppear(npc, st) {
    if (!npc) return false;
    var position = currentPositionIds(st);
    if (typeof NPCState !== 'undefined' && NPCState.isPresent && NPCState.remaining) {
      return NPCState.isPresent(npc, position) && NPCState.remaining(npc, position) > 0;
    }
    var locationId = npc.locationId || npc.location || '';
    if (locationId !== position.locationId || !npc.areaId || npc.areaId !== position.areaId) return false;
    var dialogue = npc.proactiveDialogue || {};
    var used = dialogue.usedByArea && dialogue.usedByArea[position.locationId + '|' + position.areaId] || 0;
    var limit = typeof dialogue.limitPerArea === 'number' ? dialogue.limitPerArea : 1;
    return used < limit;
  }

  function hasProactiveDialogueCandidates() {
    var st = getState();
    if (typeof NPCState !== 'undefined' && NPCState.hasEligibleSpeaker) return NPCState.hasEligibleSpeaker(currentPositionIds(st));
    var collections = [st.npcs || {}, st.characterCards || {}];
    return collections.some(function (collection) {
      return Object.keys(collection).some(function (id) { return npcCanProactivelyAppear(collection[id], st); });
    });
  }

  function historyLocationId(entry) {
    return (entry && (entry.locationId || entry.location)) || 'unknown';
  }

  function isSceneHistoryForLocation(entry, locationId) {
    return !!entry && (entry.channel || 'chat') === 'scene' && historyLocationId(entry) === locationId;
  }

  // ---- Structured content: world info / locations / character cards ----

  function getHistoryText(maxEntries) {
    var st = getState();
    var currentLocationId = currentPositionIds(st).locationId;
    var history = (st.llmHistory || []).filter(function (entry) {
      // Scene text from another region must not trigger current-location lore or characters.
      if (!entry) return false;
      return (entry.channel || 'chat') !== 'scene' || historyLocationId(entry) === currentLocationId;
    });
    var recent = (maxEntries && maxEntries > 0) ? history.slice(-maxEntries) : history;
    var parts = [];
    recent.forEach(function (h) {
      if (h && h.content) parts.push(h.content);
    });
    return parts.join('\n');
  }

  function entryMatches(entry, text) {
    if (!entry || !entry.keys || !entry.keys.length) return false;
    var logic = entry.logic || 'OR';
    var hitCount = 0;
    entry.keys.forEach(function (k) {
      if (text.indexOf(k) !== -1) hitCount++;
    });
    if (logic === 'AND') return hitCount === entry.keys.length;
    if (logic === 'NOT') return hitCount === 0;
    return hitCount > 0; // OR
  }

  function getLocationLore(location) {
    var st = getState();
    var loc = st.locations && st.locations[location];
    return (loc && loc.lore) ? loc.lore : '';
  }

  // Collect keyword-triggered world info + character cards for injection.
  function buildWorldContext(extraText) {
    var st = getState();
    var lines = [];
    var location = st.location || '';
    var baseScan = getHistoryText(12) + '\n' + (extraText || '') + '\n' + location;

    var worldInfo = st.worldInfo || [];
    worldInfo.forEach(function (entry) {
      if (!entry || !entry.content) return;
      if (entry.constant) {
        lines.push(entry.content);
        return;
      }
      var depth = entry.depth || 12;
      var scanText = depth >= 12 ? baseScan : (getHistoryText(depth) + '\n' + (extraText || '') + '\n' + location);
      if (entryMatches(entry, scanText)) lines.push(entry.content);
    });

    var cards = st.characterCards || {};
    for (var id in cards) {
      if (!cards.hasOwnProperty(id)) continue;
      var card = cards[id];
      var mentioned = false;
      if (card.keywords) {
        for (var i = 0; i < card.keywords.length; i++) {
          if (baseScan.indexOf(card.keywords[i]) !== -1) { mentioned = true; break; }
        }
      }
      if ((mentioned || card.location === location || card.locationId === location) && npcCanProactivelyAppear(card, st)) {
        lines.push('角色「' + card.name + '」：' + (card.role || '') + '，' + (card.description || '') + (card.personality ? ' ' + card.personality : '') + (card.scenario ? '（情境：' + card.scenario + '）' : ''));
      }
    }

    return lines;
  }

  // Collect active quests relevant to the current context (giver present /
  // mentioned, or quest location matches), like the world book.
  function buildQuestContext(extraText) {
    if (typeof TaskEngine !== 'undefined' && TaskEngine.promptContext) {
      var structured = TaskEngine.promptContext();
      return structured ? structured.split('\n') : [];
    }
    var st = getState();
    var lines = [];
    var location = st.location || '';
    var baseScan = getHistoryText(12) + '\n' + (extraText || '') + '\n' + location;
    var quests = st.quests || {};
    for (var qid in quests) {
      if (!quests.hasOwnProperty(qid)) continue;
      var quest = quests[qid];
      if (!quest || quest.status !== 'active') continue;
      var giver = (quest.giver && st.npcs) ? st.npcs[quest.giver] : null;
      var giverName = giver ? giver.name : '';
      var relevant = false;
      if (giver && (giver.location === location || quest.giver === st.activeNPCId)) relevant = true;
      if (quest.location && quest.location === location) relevant = true;
      if (giverName && baseScan.indexOf(giverName) !== -1) relevant = true;
      if (quest.keywords && quest.keywords.length) {
        for (var i = 0; i < quest.keywords.length; i++) {
          if (baseScan.indexOf(quest.keywords[i]) !== -1) { relevant = true; break; }
        }
      }
      if (!relevant) continue;
      lines.push('=== 任务：' + quest.title + ' ===');
      lines.push('描述：' + (quest.description || ''));
      if (quest.objectives && quest.objectives.length) {
        lines.push('目标（编号对应 effects.questObjective）：');
        quest.objectives.forEach(function (o, idx) {
          lines.push('- 目标' + idx + '：' + o.text + '（' + (o.completed ? '已完成' : '未完成') + '）');
        });
      }
      if (quest.deadlineDay) lines.push('期限：第 ' + quest.deadlineDay + ' 天');
    }
    return lines;
  }

  // Shared only by structured scene and option generation.
  function buildOptionProtocol(dialogueAvailable) {
    var lines = [
      '每个选项必须包含 "label"（短文本，中文）；"tooltip"（中文）可选，无关字段一律省略，不要填写空对象或空字符串占位。',
      '生成选项分为三类互斥入口：普通行动使用 action（type 为 scene_action），对话使用 start_dialogue tool，移动使用 move_player tool；每个选项只选一种入口。',
      '旧 target 仅留作明确已知且不涉及世界移动的页面导航兼容；不得与 action 或 tool 混填，不得虚构页面。普通购买、观察等行动不用 target，也不要用空对话代替。',
      '只写玩家准备尝试的意图，不要在场景正文、label、tooltip 或 intent 中提前叙述行动已完成、购买成功或任务已完成。',
      '禁止在选项上添加 effects（包括技能经验、金钱、物品、时间或任务进度）；实际结果由后续结果回合经程序验证后决定，不由选项预先结算。',
      '只有选项对应上方明确列出的有效任务步骤时，才原样携带该步骤给出的 questAction，并保留与尝试意图匹配的可执行入口（tool 或明确已知的页面 target）；不能与普通 scene_action 混用；questAction 不能单独充当入口。没有明确任务时省略 questAction，不得虚构任务或改写其字段。',
      '购买属于普通行动：仅当当前位置商品目录中确有对应商品时，使用 action.purchase.productId 原样引用目录 ID；价格与效果由程序决定，不得虚构商品、价格或效果。',
      '没有商品目录或没有匹配商品时，使用不含 purchase 的 scene_action 做纯叙事尝试，不承诺购买成功，不承诺扣款或获得物品。',
      '以下是分开的合法选项示例，不是要求混填的字段清单；只选符合当前场景的类型，示例占位值必须替换为上下文中的真实值。',
      '普通行动示例（仅在场景确有摊位时）：',
      '{"label":"观察摊位","action":{"type":"scene_action","intent":"观察摊位"}}',
      '购买示例（仅在目录确有早餐商品时；catalog-id 是目录 ID 占位值，不是实际商品）：',
      '{"label":"购买早餐","action":{"type":"scene_action","intent":"购买早餐","purchase":{"productId":"catalog-id"}}}'
    ];
    if (dialogueAvailable) {
      lines.push('对话示例（仅限上方列出的可搭话 NPC；npcName 和 openingLine 必须符合该角色与当前场景）：');
      lines.push('{"label":"回应招呼","tool":{"name":"start_dialogue","arguments":{"npcName":"上方列出的 NPC 名称","openingLine":"你好，需要帮忙吗？"}}}');
    } else {
      lines.push('当前子场景没有可对话 NPC，不要生成对话选项。');
    }
    lines.push('移动示例（locationId、areaId 必须来自可用位置上下文；涉及世界位置变化时使用 move_player，不使用 target）：');
    lines.push('{"label":"前往目的地","tool":{"name":"move_player","arguments":{"locationId":"已知区域 ID","areaId":"已知子区域 ID"}}}');
    return lines.join('\n');
  }

  function buildSystemPrompt() {
    var st = getState();
    var lines = [
      '你是一个文字角色扮演游戏的叙事引擎。',
      '请用中文生成沉浸式的第二人称现在时叙述。',
      '保持简洁（2-4 段）。',
      '不要打破角色，也不要提及自己是 AI。',
      '请尊重游戏世界和玩家状态来叙事。',
      '当前难度：' + ((st.game && st.game.difficulty) || 'normal') + '。',
      '',
      '=== 当前游戏状态 ===',
      '地点：' + formatCurrentPosition(st),
      '时间：' + formatTime(st.time),
      '世界：' + formatWorld(st.world),
      '玩家：',
      formatPlayer(st.player)
    ];

    // Relevant quests (keyword/context-triggered, like the world book)
    var questCtx = buildQuestContext('');
    if (questCtx.length > 0) {
      lines.push('');
      questCtx.forEach(function (l) { lines.push(l); });
    }

    // NPCs in current location
    var localNPCs = [];
    if (st.npcs) {
      for (var id in st.npcs) {
        if (!st.npcs.hasOwnProperty(id)) continue;
        var npc = st.npcs[id];
        if (npcCanProactivelyAppear(npc, st)) {
          localNPCs.push(npc.name + '（' + npc.role + '，态度：' + (npc.disposition || 0) + '）');
        }
      }
    }
    if (localNPCs.length > 0) {
      lines.push('', '=== 此地可主动搭话的 NPC ===');
      localNPCs.forEach(function (n) { lines.push('- ' + n); });
    }
    lines.push('', '只有“此地可主动搭话的 NPC”列表及下方同场景角色卡中的角色可以主动与玩家搭话；列表为空时不得调用 start_dialogue。');

    var worldMemory = st.worldMemory;
    if (worldMemory && worldMemory.events && worldMemory.events.length > 0) {
      var recentEvents = worldMemory.events.slice(-5);
      lines.push('', '=== 近期世界事件 ===');
      recentEvents.forEach(function (ev) {
        lines.push('- ' + (ev.text || '未知事件'));
      });
    }

    // Player skills context
    if (st.player && st.player.skills) {
      lines.push('', '=== 玩家技能 ===');
      var skillNames = ['运动','学识','社交','潜行','感知','意志','魅力'];
      skillNames.forEach(function (sk) {
        var sv = st.player.skills[sk];
        if (sv) {
          var desc = sv.value >= 80 ? '大师' : sv.value >= 60 ? '精通' : sv.value >= 40 ? '熟练' : sv.value >= 20 ? '练习中' : '生疏';
          lines.push('- ' + sk + '：' + sv.value + '/100（' + desc + '）');
        }
      });
    }

    // World context: keyword-triggered world info + character cards
    var worldCtx = buildWorldContext('');
    if (worldCtx.length > 0) {
      lines.push('', '=== 世界设定 ===');
      worldCtx.forEach(function (l) { lines.push('- ' + l); });
    }

    lines.push('==========================');
    return lines.join('\n');
  }

  function formatHistoryEntry(entry) {
    if (!entry || !entry.content) return '';
    var prefix = entry.role === 'user' ? '玩家：' : '叙述者：';
    return prefix + entry.content;
  }

  function getHistory(channel, limit, locationId) {
    var st = getState();
    var history = st.llmHistory || [];
    var filtered = history.filter(function (entry) {
      // Entries without a channel are treated as general chat for backward compatibility.
      return (entry.channel || 'chat') === channel;
    });
    if (channel === 'scene') {
      var targetLocationId = locationId || currentPositionIds(st).locationId;
      filtered = filtered.filter(function (entry) {
        return isSceneHistoryForLocation(entry, targetLocationId);
      });
    }
    if (limit && limit > 0) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  function getPastSceneLocations(locationId, limit) {
    var st = getState();
    var history = st.llmHistory || [];
    var seen = {};
    var locations = [];
    for (var i = history.length - 1; i >= 0; i--) {
      var entry = history[i];
      if (!entry || (entry.channel || 'chat') !== 'scene') continue;
      var entryLocationId = historyLocationId(entry);
      if (entryLocationId === 'unknown' || entryLocationId === locationId || seen[entryLocationId]) continue;
      seen[entryLocationId] = true;
      var location = st.locations && st.locations[entryLocationId];
      locations.push(location && location.name ? location.name + '（' + entryLocationId + '）' : entryLocationId);
      if (locations.length >= (limit || 3)) break;
    }
    return locations;
  }

  function appendSceneHistory(parts, locationId, limit) {
    var recentHistory = getHistory('scene', limit, locationId);
    if (recentHistory.length > 0) {
      parts.push(summarizeChannelHistory(recentHistory));
      parts.push('');
    }
    var pastLocations = getPastSceneLocations(locationId, 3);
    if (pastLocations.length > 0) {
      parts.push('=== 过去经历（不代表当前位置） ===');
      parts.push('玩家此前到访过：' + pastLocations.join('、') + '。这些地点的人物和事件不在当前场景，除非当前叙事明确说明他们已经来到这里。');
      parts.push('');
    }
  }

  function summarizeChannelHistory(history) {
    if (!history || history.length === 0) return '';
    var parts = [
      '=== 近期事件 ===',
      ''
    ];
    history.forEach(function (entry) {
      var formatted = formatHistoryEntry(entry);
      if (formatted) parts.push(formatted.substring(0, 200));
    });
    return parts.join('\n');
  }

  window.PromptBuilder = {
    hasProactiveDialogueCandidates: hasProactiveDialogueCandidates,

    scenePrompt: function (sceneDef) {
      var st = getState();
      sceneDef = sceneDef || {};

      var locationId = sceneDef.location || currentPositionIds(st).locationId;
      var locName = sceneDef.location || st.location || '未知';
      var locLore = getLocationLore(locationId);
      var parts = [
        buildSystemPrompt(),
        '',
        '=== 场景 ===',
        '地点：' + locName,
        '氛围：' + (sceneDef.mood || '中性')
      ];
      if (locLore) parts.push('地点设定：' + locLore);
      parts.push('描述：' + (sceneDef.description || '继续故事。'));
      parts.push('');

      appendSceneHistory(parts, locationId, 6);

      parts.push('请用中文写下一段场景描述。只输出叙事文本，不要添加元评论。');
      if (hasProactiveDialogueCandidates()) {
        parts.push('如果上方列出的 NPC 正在直接对玩家说话并等待回应，请调用 start_dialogue 工具；不要只把搭话写进普通叙事。');
      } else {
        parts.push('当前子场景没有已登记且可主动搭话的 NPC；不要引入新人物向玩家搭话。');
      }

      return parts.join('\n');
    },

    chatPrompt: function (userInput, context) {
      var recentHistory = getHistory('chat', 10);

      var messages = [
        { role: 'system', content: buildSystemPrompt() + '\n\n=== 上下文 ===\n' + (context || '玩家正在自由发言。') + '\n\n请用中文回复。' }
      ];

      recentHistory.forEach(function (entry) {
        if (entry.role && entry.content) {
          messages.push({ role: entry.role, content: entry.content });
        }
      });

      messages.push({ role: 'user', content: userInput });

      return messages;
    },

    sceneObjectPrompt: function (sceneDef, outputMode) {
      var st = getState();
      sceneDef = sceneDef || {};

      var locationId = sceneDef.location || currentPositionIds(st).locationId;
      var dialogueAvailable = hasProactiveDialogueCandidates();
      var locName = sceneDef.location || st.location || '未知';
      var locLore = getLocationLore(locationId);
      var parts = [
        buildSystemPrompt(),
        '',
        '=== 生成可玩场景 ===',
        '地点：' + locName,
        '氛围：' + (sceneDef.mood || '中性')
      ];
      if (locLore) parts.push('地点设定：' + locLore);
      parts.push('提示：' + (sceneDef.description || '为玩家创建一个有趣的场景。'));
      parts.push('');
      parts.push(outputMode && outputMode.toolRegistration ? '请调用 register_scene_options，参数为完整场景对象，包含 2-4 个有意义的玩家选项。' : '请生成一个场景对象，格式为 JSON。场景必须包含 2-4 个有意义的玩家选项。');
      if (dialogueAvailable) parts.push(outputMode && outputMode.toolRegistration ? '与在场 NPC 对话应注册为 options 内的 start_dialogue 入口，不能在注册过程中直接执行对话工具。' : '如果上方列出的 NPC 正在直接对玩家说话并等待回应，请调用 start_dialogue 工具；不要只把搭话写进普通叙事。');
      else parts.push('当前子场景没有已登记且可主动搭话的 NPC；不要引入新人物向玩家搭话，也不要生成对话选项。');
      if (typeof RegionSystem !== 'undefined' && RegionSystem.promptContext) parts.push('', RegionSystem.promptContext());
      if (window.SceneActions && SceneActions.catalogPrompt) parts.push('', SceneActions.catalogPrompt());
      parts.push('', buildOptionProtocol(dialogueAvailable));
      parts.push('');
      parts.push('场景外壳必需包含 id、title、text、options；location、mood 按场景填写。以下为合法 JSON 结构示例，实际 options 按上述协议生成 2-4 项：');
      parts.push('{');
      parts.push('  "id": "scene-id",');
      parts.push('  "title": "场景标题",');
      parts.push('  "location": "当前位置 ID",');
      parts.push('  "mood": "中性",');
      parts.push('  "text": "场景叙事（2-4 段中文，只描述当前情况与尝试意图）",');
      parts.push('  "options": [');
      parts.push('    {"label":"观察周围","action":{"type":"scene_action","intent":"观察周围"}},');
      parts.push('    {"label":"稍作等待","action":{"type":"scene_action","intent":"稍作等待"}}');
      parts.push('  ]');
      parts.push('}');
      parts.push('');
      parts.push('text 必须是单个 JSON 字符串：多个段落用 \\n 连接，不要拆成多个并列字符串。');
      parts.push('不要输出任何没有键名的裸字符串。');
      parts.push('');
      parts.push(outputMode && outputMode.toolRegistration ? '必须调用 register_scene_options 提交以上完整参数，不能只返回 JSON 正文。所有自然语言内容必须是中文。' : '请只返回合法 JSON。不要包含 markdown 代码块或评论。所有自然语言内容必须是中文。');

      parts.push('');
      appendSceneHistory(parts, locationId, 4);

      return parts.join('\n');
    },

    optionsPrompt: function (context, count, outputMode) {
      count = count || 3;
      var dialogueAvailable = hasProactiveDialogueCandidates();

      var parts = [
        buildSystemPrompt(),
        '',
        '=== 生成玩家选项 ===',
        '上下文：' + (context || '玩家正在决定下一步做什么。'),
        '请生成恰好 ' + count + ' 个玩家选项。'
      ];
      if (typeof RegionSystem !== 'undefined' && RegionSystem.promptContext) {
        parts.push('', RegionSystem.promptContext());
      }
      if (window.SceneActions && SceneActions.catalogPrompt) parts.push('', SceneActions.catalogPrompt());
      parts.push('', buildOptionProtocol(dialogueAvailable));
      parts.push('', outputMode && outputMode.toolResult ? '以下只规定 resolve_scene_action 的 options 字段，不是单独输出请求。后续选项应承接玩家行动后的结果。示例：' : outputMode && outputMode.toolRegistration ? '以下数组是 register_scene_options 的 options 参数示例，不是正文回复：' : '只返回选项数组，不要添加场景外壳。以下为合法 JSON 结构示例，实际数量必须符合上述要求：');
      parts.push('[');
      parts.push('  {"label":"观察周围","action":{"type":"scene_action","intent":"观察周围"}}');
      parts.push(']');
      parts.push('', outputMode && outputMode.toolResult ? '最终必须调用 resolve_scene_action 提交 description、options、effects，不能只回复数组或场景 JSON。收到 STAGED 后用非空中文确认结束。' : outputMode && outputMode.toolRegistration ? '必须调用 register_scene_options，提交 {options:[...]} 完整参数，不能只返回数组，也不能直接执行选项里的工具。所有自然语言内容必须是中文。' : '请只返回合法 JSON。不要包含 markdown 代码块或评论。所有自然语言内容必须是中文。');

      return parts.join('\n');
    },

    npcPrompt: function (npcDef) {
      var st = getState();
      npcDef = npcDef || {};

      var parts = [
        buildSystemPrompt(),
        '',
        '=== 生成 NPC ===',
        '姓名提示：' + (npcDef.name || '任何合适的名字'),
        '角色：' + (npcDef.role || '普通市民'),
        '地点：' + (npcDef.location || st.location || '未知'),
        'NPC 的 disposition（-10 敌对 到 10 友好）应参考玩家当前状态：如果玩家声望高、自控高、魅力高，倾向生成友好 NPC；如果玩家创伤高、压力高、名声差，NPC 可能更警惕或敌对。',
        '',
        '必需的 JSON schema（中文内容）：',
        '{',
        '  "id": "string（唯一的小写连字符 id）",',
        '  "name": "string（中文名）",',
        '  "location": "string",',
        '  "role": "string（中文）",',
        '  "traits": ["string（中文）", "string（中文）"],',
        '  "memory": "string（这个 NPC 知道或经历过什么，中文）",',
        '  "disposition": number（-10 敌对 到 10 友好）,',
        '  "dialogue": []',
        '}',
        '',
        '请只返回合法 JSON。不要包含 markdown 代码块或评论。所有自然语言内容必须是中文。'
      ];

      return parts.join('\n');
    },

    npcChatPrompt: function (npcId, userInput) {
      var st = getState();
      var npc = (st.npcs || {})[npcId] || { name: '陌生人', role: '未知', traits: [], memory: '', dialogue: [] };
      var recentDialogue = (npc.dialogue || []).slice(-10);

      var system = [
        '你是一个文字角色扮演游戏中的 NPC。',
        '请始终保持角色。不要打破第四面墙。',
        '请用中文回复。',
        '',
        '=== NPC 档案 ===',
        '姓名：' + npc.name,
        '角色：' + npc.role,
        '地点：' + npc.location,
        '特质：' + (npc.traits ? npc.traits.join('、') : '未知'),
        '记忆：' + (npc.memory || '你对玩家知之甚少。'),
        '对玩家的态度：' + (npc.disposition || 0),
        '',
        '=== 当前游戏状态 ===',
        '地点：' + formatLocation(st.location),
        '时间：' + formatTime(st.time),
        '世界：' + formatWorld(st.world),
        '',
        '如果剧情需要给玩家发布任务（例如玩家请求帮忙、或你有事相求），请调用 issue_quest 工具。玩家拒绝后不要重复强推。',
        '=========================='
      ].join('\n');

      // Append relationship context to NPC system prompt
      if (npc.relationship) {
        var relLines = [
          '',
          '=== 与玩家的关系 ===',
          '当前关系：' + (npc.relationship.tier || '陌生人') + '（' + (npc.relationship.value || 0) + '/100）',
          '上次见面：第 ' + (npc.relationship.lastMetDay || 1) + ' 天',
          '总共见面：' + (npc.relationship.meetCount || 1) + ' 次'
        ];
        if (npc.relationship.history && npc.relationship.history.length > 0) {
          var recent = npc.relationship.history.slice(-3);
          relLines.push('近期互动：');
          recent.forEach(function (h) {
            relLines.push('- ' + (h.action || '互动') + '（关系 ' + (h.delta > 0 ? '+' : '') + h.delta + '）');
          });
        }
        system += '\n\n' + relLines.join('\n');
      }

      // Merge a structured character card if one matches this NPC by name.
      var cards = st.characterCards || {};
      for (var cid in cards) {
        if (!cards.hasOwnProperty(cid)) continue;
        var card = cards[cid];
        if (card.name === npc.name) {
          var cardLines = ['', '=== 角色卡（结构化人设）==='];
          if (card.role) cardLines.push('角色：' + card.role);
          if (card.description) cardLines.push('描述：' + card.description);
          if (card.personality) cardLines.push('性格：' + card.personality);
          if (card.scenario) cardLines.push('情境：' + card.scenario);
          system += '\n' + cardLines.join('\n');
          break;
        }
      }

      var messages = [
        { role: 'system', content: system }
      ];

      recentDialogue.forEach(function (entry) {
        if (entry.role && entry.content) {
          messages.push({ role: entry.role, content: entry.content });
        }
      });

      messages.push({ role: 'user', content: userInput });

      return messages;
    },

    questTool: function () {
      return {
        type: 'function',
        function: {
          name: 'issue_quest',
          description: '当 NPC 想给玩家发布一个任务时调用。',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '任务标题' },
              description: { type: 'string', description: '任务描述' },
              objectives: {
                type: 'array',
                description: '按执行顺序排列的可验证目标。每个目标必须给出稳定 id、动作 id 和涉及的大区域。',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: '任务内唯一、稳定的小写连字符 id' },
                    text: { type: 'string', description: '玩家看到的目标说明' },
                    type: { type: 'string', enum: ['visit', 'action', 'collect', 'talk', 'deliver', 'purchase', 'skill', 'flag'] },
                    actionId: { type: 'string', description: '系统识别该动作的稳定 id' },
                    locations: { type: 'array', items: { type: 'string' }, description: '允许推进目标的大区域 locationId' },
                    areas: { type: 'array', items: { type: 'string' }, description: '必须填写一个已登记或 register_quest_area 返回的子区域 areaId，属于 locations 中的大区域' },
                    required: { type: 'number', description: '所需次数或数量，默认 1' },
                    prerequisites: { type: 'array', items: { type: 'string' }, description: '可选，前置 objective id' },
                    promptHint: { type: 'string', description: '在对应场景生成选项时使用的简短行动提示' }
                  },
                  required: ['id', 'text', 'type', 'actionId', 'locations', 'areas', 'required', 'promptHint']
                }
              },
              rewards: { type: 'array', items: { type: 'string' }, description: '奖励列表，每项格式「类型 数值」，如「金钱 50」「物品 能量饮料」' },
              deadlineDay: { type: 'number', description: '截止天数（可选）' },
              location: { type: 'string', description: '任务主要大区域 locationId（可选）' },
              turnIn: {
                type: 'object',
                description: '任务完成后的交付渠道；通常交还给发布任务的 NPC。',
                properties: {
                  type: { type: 'string', enum: ['npc', 'location', 'automatic'] },
                  npcId: { type: 'string' },
                  locationId: { type: 'string' },
                  areaId: { type: 'string' }
                },
                required: ['type']
              }
            },
            required: ['title', 'description', 'objectives', 'rewards']
          }
        }
      };
    },

    dialogueTool: function () {
      return {
        type: 'function',
        function: {
          name: 'start_dialogue',
          description: '仅当 NPC 出现在当前提示词的“此地可主动搭话的 NPC”或同场景角色卡中，且正在直接对玩家说话、需要玩家决定是否回应时调用。列表为空时不得调用。不要用于环境对白、远处谈话，或玩家只是考虑找人聊天的情况。',
          parameters: {
            type: 'object',
            properties: {
              npcName: { type: 'string', description: '正在向玩家搭话的 NPC 名称' },
              openingLine: { type: 'string', description: '该 NPC 对玩家说出的第一句话，中文' }
            },
            required: ['npcName', 'openingLine']
          }
        }
      };
    },

    movementTool: function () {
      return {
        type: 'function',
        function: {
          name: 'move_player',
          description: '把玩家移动到当前大区域的已有或新子区域，或移动到一个可达的已有大区域。优先使用系统提供的已有区域 ID。',
          parameters: {
            type: 'object',
            properties: {
              locationId: { type: 'string', description: '目标大区域 ID，必须来自系统提供的区域列表' },
              areaId: { type: 'string', description: '已有目标子区域 ID' },
              proposedArea: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: '新子区域名称' },
                  description: { type: 'string', description: '新子区域的简短稳定描述' },
                  aliases: { type: 'array', items: { type: 'string' } },
                  tags: { type: 'array', items: { type: 'string' } }
                },
                required: ['name', 'description']
              }
            },
            required: ['locationId']
          }
        }
      };
    },

    questPrompt: function (questDef) {
      var st = getState();
      questDef = questDef || {};
      var npcs = st.npcs || {};
      var giver = npcs[questDef.giverId] || { name: '一个神秘人物', role: '任务发布者' };

      var parts = [
        buildSystemPrompt(),
        '',
        '=== 生成任务 ===',
        '任务发布者：' + giver.name + '（' + giver.role + '）',
        '主题：' + (questDef.theme || '一个当地的问题'),
        '任务目标应具体且可验证（例如：前往某个地点、与某 NPC 交谈、获取某物品）。',
        '目标的 locations/areas 必须使用下方区域表中的现有 ID。每个目标使用稳定且唯一的 id 和 actionId。',
        '默认把任务交还给发布者：turnIn.type 使用 npc，npcId 使用发布者 ID，并填写发布者所在 locationId。只有确实无需交付时才使用 automatic。',
        'rewards 数组中的每个元素应为 "类型 数值" 格式，如 "金钱 50"、"声望 5"、"物品 能量饮料"、"健康 10"。',
        '',
        '必需的 JSON schema（中文内容）：',
        '{',
        '  "id": "string（唯一的小写连字符 id）",',
        '  "title": "string（中文标题）",',
        '  "description": "string（中文描述）",',
        '  "giver": "string（npc id）",',
        '  "objectives": [',
        '    { "id": "stable-id", "text": "string（中文）", "type": "visit | action | collect | talk | deliver | purchase | skill | flag", "actionId": "stable-action-id", "locations": ["locationId"], "areas": ["areaId（可选）"], "required": 1, "current": 0, "completed": false, "prerequisites": [], "promptHint": "string（适合做选项标签的行动）" }',
        '  ],',
        '  "rewards": ["string（中文）"],',
        '  "status": "active",',
        '  "turnIn": { "type": "npc", "npcId": "发布者 npc id", "locationId": "locationId", "areaId": "可选 areaId" }',
        '}',
        '',
        '请只返回合法 JSON。不要包含 markdown 代码块或评论。所有自然语言内容必须是中文。'
      ];

      if (typeof RegionSystem !== 'undefined' && RegionSystem.promptContext) parts.splice(8, 0, RegionSystem.promptContext(), '');
      return parts.join('\n');
    },

    worldEventPrompt: function (eventType) {
      var st = getState();
      eventType = eventType || 'ambient';

      var parts = [
        buildSystemPrompt(),
        '',
        '=== 生成世界事件 ===',
        '事件类型：' + eventType,
        '',
        '请生成一个简短的世界事件（1-2 句话），可能影响玩家或这座城市。',
        '如果事件应该对玩家状态有机械影响，请在末尾添加 [效果: 属性名 +/-数值]，例如 [效果: 压力 +5] 或 [效果: 金钱 -10]。',
        '请用中文回复。不要返回 JSON，不要添加评论。'
      ];

      return parts.join('\n');
    },

    summarizeHistory: function (history) {
      if (!history || history.length === 0) return '';
      var parts = [
        '=== 对话历史 ===',
        '请用 2-3 句话总结以下事件作为上下文：',
        ''
      ];
      history.forEach(function (entry) {
        var formatted = formatHistoryEntry(entry);
        if (formatted) parts.push(formatted.substring(0, 200));
      });
      return parts.join('\n');
    },

    addToHistory: function (role, content, channel) {
      var st = getState();
      var position = currentPositionIds(st);
      if (!st.llmHistory) st.llmHistory = [];
      st.llmHistory.push({
        role: role,
        content: content,
        channel: channel || 'chat',
        timestamp: Date.now(),
        location: position.locationId,
        locationId: position.locationId,
        areaId: position.areaId
      });
      if (st.llmHistory.length > 100) {
        st.llmHistory = st.llmHistory.slice(-100);
      }
    },

    clearHistory: function (channel) {
      var st = getState();
      if (channel) {
        st.llmHistory = st.llmHistory.filter(function (entry) {
          return (entry.channel || 'chat') !== channel;
        });
      } else {
        st.llmHistory = [];
      }
    },

    addWorldEvent: function (text, category) {
      var st = getState();
      if (!st.worldMemory) st.worldMemory = { events: [] };
      if (!st.worldMemory.events) st.worldMemory.events = [];
      st.worldMemory.events.push({
        text: text,
        category: category || 'general',
        timestamp: Date.now(),
        location: st.location || 'unknown'
      });
      if (st.worldMemory.events.length > 20) {
        st.worldMemory.events = st.worldMemory.events.slice(-20);
      }
    },

    trimWorldMemory: function (maxEvents) {
      maxEvents = maxEvents || 20;
      var st = getState();
      if (st.worldMemory && st.worldMemory.events && st.worldMemory.events.length > maxEvents) {
        st.worldMemory.events = st.worldMemory.events.slice(-maxEvents);
      }
    }
  };

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      console.log('[PromptBuilder] Loaded.');
    });
  }
}());
