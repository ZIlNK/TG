# 游戏性增强：技能成长与社交关系系统 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for syntax tracking.

**Goal:** 在现有 Twine + SugarCube-2 游戏原型上，通过 LLM 驱动 + 规则保底的混合模式，增加技能成长系统（使用提升）和社交关系系统（NPC 关系等级），增强角色扮演深度。

**架构:** 在 `$player` 中添加 `skills` 对象（7 种技能），在 `$npcs[id]` 上扩展 `relationship` 对象。LLM 的 JSON 响应中通过扩展的 `effects` 字段传递技能经验/关系变化，同时保留动作代码中硬编码的保底 XP。`applyEffects()` 函数增加对 `skills` 和 `relationship_change` 的处理。侧边栏展示 top-3 技能，新增角色页面展示完整技能和关系。

**Tech Stack:** Twine 2 + SugarCube-2 + Tweego（编译器） + JS（ES5, no modules） + CSS3

## Global Constraints

- 所有游戏文本、UI 标签、LLM 提示词必须使用中文
- `src/scripts/` 下的 JS 文件必须作为 Tweego 的 source 目录传入，不能通过 `--head` 引入（会破坏 SugarCube 全局作用域）
- 自闭合宏必须省略 `tags` 属性（`tags: null` 会导致 SugarCube 期望闭合标签）
- 存档兼容性：通过 `_header.twee` 中的 `PassageHeader` 脚本补丁处理旧存档缺少新字段的情况
- LLM 模块为非必需依赖：LLM 不可用时系统必须有合理的回退行为（fallback）
- 构建命令：`build.bat`，产物在 `dist/index.html`

---

## Phase 1 — 基础框架（MVP）

在现有代码上叠加技能数据结构和基础提升机制。本阶段不依赖 LLM，可在无 LLM 配置的情况下正常运行。

### Task 1.1: 添加技能数据结构和辅助函数

**Files:**
- Modify: `src/passages/_init.twee` — StoryInit 中添加 `$player.skills` 初始化
- Modify: `src/passages/_header.twee` — PassageHeader 添加存档兼容补丁
- Modify: `src/scripts/engine.js` — 添加 `addSkillXP()`, `getSkillLevel()`, `getTopSkills()`, `formatSkills()` 函数

**Interfaces:**
- Produces: `window.addSkillXP(skillName, xp)` — 向指定技能添加经验
- Produces: `window.getSkillLevel(skillName)` — 获取技能等级 (0-100)
- Produces: `window.getTopSkills(n)` — 获取最高的 n 个技能（用于侧边栏展示）
- Produces: `window.formatSkills()` — 格式化所有技能为可读字符串（用于 LLM prompt）
- Produces: `State.variables.player.skills` — 数据结构

- [ ] **Step 1: 修改 `_init.twee`，在 `$player` 对象中新增 `skills` 字段**

在 `StoryInit` passage 的 `$player` 对象末尾添加：

```javascript
// 在 inventory: [] 之后添加
skills: {
  运动: { value: 0, xp: 0 },
  学识: { value: 0, xp: 0 },
  社交: { value: 0, xp: 0 },
  潜行: { value: 0, xp: 0 },
  感知: { value: 0, xp: 0 },
  意志: { value: 0, xp: 0 },
  魅力: { value: 0, xp: 0 }
}
```

- [ ] **Step 2: 修改 `_header.twee`，添加旧存档的 skills 兼容补丁**

在 `_header.twee` 的 `PassageHeader` 脚本中，与已有兼容补丁代码并列，在 `// Playability patch` 块之后（约第 60 行处）添加：

```javascript
// Skill system compat: initialize skills on older saves.
if (State.variables.player && !State.variables.player.skills) {
  State.variables.player.skills = {
    运动: { value: 0, xp: 0 },
    学识: { value: 0, xp: 0 },
    社交: { value: 0, xp: 0 },
    潜行: { value: 0, xp: 0 },
    感知: { value: 0, xp: 0 },
    意志: { value: 0, xp: 0 },
    魅力: { value: 0, xp: 0 }
  };
}
```

- [ ] **Step 3: 在 `engine.js` 中添加技能辅助函数**

在 `window.checkStatThresholds` 定义之后（约第 191 行附近）插入以下代码：

```javascript
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
```

- [ ] **Step 4: 验证 — 构建并测试技能初始化**

