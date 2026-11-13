> 实施状态（2026-09-07）：首批已实现并完成自动化、构建及真实模型端到端验收。本文保留实施前设计与基线；实际模块、差异和验证边界以 `D:\code\TG\docs\npc-agency-first-delivery.md` 为准。

# NPC 自主行为首批交付：实现方案

- 日期：2026-09-07
- 状态：待实施；本文件仅为方案，不表示业务代码已修改或测试已通过。
- 项目：`D:\code\TG`
- 目标：让模型根据人设、实际经历和当前处境，自主决定帮助后的回报与以后相遇时的反应；通过 tools 将决定转为真实、可保存的游戏行为。
- 范围：允许重构现有 NPC 对话、任务奖励、社交偶遇及其异步执行路径；不重做整个游戏。

## 1. 交付结果与边界

### 1.1 第一条完整路径

玩家在正式游戏内认识林晚晴、接受寻找照片的请求、完成寻找并交还照片。任务系统确认交付，模型自主决定当场回应、是否回报以及是否留下后续打算。玩家可以接受或拒绝具体提议。离开、保存、读取、推进到次日后再次遇到同一个人，模型根据既有决定与新处境继续回应，并可执行新的行为。

不预写“完成照片任务必送什么”“第二天必定说什么”的分支。允许送现有物品、送钱、自制小纪念品、邀请见面、作出承诺、仅道谢或暂不回报。行为需体现人设，但不以每次必须不同或必须给奖励作为验收条件。

### 1.2 首批包含

- 稳定 NPC 身份、事实与主观印象分离、长期承诺与意图。
- 共用 tool 对话执行器，普通聊天、任务完成回应、再次相遇走同一条路径。
- 金钱/物品/个人纪念品提议、邀请、受支持的承诺、印象更新与后续意图 tools。
- 现有 `issue_quest` 接入相同提议机制，仍由玩家接受任务。
- 自主奖励模式，以及旧固定奖励任务的兼容。
- 游戏内再次相遇触发、存读档、取消与重复执行处理。
- 一条可从正式入口玩到后续的照片任务，不要求玩家使用调试面板造状态。
- 使用当前两个后端 provider 分支的 tool 请求/响应适配；不支持 tools 的具体模型需明确显示能力限制。

### 1.3 首批不包含

全 NPC 自主日程、离线社会模拟、新地图生成、战斗或技能体系重做、完整制造经济系统、任意脚本执行、远程邮件/通信、新的外部服务或依赖。模型不能通过文字直接控制玩家、完成任务或给予物品能力。

## 2. 已核实的项目事实

以下为本次代码阅读结果；业务改造前应核对是否已被其他工作修改。既有测试本轮未重跑。

| 位置 | 当前情况及影响 |
|---|---|
| `D:\code\TG\tools\storyformats\sugarcube-2\format.js` | 捆绑 SugarCube 2.30.0；生命周期和存档 hook 要以该版本为准，不能直接套用新版 API。 |
| `D:\code\TG\src\scripts\quest-engine.js` | `settle()` 调用 `applyQuestRewards()` 并标记完成，自动完成与 NPC 交付都会到此；没有自主回应队列。`prepareDefinition()` 显式重建字段，新增奖励字段需在此保留。 |
| `D:\code\TG\src\scripts\engine.js` | `applyQuestRewards()` 解析奖励字符串；背包兼容旧数组并以名称为键计数。`bumpRelationship()` 仅接受正增量；固化 NPC 时另建角色卡。 |
| `D:\code\TG\src\scripts\llm-macros.js` | `chatWithTools()` 顺序执行工具，当前上限到达会返回空串；`issue_quest` 执行中等待弹窗；聊天每条输入固定增加关系，重试另走普通 chat。角色卡实例化产生新的运行时 ID。 |
| `D:\code\TG\src\scripts\npc-state.js` | 角色卡/运行时 NPC 部分按姓名关联；主动搭话默认每区域一次，使用记录没有按天或相遇重置。 |
| `D:\code\TG\src\scripts\world-events.js` | 社交偶遇按大区域筛选并解析文本里的关系变化，缺少意图和行为收据；会与新 NPC 系统形成重复入口。 |
| `D:\code\TG\src\scripts\llm-client.js` | 单一 `ACTIVE_REQUEST`；取消被转换为空字符串成功结果，无法表达所属会话与过期操作。 |
| `D:\code\TG\server\llm-proxy.js` | OpenAI-compatible 分支转发 tools；当前 Ollama 分支未把 `body.tools` 加入 payload。工具调用主要原样返回，跨 provider 的 ID/arguments/历史消息适配仍需补齐。 |
| `D:\code\TG\src\scripts\llm-structured.js` | 现有 schema 校验主要检查顶层必填字段和类型，不能当作动作权限/资源/嵌套参数校验器。 |
| `D:\code\TG\src\scripts\llm-prompts.js` | 普通 NPC prompt 合并人设和近期对话；角色卡部分按姓名匹配。世界文字记忆默认仅保留最近 20 条。 |
| `D:\code\TG\src\scripts\movement.js` | `MoveTool.invoke()` 校验位置并触发 `playerMoved`；可作为真实相遇入口，但其事件发生在导航前。 |
| `D:\code\TG\src\scripts\save-system.js` | 使用 `Save.serialize()/deserialize()` 保存游戏状态，新可序列化字段无需独立数据库。 |

