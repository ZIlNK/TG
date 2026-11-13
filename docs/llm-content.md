# LLM-Driven Dynamic Content Generation

> 旧版网页工程（`src/`，2026-09-29 冻结）的 LLM 内容生成说明。主线插件的生成流程见 [迁移说明](deepseek-harness-migration.md)。

This document describes how the game uses a Large Language Model (LLM) to generate playable content: scenes, choices, NPCs, and quests.

## Overview

The content-generation macros produce **structured JSON objects** that are stored in `State.variables`. A shared `DynamicScene` passage then renders these objects as playable scenes with action links.

Generated content is automatically saved and loaded with the existing save system.

动态场景的标题、正文和位置等展示文本使用 `<<llmtext expression>>` 输出为 DOM 文本节点，不交给 Wikifier 或 HTML 解析器执行。正文保留换行，并将模型输出的 `<br>` 标签转换为换行；其他 HTML、SugarCube 宏和链接标记均作为普通文字显示。该规则同样适用于存档中已有的生成文本，仅渲染或重新生成选项不会结算；普通行动需在玩家选择后经过结果回合校验并提交。

## Architecture

```
Macro call (<<llmscene2>> / <<hubscene>> / <<llmnpc>>)
    ↓
PromptBuilder.sceneObjectPrompt() / optionsPrompt() / npcPrompt()
    ↓
LLMEngine request (scene / hub options declare register_scene_options)
    ↓
SceneOptionTools atomic validation + SceneOptions normalization (NPC keeps its existing parser)
    ↓
Validated JSON object (invalid responses report failure, not fake success)
    ↓
State.variables.generatedScenes / npcs / quests
    ↓
DynamicScene / inline options / NPCChat renders the content
```

## State Variables

| Variable | Purpose |
|----------|---------|
| `$generatedScenes` | Map of scene id → generated scene object |
| `$dynamicSceneId` | Id of the currently active generated scene |
| `$npcs` | Map of NPC id → generated NPC object |
| `$activeNPCId` | Id of the NPC currently being interacted with |
| `$dialogueReturn` | Passage and dynamic-scene id restored when a tool-started dialogue ends |
| `$quests` | Map of quest id → generated quest object |
| `$activeQuestId` | Id of the currently highlighted quest |
| `$worldMemory.events` | Persistent world events included in prompts |
| `$llmGatewayTarget` | Internal routing target for `llm:...` action links |

## Macros

### `<<llmscene2 "Location" "Mood" "Description">>`

Generates a complete playable scene and navigates to it.

Example:
```twee
:: StrangeFog
!The Strange Fog

<<llmscene2 "Street" "eerie" "A mysterious fog has rolled into the city streets.">>
```

Generated scene tool arguments (`register_scene_options`):
```json
{
  "id": "scene-street-fog-1718900000000",
  "title": "Fog-Shrouded Street",
  "location": "Street",
  "mood": "eerie",
  "text": "Mist coils around the lampposts...",
  "options": [
    { "label": "观察雾气", "action": { "type": "scene_action", "intent": "观察雾气" } },
    { "label": "查看任务日志", "target": "QuestLog" }
  ]
}
```

### `<<hubscene "Location" "Mood" "anchorText" [optionCount]>>`

Hub composition macro used by the handwritten hub scenes (Bedroom / Street / Park / Shop). It renders three parts in one shot:

1. LLM narration for the location (via `LLMEngine.generate`; the current backend returns a complete response rather than a token stream).
2. 上下文选项通过 `register_scene_options({options:[...]})` 提交，经整批参数校验与 `SceneOptions` 规范化后渲染为可点击入口；新生成选项不携带 `effects`，普通行动的实际结果由 `SceneActions` 校验后提交。
3. Fixed entries: “探索周围” (routes through `LLMGateway`) and “与附近的人交谈” (`MeetNPC`).

Example:
```twee
:: Bedroom
!卧室

<<hubscene "Bedroom" "calm" "不大但整洁的卧室，靠墙一张床">>
```

（已移除的 `<<llmoptions>>` 宏的功能已并入 `<<hubscene>>` 的第二部分。）

### `<<llmnpc "Name" "Role" "Location">>`