Run: `build.bat`（在项目根目录执行）
然后打开 `dist/index.html`，在浏览器控制台中执行：
```
State.variables.player.skills
```
期望结果：返回包含 7 个技能的对象，每个 `{value: 0, xp: 0}`。
再执行：
```
addSkillXP("运动", 5)
addSkillXP("运动", 50)
```
期望结果：运动技能值变为 3（XP 累计超过阈值，每级阈值 = (value+1)*10），控制台 Toast 提示技能提升。

- [ ] **Step 5: 提交阶段性成果**
```bash
git add src/passages/_init.twee src/passages/_header.twee src/scripts/engine.js
git commit -m "feat: add skill system data structure and XP helpers"
```

---

### Task 1.2: 为现有动作绑定保底技能 XP

**Files:**
- Modify: `src/passages/scenes.twee` — 为 SleepAction、StudyAction、JogAction、RestAction、BuyFoodAction 添加 `addSkillXP` 调用

- [ ] **Step 1: 为 SleepAction 添加「意志」XP**

在 `scenes.twee` 的 SleepAction passage 中，找到 `<<set $player.hunger` 行之前，添加：
```
  <<run addSkillXP("意志", 3)>>
```
修改后的 SleepAction 关键部分（约第 22-27 行）：
```twee
<<else>>
  <<set $player.stamina to Math.min($player.maxStamina, $player.stamina + 40)>>
  <<set $player.stress to Math.max(0, $player.stress - 10)>>
  <<set $player.hunger to Math.min(100, $player.hunger + 10)>>
  <<run addSkillXP("意志", 3)>>
  <<run advanceTime(4, 0)>>
```

- [ ] **Step 2: 为 StudyAction 添加「学识」XP**

在 StudyAction passage 中，在 `<<run advanceTime(2,0)>>` 之前添加：
```
  <<run addSkillXP("学识", 8)>>
```
修改后的 StudyAction（约第 57-59 行）：
```twee
  <<run addSkillXP("学识", 8)>>
  <<run advanceTime(2, 0)>>
```

- [ ] **Step 3: 为 JogAction 添加「运动」XP**

在 JogAction passage 的成功分支（`<<else>>` 块内约第 127-132 行）添加：
```
  <<run addSkillXP("运动", 10)>>
```
修改后：
```twee
  <<run addSkillXP("运动", 10)>>
  <<run showFeedback(["体力 +5", "健康 +3", "压力 -5", "魅力 +1", "饥饿 +8", "时间推进 1小时30分"])>>
```

在失败分支（约第 121-125 行）也添加少量 XP（学到教训）：
```
  <<run addSkillXP("运动", 2)>>
```
修改后：
```twee
  <<run addSkillXP("运动", 2)>>
  <<run showFeedback(["健康 -5", "创伤 +3", "饥饿 +8", "时间推进 1小时30分"])>>
```

- [ ] **Step 4: 为 RestAction 添加「意志」XP**

在 RestAction passage（约第 108-114 行）添加：
```
  <<run addSkillXP("意志", 2)>>
```
修改后：
```twee
<<set $player.stamina to Math.min($player.maxStamina, $player.stamina + 25)>>
<<set $player.stress to Math.max(0, $player.stress - 15)>>
<<set $player.hunger to Math.min(100, $player.hunger + 5)>>
<<run addSkillXP("意志", 2)>>
<<run advanceTime(1, 0)>>
```

- [ ] **Step 5: 为 BuyFoodAction 添加「社交」XP**

在 BuyFoodAction passage（约第 161-168 行）找到 `<<set $player.hunger` 行之前，添加：
```
  <<run addSkillXP("社交", 4)>>
```

- [ ] **Step 6: 验证 — 构建并测试技能 XP 积累**

Run: `build.bat`
打开游戏，依次执行：睡觉 → 学习 → 慢跑 → 买食物 → 休息
期望结果：每次动作后对应技能积累 XP，侧边栏（后续任务实现）或控制台可验证 `State.variables.player.skills` 的值增长。

- [ ] **Step 7: 提交**
```bash
git add src/passages/scenes.twee
git commit -m "feat: bind skill XP to existing scene actions"
```

---

### Task 1.3: 侧边栏 top-3 技能展示

**Files:**
- Modify: `src/passages/_caption.twee` — StoryCaption 中在 stat bars 下方添加技能展示

- [ ] **Step 1: 在侧边栏 stat bars 后添加 top-3 技能**

在 `_caption.twee` 末尾、`</div>`（侧边栏封闭标签）之前添加：

