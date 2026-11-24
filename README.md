# 文字游戏（TG）

受 *Degrees of Lewdity* 启发的中文文字游戏，含两条产品线：

| 产品线 | 位置 | 状态 |
| --- | --- | --- |
| **DeepSeek Harness 原生插件** | `packages/dsh-tg/` | 主线，当前 `0.6.1` |
| Twine + SugarCube-2 网页游戏 | `src/` + `server/` | 2026-09-29 起冻结，作为历史版本与内容数据源 |

两者共用同一套角色、地点与主题数据：插件通过 `npm run content:sync` 从旧版 `src/scripts/content.js` 与主题 CSS 抽取。改文案仍改旧版文件，再同步。

---

## 主线：DeepSeek Harness 原生插件

独立游戏面板接入官方 Harness，复用宿主的模型与凭证；游戏状态由 Host 统一持有，AI 只提交候选行动，规则引擎复核算完才落库。

插件按官方 Windows 桌面版 Harness **0.2.1-rc.2** 类型构建，保留 **0.2.0-rc.2** 与早期 Web **0.1.5-rc.2** 的协议声明。

### 安装（桌面版）

首次需先打包：`cd packages/dsh-tg && npm ci --ignore-scripts && npm run pack:plugin`，产物为 `artifacts/dsh-tg-0.6.1.tgz`（`artifacts/` 不进版本库）。

先在桌面版「应用」菜单选择**退出**（关窗口只是隐藏），再在插件目录执行：

```powershell
cd packages/dsh-tg
./scripts/manage-desktop.ps1 -DesktopRoot 'D:/AppData/DSH' -Package './artifacts/dsh-tg-0.6.1.tgz'
```

`DesktopRoot` 改为实际安装目录。脚本使用桌面版自带 CLI，备份 profile 配置后安装并登记 bundle；宿主仍在运行或版本不匹配时拒绝修改。完成后重新打开桌面版，在侧栏选择「文字游戏」。

卸载：`./scripts/manage-desktop.ps1 -DesktopRoot 'D:/AppData/DSH' -Action remove`（保留游戏存档）。

### 玩法

选具体模型或「跟随 DSH 当前模型」开局，输入想做的事，或生成现场选项。管理入口只有背包、角色、地图、任务日志、调用记录、存档、设置；移动、交付、购买和接受提议都回到现场进行。

- 行动可取消；已确认的结果保留，重试只补齐未完成阶段。
- 每次提交自动保存，另有 8 个手动栏位与 JSON 导入导出。
- 与 NPC 交谈时进入独立对话界面，每条消息结算 1 分钟，只调用人物回应。
- 调用记录可查看每个阶段实际发送的提示词、模型输出、工具参数与返回值，以及已结算的状态变化。

完整版本变更见 [插件 README](packages/dsh-tg/README.md)；实现原理见 [迁移说明](docs/deepseek-harness-migration.md)、[上下文与经历](docs/deepseek-harness-context.md)、[调用记录](docs/deepseek-harness-traces.md)。

### 开发

```powershell
cd packages/dsh-tg
npm ci --ignore-scripts
npm test
npm run pack:plugin
```

依赖锁定在 `package-lock.json`；`lib/` 与 `artifacts/` 是构建产物，不进版本库。

---

## 历史版本：Twine 网页游戏

基于 Tweego + SugarCube-2 的单页 HTML 游戏，配套零依赖 Node 后端（静态托管、LLM 代理、日志收集）。功能齐全但已冻结，仅用于保留旧存档、旧玩法与内容数据源。

### 构建与运行

```batch
build.bat          :: 编译到 dist/index.html
start.bat          :: 编译 + 启动后端 + 打开浏览器（-s 跳过编译）
```

也可以手动分两步：

```batch
build.bat
node server/index.js
```

然后打开 <http://localhost:3000>。直接双击 `dist/index.html` 也能玩，但 LLM 与日志上报不可用（依赖 `/api/llm` 与 `/api/log`）。

环境要求：Windows x64（`tools/` 内置 Tweego）、Node.js 18+。

> Tweego 的包含规则有个坑：`src/scripts/` 下的 JS 必须作为 source 传入，不能走 `--head`，否则拿不到 SugarCube 全局。详见 [`docs/build-notes.md`](docs/build-notes.md)。

