# LLM 集成指南

> 本文描述已冻结的旧版网页工程（`src/` + `server/`）。主线插件复用宿主模型，见 [迁移说明](deepseek-harness-migration.md)。

## 概述

本游戏支持通过大语言模型（LLM）进行 AI 驱动的动态叙事生成。你可以使用本地 Ollama 实例或任何兼容 OpenAI 的 API。

当前所有 LLM 相关的提示词和 UI 都已本地化为中文；模型会被明确要求用中文回复。

## 快速开始（Ollama）

1. 从 https://ollama.com 安装 Ollama
2. 拉取模型：`ollama pull llama3.2`
3. 启动 Ollama（普通启动即可，无需 CORS 配置——浏览器不再直连它）
4. 启动游戏后端：`node server/index.js`
5. 浏览器打开 `http://localhost:3000`，前往 **设置 > LLM 集成 > 打开 LLM 配置**
6. 点击 **测试连接**
7. 启用 LLM 并保存
8. 进入 **街道** 等场景，LLM 会生成叙事与选项

## 配置

**游戏内 `LLMConfig` 页面（保存到本机后端）：**

| 设置 | 说明 | 默认值 |
|------|------|--------|
| 启用 LLM | 总开关 | `true` |
| 连接方式 | `ollama` / `openai` | `ollama` |
| 接口地址 | 上游 API 基础 URL | `http://localhost:11434` |
| API Key | 仅兼容 OpenAI 的接口需要；读取时只返回脱敏状态 | （空） |
| 模型 | 模型名称 | `llama3.2` |
| 温度 | 创造性（0-2） | `0.8` |
| 最大 Token | 回复长度限制 | `1024` |

保存后配置写入被 Git 忽略的 `server/llm-config.local.json`。下一次打开页面时，前端通过 `GET /api/llm/config` 读取配置；完整 API Key 永远不会通过读取接口返回。留空 API Key 会保留已有密钥，勾选“清除已保存的 API Key”才会删除。

**初始默认值（`server/.env` 或环境变量，见 `server/.env.example`）：**

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_PROVIDER` | `ollama` / `openai` | `ollama` |
| `LLM_ENDPOINT` | 上游 API 基础 URL | `http://localhost:11434` |
| `LLM_MODEL` | 首次启动的默认模型 | `llama3.2` |
| `LLM_API_KEY` | 仅 `openai` 需要 | （空） |
| `LLM_MAX_TOKENS` / `LLM_TEMPERATURE` | 默认生成参数 | `1024` / `0.8` |
| `LLM_LOG_CONTENT` | 是否记录完整提示词与回复 | `false` |

如果本地配置文件尚不存在，后端使用 `.env` 的值；一旦通过前端保存，以本地配置文件为准。

## 宏

### `[[LLM 配置|LLMConfig]]`

侧边栏菜单项，打开配置页面。

### `<<llmconfig>>`

渲染配置表单。通常用于 `LLMConfig` passage。

叙事与动态选项能力目前由 `<<hubscene>>` 承载（见 `docs/llm-content.md`），NPC 对话由 `<<npcchat>>` 承载；旧的 `<<llmscene>>` / `<<llmchat>>` / `<<llmoptions>>` 宏已移除。

当前后端以非流式方式请求上游（`stream: false`）。`NarrativeUI` 保留兼容分块渲染的接口，但现阶段会在完整回复到达后一次性显示内容。

## Mod API 钩子

Mod 可以拦截 LLM 提示词和回复：

```javascript
ModAPI.on('llmPromptReady', function (data) {
  data.prompt += '\n\n[Mod: 强调这个场景中的危险。]';
});

ModAPI.on('llmResponseReady', function (data) {
  data.text = data.text.replace(/旧名字/g, '新名字');
});
```

场景生成还会向支持 function calling 的模型提供 `start_dialogue` 工具。当 NPC 在场景中直接向玩家搭话时，模型可提交 NPC 名与第一句话；玩家确认后进入已有的 NPC 对话界面。动态选项通过结构化 `tool` 字段调用同一能力。发布任务仍使用 NPC 对话中的 `issue_quest` 工具。

## 保存 / 读取

LLM 对话历史会随游戏存档保存和读取。LLM 连接配置独立保存在后端，不受新游戏、读档或存档导入影响；`$llmConfig` 仅保留后端配置的前端镜像。保存前历史记录会被裁剪到最后 50 条，防止存档膨胀。

## 日志与排错

后端把运行时日志落盘并回显到终端：

- `logs/llm.jsonl`：LLM 请求/响应，包括 `requestId`、调用用途、模型、参数、输入/输出长度、截断预览、耗时、结束原因、工具调用数与错误阶段。
- `logs/game.jsonl`：浏览器会话、passage 切换、按钮/链接操作、LLM 客户端阶段、`console.*`、全局 JS 错误和 Promise rejection。
- `logs/server.jsonl`：服务启动信息、每个 HTTP 响应的路径/状态/耗时、请求中断、日志接收失败及服务异常。