```twee
<<if $player.skills>>
<<set _topSkills to getTopSkills(3)>>
<<if _topSkills.length gt 0>>
<div class="sidebar-section">
  <div class="sidebar-title">擅长技能</div>
  <<for _skill range _topSkills>>
    <<set _skillPct to Math.round((_skill.value / 100) * 100)>>
    <<set _xpPct to Math.round(getSkillProgress(_skill.name) * 100)>>
    <div class="stat-bar">
      <div class="stat-bar-label"><span><<_skill.name>></span><span><<_skill.value>>/100</span></div>
      <div class="stat-bar-track"><div class="stat-bar-fill stat-skill" @style="'width: ' + _skillPct + '%;'"></div></div>
    </div>
  <</for>>
</div>
<</if>>
<</if>>
```

注意：使用 `<<_skill.name>>`（尖括号语法）而不是 `<<print _skill.name>>`，这是 SugarCube 的简写变量标记语法。

- [ ] **Step 2: 在 CSS 中添加技能条颜色**

在 `src/styles/ui.css` 中添加（可放在 stat bar 样式附近）：
```css
.stat-bar-fill.stat-skill {
  background: linear-gradient(90deg, #a78bfa, #7c3aed);
}
```

- [ ] **Step 3: 验证**

Run: `build.bat`
打开游戏，查看侧边栏底部是否显示"擅长技能"区域，其中包含 3 个技能条（当前都为 0%）。执行睡觉/学习等动作后刷新页面，技能条应增长。

- [ ] **Step 4: 提交**
```bash
git add src/passages/_caption.twee src/styles/ui.css
git commit -m "feat: display top-3 skills in sidebar"
```

---

### Task 1.4: 整体验证 Phase 1

- [ ] **Step 1: 构建并功能验证**

Run: `build.bat`
功能检查清单：
1. 新游戏开始时 `$player.skills` 包含 7 个技能，value=0, xp=0
2. 加载旧存档时自动补全 skills 字段
3. 执行学习动作后学识 XP 增长，积累到阈值后 value +1
4. 执行慢跑后运动 XP 增长
5. 执行睡觉后意志 XP 增长
6. 侧边栏显示 top-3 技能条
7. 技能提升时弹出 Toast 提示
8. 保存游戏 → 刷新 → 读取，技能数据持久化

- [ ] **Step 2: 提交 Phase 1 完成标记**
```bash
git commit --allow-empty -m "phase 1: skill system MVP complete"
```

---

## Phase 2 — LLM 集成

本阶段扩展 LLM 交互，使其能理解和驱动技能/关系变化。修改 LLM 响应处理链路，使场景/选项/NPC 对话中 LLM 返回的 JSON 可以通过 `effects` 字段传递技能经验和关系变化。

### Task 2.1: 扩展 `applyEffects()` 支持技能和关系变化

**Files:**
- Modify: `src/scripts/engine.js` — 修改 `applyEffects()` 函数

- [ ] **Step 1: 在 `applyEffects()` 中添加 `effects.skills` 和 `effects.relationship_change` 处理**

在 `applyEffects()` 函数中，在 `checkStatThresholds();` 调用之前（约第 265 行），插入以下代码块：

```javascript
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
    var npc = State.variables.npcs[npcId];
    var delta = typeof rc.delta === 'number' ? rc.delta : 0;
    if (delta !== 0) {
      npc.disposition = Math.max(-10, Math.min(10, (npc.disposition || 0) + (delta > 0 ? 1 : -1)));
      if (!npc.relationship) {
        npc.relationship = { tier: '陌生人', value: 0, history: [], lastMetDay: 1, meetCount: 1 };
      }
      npc.relationship.value = Math.max(0, Math.min(100, (npc.relationship.value || 0) + delta));
      if (typeof updateRelationshipTier === 'function') updateRelationshipTier(npc);
      msgs.push(npc.name + ' 的关系值 ' + (delta > 0 ? '+' : '') + delta);
    }
  }
}
```

- [ ] **Step 2: 验证**

Run: `build.bat`
在浏览器控制台测试：
```javascript
applyEffects({
  health: 10,
  skills: { 运动: 15, 意志: 5 },
  relationship_change: { npcId: "<已存在NPC的ID>", delta: 8 }
});
```
期望结果：技能 XP 增长、NPC 关系值变化、Toast 显示变化信息。

- [ ] **Step 3: 提交**
```bash
git add src/scripts/engine.js
git commit -m "feat: extend applyEffects for skills and relationship_change"
```

