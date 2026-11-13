# AGENTS.md — TG 文字游戏

项目根：`D:\code\TG`。所有游戏文案、UI 标签与 LLM 提示词均为中文。

## 这是什么

两条产品线并存。动手前先确认改的是哪一条：

| 产品线 | 位置 | 状态 |
| --- | --- | --- |
| **DeepSeek Harness 原生插件（主线）** | `packages/dsh-tg/` | 活跃开发，当前 `0.6.0`（2026-10-26） |
| 旧版 Twine + SugarCube-2 网页游戏 | `src/` + `server/` | 2026-09-29 起冻结，仅作历史版本与内容数据源 |

插件的角色、地点、主题数据由 `packages/dsh-tg/scripts/sync-content.mjs` 从旧版 `src/scripts/content.js` 与 `src/styles/theme-*.css` 抽取。**改人设或地点文案仍要改旧版文件，再执行 `npm run content:sync`。**

## 命令速查

旧版网页游戏（项目根）：

```batch
build.bat          :: Tweego 编译 -> dist/index.html
start.bat          :: 编译 + 启动后端 + 打开浏览器（-s 跳过编译）
node server/index.js
```

原生插件（`packages/dsh-tg/`）：

```powershell
npm ci --ignore-scripts
npm test           # tsx --test tests/*.test.ts
npm run build      # tsc --noEmit + tsdown + 客户端包装 + node --check
npm run pack:plugin
npm run content:sync
```

本机验证基线（2026-11-13）：Node v22.20.0；旧版 323 条测试、插件 53 条测试全部通过，`tsc --noEmit` 无错误。

在禁止子进程的沙箱里，`npm test` 会以 `spawn EPERM` 失败（tsx/esbuild 需要起子进程），不是代码问题。逐文件跑可绕过：`node --test --experimental-test-isolation=none tests/<file>.test.js`。

## 插件架构与边界

```
src/core/   纯规则：schema（Zod 合同）、rules（玩法规则）、service（状态机/串行队列/收据）、
            context（知情范围裁剪）、world（初始世界）
src/host/   Cordis 适配：ModelRunner（宿主 Agent + 工具协议）、Remote、存储域、外部提示词
src/client/ React 面板（现场/背包/角色/地图/任务日志/调用记录/存档/设置）
src/rpc.ts  一份 Zod 表同时生成 Host descriptor 与 Client 类型
```

必须守住的边界：

- `src/core` 不依赖 React、Cordis、DOM 或 SugarCube。**Host 是唯一状态权威**，浏览器只记「上次打开的游戏编号」。
- 模型只能通过 `tg_propose_result` / `tg_enter_dialogue` 暂存候选，由 `GameService` 复核后提交。不要新增让模型直接改状态的工具。
- 提交走 `submitAction`：`requestId` 收据幂等 + `expectedRevision` 乐观并发 + `generation` 代次；过期结果不得覆盖新状态。
- 结算先在 `applyPlan` 的 `structuredClone` 草稿上执行，任一步前置条件失败则整份丢弃。
- NPC 上下文只能来自 `buildNpcContext` 的 `knownBy` 过滤；不得把其他人物对话、玩家私有背包或未汇报的任务进度泄露给该 NPC。

## 源码布局

```
src/passages/     .twee 故事与 UI 特殊 passage（旧版）
src/scripts/      SugarCube 用户脚本：引擎、存档、Mod API、主题、像素图、LLM、NPC、任务、移动（旧版）
src/styles/       CSS 模块与主题变量（旧版）
server/           零依赖 Node 后端：静态托管 + /api/llm 代理 + /api/log 收集
tests/            旧版测试（node:test）
packages/dsh-tg/  原生插件（源码见上节，测试在 packages/dsh-tg/tests）
docs/             架构、构建、LLM、插件迁移与验收记录
tools/            tweego.exe 与内置 story formats
logs/             运行时日志（gitignored）
```

## 构建红线

- `src/scripts/` 的 JS 必须作为 Tweego 的 **source** 传入，不能用 `--head`：`--head` 把内容插进独立作用域的 `<head>`，会导致拿不到 `Macro`、`State`、`Save`、`Setting`。
- 自闭合宏不要写 `tags` 属性；`tags: null` 会让 SugarCube 期待闭合标签。
- 插件用 TypeScript 标准装饰器，由 tsdown 打包。改 `src/` 后必须重新 `npm run build`，否则 `lib/` 还是旧代码；`lib/` 与 `artifacts/` 均 gitignored。

## 安全与数据

- `server/` 是无鉴权的本地开发服务，未加访问控制前不要暴露到公网或不可信局域网。
- LLM 正文默认只记 300 字预览；`LLM_LOG_CONTENT=true` 会写完整提示词与回复，按敏感数据处理。
- 不要提交 `server/.env`、`server/llm-config.local.json`（含明文 API Key）、`logs/`、`dist/`。
- 存档与导出不得携带 API Key；密钥只存在于本机后端配置。

## 深入文档

| 文档 | 内容 |
| --- | --- |
| `docs/architecture.md` | 两条线的组件与数据流总览 |
| `docs/deepseek-harness-migration.md` | 插件实现、模块职责、一次行动如何提交 |
| `docs/deepseek-harness-context.md` | 分阶段上下文、知情范围与结构化经历 |
| `docs/deepseek-harness-traces.md` | 调用记录面板与轨迹存储 |
| `docs/deepseek-harness-validation.md` | 早期 Web 验收（0.1.6，2026-10-06） |
| `docs/deepseek-harness-desktop-validation.md` | 桌面版适配验收（0.2.1，2026-10-17） |
| `docs/build-notes.md` | Tweego 包含规则与 `--head` 问题 |
| `docs/llm-integration.md` | 旧版 LLM 配置、请求流与日志排查 |
| `docs/llm-content.md` | 旧版 LLM 内容生成（场景/选项/NPC/任务） |
| `docs/npc-agency-first-delivery.md` | 旧版 NPC 自主行为首批交付记录 |
| `packages/dsh-tg/README.md` | 插件安装、卸载、版本变更 |

## 红线

- 除 Tweego 外不新增构建工具；`server/` 是运行时服务不是构建工具，保持零依赖（Node 内置 + 全局 `fetch`，Node 18+）。
- 保持 `dist/`、`logs/`、`server/.env`、`server/llm-config.local.json` gitignored。
- 不要把 `tools/tweego.exe` 提交进仓库；改为文档说明需要 Tweego。
- 生成选项的 `effects` 只能在玩家点击该选项时应用；渲染 `DynamicScene` 或 `hubscene` 本身不得改动玩家状态。
- 移动统一经 `MoveTool.invoke()`，任务进度统一经 `TaskEngine`；不要为单次需求绕过这两个入口直接改 `$position` / `$quests`。
- 插件的 `src/core` 不得引入宿主或浏览器依赖，否则规则无法在测试中独立运行。