同一次 LLM 调用在 `game.jsonl` 和 `llm.jsonl` 中使用相同的 `requestId`。排查时先在游戏日志找到失败事件，再用该 ID 搜索另外两个文件，即可还原浏览器 → 后端 → 上游的处理链路。

**后端 LLM 请求日志**默认只保存最多 300 字的提示词/回复预览，并对常见密钥格式做遮盖。需要诊断完整内容时，在 `server/.env` 设置 `LLM_LOG_CONTENT=true` 并重启后端；完整日志可能包含剧情和玩家输入，不要随意上传或共享。

查看：

```bash
tail -f logs/game.jsonl
tail -f logs/llm.jsonl
tail -f logs/server.jsonl
```

常见问题：

- `NETWORK_ERROR：无法连接到后端` → 后端没启动，运行 `node server/index.js`，并确认用 `http://localhost:3000` 打开。
- `无法连接到 LLM 服务器` → Ollama/OpenAI 未启动，或 `LLM_ENDPOINT` 配置错误。
- `LLM 上游返回 HTTP xxx` → 上游报错，详情见 `logs/llm.jsonl` 的 `error` 事件。
- 后端返回的错误提示含 `requestId` → 在三个 JSONL 文件中搜索该值，可找到完整调用链及具体失败阶段。

> 由于浏览器只和后端同源通信，原来的 `OLLAMA_ORIGINS=*` CORS 配置不再需要。

## 提示词定制

编辑 `src/scripts/llm-prompts.js` 可自定义：
- 系统提示词的语气和约束
- 玩家状态的格式化方式
- 场景提示词模板
- 对话提示词模板

下次运行 `build.bat` 后生效。所有提示词已要求 LLM 用中文回复。

## 架构

Passage → `<<hubscene>>` 宏 → `PromptBuilder` → `LLMEngine` → `POST /api/llm` → `server/llm-proxy.js` → Ollama/OpenAI → `NarrativeUI` → SugarCube passage DOM。

前端 `LLMEngine` 不再直连 LLM。`GET/PUT /api/llm/config` 负责读取和保存后端配置，`POST /api/llm` 使用同一份配置代理请求；API Key 只写入后端本地文件，读取时仅返回脱敏状态。所有游戏状态仍保存在 `State.variables` 中。

当前 Node 后端没有鉴权、Origin 校验或速率限制，仅适合本机开发。需要对外提供服务时，应先增加访问控制并限制监听地址。

## NPC tools 回合

OpenAI-compatible 与 Ollama 分支均转发 tools 并适配 assistant/tool 历史、参数和调用 ID。NPC 请求不使用自由文本效果解析：每次 tool 只返回 STAGED/REJECTED，最终答复成功后统一提交；玩家接受礼物后才结算。取消、空答复、超限、失效或断线不会提交半回合。请求归属独立，场景氛围避让活跃 NPC 请求。

工具能力取决于具体上游模型；失败不会退化为默认奖励。当前真实端到端验证使用已配置的 OpenAI-compatible 模型，Ollama 只完成适配 fixtures 验证。详见 [交付记录](npc-agency-first-delivery.md)。


### NPC 完整调试日志（2026-09-07）

NPC 调试事件默认以 level=debug 写入 logs/game.jsonl，不需要开启 LLM_LOG_CONTENT。此开关仍只控制后端请求日志；不要把“后端只保存预览”理解为 NPC 发言未完整记录。

| 事件 | 内容与意义 |
| --- | --- |
| npc-job-enqueued | NPC 姓名、job.id、actorId、触发事件、玩家完整发言；重放已入队事件不重复记录 |
| npc-tool-call | decisionId、runId、轮次、callId、工具名称与完整参数，包括被拒绝的参数 |
| npc-tool-result | 对应 callId 的 STAGED / REJECTED、业务错误及引用 ID；STAGED 不代表已入账 |
| npc-model-tool-preamble / npc-model-reply | 工具调用轮的可见文字 / 完整最终回复；不代表业务已提交 |
| npc-turn-committed | 成功提交的回复、收据、新动作、NPC 资源/印象/关系，以及玩家钱包和背包提交前后值 |
| npc-decision-outcome / npc-tool-run-ended | 回合结果及失败、取消、过期或超限原因；失败回合不会记录 turn-committed |
| npc-offer-resolved / npc-offer-rejected | 玩家接受/拒绝结果或操作失败；成功时记录提议、收据及钱包/背包前后值 |
| npc-appointment-attended | 玩家实际赴约后的提议状态 |