遵守 `D:\code\TG\CLAUDE.md`：保持零后端依赖、JS 作为 Tweego source、生成文字纯文本输出、页面渲染不结算收益。既有工作区有大量改动，不回滚、覆盖或自动提交。

历史方案 `D:\code\TG\docs\superpowers\specs\2026-07-20-gameplay-enhancement-design.md` 中与本方案冲突的固定聊天加关系、自由文本解析社交效果等，不作为新路径的实现依据；不借本次任务重写无关技能设计。

## 3. 核心决策：tools 暂存行为，完整回合提交；玩家接受另行结算

### 3.1 责任边界

- 程序确认任务、物品、位置、时间、已发生行为和知情范围。
- 模型决定态度、回报方式、具体内容、邀请、承诺和后续意图。
- 执行器检查动作是否成立，不替模型换成某个固定奖励。
- UI 展示已经提交的对话与提议；玩家自己的接受、拒绝和移动不能由 NPC 代办。

### 3.2 一次模型回合

```text
真实事件或玩家输入 -> 创建 decisionId、读取相关状态版本
  -> 组织人设/可见事实/个人印象/资源/未完成事项
  -> 调用 chatRaw，接收 tool_calls
  -> 按顺序校验并在当前回合草稿中暂存动作
  -> 返回明确的 STAGED 或 REJECTED 工具结果给模型
  -> 模型修正或输出最终对话
  -> 重新检查会话、相遇、资源与版本
  -> 同步提交完整回合：对话 + 印象 + 提议 + 意图 + 收据
  -> 界面展示；不在提交期间等待网络、弹窗或导航
```

采用暂存是为避免“第一个 tool 已经发钱，第二次请求失败，用户重试又发一次”。首批不实现通用数据库事务；使用范围明确的草稿状态和同步提交函数。提交函数不得调用会导航或触发未知业务副作用的旧 helper，相关 hooks/UI 通知在提交后发送。先验证并计算全部 next state，再赋值；禁止边验证边扣资源。

工具暂存不是事实，返回 `STAGED` 不能称为已入账。最终文本和暂存行为一同提交；中间 assistant 文本不提前展示。没有 tool 的有效对话可作为“仅回应”提交；空结果、取消、超限、解析失败不可伪装成“NPC 决定不回报”。

普通话语保留为最终 assistant 文本，不再额外建立重复的 `speak` tool。所有会修改资源、提出可接受事项或改变记忆/意图的行为通过 tools。文本里的“已获得”“任务完成”不触发效果；权威状态以执行收据和 UI 卡片为准。提示词与结果约束应避免叙述已转移仍待接受的礼物，但不声称能用规则彻底识别所有自然语言矛盾。

### 3.3 玩家处理提议

```text
已保存的 offer -> 玩家点击接受/拒绝
  -> 重新检查 offer 状态、相遇/有效期和所需资源
  -> 同步提交接受/拒绝和必要转移，保存 settlement receipt
  -> 创建 player_accepted/player_declined 事实
  -> 在仍有效的互动中排队请求 NPC 后续回应
```

模型不接收 `accept_offer`、`complete_quest`、任意 `applyEffects` 或替玩家移动的工具。接受/拒绝是前端确定性操作，不是在模型循环中等待 Promise 弹窗。模型后续调用失败不撤销已经完成的玩家操作。

## 4. 模块与接口分工

建议五个新模块，避免为首批再建立通用事件平台。名称可按实现调整，责任不混合。

| 建议文件 | 责任/主要接口 |
|---|---|
| `D:\code\TG\src\scripts\npc-agency-state.js` | 身份、序列化状态、迁移与事实。`ensure()`、`resolveActor()`、`recordFact()`、`buildContext()`、`createTurnDraft()`。 |
| `D:\code\TG\src\scripts\npc-tools.js` | Tool schema/registry、逐动作校验和草稿处理、完整提交与提议结算。`definitions(context)`、`stage(call, draft)`、`commitTurn()`、`resolveOffer()`。 |
| `D:\code\TG\src\scripts\npc-director.js` | 事件队列、NPC 回合调度、相遇和到期意图。`enqueue()`、`onEncounter()`、`runDecision()`、`resumePending()`。 |
| `D:\code\TG\src\scripts\llm-tool-runner.js` | 不含 NPC 业务的 tools 消息循环、规范化调用、错误/超限与重试。接收 caller 提供的 stage handler 和 operation scope。 |
| `D:\code\TG\src\scripts\llm-operation-scope.js` | 非存档会话代数、取消信号与上下文有效性；供 NPC 和现有场景请求共用。 |