---

### Task 2.2: 修改 LLM Prompts 加入技能/关系上下文

**Files:**
- Modify: `src/scripts/llm-prompts.js` — 在 `buildSystemPrompt()` 中增加技能信息，在 `npcChatPrompt()` 中增加关系上下文

- [ ] **Step 1: 在 `buildSystemPrompt()` 中新增技能信息块**

在 `buildSystemPrompt()` 函数中，在世界事件块之后、`lines.push('==========================');` 之前添加：

```javascript
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
```

- [ ] **Step 2: 在 `npcChatPrompt()` 中新增关系上下文**

在 `npcChatPrompt()` 函数中，找到 system prompt 字符串构建完成的位置（约第 315 行，`].join('\n')` 之后），在 `messages.push({ role: 'system', content: system });` 之前插入：

```javascript
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
```

- [ ] **Step 3: 在 `sceneObjectPrompt()` 和 `optionsPrompt()` 中加入技能效果指引**

在 `sceneObjectPrompt()` 函数的 prompt 数组末尾、最后一行之前添加：
```javascript
parts.push('如果选项涉及技能运用，请在 effects.skills 中指定技能经验值。');
parts.push('支持的技能：运动、学识、社交、潜行、感知、意志、魅力');
```

在 `optionsPrompt()` 函数类似位置添加：
```javascript
parts.push('如果选项涉及技能运用，请在 effects.skills 中指定经验值。');
parts.push('例如：{"label": "奋力奔跑", "effects": {"stamina": -10, "skills": {"运动": 5}}}');
```

- [ ] **Step 4: 验证**

Run: `build.bat`
如果有 LLM 配置，检查发送给 LLM 的请求数据中包含"玩家技能"章节。在没有 LLM 时，确认游戏仍可正常运行。

- [ ] **Step 5: 提交**
```bash
git add src/scripts/llm-prompts.js
git commit -m "feat: add skills and relationship context to LLM prompts"
```

---

### Task 2.3: 确认 LLM 响应管道自动支持新 effects

**Files:**
- Read: `src/scripts/llm-macros.js` — 确认 hubscene 和选项处理自动传递新 effects
- Read: `src/scripts/llm-structured.js` — 确认 validation 不拒绝额外字段

- [ ] **Step 1: 确认 LLMStructured.validate() 不拒绝 effects 中的新字段**

检查 `llm-structured.js` 第 32-49 行的 `validate()`：只检查 `required` 字段存在且类型匹配，不会拒绝额外字段。确认无需修改。

- [ ] **Step 2: 确认 hubscene 宏的选项点击处理已自动应用新 effects**

检查 `llm-macros.js` 约第 714-727 行：选项点击事件已调用 `applyEffects(opt.effects)`，而 `applyEffects()` 已在 Task 2.1 中扩展。确认无需修改。

- [ ] **Step 3: 提交**
```bash
git commit --allow-empty -m "phase 2: LLM integration complete - effects pipeline verified"
```

---

## Phase 3 — 社交关系系统

本阶段实现完整的 NPC 社交关系系统，包括关系数据结构、关系变化驱动（LLM + 规则）、关系门槛解锁、角色页面，以及世界事件中的社交偶遇。

### Task 3.1: NPC 关系数据结构与辅助函数

**Files:**
- Modify: `src/scripts/engine.js` — 添加 `initRelationship()`, `updateRelationshipTier()`, `getRelationshipTier()`, `getRelationshipProgress()`, `decayRelationships()`
- Modify: `src/passages/_header.twee` — NPC 关系存档兼容
- Modify: `src/scripts/llm-macros.js` — 在 `<<llmnpc>>` 宏中调用 initRelationship

- [ ] **Step 1: 在 `engine.js` 中添加关系辅助函数**

在 `getSkillProgress()` 函数之后添加：