Generates an NPC and stores it in `$npcs`.

Example:
```twee
:: MeetSomeone
!A New Face

<<llmnpc "" "mysterious stranger" "Street">>
```

Generated NPC JSON schema:
```json
{
  "id": "npc-mysterious-stranger-1718900000000",
  "name": "Silas",
  "location": "Street",
  "role": "mysterious stranger",
  "traits": ["quiet", "observant"],
  "memory": "Silas has been watching the fog for three nights.",
  "disposition": 0,
  "dialogue": []
}
```

### `<<llmquest "GiverNpcId" "Theme">>`

显示“询问是否需要帮忙”按钮。只有玩家点击后才进入 NPC 自主决策队列；模型可以调用 `issue_quest` 暂存请求，完整答复提交后展示卡片，玩家接受后才创建任务。渲染本宏不会调用模型或入队。

Example:
```twee
:: NewQuest
!A Request

<<llmquest $activeNPCId "a missing person">>
```

Quest objectives are stored as stable, machine-readable records rather than array-index flags. Each objective carries `id`, `type`, `actionId`, allowed `locations`/`areas`, and numeric `current`/`required` progress. `issue_quest` uses the same format and also declares a `turnIn` channel (`npc`, `location`, or `automatic`). The acceptance card shows the involved places before the player accepts.

Only objectives allowed at the player's current `{ locationId, areaId }` are composed into scene and option prompts. A generated task option must echo the supplied descriptor exactly:

```json
{
  "label": "帮老陈擦桌子",
  "target": "DynamicScene",
  "questAction": {
    "questId": "help-chen",
    "objectiveId": "clean-tables",
    "actionId": "help-chen:clean-tables",
    "amount": 1
  }
}
```

`TaskEngine` validates the active task, objective, prerequisites, action ID, current place, and amount before updating progress. Required objectives move a task from `active` to `ready_to_turn_in`; 固定奖励在交付成功时仅结算一次；`npc_discretionary` 不结算固定奖励，改为记录交付事实并请求 NPC 自主回应；`fixed_plus_npc` 支持两条互相独立的回报记录。 Authored non-event `visit` objectives may still progress after real movement. Model-created event tasks do not: their options enter `QuestEvent`, and neither movement nor legacy `effects.questObjective` can skip the encounter. Legacy string objectives remain supported through migration.

### `<<npcchat "npcId">>`

Opens a chat interface with a generated NPC. The LLM roleplays using the NPC's traits and memory. Dialogue history is stored **per-NPC** in `npc.dialogue`, completely separate from general chat and scene contexts.

## Dialogue Tool

`PromptBuilder.dialogueTool()` exposes the real `start_dialogue` function tool to scene generation. Its required arguments are:

```json
{ "npcName": "摊主", "openingLine": "早啊，要来份刚出锅的吗？" }
```

Model-triggered calls show a confirmation dialog. Accepting reuses a same-name NPC (preferring the current location) or creates a temporary passerby, stores `openingLine` as the first assistant message, and enters `NPCChat`. Declining returns the tool result to the model and continues normal scene generation without exposing the tool again.

Deterministic game code may call `DialogueTool.invoke(args, options)`. Generated options use the same executor through a persisted descriptor:

```json
{
  "label": "和摊主搭话",
  "tool": {
    "name": "start_dialogue",
    "arguments": { "npcName": "摊主", "openingLine": "想吃点什么？" }
  }
}
```

For an explicit player-selected option, `confirm: false` avoids a second confirmation. 新生成的对话选项不附带预结算 `effects`；旧效果仅保留原有点击时兼容处理。 Ending a tool-started conversation restores the originating passage and dynamic-scene id; ordinary `MeetNPC` conversations retain the location fallback.

## Movement Tool

`RegionSystem` stores registered large regions, their child areas, aliases, default entry areas, and allowed cross-region connections. Player position is persisted as `{ locationId, areaId }`; legacy `$location` remains synchronized with `locationId`.

Generated options that move the player use a `move_player` descriptor instead of a passage `target`:

```json
{
  "label": "走到早餐摊",
  "tool": {
    "name": "move_player",
    "arguments": { "locationId": "Street", "areaId": "food_stall" }
  }
}
```