不另建独立 NPC 聊天页面或新的后端状态服务。提示词在现有 `PromptBuilder` 增加 NPC decision context；UI 在现有 `NarrativeUI` 增加提议卡片与结构化回执。

## 5. 状态契约

### 5.1 稳定身份

新增稳定 `actorId`。静态卡、运行时 NPC、固化后的卡关联同一 actor。任务 giver 暂保留现有运行时 ID 兼容，但事件和记忆统一绑定 actorId。

- 新 NPC 在创建时分配 actorId；由卡实例化时继承卡的 actorId。
- 显式 `cardId`/actorId 关联优先于姓名；prompt 和资源查询不再以姓名为权威依据。
- 旧存档仅在唯一且无冲突的卡/运行时对应关系下补关联。同名不唯一时保持独立，不能合并记忆。
- 晚晴的 `personality`、`scenario`、`description` 保持可访问，不能只复制 name/role 丢失人设。

### 5.2 可序列化根状态

建议 `$npcAgency`：

```javascript
{
  schemaVersion: 1,
  actors: {},       // actorId -> 人物状态与资源
  facts: {},        // 程序事件、玩家话语等；含 source 与知情范围
  jobs: {},         // 由事实/相遇触发的决策任务
  decisions: {},    // 已提交的回合与 sourceEventId
  offers: {},       // 奖励、邀请、任务提议
  promises: {},     // 已表达的单方承诺
  intentions: {},   // 未公开的未来打算
  receipts: {},     // 提交及接受/拒绝收据
  encounters: {},   // 相遇实例和冷却
  itemDefinitions: {} // 新纪念品的稳定定义
}
```

记录使用游戏时间 `{ day, minuteOfDay }` 或等价的绝对游戏分钟。现实时间仅用于日志/请求耗时，不能决定失约或提议过期。

actor 至少包含 `actorId`、`profileRef`、`revision`、`impression`、`knownFactIds`、`resources`。资源记录总持有量和预留量，不以“角色设定里说她有钱”作为可无限发钱的余额。首批晚晴资源由 `content.js` 的初始数据配置，包含有限可支配金额、少量物品/纸材；这是世界初始物资，不是固定奖励表。其他旧 NPC 缺资源时不补无限默认钱包。

### 5.3 事实、观点、承诺分离

- 程序事实：交还照片、赠送已接受、双方已赴约等，必须来自对应执行器。
- 玩家话语：记录“玩家声称找到照片”，不能升级为完成事实。
- 个人观点：允许 NPC 误解玩家，保存短态度/印象摘要及参考事件，不要求模型输出完整推理过程。
- 承诺：已经对玩家表达、具有受支持履行方式的单方义务。
- 意图：私下打算，不展示给玩家，可以后来改变或取消。

每个事实带 `sourceEventId`、参与者、知情者。任务目标在远处完成不自动让 NPC 知道；`turnIn()` 或真实见证/交流才触发知情。模型提供的事实 ID 必须在该上下文允许列表内。

### 5.4 生命周期与去重

- job：`queued -> running -> committed`；另有 `retryable / deferred / cancelled`。
- offer：`pending -> accepted / declined / expired / withdrawn`，终态不可再次转移。
- promise：`open -> fulfilled / broken / released`；玩家拒绝履行提议可记录释放，不等同违约。
- intention：`pending -> eligible -> resolved / rescheduled / cancelled`。

ID 由程序分配，模型不能选择 decisionId、actorId、receiptId。tool_call_id 只标识传输调用，不是唯一业务幂等键。绑定 `decisionId + callSlot`，同回合重复调用还需识别等价参数，避免 provider 换 ID 后执行重复赠送。一个 cause/意图已有待处理提议时不能再堆同类提议；需要变更则显式替换并释放旧预留。

同一存档分支不重复处理已经提交的事件；读取更早存档允许世界正常回到过去，不建设跨存档的反悔惩罚系统。已接受记录与资金转移必须处在同一保存状态中。

## 6. 首批 Tool 契约

### 6.1 通用约束

调用者 NPC、触发事件、位置和 scope 由执行器注入，schema 不开放任意目标 NPC、任意状态路径或 JS。schema 声明与实际 executor 校验共用定义；检查嵌套字段、有限数值、合法引用、数量和文本长度，不只检查顶层类型。

