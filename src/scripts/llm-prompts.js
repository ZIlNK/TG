/* Prompt Builder: assembles structured prompts from game state */
(function () {
  'use strict';

  function getState() {
    return (typeof State !== 'undefined' && State.variables) ? State.variables : {};
  }

  function formatPlayer(stats) {
    if (!stats) return '未知角色。';
    var lines = [
      '姓名：' + (stats.name || '玩家'),
      '生命：' + stats.health + '/' + stats.maxHealth,
      '体力：' + stats.stamina + '/' + stats.maxStamina,
      '压力：' + stats.stress,
      '金钱：' + stats.money + ' 元',
      '背包：' + (stats.inventory && stats.inventory.length ? stats.inventory.join('、') : '空')
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

  function buildSystemPrompt() {
    var st = getState();
    var lines = [
      '你是一个文字角色扮演游戏的叙事引擎。',
      '请用中文生成沉浸式的第二人称现在时叙述。',
      '保持简洁（2-4 段）。',
      '不要打破角色，也不要提及自己是 AI。',
      '请尊重游戏世界和玩家状态来叙事。',
      '',
      '=== 当前游戏状态 ===',
      '地点：' + formatLocation(st.location),
      '时间：' + formatTime(st.time),
      '世界：' + formatWorld(st.world),
      '玩家：',
      formatPlayer(st.player)
    ];

    var worldMemory = st.worldMemory;
    if (worldMemory && worldMemory.events && worldMemory.events.length > 0) {
      var recentEvents = worldMemory.events.slice(-5);
      lines.push('', '=== 近期世界事件 ===');
      recentEvents.forEach(function (ev) {
        lines.push('- ' + (ev.text || '未知事件'));
      });
    }

    lines.push('==========================');
    return lines.join('\n');
  }

  function formatHistoryEntry(entry) {
    if (!entry || !entry.content) return '';
    var prefix = entry.role === 'user' ? '玩家：' : '叙述者：';
    return prefix + entry.content;
  }

  function getHistory(channel, limit) {
    var st = getState();
    var history = st.llmHistory || [];
    var filtered = history.filter(function (entry) {
      // Entries without a channel are treated as general chat for backward compatibility.
      return (entry.channel || 'chat') === channel;
    });
    if (limit && limit > 0) {
      return filtered.slice(-limit);
    }
    return filtered;
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
    scenePrompt: function (sceneDef) {
      var st = getState();
      var recentHistory = getHistory('scene', 6);
      sceneDef = sceneDef || {};

      var parts = [
        buildSystemPrompt(),
        '',
        '=== 场景 ===',
        '地点：' + (sceneDef.location || st.location || '未知'),
        '氛围：' + (sceneDef.mood || '中性'),
        '描述：' + (sceneDef.description || '继续故事。'),
        ''
      ];

      if (recentHistory.length > 0) {
        parts.push(summarizeChannelHistory(recentHistory));
        parts.push('');
      }

      parts.push('请用中文写下一段场景描述。只输出叙事文本，不要添加元评论。');

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

    actionPrompt: function (actionDef) {
      var st = getState();
      actionDef = actionDef || {};
      var parts = [
        buildSystemPrompt(),
        '',
        '=== 玩家行动 ===',
        '行动：' + (actionDef.action || '做点什么'),
        '目标：' + (actionDef.target || '环境'),
        '意图：' + (actionDef.intent || '探索'),
        '',
        '请用中文描述这个行动的结果（1-2 段）。具体说明它对玩家和世界的影响。'
      ];
      return parts.join('\n');
    },

    sceneObjectPrompt: function (sceneDef) {
      var st = getState();
      sceneDef = sceneDef || {};
      var recentHistory = getHistory('scene', 4);

      var parts = [
        buildSystemPrompt(),
        '',
        '=== 生成可玩场景 ===',
        '地点：' + (sceneDef.location || st.location || '未知'),
        '氛围：' + (sceneDef.mood || '中性'),
        '提示：' + (sceneDef.description || '为玩家创建一个有趣的场景。'),
        '',
        '请生成一个场景对象，格式为 JSON。场景必须包含 2-4 个有意义的玩家选项。',
        '每个选项需要包含 "label"（短文本）、"target"（passage 名称，如 "Bedroom"、"Street"、"Park"、"Shop"，或 "llm:generate:内容" 来让 LLM 生成更多内容）和可选的 "tooltip"。',
        '如果玩家想去上面未列出的地方，请使用 "llm:generate:<地点名>" 作为 target。',
        '',
        '必需的 JSON  schema（请用中文填写文本内容，JSON 字段名保持英文）：',
        '{',
        '  "id": "string（唯一的小写连字符 id）",',
        '  "title": "string（场景标题）",',
        '  "location": "string",',
        '  "mood": "string",',
        '  "text": "string（2-4 段叙事，中文）",',
        '  "options": [',
        '    { "label": "string（中文）", "target": "string", "tooltip": "string（中文）" }',
        '  ]',
        '}',
        '',
        '请只返回合法 JSON。不要包含 markdown 代码块或评论。所有自然语言内容必须是中文。'
      ];

      if (recentHistory.length > 0) {
        parts.push('', summarizeChannelHistory(recentHistory));
      }

      return parts.join('\n');
    },

    optionsPrompt: function (context, count) {
      var st = getState();
      count = count || 3;

      var parts = [
        buildSystemPrompt(),
        '',
        '=== 生成玩家选项 ===',
        '上下文：' + (context || '玩家正在决定下一步做什么。'),
        '请生成恰好 ' + count + ' 个玩家选项。',
        '',
        '每个选项需要包含 "label"（短文本，中文）、"target"（passage 名称，如 "Bedroom"、"Street"、"Park"、"Shop"，或 "llm:generate:内容"）和可选的 "tooltip"（中文）。',
        '',
        '必需的 JSON schema（只返回数组，中文内容）：',
        '[',
        '  { "label": "string（中文）", "target": "string", "tooltip": "string（中文）" }',
        ']',
        '',
        '请只返回合法 JSON。不要包含 markdown 代码块或评论。所有自然语言内容必须是中文。'
      ];

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
        '=========================='
      ].join('\n');

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
        '',
        '必需的 JSON schema（中文内容）：',
        '{',
        '  "id": "string（唯一的小写连字符 id）",',
        '  "title": "string（中文标题）",',
        '  "description": "string（中文描述）",',
        '  "giver": "string（npc id）",',
        '  "objectives": [',
        '    { "text": "string（中文）", "completed": false }',
        '  ],',
        '  "rewards": ["string（中文）"],',
        '  "status": "active"',
        '}',
        '',
        '请只返回合法 JSON。不要包含 markdown 代码块或评论。所有自然语言内容必须是中文。'
      ];

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
      if (!st.llmHistory) st.llmHistory = [];
      st.llmHistory.push({
        role: role,
        content: content,
        channel: channel || 'chat',
        timestamp: Date.now(),
        location: st.location || 'unknown'
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