The option prompt lists the current large region's known child areas and connected large regions. Existing IDs are preferred. A model may propose a new child area with `proposedArea`, but `MoveTool` rechecks names and aliases before registering it, limits dynamic areas per large region, and registers it only after the player selects the option. Cross-region movement cannot create a new large region or a new destination child area.

`PromptBuilder.movementTool()` exposes the matching function schema for integrations that need a real function definition. Deterministic movement uses `MoveTool.invoke(args, options)` or the `<<moveaction>>` macro. Non-world UI navigation continues to use passage `target`, and old generated options remain compatible.

## Context Separation

To prevent scene-generation prompts from being polluted by chat history (and vice versa), all history entries are tagged with a `channel`:

| Channel | Used By | Storage |
|---------|---------|---------|
| `chat` | （预留，原 `<<llmchat>>` 已移除） | `$llmHistory` entries with `channel: 'chat'` |
| `scene` | `<<hubscene>>`, `<<llmscene2>>` | `$llmHistory` entries with `channel: 'scene'` |
| per-NPC | `<<npcchat>>` | `npc.dialogue` array on each NPC object |

`PromptBuilder.getHistory(channel, limit)` filters by channel, so prompts only see the relevant context.

## Dynamic Passage Simulation

SugarCube-2 cannot create passages at runtime. Generated scenes are rendered by a single `DynamicScene` passage that reads `$generatedScenes[$dynamicSceneId]`. 旧存档中的 `target: "llm:generate:something"` 仍通过 `LLMGateway` 兼容路由；新生成的观察、购买等普通行动使用 `action`，不要以虚构 target 或空对话代替。

新生成选项不声明 `effects`。旧选项的兼容效果仍只允许在实际点击入口中处理，不能在渲染时执行；普通行动则必须完成下述暂存、校验与提交流程。仅展示场景不改变玩家属性、背包、时间、任务或关系。

## SceneOptions 与普通行动结算

### 三种互斥入口

`SceneOptions` 统一处理生成选项：每项必须有非空 `label`，且 `action`、`tool`、`target` 必须且只能选择一个。`tooltip` 可选；无关字段省略，不用空对象凑齐 schema。

- `action`：普通观察、休息、购买等尝试，使用 `{ "type": "scene_action", "intent": "观察摊位" }`。只描述准备尝试的意图，不提前宣布行动完成。
- `tool`：对话沿用 `start_dialogue`，移动沿用 `move_player`；各自只携带该工具需要的 arguments，不混填 NPC 和移动字段。
- `target`：明确已知、与世界移动无关的页面导航兼容入口，例如任务日志；不是普通行动或移动的替代品。

新生成选项不添加 `effects`。没有明确任务时不带 `questAction`；任务入口仍需原样携带上下文中有效的 `questAction`，并保留有效的 tool 或明确已知的页面 target 入口。`questAction` **不能与 `action.type: "scene_action"` 配对**，混用会被拒绝；任务选项进入任务现场，不能借普通行动结算任务进度。新注册选项采用整批校验：任一参数无效则整批不注册，并将具体错误返回模型修正一次；旧存档和 hook 后的兼容规范化仍会过滤无效项并保留合法项。修正和拒绝原因进入诊断报告，不反向改写模型原始回复。

### SceneActions 与购买边界

普通行动由 `SceneActions` 进入结果回合，通过 `resolve_scene_action` 提交结果正文、后续选项及允许范围内的效果。工具先校验并暂存，`STAGED` 不代表已经生效；完整回合成功且操作仍属于当前页面、存档、地点与行动时，再次校验后才提交真实结果。取消、断线、无效参数、工具未调用或过期操作不以默认成功兜底。普通行动没有 NPC 发奖、任务交付或推进任务的权限。

`SceneActions` 的工具循环请求使用 `maxTokens: 4096`（最多 4 轮、6 次工具调用）。生成后续选项时调用 `PromptBuilder.optionsPrompt(context, count, { toolResult: true })`：可选第三参数 `outputMode.toolResult` 将“只返回数组”切换为工具结果模式，要求通过 `resolve_scene_action` 提交 `description`、`options`、`effects`，收到 STAGED 后以非空中文确认结束，避免数组输出指令与工具协议冲突。这里的 `effects` 属于受校验的结果参数，不是选项字段；未启用该模式的独立选项请求仍只返回数组。