合法行为返回 `STAGED`、程序分配的引用和明确待接受/待触发状态。拒绝返回稳定错误码及可修正原因，例如 `INSUFFICIENT_RESOURCE`、`UNKNOWN_ITEM`、`INVALID_LOCATION`、`DUPLICATE_ACTION`。不给失败动作偷偷替换奖励。

### 6.2 工具目录

| Tool | 参数核心 | 暂存结果与执行约束 |
|---|---|---|
| `npc_offer_reward` | `reward`、`message`、可选 `promiseId`/`replaceOfferId`；reward 是 money / existing_item / keepsake 三选一 | 建立奖励提议并预留资源；不直接加玩家资产。金额/数量由模型选，不能超过可用资源。 |
| `npc_invite_player` | `locationId`、`areaId`、`startAt`、`endAt`、`purpose`、`message`、可选 `promiseId` | 创建可接受邀请；时间合理、地点已注册、NPC 第一版确实可在该处见面。接受后建立约会，不自动移动玩家。 |
| `npc_make_promise` | `benefit`、`dueAt`、`message` | 登记公开承诺；首批 benefit 仅支持奖励或会面这两类可履行行为。不能承诺不存在的房产、权限或能力。 |
| `npc_set_intention` | `goal`、`anchorFactIds`、`reconsiderWhen`、可选 `replaceIntentionId` | 记录私下打算，供后续重新判断；goal 可自由写，但触发条件必须是受支持结构。 |
| `npc_update_impression` | `summary`、`basisFactIds`、`relationshipDelta` | 保存主观印象。关系变化允许负数或零，单回合范围在配置中限制；同回合只接受一次最终更新，不按 tool 次数叠加。 |
| `issue_quest`（兼容既有名称） | 原任务字段 + `rewardMode`，giver 由执行器绑定 | 使用 `TaskEngine.prepareDefinition()` 预检，创建任务提议；玩家接受后才写入 active quests。 |

不把 `npc_share_information` 做成首批额外状态工具：普通信息可在对话中表达并作为已说出的内容保存，但不能凭文字解锁地点或伪造任务证据。需要实际“线索物品”时使用已登记的物品/任务机制。后续有真实内容需要再新增能力。

### 6.3 奖励与纪念品

`reward` 示例：

```json
{"kind":"money","amount":12}
{"kind":"existing_item","itemId":"registered-item-id","quantity":1}
{"kind":"keepsake","title":"手绘的小公园","description":"她在空白纸上画了找到照片的长椅。"}
```

金额 12 只是参数示例，不是照片任务的报酬标准。

- 待接受提议预留对应钱、物品或纸材，防止多个 pending offers 超额承诺；拒绝、过期、撤回释放预留。
- 玩家接受时再次检查，在一个同步提交中扣 NPC 资源、加玩家资产、写收据并终结 offer。
- keepsake 允许模型原创标题/描述；首批消耗已登记纸材并在接受时完成制作/交付。无附加属性、不可用作任意任务凭证、不自动获得售价，避免文字宣称未实现的能力。
- 新物品用稳定 ID 与描述，旧背包名称键通过兼容访问器保留。物品展示/使用入口必须识别新旧两类键，不能把 ID 直接显示给玩家或仅新增一个看不见的旁路背包。
- `npc_make_promise` 的 benefit 涉及金钱、物品或纸材时必须预留对应资源；会面承诺只登记可履行的地点与时间，不预留虚构资产。它不转移资产。履行时携带 promiseId 转为 offer，复用预留，不重复占用。取消/过期释放；已说出的承诺不能因加载失败被悄悄删除。
- NPC 首批只允许提出对玩家有益、待玩家接受的转移。接受邀请不是同意自动花钱或耗时；涉及额外消费需另一个明确玩家操作，首批不扩展隐式消费。

### 6.4 邀请如何真正完成

邀请不是一张永远 pending 的卡。接受后记录地点和时间窗口。玩家在窗口内到达同一子区域、NPC 在场时出现“赴约”动作；点击登记 `appointment_attended` 并进入共同 NPC 回合。该事实完成对应会面承诺/意图。

首批 NPC 不自主跨地图移动，只邀请到其已登记可到达且可出现的地点；不能发出必然无法赴约的随机地点。超过结束时间按实际出席记录处理，未接受的邀请仅过期、不产生失约。吃饭、购物等需要额外机制的结果不能仅凭 purpose 文本自动结算。

### 6.5 印象与关系兼容

移除聊天输入固定 `+2`；将现有关系显示保留为模型印象的数值投影，而不是并行的另一套好感。