### 功能

- 主场景叙事、侧边栏状态栏（时间、地点、金钱、属性条）与多地点导航
- 存档：8 个 localStorage 栏位 + JSON 文件导出/导入
- 设置开关：宽屏、动画、像素缩放、静音、成人内容
- `ModAPI` 运行时加载 mod（CSS / JS / 事件钩子）
- 默认暗色 + 浅色主题切换，像素艺术 SVG 占位图生成
- 可选 LLM 集成：Ollama 或 OpenAI 兼容接口，支持动态场景、自由对话、结构化内容（场景 / 选项 / NPC / 任务）
- NPC 自主行为：模型通过 tools 决定礼物、邀请、承诺与后续意图，程序验证资源与事实，玩家接受后才入账
- 运行时日志：LLM 请求/响应与游戏日志落盘为 `logs/*.jsonl`，同时回显终端

### LLM 配置

游戏内「LLM 配置」页面设置，保存后由本机后端持久化，重开或读档会自动恢复。API Key 不随存档保存，后端只返回掩码状态。

日志写在 `logs/llm.jsonl`、`logs/game.jsonl`、`logs/server.jsonl`，每次调用带统一 `requestId` 可跨文件串联。

> 后端是无鉴权的本地开发服务，不要暴露到公网或不可信局域网。正文默认只记 300 字预览；`LLM_LOG_CONTENT=true` 会写完整提示词与回复，须按敏感数据管理。

### Modding

```javascript
ModAPI.loadModData({
  name: '我的 Mod',
  version: '1.0.0',
  css: '#ui-bar { border-color: #ff0 !important; }',
  script: 'console.log("我的 Mod 已加载");',
  hooks: {
    passageStart: function () { console.log('新 passage'); }
  }
});
```

### 体验 NPC 自主行为

起床 → 去街上 → 去公园 → **与晚晴交谈** → **询问遗失的照片** → 接受请求。结束对话，沿固定入口前往林间小径寻找照片，回公园入口当面交付。模型自行决定是否回报、回报什么；礼物卡需玩家接受才入账。

通过睡眠/休息推进时间，再次见到晚晴时她可根据过往经历回应或发出邀请。邀请只支持本人登记所在的子区域，需在约定时间手动赴约；首批不含 NPC 自主移动。实现与验证边界见 [NPC 首批交付记录](docs/npc-agency-first-delivery.md)。

### 社区人设：亨特

起床 → 去街上 → 去公园 → **与亨特交谈**。亨特位于公园入口，使用现有 NPC 对话、关系与记忆系统；旧存档会自动补入缺失角色卡，不覆盖已有角色。

人设改编自 [botson 的 Hunter Springfield 角色卡](https://chub.ai/characters/botson/hunter-springfield-4f929e67dad7)，保留慢热、有礼、喜欢阅读绘画、渴望朋友又回避社交，以及遇到不公平时坚持原则的性格。中文人设在 `src/scripts/content.js` 的 `characterCards.hunter.personality`，按动机、情境与表达习惯组织；`dialogueExamples` 单独提供示例，只指导表达，不作为真实经历。

---

## 目录结构

```
packages/dsh-tg/   原生插件：src/core 规则、src/host 宿主接入、src/client React 面板、tests
src/passages/      旧版 .twee 故事与 UI 特殊 passage
src/scripts/       旧版 SugarCube 脚本（引擎、存档、Mod API、LLM、NPC、任务、移动）
src/styles/        旧版 CSS 与主题变量
server/            旧版零依赖 Node 后端（托管 + LLM 代理 + 日志）
tests/             旧版测试（node:test）
docs/              架构、构建、LLM、插件迁移与验收记录
tools/             tweego.exe 与内置 story formats
logs/              运行时日志（gitignored）
```

## 存档格式

- **插件**：结构化存储域 `tg_game_v1`（每局一条完整记录）与 `tg_traces_v1`（调用轨迹），另有 0–7 共八个存档栏位；浏览器只保存「上次打开的游戏编号」。
- **旧版**：`localStorage` 的 `tg_save_0` 到 `tg_save_7`，每条是含标题、时间戳与序列化 SugarCube 状态的 JSON；导出即下载该记录。

## 许可

MIT