首批商品是 `src/scripts/scene-actions.js` 中程序维护的消费型商品目录，购买成功后立即食用。目录按当前位置等程序条件提供；`SceneActions.catalogPrompt()` 为场景及选项 prompt 提供可购商品。购买结构为：

```json
{
  "label": "购买早餐",
  "action": {
    "type": "scene_action",
    "intent": "购买早餐",
    "purchase": { "productId": "breakfast-pancake" }
  }
}
```

上述示例仅在当前位置目录实际包含该商品时有效。价格、扣款和消费效果由程序目录决定，程序在提交时复核商品与余额，不接受模型虚构价格、收益或商品。没有匹配商品时，只能生成不带 `purchase` 的纯叙事尝试，不承诺购买成功。当前**未实现任意商品交易**，也不支持模型自行创建商品、任意背包物品或自由议价结算。

### 失败重试与调试证据

动态场景、hub 选项和手动选项重试使用 `register_scene_options`，保留每轮真实 `requestId`，将校验、存储和渲染事件关联到请求。参数无效（包括错误的工具名称、畸形 arguments、越权 effects 或无效地点/NPC）会通过 `role: tool` 返回具体路径与原因，最多追加一次修正请求；第二次仍失败则整批不注册。不调用注册工具而仅返回正文 JSON、响应截断或网络失败直接显示失败，不占用参数修正回合。程序补充的任务入口不替换合法模型选项，也不伪装原请求成功。

- 选项处理失败时展示错误并允许重新生成行动选项；这只更新可执行入口，不执行任何选项，不重复结算已经提交的行动。
- 普通行动结果回合失败时可以重试；未提交的草稿不扣款、不发放收益。已完成行动复用已提交结果，不因重试或再次查看结果而重复结算。
- 调试面板保留原有请求、tool 参数、执行事件和模型回复，在独立“选项处理摘要”中展示 `scene-options-normalized`、`scene-options-registration-checked`、`scene-options-registration-failed`、`scene-options-stored`、`scene-options-rendered`。报告中的 `generated` / `kept` / `rejected` 分别表示生成、保留和拒绝数量，`entries` 中的 `reason` / `corrections` 展示逐项原因与修正；渲染事件展示实际数量和标签。日志未提供的计数显示为“—”，不推测为零。
- `STAGED` 对 NPC、任务事件与普通行动都只表示暂存；真实结算看对应 `committed` / `outcome` 记录。普通行动直接读取 `entry.events` 中的 `scene-action-committed` 与 `scene-action-outcome` 日志，无额外 `eventOutcome` 字段；既有 `eventOutcome` 展示仅用于任务事件，不作为普通行动的提交来源。选项被保留、存储或渲染均不等于购买或任务已完成。原始回复与原始事件仍可单独查看。

## Mod API Hooks

| Hook | Fired | Data |
|------|-------|------|
| `llmPromptReady` | Before sending to LLM | `{ prompt, type, ... }` |
| `llmResponseReady` | After receiving LLM response | `{ scene / options / npc / quest, type }` |

Example mod:
```javascript
ModAPI.on('llmResponseReady', function (data) {
  if (data.type === 'scene2') {
    data.scene.text += '\n\n[Mod: A crow watches from above.]';
  }
});
```

## World Memory

Persistent world events are stored in `$worldMemory.events` and included in all system prompts. Use `PromptBuilder.addWorldEvent(text, category)` from JS or a custom macro to record significant events so the LLM remembers them.

Events are trimmed to the last 20 before saving.

## Fallbacks

场景、hub 选项与普通行动不再用默认场景、默认选项或默认成功结果掩盖失败。场景结构无效时显示生成失败；hub 选项畸形或截断时保留诊断并提供重试；普通行动只提交已校验的工具结果。选项重试与结算相互独立，不重复执行已完成行动。