建议首批单回合关系 delta 限制为 -5 到 +5，范围放入配置，不写成每类事件固定加分；模型可以不调用该工具。扩展现有关系 helper 以支持正/负/零和 sourceEventId，统一更新 tier、history、disposition 的兼容展示与固化逻辑。避免重试再次更新、固化时创建第二个 actor。审计同一 NPC 的旧 `relationship_change` 与日常衰减路径，明确保留的世界规则并统一调用入口，不允许隐藏的第二次社交加分。

### 6.6 后续意图的触发结构

首批支持：

- `next_encounter`：可带 notBefore 游戏时间，只在真实再次相遇时重新考虑。
- `game_time`：到时变 eligible，需现场的行为仍等待见面。
- `offer_resolved`：某份提议被接受、拒绝或过期。

不用自然语言解析时间条件，不执行模型编写的表达式。被唤起后模型可以履行、修改、延后或取消意图，不必照第一次想法机械执行。未留下显式意图的 NPC 也可以在次日新的相遇中依据重要记忆重新回应，不把“没调用 set_intention”变成永久失忆。

## 7. 任务与照片内容接入

### 7.1 奖励模式

- `fixed`：旧存档和已有任务默认值，原已约定报酬继续一次性处理。
- `npc_discretionary`：无预定报酬；任务完成后产生 NPC 可知事件，回报完全走模型行为。
- `fixed_plus_npc`：先兑现已约定报酬，再允许自主回应；已发报酬作为上下文，避免再次索赔/重复发放。

`prepareDefinition()`、normalize、两种任务创建入口、奖励展示都保留该字段。`npc_discretionary` 不应同时携带非空的既定 rewards；校验要求澄清，不能界面承诺一份奖励却结算成另一种。固定任务的迁移不扣旧 NPC 未建模的钱包；新自主礼物必须有资源来源。

`settle()` 在实际首次状态变更时原子写入完成/固定报酬标记和 source event。不能每次 recompute/渲染重新发事件。任务完成与“人物已决定”“玩家已收礼”分开，不扩用 `rewardsClaimed` 表示所有状态。

自动完成任务只记录事实，按实际知情范围通知 NPC；照片任务用 NPC 交付，交付时晚晴明确知情。审计 `defaultTurnIn()`、旧 completion fallback 及新字段迁移触达的路径，修复阻碍本交付的既有错误，但不扩大为全项目清理。

### 7.2 正式内容入口

在现有晚晴互动中提供稳定的照片请求入口，可复用现有任务提议 UI。目标定义与交付验证可以确定性编写，这是“到底有没有帮到人”的判据，不是规定 NPC 的奖励答案。

- 稳定任务定义：寻找并交还那张特定照片，`rewardMode: npc_discretionary`。
- 接受后在一个已存在的公园子区域提供有效寻找行动；找到后登记唯一照片物品/任务凭证。
- 交付须满足持有与任务状态，移交凭证、完成任务、写 `photo_returned` 事实是一次操作。
- 玩家说“已经交还”或模型调用 issue_quest 不能越过这条验证。
- 同一实例不可重复领取照片或交付，已完成任务不在普通聊天中被重新发成另一个同义照片任务。
- 内容文本及 NPC 对话不写固定回报或固定次日结果。初始人设可保留照片的重要性和内向性格。

## 8. 对话执行器与两个 provider

### 8.1 重构现有 NPC 对话

`llm-macros.js` 中 NPC 输入、任务结束回应、再次相遇和 Retry 都调用同一个 director/runner。历史用户消息按 messageId 只登记一次；失败重试不再 push 同一句输入或增加关系。

将现有 `issue_quest` 从“工具调用 -> 阻塞弹窗 -> 写任务”改为“暂存任务提议 -> 回合提交 -> 玩家独立接受”。保留名称与 TaskEngine 校验，不保留不安全的旧执行旁路。旧 `RequestQuest` 的生成结果也落入同一提议处理；不可存在“工具任务需要接受，宏任务直接写 active”的新旧不一致。

首批不把场景移动工具和 NPC 意图工具混在同一执行权限里；世界场景工具可以继续使用既有能力，但需接入相同的取消/有效性保护。NPC 不获得改变玩家位置的权限。

### 8.2 工具循环

- 顺序处理同一响应中的 tools；前一个动作的预留量会影响后一个，不能 `Promise.all` 扣同一钱包。
- runner 返回结构化状态：`completed / cancelled / stale / failed / limit_reached`，不再把达到循环上限变为空串成功。
- 循环和调用数量设可配置保护，沿用现有上限作为初始值并按真实回归校准；达到限制时不提交半回合、不无限续跑，也不冒充不回报。
- 对格式/业务错误，tool result 提供原因，允许在剩余回合内修正；重试走同一校验器。无新信息的重复非法调用不反复执行。
- 丢失最终文本但有尚未提交动作时不直接交付草稿；明确失败/可重试。首批所有现场回合都要求非空最终答复，即使唯一工具动作只是记录私下意图，也不能将空响应或工具结果当作完整答复。