```javascript
// NPC relationship data: tiers, initialization, decay
var RELATIONSHIP_TIERS = [
  { name: '陌生人', min: 0, max: 19 },
  { name: '熟人', min: 20, max: 39 },
  { name: '朋友', min: 40, max: 59 },
  { name: '密友', min: 60, max: 79 },
  { name: '挚友', min: 80, max: 100 }
];

window.initRelationship = function (npc) {
  if (!npc) return;
  if (!npc.relationship) {
    npc.relationship = {
      tier: '陌生人',
      value: 0,
      history: [],
      lastMetDay: State.variables.time ? State.variables.time.day : 1,
      meetCount: 1
    };
  }
  // Ensure all sub-fields exist on partial data
  if (!npc.relationship.history) npc.relationship.history = [];
  if (typeof npc.relationship.value !== 'number') npc.relationship.value = 0;
  if (typeof npc.relationship.lastMetDay !== 'number') npc.relationship.lastMetDay = State.variables.time ? State.variables.time.day : 1;
  if (typeof npc.relationship.meetCount !== 'number') npc.relationship.meetCount = 1;
  updateRelationshipTier(npc);
  return npc.relationship;
};

window.updateRelationshipTier = function (npc) {
  if (!npc || !npc.relationship) return;
  var val = npc.relationship.value || 0;
  for (var i = RELATIONSHIP_TIERS.length - 1; i >= 0; i--) {
    if (val >= RELATIONSHIP_TIERS[i].min) {
      npc.relationship.tier = RELATIONSHIP_TIERS[i].name;
      return;
    }
  }
  npc.relationship.tier = '陌生人';
};

window.getRelationshipTier = function (npc) {
  if (!npc || !npc.relationship) return '陌生人';
  return npc.relationship.tier;
};

window.getRelationshipProgress = function (npc) {
  if (!npc || !npc.relationship) return 0;
  var val = npc.relationship.value || 0;
  var currentMin = 0, nextMax = 20;
  for (var i = 0; i < RELATIONSHIP_TIERS.length; i++) {
    if (val >= RELATIONSHIP_TIERS[i].min && val <= RELATIONSHIP_TIERS[i].max) {
      currentMin = RELATIONSHIP_TIERS[i].min;
      nextMax = (i < RELATIONSHIP_TIERS.length - 1) ? RELATIONSHIP_TIERS[i + 1].min : RELATIONSHIP_TIERS[i].max;
      break;
    }
  }
  var range = nextMax - currentMin;
  return range > 0 ? (val - currentMin) / range : 1;
};

// Relationship decay: called on day rollover
window.decayRelationships = function () {
  var npcs = State.variables.npcs;
  if (!npcs) return;
  var currentDay = State.variables.time ? State.variables.time.day : 1;
  for (var id in npcs) {
    if (!npcs.hasOwnProperty(id)) continue;
    var npc = npcs[id];
    if (!npc.relationship) continue;
    var daysSinceMet = currentDay - (npc.relationship.lastMetDay || currentDay);
    if (daysSinceMet > 3) {
      var decay = Math.floor(daysSinceMet / 3);
      npc.relationship.value = Math.max(0, (npc.relationship.value || 0) - decay);
      updateRelationshipTier(npc);
    }
  }
};
```

- [ ] **Step 2: 在 `advanceTime()` 中调用 `decayRelationships()`**

在 `engine.js` 的 `advanceTime()` 函数中，找到 day rollover 处理块（约第 396-401 行，`// Day rollover` 注释处），在天气重置之后添加：
```javascript
        if (typeof decayRelationships === 'function') decayRelationships();
```

- [ ] **Step 3: 在 `_header.twee` 中添加 NPC 关系存档兼容**

在 `_header.twee` 的 PassageHeader 脚本中，与 skills 兼容代码并列添加：
```javascript
// NPC relationship compat: ensure all NPCs have relationship data.
if (State.variables.npcs) {
  for (var nid in State.variables.npcs) {
    if (State.variables.npcs.hasOwnProperty(nid)) {
      if (typeof initRelationship === 'function') initRelationship(State.variables.npcs[nid]);
    }
  }
}
```

- [ ] **Step 4: 在 `<<llmnpc>>` 宏中初始化关系**

在 `llm-macros.js` 的 `<<llmnpc>>` 宏中，在设置 `npc.dialogue` 和 `npc.disposition` 之后、`fireHook` 之前添加：
```javascript
        if (typeof initRelationship === 'function') initRelationship(npc);
```

- [ ] **Step 5: 验证**

Run: `build.bat`
1. 生成 NPC → 确认 relationship 字段存在且正确初始化
2. 执行 `applyEffects({ relationship_change: { npcId: "...", delta: 20 } })` → 关系变化
3. 推进多天 → 关系衰减生效

- [ ] **Step 6: 提交**
```bash
git add src/scripts/engine.js src/passages/_header.twee src/scripts/llm-macros.js
git commit -m "feat: NPC relationship data structure with init, tier, decay"
```

---

### Task 3.2: NPC 对话界面显示关系信息