`LLMStructured` 仍保留 `fallbackScene()`、`fallbackOptions(count)`、`fallbackNPC()`、`fallbackQuest()` 等兼容辅助函数；不能据此推断当前场景或选项流程会自动成功。NPC 等其他调用方的既有 fallback 行为不因本次选项协议修改而改变。

## Testing

1. Build with `build.bat`.
2. Start `node server/index.js` and open `http://localhost:3000`.
3. Open **LLM Config** from the sidebar, save the model settings, and run **Test Connection**.
4. Enter **Street**, **Park**, **Shop**, or **Bedroom** and verify narration plus contextual options appear.
5. 点击普通行动选项，确认 STAGED 时未结算，仅 committed / outcome 成功后产生一次真实结果；重试失败请求、重新生成选项或再次查看结果均不重复扣款、发放收益。仅打开场景不改变状态。
6. Use **Talk to someone nearby** to generate an NPC, then open the NPC chat and request a quest.
7. Save the game, reload, load the save, and verify generated scenes/NPCs/quests persist.

## Customization

Edit `src/scripts/llm-prompts.js` to change:
- The JSON schemas sent to the LLM
- How player stats are described
- The tone and constraints of generated content

Edit `src/styles/llm-ui.css` to change the appearance of generated scene cards, NPC cards, and quest cards.

## NPC 自主动作与安全边界

`npcchat` 由 `NPCDirector`、`LLMToolRunner` 和 `NPCTools` 执行，不再固定增加关系或解析文字发奖。`$npcAgency` 保存稳定身份、已知事实、主观印象、提议、承诺、私下意图和行为收据。Tools 暂存后需非空最终答复才能整体提交；礼物另由玩家接受结算。资源不足、越权事实、过期请求和读档前的旧操作会被拒绝。生成动作文字始终以 DOM 纯文本展示。

完整 tool 清单、存档语义及首批限制见 [交付记录](npc-agency-first-delivery.md)。

## 地点绑定与任务现场事件（2026-09-08）

### 生成任务

NPC 每轮程序上下文的 `questLocations` 包含当前游戏中已登记的全部大区域与子地点。直接复制现有字段（id、name、passage、defaultAreaId、connections、areas，以及子地点的 name、description、aliases、tags、generated 等）；没有增加 activities、开放条件等地点字段。

- 优先从清单选择；每个新事件目标必须绑定一个真实 locationId 和一个属于它的 areaId。
- 缺少合适地点时，先调用 `register_quest_area({locationId, proposedArea:{name,description,aliases?,tags?}})`，再将返回的 locationId / areaId 原样用于 `issue_quest`。
- 只允许从当前位置可达的已有大区域；同名或别名复用已有子地点；沿用移动系统每个大区域至多 24 个动态子地点的限制。不能创建大区域或移动玩家。
- 注册只改 NPC 草稿，工具返回 STAGED 不代表已登记。完整回合成功后，地点与任务提议一起提交；新地点未被有效任务引用、取消、断线或世界改变时不提交。
- 任务接受仍是独立操作；接受前再次校验地点。新任务不会接受模型注入的 current、completed、lastAction。前置目标不能循环依赖。

### 执行任务

1. 接受任务后，使用任务日志中目标旁的“前往 / 执行”逐段前往真实地点；到达后再次点击即可进入现场。场景中带 questAction 的任务按钮也进入同一入口。
2. `QuestEvent` 页面进入后，通过 `operation: quest-event` 调用模型。模型调用 `present_quest_scene`，生成尚未完成的现场和行动选项。此时无进度。
3. 玩家点击选项或在单行输入框输入行动后，再次调用模型。模型通过 `resolve_quest_event` 提交 description、summary、outcome 和 choices。
4. `continue` 保存现场并继续互动；`progress` 保存具体结果且仅推进当前目标一次。工具只暂存，完整最终答复成功、操作仍属于当前页面/存档/地点/任务时才提交。最终可见现场采用已校验的工具 description，不使用额外自由文本冒充状态。
5. 结果保存在 quest.result.events 和 objective.lastAction.result；现场及最近 16 步互动存于 quest.eventScenes。后续现场目标、任务日志和程序交付记录保留真实结果；NPC Prompt 不读取离场过程，只读取自身委托和当面交付事实。结果记录最多保留 100 次事件。多次目标需要明确重新进入下一次事件，不能重复提交已完成的现场。