### 8.3 传输协议与能力限制

前端内部统一使用带本地 call ID、name、解析后 arguments 的格式；发送给 provider 的 assistant tool_calls 与 tool results 由 adapter 保持对应。保留 provider 原始 ID；缺 ID 时生成该次响应内稳定的本地 ID，但不能假定任何 provider 都接受另一种格式。

修改 `server/llm-proxy.js`：补齐 Ollama chat 的 tools 转发，并对现有两个 provider 的 arguments 字符串/对象、工具结果消息关联进行明确适配。所用上游版本的字段在实现时用其实际响应/官方协议核实，测试使用捕获后脱敏或构造的协议 fixtures。后端只转发/规范化，不执行游戏 tools。

已有 `LLMEngine.chatRaw()` 复用；不引入 SDK、数据库、agent 框架或新模型服务。普通 generate/chat 继续工作。

模型不调用工具可能只是决定说话，不能据此断言不支持 tools。只有能力检查或明确上游错误证明不支持时显示限制；不能悄悄从文本正则发奖。网络不可用时保留任务完成和待处理事件，可继续其他游戏操作；已提交提议仍可按规则接受。真实 provider 未验证时明确列为未验证，不用 mocks 冒充。

## 9. 请求归属、相遇与调度

### 9.1 先修复过期异步写入

运行时 operation scope 至少携带 `sessionEpoch`、`decisionId`、`actorId`、相关状态版本，以及现场请求的 `encounterId`/页面实例。epoch、AbortController、Promise、DOM 引用不进入存档。

- 读档、历史回退/前进、重开使旧运行实例失效；覆盖自定义 slot、导入后加载及 SugarCube 支持的其他入口，而不只改一个按钮。
- 离开现场、切换 NPC、时间/资源改变使相关现场决策失效；取消网络只是辅助手段，每次 tool staging、最终提交、延迟导航前仍检查 scope。
- `LLMEngine` 支持逐请求 signal/取消，不再只靠一个 ACTIVE_REQUEST 指针。AbortError 返回明确取消，不进入 fallback。
- 旧 `llmscene2`、`hubscene` 与 NPCChat 的写状态和延迟导航都接入保护；否则旧场景请求仍会破坏新 NPC 世界。
- 本轮失效时丢弃草稿，不回滚后来已经发生的操作；原 source event 可以 deferred 等下一次相关互动，而不是当场自动启动一串新请求。

### 9.2 相遇定义

同一 actor 与玩家在同一子区域，且发生真实进入/新一天的有效会面才产生 encounter。打开设置、背包、重复渲染、从 NPCChat 返回同一地点不自动制造新相遇。

`playerMoved` 在导航前触发：此处登记相遇候选，待该动作的导航完成、当前上下文稳定后启动现场请求。不能用离开前的页面 stamp 发请求，再让正常导航立刻把它取消。

用相遇实例、最近回应的事件、游戏时间冷却代替永久“每区域一次”限制。旧使用记录迁移为历史而非永久锁定；同一次相遇没有新事实就不重复生成搭话。玩家忽略提议后本次不连续强推，接受/拒绝也保存为已处理事实。

`world-events.js` 的社交分支只提交候选/触发，不再独立解析关系变化或抢夺对话。保留无关氛围功能，但同一 NPC 的自主社交只保留一个权威入口。

### 9.3 排队与跨日

同一 NPC 同时只运行一个决策；交付回应、玩家显式对话优先于可推迟的主动搭话。用户已经等待 NPC 回答时，不让低优先级环境生成取消该回合。

`timeAdvanced` 根据旧/新游戏时间检查跨过的期限，避免睡过多小时漏掉过期。时间到只更新邀请/意图状态，不强制传送、自动替玩家赴约或远程发起现场对话。

渲染只读取状态、绘制卡片；请求启动来自已提交动作/调度器，不在 `DynamicScene`/`hubscene` 的渲染中发奖励或消费事件。读档后由恢复逻辑恢复可继续任务，必要时显示“继续回应”入口，而不是每次重绘重复运行。

## 10. UI、存档与兼容

### 10.1 UI

修改 `D:\code\TG\src\scripts\llm-ui.js`、`D:\code\TG\src\passages\npc-chat.twee`、`D:\code\TG\src\passages\quest-log.twee` 及必要样式：