通用上下文包含 sessionId、seq、clientTs、页面、地点和游戏时间。先按 sessionId 选中本次游玩，再用 job.id / decisionId 追踪一轮决策，用 callId 配对工具调用与返回，用 reference / offerId 追踪后续领取。runId 用于区分同一页面生命周期内的重试。读回旧存档可能复用业务 ID，必须结合 sessionId、seq 和 runId 判断，不能只按 decisionId 跨会话合并。

调试数据不使用普通日志的 4000 字截断和 4 层深度限制（保留 32 层异常结构保护），包含完整剧情和玩家输入。常见凭证字段与文本格式继续脱敏，thinking/reasoning_content 不记录；不要直接共享原始日志。日志采用现有 /api/log 尽力上报，不是可靠审计存储：断网或立即关闭页面可能丢失未送达记录，超过浏览器 keepalive 限制的大批次采用普通请求。历史截断内容无法通过本次改动补回。

验证：tests/npc-debug-logging.test.js 覆盖长文本、深层参数、脱敏、工具拒绝后修正、草稿与提交/领取区别、失败不提交以及日志异常不干扰游戏。

### 右上角 LLM 调用查看器（2026-09-07）

右上角 `STATE MONITOR` 增加“LLM 调用”视图。默认跟随最新请求，也可从下拉框固定查看某次请求；NPC 工具循环的每轮请求单独列出，通过 runId、round 和 decisionId 关联。

- 展示统一客户端真正发往 `/api/llm` 的 messages/prompt、请求参数、tools 定义、模型 tool_calls、可见正文和错误/取消状态。这是前端请求视图，不是供应商 HTTP 报文；后端仍会适配协议和使用本机配置。
- NPC Prompt 显示 `NPCDirector.messagesFor` 的实际构建片段：角色表演、事实与行动边界、人物设定、当前处境与已知事实、语气示例（如有，非经历）、照片任务入口（仅相关人物/任务）、精简触发事件，以及后续消息顺序；任务仅在上下文出现，不重复拼接关联任务。其他请求展示原始消息顺序及已有段落标题，不猜测没有显式提供的构建来源。
- NPC 工具事件展示参数、STAGED/REJECTED、最终答复和业务提交结果；场景 `start_dialogue` 展示执行结果。`STAGED` 不等于已提交，更不等于玩家已领取奖励。重试和读档复用业务 ID 时，以本次运行标识区分，避免混入之前的结果。
- 当前页面内存最多保留 12 次请求，总容量最多约 400 万字符；单次采集文本预算 24 万字符、单段文本 8 万字符，工具事件最多 60 条且每条 1.6 万字符。超限内容有截断标记。刷新页面清空，不写入 SugarCube 存档，也不读取服务器历史日志；既有文件日志策略不变。
- 内容使用纯文本 DOM，常见凭证脱敏，thinking/reasoning 字段省略。展开项和阅读滚动位置在日志更新时保留；无更新时不重建查看器。

相关实现：`src/scripts/llm-trace.js`、`src/scripts/debug-panel.js`。不需要安装依赖或修改后端配置。

### 任务现场调用与日志（2026-09-08）

新增请求类型 `quest-event`，复用 LLMToolRunner。开场工具为 `present_quest_scene`，玩家行动结果工具为 `resolve_quest_event`。NPC 工具中新增 `register_quest_area`，地点字段及草稿提交语义见 llm-content.md 的“地点绑定与任务现场事件”。

右上角“LLM 调用”可查看任务现场的真实 Prompt 拼接规则、程序现场、玩家行动、工具参数、STAGED/REJECTED 及“任务事件最终提交结果”。任务请求与 NPC 请求仍以每次实际请求分别展示，同一工具循环按 runId/round 关联。

新增完整 debug 事件：
- `quest-event-started`：attempt、questId/objectiveId/actionId、是否开场、玩家输入。
- `quest-event-committed`：实际写入的现场、历史、结果和任务状态；开场/continue 也会记录，不等于目标已完成。
- `quest-event-outcome`：最终成功、失败或过期结果。

共享 runner 的工具调用仍记为 npc-tool-call / npc-tool-result / npc-model-reply 等通用事件名；任务调用通过 context.questId、objectiveId、eventAttempt 与 NPC decisionId 区分。只有 quest-event-committed 的结果与任务进度可视为实际提交，不能把模型最终文字或 STAGED 当成完成。延续现有日志脱敏、完整 debug 记录及页面内 trace 容量限制。

交付合并后，最终返回本人汇报/归还不再产生 quest-event 请求；点击 NPC 对话中的交付，沿用 quest_settled → npc-agency 工具循环生成一次融合现场与对白的回应。填写的交付说明记录为玩家说法；无说明时仅传当面交付事实。NPC Prompt 不传离场事件历史/结果，旧存档嵌套事实也按视角过滤，但全局 debug 证据仍保留。展示层修复字面换行不修改原始 tool-call 日志，因此日志与显示文字可能存在转义形式差异。