开场和每次玩家行动各使用一个工具循环，正常为“工具调用 → 最终答复”两次模型请求；每循环最多 4 轮、6 次工具调用。模型不可用、工具未调用、参数无效或请求失败时保留已有现场，不用默认成功兜底。暂存中的请求不进存档；读档后从已提交现场继续。

### 范围与兼容

- 新 NPC 模型任务标记 eventDriven；旧 npc_discretionary 任务尚未完成的目标也走现场入口，但不自动改写其原有地点或补造过去经历。已完成历史不重开、不重复发奖。
- 正式照片任务继续使用原有寻找、凭证及交付流程；教程和其他非事件任务保持原逻辑。
- 本批工具只创造现场叙事和任务事件证据，不创造背包物品、付款、NPC 资源、奖励、优惠或新常驻 NPC；仍使用现有任务交付及 NPC 奖励工具。没有新增事件耗时规则。
- 任意文本中“行动是否真的满足目标”的语义判断由模型承担；程序校验的是地点、前置目标、当前行动归属和提交时机，不宣称可以确定性验证所有自由文本语义。

### 对话内交付与 NPC 知识边界（2026-09-08）

- 新任务以 turnIn 表达最终汇报、归还或交付，不再额外生成同一次交付现场。NPC 最终答复融合眼前动作、氛围与对白，回报仍由原有 NPC tools 决定。
- 兼容已有任务：明确提及交付 NPC、绑定其交付地点、次数为 1、有前置且没有后继的 talk/deliver 汇报或归还目标，合并到 NPC 对话中的交付。非交付目标和前置完成后可前往交付；合并步骤直到玩家明确点击交付才完成。普通调查谈话、其他 NPC、其他子地点、重复次数或中间步骤不会被跳过。无法明确识别的旧目标仍保留原行为。
- 旧存档停留在该交付现场时，展示前往 NPC 对话的入口，不重新请求现场模型。已完成事件不重写，结算仍校验地点/接收人并且仅一次；模型失败只重试 NPC 回应，不重复结算。
- NPC 对话的交付入口提供可选单行说明。仅将玩家实际填写的话作为 player_statement 和 user 消息；不从 quest.result 自动拼接“玩家汇报”。空白交付只通知当面交付事实，NPC 不会自动获得寻找地点、行动选项或过程结果。
- NPCAgency 使用字段投影构建 NPC Prompt：人设白名单、自身事实/提议/承诺/意图和可用物品；任务只含原始要求及知晓的交付状态。未当面交付时不暴露 current/completed、ready_to_turn_in、lastAction、result、eventScenes 或 settlement 内的过程副本。旧 fact.data.task 与接受提议中的嵌套任务也过滤；job 只传触发类型和引用 ID，不重复拼接任务。
- 地点清单继续按原有字段完整提供，用于合法发布任务；不代表 NPC 知道玩家在这些地点的经历。程序证据和调试原始日志保留，不改写既有对话或 NPC 已经形成的历史印象。
- 生成的可见自然语言将字面量反斜杠+n/r、CRLF 和 br 标签转换为真实换行；现场与 NPC 文本仍用 textContent/文本节点显示，不执行 HTML 或 SugarCube 宏。原始 tool 参数和调用日志不作替换。


### 选项工具注册与单次修正（2026-09-08）