- 对话中绘制已提交的礼物/邀请/任务卡片，状态来自 offer ID，不来自闭包里的旧对象。
- 明确区分“提出赠送”“已收下”“已拒绝”“已过期”；显示接受前会发生的实际转移。
- 展示已公开的承诺与赴约地点/时间；不泄露 NPC 私下意图和主观分析。
- 请求失败提供同源重试，取消不弹普通网络错误；用户输入不能被静默丢弃。
- 恢复存档后从状态重建卡片，旧 DOM 回调必须失效。
- NPC 姓名、角色、物品标题/描述等生成字段也使用纯文本路径；不要仅保护对话正文而仍用 `<<print _npc.name>>` 解析生成宏。
- 动态选项不能再通过 `effects` 绕过新自主奖励或关系处理；保留非 NPC 行动效果时明确其执行边界。

### 10.2 存档

`_init.twee` 初始化，`_header.twee`/适当加载钩子调用幂等 `ensure()`。新状态是普通 JSON 数据，不存函数、工具 handler 或运行时草稿。

保存中断回合时可保存 source event 与用户消息，但不能保存半完成的执行草稿。读档时 `running` 任务归一化为可恢复状态，创建新的 runtime scope；已 committed 决定只显示，不重抽。

在 `save-system.js` 及 SugarCube 实际生命周期接入失效处理；旧存档默认奖励模式 fixed、不补发历史 NPC 感谢、不把旧关系历史推断成从未做出的承诺。迁移应测试数组/对象背包、只有角色卡、已有运行时 NPC、已固化 NPC 等情况。

重要承诺、资源预留、收据和相关事实不能随着聊天最近 50 条/世界最近 20 条的裁剪丢失。首批只记录事件级记忆，不复制每次完整 prompt；长期无关对话可按现有方式裁剪。终态事项可归档，但必须保留去重和兑现所需的最小记录。

## 11. 实施顺序与文件范围

### 阶段 A：传输与异步基础

- 新建 operation-scope 和 tool-runner；修改 llm-client、llm-proxy。
- 补齐两个 provider 的 tool 历史往返适配；明确取消/过期/超限语义。
- 接入现有 scene、hub、NPC 的晚到写入/导航保护。
- 完成协议与延迟回调测试后再接入会改资产的 tools。

### 阶段 B：身份、状态和确定性执行

- 新建 npc-agency-state、npc-tools；修改 npc-state、content、engine、初始化/加载。
- 完成 actor 关联、草稿、预留、提议状态、接受/拒绝、背包纪念品和收据。
- 使用脚本化 tool calls 验证真实资源变化，不先依赖真实模型输出。

### 阶段 C：统一对话与任务奖励

- 新建 npc-director；改 PromptBuilder、llm-macros、quest-engine 和 UI。
- 移除固定聊天加分，统一 Retry、issue_quest 和 RequestQuest。
- 增加 rewardMode、单次任务事实、自主回应状态，完成第一天接受/拒绝路径。

### 阶段 D：正式照片内容与再次相遇

- 修改 content、现有公园/对话 passages，补确定性的寻找/交付入口，不加入固定奖励分支。
- 接入 movement/time/world-events，调整主动搭话额度。
- 完成 next encounter、邀请赴约、承诺兑现/过期与存读档恢复。

### 阶段 E：整体验收与文档

- 完成下节测试和浏览器验证；修复范围内问题。
- 更新 `D:\code\TG\docs\architecture.md`、`D:\code\TG\docs\llm-content.md`、`D:\code\TG\docs\llm-integration.md` 和必要 README。
- 把 tools 参数/返回码/状态转换作为实际执行契约记录；同步实现后的名字，不保留方案与代码各一套接口。

主要既有修改范围：`D:\code\TG\src\scripts\llm-client.js`、`llm-macros.js`、`llm-prompts.js`、`llm-ui.js`、`npc-state.js`、`quest-engine.js`、`engine.js`、`content.js`、`movement.js`、`world-events.js`、`save-system.js`；`D:\code\TG\server\llm-proxy.js`；`D:\code\TG\src\passages\_init.twee`、`_header.twee`、`npc-chat.twee`、`quest-log.twee`、`scenes.twee`、`dynamic-scene.twee`、`character.twee` 的相关部分。`llm-structured.js` 仅在确需复用/修正解析入口时改，不强行把 tools 包装成原来的场景 schema。

沿用已有 CSS 模块，避免新增构建步骤。只有新增样式文件才修改 build.bat 的模块列表。后端不增加依赖，日志不记录凭证；不改无关设置/UI，不做自动 Git 提交。

## 12. 验证计划

以下是实施时的验收，不是本次已执行结果。优先沿用 `D:\code\TG\tests` 的 Node test + VM/桩模式。

### 12.1 自动化