**Files:**
- Modify: `src/passages/npc-chat.twee` — 在对话头部添加关系标签和进度条
- Modify: `src/styles/ui.css` — 添加关系样式

- [ ] **Step 1: 在 NPCChat 开头添加关系展示**

在 `npc-chat.twee` 的 `:: NPCChat` passage 中，`你正在和...` 文本之后、`<<npcchat>>` 宏之前添加：

```twee
<<if _npc.relationship>>
  <<set _relTier to getRelationshipTier(_npc)>>
  <<set _relValue to _npc.relationship.value || 0>>
  <<set _relProgress to Math.round(getRelationshipProgress(_npc) * 100)>>
  <div class="npc-relationship-badge">
    <span class="npc-rel-tier">[<<print _relTier>>]</span>
    <div class="stat-bar" style="margin: 4px 0;">
      <div class="stat-bar-label"><span>关系</span><span><<print _relValue>>/100</span></div>
      <div class="stat-bar-track"><div class="stat-bar-fill stat-relationship" @style="'width: ' + _relProgress + '%;'"></div></div>
    </div>
  </div>
<</if>>
```

- [ ] **Step 2: 添加 CSS 样式**

在 `src/styles/ui.css` 中添加：
```css
.stat-bar-fill.stat-relationship {
  background: linear-gradient(90deg, #f59e0b, #ef4444);
}
.npc-relationship-badge {
  margin: 8px 0;
  padding: 8px;
  background: var(--bg-secondary, #1e1e2e);
  border-radius: 6px;
}
.npc-rel-tier {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.85em;
  background: var(--accent, #7c3aed);
  color: white;
}
```

- [ ] **Step 3: 验证**

Run: `build.bat`
生成 NPC → 对话 → 确认显示"关系：陌生人"标签及进度条。

- [ ] **Step 4: 提交**
```bash
git add src/passages/npc-chat.twee src/styles/ui.css
git commit -m "feat: show NPC relationship info in chat header"
```

---

### Task 3.3: 角色页面（技能 + 关系总览）

**Files:**
- Create: `src/passages/character.twee` — 角色页面
- Modify: `src/passages/_menu.twee` — 添加「角色」链接
- Modify: `src/styles/ui.css` — 角色页面样式

- [ ] **Step 1: 创建 `src/passages/character.twee`**

```twee
:: Character
!角色

<h2>技能</h2>
<div class="character-section">
<<for _sk in [&quot;运动&quot;, &quot;学识&quot;, &quot;社交&quot;, &quot;潜行&quot;, &quot;感知&quot;, &quot;意志&quot;, &quot;魅力&quot;]>>
  <<set _sv to $player.skills[_sk]>>
  <<set _pct to Math.round((_sv.value / 100) * 100)>>
  <<set _xpPct to Math.round(getSkillProgress(_sk) * 100)>>
  <div class="skill-detail-row">
    <div class="skill-detail-header">
      <strong><<_sk>></strong>
      <span><<_sv.value>>/100（经验 <_sv.xp>）</span>
    </div>
    <div class="stat-bar">
      <div class="stat-bar-track"><div class="stat-bar-fill stat-skill" @style="'width: ' + _pct + '%;'"></div></div>
    </div>
    <div class="skill-xp-bar">
      <div class="stat-bar-track"><div class="stat-bar-fill stat-xp" @style="'width: ' + _xpPct + '%;'"></div></div>
    </div>
  </div>
<</for>>
</div>

<h2>社交关系</h2>
<div class="character-section">
<<set _hasRelations to false>>
<<for _nid in Object.keys($npcs)>>
  <<set _n to $npcs[_nid]>>
  <<if _n.relationship && _n.relationship.value gt 0>>
    <<set _hasRelations to true>>
    <<set _relProgress to Math.round(getRelationshipProgress(_n) * 100)>>
    <div class="npc-rel-card">
      <div class="npc-rel-header">
        <strong><<_n.name>></strong> — <em><<_n.role>></em>
        <span class="npc-rel-tier-badge">[<<print _n.relationship.tier>>]</span>
      </div>
      <div class="stat-bar" style="margin: 4px 0;">
        <div class="stat-bar-label"><span>关系值</span><span><<_n.relationship.value>>/100</span></div>
        <div class="stat-bar-track"><div class="stat-bar-fill stat-relationship" @style="'width: ' + _relProgress + '%;'"></div></div>
      </div>
      <div class="npc-rel-meta">
        上次见面：第 <<print _n.relationship.lastMetDay>> 天 · 交谈 <<print _n.relationship.meetCount>> 次
      </div>
    </div>
  <</if>>
<</for>>
<<if not _hasRelations>>
  <p class="empty-state">你还没有和任何人建立关系。去城里走走吧。</p>
<</if>>
</div>

<h2>游戏统计</h2>
<div class="character-section">
  <div class="stat-row">存活天数：<<print $time.day>></div>
  <div class="stat-row">金钱：<<print &quot;$&quot; + $player.money>></div>
  <div class="stat-row">声望：<<print $player.reputation>></div>
  <div class="stat-row">背包物品：<<print Object.keys($player.inventory).length>> 种</div>
  <div class="stat-row">已结识 NPC：<<print Object.keys($npcs).length>> 人</div>
  <div class="stat-row">游戏难度：<<print $game.difficulty>></div>
</div>

<<action &quot;返回&quot; $location &quot;回到原处&quot;>>
```