- 动态完整场景调用 `register_scene_options({id,title,text,location?,mood?,options})`，包含 2–4 个选项；地点页与“重新生成行动选项”调用 `register_scene_options({options})`，包含 1–8 个选项。schema 无关字段应省略，尤其不能给每个选项填空 tool，也不接收预结算 effects。
- 注册调用本身不会执行 options 内的 action/tool/target，不移动玩家、不创建 NPC、不扣款、不推进任务；全部参数通过且操作仍有效后，调用者才保存选项。成功只需一次模型请求，无须额外的最终确认请求。
- 一次响应必须恰好一次注册工具调用。参数失败时，不先保存合法子集；下一次请求包含原始任务、上一轮 assistant 工具调用及与 tool_call_id 匹配的 REJECTED 错误消息（字段路径、原因和剩余修正次数）。模型必须重新提交完整参数。畸形 JSON 在兼容回放中使用空对象，原参数另随错误反馈返回，原始日志保持不变。
- 自动参数修正最多一次，即一次注册操作最多请求模型两次。第二次仍失败就停止；不额外请求模型作成功确认。没调用工具、截断、网络异常、取消或上下文失效不触发参数修正。用户手动重试属于新操作。
- 新场景失败不保存或跳转；地点页选项失败保留已生成叙事与固定入口，显示错误和仅重试选项的按钮；手动重试失败不覆盖原现场或原有选项。离场、读档、状态改变后，不继续修正或提交迟到结果。
- 调试日志包含 `scene-options-tool-call/result/retry`、整批校验和失败记录。两轮使用相同 runId、不同 round 与真实 requestId；调试面板可展开原始参数、错误反馈、拼接规则与实际保存结果。VALIDATED 仅表示参数通过，scene-options-stored 才表示入口保存，两者都不是行动结算。
- 本协议不改变 NPC 工具、任务现场工具或普通行动 `resolve_scene_action` 的既有循环；后者的 options 是行动结果的一部分，仍按原有暂存与最终提交规则处理。

### 角色提示词：行为化人设与分层示例（方案一，2026-09-29）

- 实际 NPC 聊天由 `NPCDirector.messagesFor` 组装：角色表演 → 事实与行动边界 → 人物设定 → 当前处境与已知事实 → 语气示例（如有） → 照片任务入口（仅相关人物/任务） → 当前触发事件。调试面板的片段可以完整还原实际 system 消息。
- 通用表演要求让动机、原则和处境影响回应，允许简短、拒绝或自然结束话题；动作和神态用于具体表达，不强制每轮追问、推进关系或发布任务。当前状态优先于角色卡的初始 scenario/greeting，示例条件不代表当前关系或真实经历。
- 亨特的 `personality` 按核心动机、陌生与熟悉、共同兴趣、压力与原则、不适与帮助、表达习惯组织。`dialogueExamples` 使用 `{ situation, user, assistant }`，独立于事实和真实消息历史；`NPCAgency` 仅投影这三个字段。没有独立示例的旧卡和临时 NPC 继续使用自身人设与真实对话。
- 旧存档仅在亨特 `personality` 与上一个内置版本完全一致时更新为新文案，并补入缺失的示例；保留自定义人设和自定义示例，不重置运行人物、历史对话、关系、印象、资源或已提交行为。已关联角色使用角色卡的新文案。
- 事实、提议、承诺、意图、任务和合法地点仍使用既有完整投影；近期对话仍取最近 20 条后筛选 user/assistant。工具循环、草稿提交、接受礼物和任务交付流程保持原有规则，没有新增模型生成阶段。

### 待完成：日期切换时更新 NPC 记忆（方案二）

状态：**待完成，本次不实现**。用户决定将方案二的记忆更新纳入游戏日期切换环节，后续从 `src/scripts/engine.js` 的 `advanceTime` 跨日处理接入。

- [ ] 在游戏日期实际改变后，按稳定 `actorId` 整理上一日该人物知晓的经历与关系变化；记录已处理日期，避免刷新、读档或重试重复更新，明确连续跨越多日时的处理方式。
- [ ] 区分事实、玩家陈述与主观印象，保留来源引用；不将语气示例、人物未知的离场事件或玩家自称经历写成事实。
- [ ] 保留未履行承诺、待处理提议、意图及其依据，并保留交付/领取去重所需记录；在后续聊天中结合更新后的记忆与当前事件选择相关背景。
- [ ] 验证跨午夜、连续跨日、保存与读取、更新失败与重试、同名不同人物隔离；更新失败时保留已有记忆，不影响资源、任务或已提交行为。

当前仍使用既有事实、印象和意图系统；次日相遇触发已有 NPC 回应不等于已经实现上述记忆更新。本次不新增记忆摘要、相关性检索、裁剪或跨日模型请求。
