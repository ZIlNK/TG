# 架构

## 概述

本项目是一个使用 Tweego 从 Twine/SugarCube-2 源文件编译而成的单页 HTML 游戏。

## 数据流

```
Twee passages (.twee)  ──────┐
User scripts (.js)     ──────┼──▶  Tweego  ──▶  dist/index.html
CSS modules (.css)     ──────┘
```

## Passage 类型

| Passage | 用途 |
|---------|------|
| `StoryInit` | 初始化 `$player`、`$time`、`$location`、`$world`、`$game`、`$theme`、LLM 相关状态 |
| `StoryCaption` | 每条 passage 渲染的侧边栏状态栏 |
| `StoryMenu` | 侧边栏导航链接 |
| `PassageHeader` | 每条 passage 的设置（如注册场景图片、兜底初始化 LLM 状态） |
| `PassageFooter` | 每条 passage 的清理/钩子 |
| `Start` | 开场场景 |
| `Bedroom`、`Street`、`Park`、`Shop` | 地点场景 |
| `Settings` | 保存/读取和配置 UI |
| `Mod Test` | Mod 扩展接口演示 |
| `LLMConfig`、`LLMSceneDemo`、`LLMChatDemo` 等 | LLM 功能演示 |
| `DynamicScene` / `LLMGateway` | 动态生成场景的渲染与路由 |

## JavaScript 模块

- `engine.js` — `ModAPI`、`ThemeEngine`、`advanceTime()`、`<<action>>` 宏、事件钩子
- `save-system.js` — 基于 SugarCube `Save` API 的 `CustomSave` 封装
- `settings.js` — SugarCube `Setting` 定义
- `pixel-images.js` — 确定性 SVG 像素艺术生成器和 `<<sceneimg>>` 宏
- `llm-client.js` — `LLMEngine`：支持 Ollama 和兼容 OpenAI 的 API，含流式输出
- `llm-prompts.js` — `PromptBuilder`：用中文从游戏状态组装提示词
- `llm-ui.js` — `NarrativeUI`：流式文本、打字指示器、错误横幅
- `llm-structured.js` — `LLMStructured`：JSON 生成、解析、校验和 fallback
- `llm-macros.js` — `<<llmscene>>`、`<<llmchat>>`、`<<llmconfig>>`、`<<llmscene2>>`、`<<llmoptions>>`、`<<llmnpc>>`、`<<llmquest>>`、`<<npcchat>>`

## 状态模型

所有游戏状态都保存在 SugarCube 的 `State.variables` 对象中。关键对象：

- `$player` — 属性、背包、金钱
- `$time` — 小时、分钟、天数、星期几
- `$location` — 当前场景名称
- `$world` — 天气、温度
- `$theme` — 当前主题名称
- `$modRegistry` — 已加载 mod 名称
- `$llmConfig`、`$llmHistory`、`$llmSession` — LLM 配置与历史
- `$generatedScenes`、`$dynamicSceneId` — 生成的场景
- `$npcs`、`$activeNPCId` — 生成的 NPC
- `$quests`、`$activeQuestId` — 生成的任务
- `$worldMemory` — 持久化的世界事件

## Mod API

可以在运行时加载 mod，无需重新编译：

```javascript
ModAPI.loadModData({
  name: '我的 Mod',
  version: '1.0.0',
  css: '#ui-bar { border-color: #ff0 !important; }',
  script: 'console.log("我的 Mod 已加载");',
  hooks: {
    passageStart: function () { /* ... */ }
  }
});
```

## LLM 集成

本原型可通过外部 LLM 生成动态叙事和实时对话。所有提示词已本地化为中文，并要求模型用中文回复。

**数据流（流式叙事）：**
```
Twee passage
    ↓
<<llmscene>> / <<llmchat>> 宏
    ↓
PromptBuilder（从 $player、$time、$location、$world 组装系统提示词）
    ↓
LLMEngine（fetch 到 Ollama 或兼容 OpenAI 的 API）
    ↓
NarrativeUI（流式文本、打字指示器、错误横幅）
    ↓
Passage DOM
```

**数据流（结构化内容生成）：**
```
Macro call（<<llmscene2>> / <<llmoptions>> / <<llmnpc>> / <<llmquest>>）
    ↓
PromptBuilder（带 JSON schema 的中文提示词）
    ↓
LLMStructured.generateJSON（非流式 JSON 生成与校验）
    ↓
State.variables（$generatedScenes / $npcs / $quests）
    ↓
DynamicScene / 内联选项 / NPCChat 渲染内容
```

**上下文隔离：** 历史记录按 `channel` 标记：`scene`（场景生成）、`chat`（自由对话）、`npc.dialogue`（每个 NPC 独立）。提示词只读取对应 channel 的历史，避免场景生成被闲聊污染。

**状态：** `$llmConfig`、`$llmHistory`、`$llmSession`、`$generatedScenes`、`$npcs`、`$quests`、`$worldMemory` 都保存在 `State.variables` 中，因此由 `CustomSave` 自动保存/读取。

**钩子：** 通过 `ModAPI` 触发 `llmPromptReady` 和 `llmResponseReady`，mod 可以拦截或改写提示词和回复。

详见 `docs/llm-integration.md`（LLM 设置、宏、CORS 排错）和 `docs/llm-content.md`（LLM 驱动的内容生成）。

## 主题

主题是编译进 HTML 的 CSS 文件。`ThemeEngine.setTheme(name)` 通过在根元素上设置 `data-theme` 来切换。可以按主题注册资源（图片）。

## 构建说明

详见 `docs/build-notes.md` 了解关键的 Tweego 包含规则和已修复的 `--head` 作用域 bug。