- [ ] **Step 2: 在 `_menu.twee` 中添加角色链接**

在 `[[任务日志|QuestLog]]` 之后添加 `[[角色|Character]]`：
```
:: StoryMenu
[[背包|Inventory]]
[[角色|Character]]
[[任务日志|QuestLog]]
```

- [ ] **Step 3: 添加角色页面 CSS**

在 `src/styles/ui.css` 末尾添加：
```css
.character-section {
  margin: 12px 0;
}
.skill-detail-row, .npc-rel-card {
  margin: 8px 0;
  padding: 8px;
  background: var(--bg-secondary, #1e1e2e);
  border-radius: 6px;
}
.skill-detail-header, .npc-rel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.skill-xp-bar {
  margin-top: 2px;
}
.stat-bar-fill.stat-xp {
  background: linear-gradient(90deg, #6ee7b7, #10b981);
  height: 4px;
}
.npc-rel-tier-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.8em;
  background: var(--accent, #7c3aed);
  color: white;
  margin: 0 4px;
}
.npc-rel-meta {
  font-size: 0.85em;
  color: var(--text-secondary, #888);
  margin-top: 4px;
}
.stat-row {
  padding: 4px 0;
  border-bottom: 1px solid var(--border-color, #333);
}
.empty-state {
  color: var(--text-secondary, #888);
  font-style: italic;
}
```

- [ ] **Step 4: 验证**

Run: `build.bat`
1. 侧边栏出现「角色」链接 → 点击进入
2. 页面显示 7 个技能条（均含 value 和经验进度条）
3. 社交关系区显示已结识 NPC
4. 游戏统计区显示天数、金钱等

- [ ] **Step 5: 提交**
```bash
git add src/passages/character.twee src/passages/_menu.twee src/styles/ui.css
git commit -m "feat: add Character page with skills, relationships, and stats"
```

---

### Task 3.4: 社交世界事件

**Files:**
- Modify: `src/scripts/world-events.js` — 添加社交偶遇事件类型

- [ ] **Step 1: 添加社交事件概率常量**

在 `world-events.js` 文件顶部常量区域（约第 5 行）添加：
```javascript
var SOCIAL_EVENT_CHANCE = 0.15;
```

- [ ] **Step 2: 在 `maybeGenerateEvent()` 中添加社交事件分支**

在 ambient 事件生成代码之后（约第 18 行 `LLMEngine.generate(...)` 之后），或在该函数的 `if (Math.random() > chance) return;` 路径之后，添加一个独立的社会事件触发逻辑：

在 `maybeGenerateEvent` 函数末尾（`inFlight = true;` 和 `LLMEngine.generate` 之后、`.catch` 之前）插入：

```javascript
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
```

- [ ] **Step 3: 验证**

Run: `build.bat`
在 LLM 可用时，生 NPC 并提升关系到 10+，推进时间，观察是否有社交偶遇事件触发。

- [ ] **Step 4: 提交**
```bash
git add src/scripts/world-events.js
git commit -m "feat: social encounter events for NPC relationships"
```

---

## Phase 4 — 打磨与扩展

本阶段为技能系统增加门槛解锁内容，优化 LLM prompts 的一致性，并完善 LLM 离线场景的 fallback。

### Task 4.1: 技能门槛解锁新动作

**Files:**
- Modify: `src/passages/scenes.twee` — 添加运动 >= 20 的「快速逃离」、感知 >= 15 的「观察自然」动作

- [ ] **Step 1: 在 Street 添加「快速逃离」选项（运动 >= 20）**