| 测试组（建议文件） | 必须覆盖的可观察行为 |
|---|---|
| `D:\code\TG\tests\llm-tool-runner.test.js` | 多工具顺序、字符串/对象参数、调用 ID 对应、错误修正、循环超限、取消、空结果；无半回合提交。 |
| `D:\code\TG\tests\llm-proxy-tools.test.js` | 两个 provider 实际 tools payload、assistant/tool 历史适配、响应归一化、无 tools 的旧请求兼容；不访问真实网络。 |
| `D:\code\TG\tests\npc-agency-state.test.js` | 稳定身份/固化/旧存档迁移、同名不误合并、事实知情范围、对话裁剪不删重要承诺、游戏时间语义。 |
| `D:\code\TG\tests\npc-tools.test.js` | 金钱/物品赠送、纪念品、资源预留、超额/非法引用、拒绝/过期释放、重复调用/重复点击、负关系变化、全回合失败无部分写入。 |
| `D:\code\TG\tests\npc-director.test.js` | 单次交付一次排队、无奖励也是有效回应、次日真实相遇、刷新不触发、忽略不刷屏、无显式意图也可新相遇回忆、范围失效不写入。 |
| 扩展 `D:\code\TG\tests\quest-engine.test.js` | 三种 rewardMode、fixed 兼容、自动完成与 NPC 知情区别、照片凭证移交、任务和 NPC 回报分别去重。 |
| 扩展 `D:\code\TG\tests\npc-state.test.js`、`movement.test.js`、`llm-text.test.js` | 次日额度恢复、子区域相遇、模型字段纯文本和旧行为保留。 |

至少用三组不同的脚本化模型回合验证执行器不编码奖励答案：直接送钱、原创纪念品、当场只道谢并在以后邀请。另测“主动拒绝回报/不留意图”可正常提交。脚本化模型证明行为能力与一致性，不用于证明真实模型具有主观性。

失败注入必须覆盖：第一次 tool 后网络失败、最后响应前读档、接受卡片同时状态变更、已排队的旧延迟导航、重复 tool 换 transport ID、两个提议争用同一资源、午夜跨越过期时间。存档回放同时核对 NPC 资产、玩家资产、offer 和 receipt，不只检查屏幕文字。

### 12.2 真实浏览器

使用项目捆绑 SugarCube，独立测试存档，不覆盖用户现有槽位：

1. 从正式入口遇到晚晴、接受请求、找到并交还照片。
2. 等待自主回应，验证工具提议和实际资产一致，接受/拒绝都留下事实。
3. 保存、离开、读取；同一礼物不能再领，人设/记忆仍属同一 actor。
4. 推进到次日重新进入同一子区域，得到依据既有经历的新回应；不要求随机给定某一句台词。
5. 脚本化响应覆盖邀请的接受、赴约及过期，实际 UI 可完成而非只存在 schema。
6. 模型不可用/请求取消时，任务不回滚、没有凭空奖励、其他页面可继续使用；恢复后按 source event 续接。
7. 模型输出含宏/HTML 的姓名、正文、礼物描述只显示为文字。

真实模型质量检查：比较不同初始运行中的选择及与人设的关联，检查是否重复首次感谢、忽略拒绝或宣称不存在的能力。允许合理的相同答案，不用“每次必须不同”逼迫无意义随机。至少完成一个实际已配置且支持 tools 的端到端运行；另一 provider 若没有可用服务，只报告适配 fixtures 已通过、真实调用未验证。

### 12.3 命令与收尾

实施期间按改动范围运行 targeted tests，整合后运行：

```powershell
Set-Location D:\code\TG
node --test tests/*.test.js
.\build.bat
git diff --check
```

对修改的 JS 补 `node --check <文件>`。若 Node runner 遇到沙箱 spawn 限制，走正常提权机制，不换途径绕过。`build.bat` 的末尾提示不是独立成功证据，检查 Tweego 返回结果与产物可打开；必要时直接执行脚本内已核实的编译命令。

原方案阶段不运行游戏测试、不重新编译、不调用真实模型；当前实施阶段结果见文首交付记录。实施后报告具体通过/失败/未验证项，清理临时夹具与服务，不删除已有文件，不自动提交/推送。

## 13. 完成定义

首批完成意味着：正式照片任务可完成；模型自主选择回报/不回报及后续行为；工具行为能兑现；玩家选择被记住；跨日和存读档后仍是同一个人物；没有重复收益、晚到状态污染和文本执行；现有固定任务及正常对话不被破坏。

只有聊天文案多样、只有 schema、只有 mock 演示、固定挑选预写奖励、必须调试造状态才能见到后续，均不算首批交付完成。若真实模型/某 provider 不可用，交付已完成部分与具体验证缺口，不能把缺口写成已验证。

后续再扩展共享信息工具、自由生成任务链和更多 NPC 能力。首批不因这些可扩展方向而增加未使用的抽象或持续扩大范围。
