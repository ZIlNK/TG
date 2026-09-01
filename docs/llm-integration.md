# LLM 集成指南

## 概述

本游戏支持通过大语言模型（LLM）进行 AI 驱动的动态叙事生成。你可以使用本地 Ollama 实例或任何兼容 OpenAI 的 API。

当前所有 LLM 相关的提示词和 UI 都已本地化为中文；模型会被明确要求用中文回复。

## 快速开始（Ollama）

1. 从 https://ollama.com 安装 Ollama
2. 拉取模型：`ollama pull llama3.2`
3. 启用 CORS 启动 Ollama：
   - **Windows：** `set OLLAMA_ORIGINS=*` 然后 `ollama serve`
   - **macOS/Linux：** `OLLAMA_ORIGINS=* ollama serve`
4. 打开游戏，前往 **设置 > LLM 集成 > 打开 LLM 配置**
5. 点击 **测试连接**
6. 启用 LLM 并保存
7. 访问演示：
   - 从**侧边栏**：**LLM 场景演示** 或 **LLM 对话演示**
   - 或进入 **街道** 场景，点击 **调查奇怪的雾**

## 配置

| 设置 | 说明 | 默认值 |
|------|------|--------|
| 启用 LLM | 总开关 | `false` |
| 提供商 | `ollama` 或 `openai` | `ollama` |
| 接口地址 | API 基础 URL | `http://localhost:11434` |
| 模型 | 模型名称 | `llama3.2` |
| API 密钥 | 仅兼容 OpenAI 时需要 | （空） |
| 温度 | 创造性（0-2） | `0.8` |
| 最大 Token | 回复长度限制 | `512` |

配置保存在 `$llmConfig`（SugarCube 状态变量）中，因此会自动保存和读取。

## 宏

### `[[LLM 配置|LLMConfig]]`

侧边栏菜单项，打开配置页面。

### `<<llmconfig>>`

渲染配置表单。通常用于 `LLMConfig` passage。

流式叙事与动态选项能力目前由 `<<hubscene>>` 承载（见 `docs/llm-content.md`），自由对话由 `<<npcchat>>` 承载；旧的 `<<llmscene>>` / `<<llmchat>>` / `<<llmoptions>>` 宏已移除。

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

## 保存 / 读取

LLM 对话历史（`$llmHistory`）和配置（`$llmConfig`）会自动随现有保存系统保存和读取。保存前历史记录会被裁剪到最后 50 条，防止存档膨胀。

## CORS 排错

如果在使用 Ollama 时看到 `CORS_BLOCKED` 错误，说明浏览器阻止了来自 `file://` 或不同源的请求。

**Windows：**
```batch
set OLLAMA_ORIGINS=*
ollama serve
```

**macOS/Linux：**
```bash
OLLAMA_ORIGINS=* ollama serve
```

或者，用本地静态服务器运行游戏，而不是直接打开 `dist/index.html`：
```bash
cd dist
python -m http.server 8000
```

然后打开 `http://localhost:8000`。

## 提示词定制

编辑 `src/scripts/llm-prompts.js` 可自定义：
- 系统提示词的语气和约束
- 玩家状态的格式化方式
- 场景提示词模板
- 对话提示词模板

下次运行 `build.bat` 后生效。所有提示词已要求 LLM 用中文回复。

## 架构

Passage → `<<hubscene>>` 宏 → `PromptBuilder` → `LLMEngine` → 流式 fetch → `NarrativeUI` → SugarCube passage DOM。

所有状态保存在 `State.variables` 中，因此保存/读取、导出/导入和 mod 钩子无需额外接线即可工作。
