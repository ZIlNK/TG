const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.State = {
  variables: {
    location: 'Park',
    position: { locationId: 'Park', areaId: 'park_entrance' },
    game: { difficulty: 'normal' },
    player: {
      name: 'Player', health: 100, maxHealth: 100, stamina: 80, maxStamina: 80,
      stress: 0, trauma: 0, arousal: 0, control: 100, allure: 0, money: 25,
      hunger: 0, reputation: 0, dailyActions: 0, maxDailyActions: 8, inventory: {}
    },
    time: { dayName: 'Monday', day: 1, hour: 9, minute: 0 },
    world: { weather: 'clear', temperature: 22 },
    locations: {
      Street: { name: '城市街道', lore: '街边有便利店。' },
      Park: { name: '中央公园', lore: '公园里有喷泉和长椅。' }
    },
    regions: {
      Park: {
        id: 'Park', defaultAreaId: 'park_entrance',
        areas: {
          park_entrance: { id: 'park_entrance', name: '公园入口' },
          park_path: { id: 'park_path', name: '林间小径' }
        }
      }
    },
    npcs: {},
    characterCards: {},
    worldInfo: [
      { keys: ['便利店'], logic: 'OR', content: '不应进入公园提示词的便利店设定。' }
    ],
    llmHistory: [
      { role: 'assistant', content: '便利店店员正在收银台后招呼玩家。', channel: 'scene', location: 'Street' },
      { role: 'assistant', content: '玩家沿着喷泉旁的小径散步。', channel: 'scene', locationId: 'Park', areaId: 'park_path' }
    ]
  }
};

require('../src/scripts/npc-state.js');
require('../src/scripts/llm-prompts.js');

test('scene prompt keeps current-region history and reduces other regions to a location-only summary', () => {
  const prompt = PromptBuilder.scenePrompt({ location: 'Park', mood: 'peaceful' });

  assert.match(prompt, /玩家沿着喷泉旁的小径散步/);
  assert.doesNotMatch(prompt, /便利店店员正在收银台后招呼玩家/);
  assert.doesNotMatch(prompt, /不应进入公园提示词的便利店设定/);
  assert.match(prompt, /过去经历（不代表当前位置）/);
  assert.match(prompt, /城市街道（Street）/);
  assert.match(prompt, /这些地点的人物和事件不在当前场景/);

  const objectPrompt = PromptBuilder.sceneObjectPrompt({ location: 'Park', mood: 'peaceful' });
  assert.doesNotMatch(objectPrompt, /便利店店员正在收银台后招呼玩家/);
  assert.match(objectPrompt, /过去经历（不代表当前位置）/);
});

test('new history entries store both region and sub-area ids', () => {
  PromptBuilder.addToHistory('assistant', '新的公园场景', 'scene');
  const entry = State.variables.llmHistory.at(-1);

  assert.equal(entry.location, 'Park');
  assert.equal(entry.locationId, 'Park');
  assert.equal(entry.areaId, 'park_entrance');
});

test('scene prompts only include NPCs in the current sub-area with proactive quota remaining', () => {
  const npc = {
    id: 'lin', name: '林晚晴', role: '管理员', location: 'Park', locationId: 'Park', areaId: 'park_entrance',
    proactiveDialogue: { limitPerArea: 1, usedByArea: {} }
  };
  const card = {
    name: '林晚晴', role: '管理员', location: 'Park', locationId: 'Park', areaId: 'park_entrance',
    description: '正在入口附近整理长椅。', keywords: ['林晚晴'],
    proactiveDialogue: { limitPerArea: 1, usedByArea: {} }
  };
  State.variables.npcs = { lin: npc };
  State.variables.characterCards = { linwanqing: card };
  State.variables.proactiveDialogueUsage = {};

  assert.match(PromptBuilder.scenePrompt({ location: 'Park' }), /林晚晴/);

  State.variables.position.areaId = 'park_path';
  assert.doesNotMatch(PromptBuilder.scenePrompt({ location: 'Park' }), /林晚晴/);

  State.variables.position.areaId = 'park_entrance';
  assert.equal(NPCState.consumeByName('林晚晴').ok, true);
  assert.doesNotMatch(PromptBuilder.scenePrompt({ location: 'Park' }), /林晚晴/);
  assert.equal(PromptBuilder.hasProactiveDialogueCandidates(), false);
  assert.doesNotMatch(PromptBuilder.sceneObjectPrompt({ location: 'Park' }), /"name"\s*:\s*"start_dialogue"/);
  assert.doesNotMatch(PromptBuilder.optionsPrompt('继续行动', 3), /"name"\s*:\s*"start_dialogue"/);

  npc.areaId = 'park_path';
  card.areaId = 'park_path';
  State.variables.position.areaId = 'park_path';
  assert.equal(NPCState.remaining(npc), 1);
  assert.equal(PromptBuilder.hasProactiveDialogueCandidates(), true);
  assert.match(PromptBuilder.scenePrompt({ location: 'Park' }), /林晚晴/);
  assert.match(PromptBuilder.sceneObjectPrompt({ location: 'Park' }), /"name"\s*:\s*"start_dialogue"/);
});


