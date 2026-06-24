# 构建说明

## 环境要求

- Windows：`build.bat` 使用内置的 `tools\tweego.exe`。
- macOS/Linux：单独安装 Tweego，并更新 `build.sh` 指向它。

## 构建命令

```batch
build.bat
```

输出：`dist/index.html`

## 关键：如何包含 JavaScript

**将 JS 文件作为源目录传入，不要通过 `--head`。**

正确（`build.bat`）：

```batch
tweego -f sugarcube-2 -o dist\index.html src\passages src\scripts --module=src\styles\base.css ...
```

错误：

```batch
tweego -f sugarcube-2 -o dist\index.html src\passages --head=src\scripts\engine.js ...
```

### 为什么 `--head` 对 SugarCube 脚本会失败

Tweego 的 `--head` 选项会按原样把文件内容追加到 HTML `<head>` 元素中。这意味着：

1. JS 不会被自动包裹在 `<script>` 标签中，除非你自己包裹。
2. 即使包裹了，它也会运行在与 SugarCube 引擎分离的浏览器脚本作用域中。
3. SugarCube 全局对象（`Macro`、`State`、`Save`、`Setting`、`Story`、`Engine`）无法访问。

把 `src/scripts/` 作为源目录传入，Tweego 就会把它作为 SugarCube **用户脚本** 嵌入到 `<tw-storydata>` 中。SugarCube 会在与引擎相同的作用域中执行这些脚本，因此所有全局对象都可用。

## 关键：自关闭宏定义

自关闭宏应完全省略 `tags` 属性：

```javascript
Macro.add('action', {
  handler: function () { /* ... */ }
});
```

使用 `tags: null` 会让 SugarCube 期待一个关闭标签（`<</action>>`）并发出警告。

## 已修复的运行时错误

| 症状 | 原因 | 修复 |
|------|------|------|
| `TypeError: Cannot read properties of null (reading 'hasChildNodes')` | JS 被放入 `<head>` 但没有 `<script>` 标签 | 将脚本作为源目录传入 |
| `macro <<action>> does not exist` | JS 在分离作用域中，宏从未注册 | 将脚本作为源目录传入 |
| `cannot find a closing tag for macro <<action>>` | 在 `Macro.add` 中使用了 `tags: null` | 完全省略 `tags` 属性 |

## CSS 模块

CSS 文件通过 `--module` 传入。它们会被作为 SugarCube 样式表模块插入并全局生效。

## 输出

`dist/index.html` 是一个自包含文件，可以直接在浏览器中打开，也可以通过任何静态服务器提供。

## 本地化说明

所有游戏文本、UI 标签、LLM 提示词和 fallback 内容均已本地化为中文。提示词会明确要求 LLM 用中文回复。修改 `src/scripts/llm-prompts.js` 可调整提示词语言或风格；修改 `src/passages/` 中的 `.twee` 文件可调整静态游戏文本。
