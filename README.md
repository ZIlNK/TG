# 文字游戏 UI 原型

一个受 *Degrees of Lewdity* 启发的 Twine + SugarCube-2 脚手架。

## 功能

- **主场景/故事页面**：占位叙事文本和动作选项
- **侧边栏状态栏**：显示时间、地点、金钱和属性条
- **场景导航**：卧室、街道、公园、商店
- **保存/读取系统**：使用 localStorage，支持 JSON 文件导出/导入
- **设置开关**：宽屏、动画、像素缩放、静音、成人内容
- **Mod 扩展接口**（`ModAPI`）：运行时注入样式/脚本/钩子
- **动态主题切换**：默认暗色 + 浅色主题
- **像素艺术占位图生成器**：生成确定性 SVG 图片
- **可选 LLM 集成**（`LLMEngine`、`PromptBuilder`、`NarrativeUI`）：通过 Ollama 或兼容 OpenAI 的 API 实现动态场景叙述和自由对话
- **LLM 驱动的内容生成**：场景、选项、NPC、任务（详见 `docs/llm-content.md`）

## 环境要求

- Windows x64 已内置 `tools/` 目录下的 Tweego。

## 构建

### Windows

```batch
build.bat
```

### Unix / macOS

如果你有原生 `tweego` 二进制文件在 PATH 中，编辑 `build.sh` 指向它：

```bash
./build.sh
```

编译后的游戏输出到 `dist/index.html`。

> 详见 [`docs/build-notes.md`](docs/build-notes.md) 了解重要的 Tweego 包含规则（特别是 JS 文件必须作为 source 目录传入，而不是通过 `--head`）。

> 详见 [`docs/llm-integration.md`](docs/llm-integration.md) 了解 LLM 设置、流式宏和 CORS 排错。

> 详见 [`docs/llm-content.md`](docs/llm-content.md) 了解如何用 LLM 生成场景、选项、NPC 和任务。

## 运行

用任意现代浏览器打开 `dist/index.html`。

本地开发时，可以用静态服务器运行 `dist/`：

```bash
cd dist
python -m http.server 8000
```

然后打开 `http://localhost:8000`。

## 项目结构

```
src/
  passages/   .twee 故事文件
  scripts/    JavaScript 模块（引擎、保存、设置、像素图、LLM）
  styles/     CSS 主题和 UI 样式
docs/         架构和构建文档
tools/
  tweego.exe  Twine 编译器（Windows x64）
  storyformats/  包含 SugarCube-2 的故事格式
```

## Modding

可以通过 `ModAPI.loadModData()` 在运行时加载 mod：

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

## 存档格式

存档保存在 `localStorage` 中，键名为 `tg_save_0` 到 `tg_save_7`。每个存档是包含标题、时间戳和序列化 SugarCube 状态的 JSON 记录。导出功能会把这个记录下载为 `.json` 文件。

## 许可

MIT