function isolateOptionContext(t) {
  const previousState = State.variables;
  const previousGlobals = Object.fromEntries(
    ['SceneActions', 'TaskEngine', 'RegionSystem'].map((name) => [name, Object.getOwnPropertyDescriptor(global, name)])
  );
  t.after(() => {
    State.variables = previousState;
    for (const [name, descriptor] of Object.entries(previousGlobals)) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  });
  State.variables = structuredClone(previousState);
  State.variables.npcs = {};
  State.variables.characterCards = {};
  State.variables.quests = {};
  State.variables.position = { locationId: 'Park', areaId: 'park_entrance' };
  State.variables.proactiveDialogueUsage = {};
  delete global.SceneActions;
  delete global.TaskEngine;
  delete global.RegionSystem;
}

function structuredPrompts() {
  return [
    PromptBuilder.sceneObjectPrompt({ location: 'Park' }),
    PromptBuilder.optionsPrompt('决定接下来尝试的行动', 4)
  ];
}

function optionExamples(prompt) {
  return prompt.split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line.startsWith('{"label":'))
    .map((line) => JSON.parse(line));
}

test('structured prompts use separate executable option examples without mixed legacy fields', (t) => {
  isolateOptionContext(t);
  State.variables.npcs.lin = {
    id: 'lin', name: '林晚晴', role: '管理员', locationId: 'Park', areaId: 'park_entrance',
    proactiveDialogue: { limitPerArea: 1, usedByArea: {} }
  };

  for (const prompt of structuredPrompts()) {
    const examples = optionExamples(prompt);
    assert.ok(examples.length >= 4);
    for (const option of examples) {
      assert.equal(['action', 'tool', 'target'].filter((key) => key in option).length, 1);
      assert.equal('questAction' in option, false);
      assert.equal('effects' in option, false);
      assert.deepEqual(Object.keys(option).sort(), option.action ? ['action', 'label'] : ['label', 'tool']);
    }
    assert.deepEqual(examples.find((option) => option.label === '观察摊位'), {
      label: '观察摊位', action: { type: 'scene_action', intent: '观察摊位' }
    });
    assert.deepEqual(examples.find((option) => option.label === '购买早餐'), {
      label: '购买早餐', action: { type: 'scene_action', intent: '购买早餐', purchase: { productId: 'catalog-id' } }
    });
    const dialogue = examples.find((option) => option.tool?.name === 'start_dialogue');
    assert.ok(dialogue);
    assert.deepEqual(Object.keys(dialogue.tool.arguments).sort(), ['npcName', 'openingLine']);
    const movement = examples.find((option) => option.tool?.name === 'move_player');
    assert.ok(movement);
    assert.deepEqual(Object.keys(movement.tool.arguments).sort(), ['areaId', 'locationId']);
    assert.match(prompt, /三类互斥入口/);
    assert.match(prompt, /旧 target 仅留作明确已知且不涉及世界移动的页面导航兼容/);
    assert.match(prompt, /普通购买、观察等行动不用 target，也不要用空对话代替/);
    assert.match(prompt, /无关字段一律省略/);
    assert.match(prompt, /没有明确任务时省略 questAction/);
    assert.match(prompt, /只写玩家准备尝试的意图/);
    assert.match(prompt, /不要在场景正文、label、tooltip 或 intent 中提前叙述行动已完成、购买成功或任务已完成/);
    assert.match(prompt, /禁止在选项上添加 effects/);
    assert.match(prompt, /实际结果由后续结果回合经程序验证后决定/);
    assert.doesNotMatch(prompt, /"effects"\s*:|effects\.skills|"name"\s*:\s*"start_dialogue \| move_player"|与 tool 二选一/);
    assert.doesNotMatch(prompt, /请在 "effects" 对象中说明|表示选择后健康/);
  }
});

test('scene keeps a valid required shell while options returns an array contract', (t) => {
  isolateOptionContext(t);
  const [scenePrompt, optionsPrompt] = structuredPrompts();
  const shell = JSON.parse(scenePrompt.match(/^\{\n[\s\S]*?^\}/m)[0]);
  for (const key of ['id', 'title', 'text']) assert.equal(typeof shell[key], 'string');
  assert.equal(Array.isArray(shell.options), true);
  assert.ok(shell.options.length >= 2 && shell.options.length <= 4);
  assert.match(scenePrompt, /text 必须是单个 JSON 字符串/);
  assert.match(scenePrompt, /段落用 \\n 连接/);
  assert.match(optionsPrompt, /请生成恰好 4 个玩家选项/);
  assert.match(optionsPrompt, /只返回选项数组，不要添加场景外壳/);
  for (const prompt of [scenePrompt, optionsPrompt]) {
    assert.doesNotMatch(prompt, /"name"\s*:\s*"start_dialogue"/);
    assert.match(prompt, /当前子场景没有可对话 NPC，不要生成对话选项/);
    assert.ok(optionExamples(prompt).some((option) => option.tool?.name === 'move_player'));
  }
});