在 `scenes.twee` 的 `:: Street` passage 中，在导航动作区域添加：
```twee
<<if getSkillLevel("运动") gte 20>>
  <<action "快速逃离" "FastEscape" "利用敏捷身法快速离开险境">>
<</if>>
```

新增 passage：
```twee
:: FastEscape
!快速逃离

你利用敏捷的身法快速穿过人群，甩掉了任何可能的跟踪。

<<set $player.stamina to Math.max(0, $player.stamina - 15)>>
<<run addSkillXP("运动", 5)>>
<<run advanceTime(0, 15)>>
<<run showFeedback(["体力 -15", "运动 +5", "时间推进 15分钟"])>>

<<action "停下脚步" "Street">>
```

- [ ] **Step 2: 在 Park 添加「观察自然」选项（感知 >= 15）**

在 `scenes.twee` 的 `:: Park` passage 中，在动作区域添加：
```twee
<<if getSkillLevel("感知") gte 15>>
  <<action "观察自然" "ObserveNature" "训练你的感知能力">>
<</if>>
```

新增 passage：
```twee
:: ObserveNature
!观察自然

你静下心来观察周围的细节——树叶的沙沙声、远处的流水。世界在你眼前展开。

<<set $player.stress to Math.max(0, $player.stress - 8)>>
<<set $player.control to Math.min(100, $player.control + 3)>>
<<run addSkillXP("感知", 8)>>
<<run advanceTime(0, 30)>>
<<run showFeedback(["压力 -8", "自控 +3", "感知 +8", "时间推进 30分钟"])>>

<<action "离开" "Park">>
```

- [ ] **Step 3: 验证**

Run: `build.bat`
1. 新游戏：运动=0 → Street 无「快速逃离」
2. `addSkillXP("运动", 500)` → 运动=45 → Street 出现「快速逃离」
3. 执行快速逃离 → 运动 XP 再次增长

- [ ] **Step 4: 提交**
```bash
git add src/passages/scenes.twee
git commit -m "feat: skill threshold unlocks (FastEscape, ObserveNature)"
```

---

### Task 4.2: 离线游玩验证

**Files:**
- No code changes — 仅验证

- [ ] **Step 1: 无 LLM 环境下完整游玩测试**

关闭 LLM（或在 `$llmConfig.enabled = false` 下）进行以下测试：
1. 新游戏开始 → 起床 → 学习 → 去街道 → 公园慢跑 → 商店买食物 → 回家睡觉
2. 所有动作正常执行，技能 XP 正常积累
3. 侧边栏显示技能增长
4. 角色页面正常展示
5. 保存/读取后技能数据持久化

- [ ] **Step 2: 最终提交**
```bash
git commit --allow-empty -m "phase 4: polish complete - skill unlocks and offline verification"
```

---

## 完整受影响文件清单

| 文件 | 操作 | 阶段 |
|------|------|------|
| `src/passages/_init.twee` | 修改 | 1 |
| `src/passages/_header.twee` | 修改 | 1, 3 |
| `src/passages/_caption.twee` | 修改 | 1 |
| `src/passages/_menu.twee` | 修改 | 3 |
| `src/passages/scenes.twee` | 修改 | 1, 4 |
| `src/passages/npc-chat.twee` | 修改 | 3 |
| `src/passages/character.twee` | 新建 | 3 |
| `src/scripts/engine.js` | 修改 | 1, 2, 3 |
| `src/scripts/llm-prompts.js` | 修改 | 2 |
| `src/scripts/llm-macros.js` | 修改 | 3 |
| `src/scripts/world-events.js` | 修改 | 3 |
| `src/styles/ui.css` | 修改 | 1, 3 |

## 验证清单（全部完成后）

1. ✅ 构建成功（`build.bat` 无错误退出）
2. ✅ 新游戏 7 项技能初始 value=0, xp=0
3. ✅ 动作绑定 XP 且累积后技能升级
4. ✅ 技能提升时弹出 Toast 提示
5. ✅ 侧边栏显示 top-3 技能
6. ✅ 角色页面显示完整技能 + 关系 + 统计
7. ✅ NPC 自动初始化 relationship
8. ✅ NPC 对话显示关系标签和进度条
9. ✅ LLM 场景/选项/NPC 对话可驱动技能和关系变化
10. ✅ 无 LLM 时仍可完整游玩
11. ✅ 存档/读取后所有新数据持久化
12. ✅ 旧存档加载时自动补全新字段
