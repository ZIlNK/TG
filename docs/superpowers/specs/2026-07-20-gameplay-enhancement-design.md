# 游戏性增强设计方案：技能成长与社交关系系统

## 概述

在现有 Twine + SugarCube-2 文字游戏原型基础上，增加以角色成长为核心的玩法系统。核心目标是让玩家通过使用技能获得成长，并通过与 NPC 建立关系获得更丰富的游戏体验。

## 设计原则

1. **LLM 驱动核心，规则保底**：核心逻辑（技能提升判定、关系变化）由 LLM 主导，硬编码机制作为 LLM 不可用时的保底
2. **渐进增强**：所有新系统在现有架构上叠加，不破坏已有功能
3. **分阶段可上线**：每个阶段完成都可独立运行和测试

## 数据模型变更

### `$player.skills`（新增）

```javascript
skills: {
  运动: { value: 0, xp: 0 },
  学识: { value: 0, xp: 0 },
  社交: { value: 0, xp: 0 },
  潜行: { value: 0, xp: 0 },
  感知: { value: 0, xp: 0 },
  意志: { value: 0, xp: 0 },
  魅力: { value: 0, xp: 0 },
}
```

- `value` 范围 0-100，初始 0
- `xp` 积累达到阈值（`(value+1) * 10`）后 value 提升 1 点
- 收益递减：技能越高，升级所需 XP 越多

### `$npcs[id].relationship`（扩展现有 NPC）

```javascript
relationship: {
  tier: "陌生人",   // 陌生人 → 熟人 → 朋友 → 密友 → 挚友
  value: 0,         // 0-100 隐藏数值
  history: [
    { action: "初次见面", location: "Street", delta: +5, tier: "陌生人" }
  ],
  lastMetDay: 1,
  meetCount: 1
}
```

关系等级与解锁内容：

| 等级 | value 门槛 | 解锁能力 |
|------|-----------|---------|
| 陌生人 | 0-19 | 基础对话 |
| 熟人 | 20-39 | 可请求任务、NPC 主动打招呼 |
| 朋友 | 40-59 | 可赠送礼物、邀请同行、打听消息 |
| 密友 | 60-79 | 特殊任务、NPC 主动帮助 |
| 挚友 | 80+ | 永久增益效果 |

## 核心机制

### 技能提升

**双轨判定**：
1. **硬编码保底**：每次执行相关动作时调用 `addSkillXP("技能名", xp)`，如慢跑自动增加「运动」经验
2. **LLM 增强**：LLM 在场景/对话叙事中可以额外判定技能提升，通过扩展的 `effects.skills` 字段返回

**门槛解锁**：
- 技能值达到特定阈值时解锁新动作和场景选项
- 示例：运动 20+ 解锁「快跑」、社交 30+ 解锁「说服」、学识 40+ 解锁「图书馆」

### 社交关系变化

**LLM 主导**：NPC 对话结束时，LLM 在回复末尾附加关系变化元数据

**行动影响**：玩家选择中带 `npcDisposition` 或 `relationship` 效果时直接触发

**冷热机制**：太久不见面（超过 3 天）关系自然衰减 -1/天；频繁互动有加成

### 扩展的 effects 系统

在现有 `applyEffects()` 基础上增加对以下对象的支持：

```json
{
  "skills": { "运动": 3, "意志": 1 },
  "relationship_change": { "npcId": "...", "delta": 5, "reason": "聊天愉快" }
}
```

## UI 变更

1. **侧边栏**：stat bars 下方新增 top-3 技能展示条
2. **角色页面**（新建 `Character` passage）：完整技能列表、关系一览、游戏统计
3. **NPC 对话**：关系标签 + 进度条
4. **Toast 增强**：技能提升醒目提示

## LLM Prompt 变更

所有 Prompt 中新增技能和关系上下文：

```
=== 玩家技能 ===
运动：15/100（练习中）
学识：5/100（生疏）

=== 与 [NPC名] 的关系 ===
当前关系：熟人（32/100）
上次见面：第 3 天
最近互动：帮忙找物品（关系 +8）
```

## 实施阶段

### 阶段 1 — 基础框架（MVP）
- `$player.skills` 数据结构 + 初始化 + 存档兼容
- `addSkillXP()` / `checkSkillThreshold()` 函数
- 现有动作绑定保底 XP
- 侧边栏 top-3 技能展示
- 受影响文件：`_init.twee`、`_header.twee`、`_caption.twee`、`engine.js`、`scenes.twee`

### 阶段 2 — LLM 集成
- 扩展 `applyEffects()` 支持 skills 和 relationship
- 修改所有 LLM Prompts 加入技能/关系上下文
- 扩展 JSON schema 校验
- 受影响文件：`engine.js`、`llm-prompts.js`、`llm-structured.js`、`llm-macros.js`

### 阶段 3 — 社交系统
- NPC relationship 完整实现
- 关系门槛解锁
- 角色页面（`Character` passage）
- 世界事件社交扩展
- 受影响文件：`engine.js`、`npc-chat.twee`、`_menu.twee`、`world-events.js`、`scenes.twee`

### 阶段 4 — 打磨
- 更多技能门槛和解锁内容
- Prompt 优化
- LLM 离线 fallback 完善
- 测试与调平

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| LLM 判定技能提升不一致 | 硬编码保底 XP 确保基础成长 |
| LLM 离线时社交系统薄弱 | 关系值仍然积累，只是速度减慢 |
| 存档兼容性 | `_header.twee` 中已有兼容性补丁模式，新增字段用默认值填充 |
| 技能过多导致 UI 拥挤 | 侧边栏只显示 top-3，完整列表在角色页面 |

## 验证方式

1. 构建游戏（`build.bat`），在浏览器中运行
2. 确认技能系统：执行动作 → 查看侧边栏技能条是否增长
3. 确认社交系统：与 NPC 对话 → 查看关系变化
4. 保存游戏 → 刷新 → 读取 → 确认状态持久化
5. 断开 LLM → 确认基础系统仍然可用