test('both structured prompts fetch the current catalog only when the provider exists', (t) => {
  isolateOptionContext(t);
  for (const provider of [undefined, null, {}]) {
    if (provider === undefined) delete global.SceneActions;
    else global.SceneActions = provider;
    assert.doesNotThrow(() => structuredPrompts());
  }

  const calls = [];
  global.SceneActions = {
    catalogPrompt() {
      assert.equal(this, SceneActions);
      const areaId = State.variables.position.areaId;
      calls.push(areaId);
      return '当前位置商品目录：' + areaId + ' / breakfast-001 / 早餐';
    }
  };
  for (const areaId of ['park_entrance', 'park_path']) {
    State.variables.position.areaId = areaId;
    for (const prompt of structuredPrompts()) {
      assert.ok(prompt.includes('当前位置商品目录：' + areaId + ' / breakfast-001 / 早餐'));
      assert.equal(prompt.split('当前位置商品目录：').length - 1, 1);
      assert.match(prompt, /原样引用目录 ID/);
      assert.match(prompt, /价格与效果由程序决定，不得虚构商品、价格或效果/);
      assert.match(prompt, /catalog-id 是目录 ID 占位值，不是实际商品/);
    }
  }
  assert.deepEqual(calls, ['park_entrance', 'park_entrance', 'park_path', 'park_path']);
  PromptBuilder.scenePrompt({ location: 'Park' });
  assert.equal(calls.length, 4, 'unstructured scene prompt must not request a catalog');
});

test('missing or empty catalogs require narrative attempts without promised purchases', (t) => {
  isolateOptionContext(t);
  for (const catalog of [undefined, '', '当前位置没有可购买商品']) {
    if (catalog !== undefined) global.SceneActions = { catalogPrompt: () => catalog };
    for (const prompt of structuredPrompts()) {
      assert.match(prompt, /仅当当前位置商品目录中确有对应商品时/);
      assert.match(prompt, /没有商品目录或没有匹配商品时，使用不含 purchase 的 scene_action 做纯叙事尝试/);
      assert.match(prompt, /不承诺购买成功，不承诺扣款或获得物品/);
      if (catalog) assert.ok(prompt.includes(catalog));
    }
  }
});

test('valid quest actions remain verbatim context and require a separate executable entry', (t) => {
  isolateOptionContext(t);
  const questAction = { questId: 'park-check', objectiveId: 'observe', actionId: 'inspect', amount: 1 };
  const questContext = '=== 当前场景可推进的任务步骤 ===\n调查入口：尝试观察入口\n  questAction=' + JSON.stringify(questAction);
  global.TaskEngine = { promptContext: () => questContext };
  global.RegionSystem = { promptContext: () => '可移动位置：Park / park_path' };
  for (const prompt of structuredPrompts()) {
    assert.ok(prompt.includes(questContext));
    assert.match(prompt, /只有选项对应上方明确列出的有效任务步骤时，才原样携带该步骤给出的 questAction/);
    assert.match(prompt, /保留与尝试意图匹配的可执行入口（tool 或明确已知的页面 target）/);
    assert.match(prompt, /questAction 不能单独充当入口/);
    assert.match(prompt, /不得虚构任务或改写其字段/);
    assert.match(prompt, /可移动位置：Park \/ park_path/);
    assert.doesNotMatch(prompt, /"effects"\s*:/);
  }
});

test('scene action tool prompt does not compete with a standalone JSON array response', (t) => {
  isolateOptionContext(t);
  const prompt = PromptBuilder.optionsPrompt('已经选择观察现场', 3, { toolResult: true });
  assert.match(prompt, /只规定 resolve_scene_action 的 options 字段/);
  assert.match(prompt, /最终必须调用 resolve_scene_action/);
  assert.doesNotMatch(prompt, /只返回选项数组|请只返回合法 JSON/);
  assert.match(prompt, /不能与普通 scene_action 混用/);
  assert.match(PromptBuilder.optionsPrompt('现场', 3), /只返回选项数组/);
});

test('registration prompts request a tool rather than prose JSON or direct dialogue execution', (t) => {
  isolateOptionContext(t);
  for (const prompt of [PromptBuilder.sceneObjectPrompt({ location: 'Park' }, { toolRegistration: true }), PromptBuilder.optionsPrompt('当前现场', 3, { toolRegistration: true })]) {
    assert.match(prompt, /必须调用 register_scene_options/);
    assert.doesNotMatch(prompt, /请只返回合法 JSON|只返回选项数组|请调用 start_dialogue 工具/);
    assert.match(prompt, /scene_action/);
  }
});
