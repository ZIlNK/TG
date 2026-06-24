# CLAUDE.md — Text Game UI Prototype

Project root: `D:\code\TG`

## What this project is

A Twine + SugarCube-2 scaffold for a text-based game UI inspired by *Degrees of Lewdity*. It is not a complete game; it is a working prototype with placeholder content and extension interfaces. **All game text, UI labels, and LLM prompts are in Chinese.**

## Build

```batch
build.bat
```

Compiled output: `dist/index.html`

Open `dist/index.html` in a browser to run.

## Source layout

```
src/
  passages/   .twee story files (scenes, UI special passages)
  scripts/    SugarCube user scripts (macros, save system, mod API, themes, pixel art, LLM modules)
  styles/     CSS modules (base, UI, themes, pixel art, LLM UI)
tools/
  tweego.exe  Twine compiler (Windows x64)
  storyformats/  Bundled story formats including SugarCube-2
```

## Critical build rule

JS files in `src/scripts/` must be passed to Tweego as **source files/directories**, not via `--head`. `--head` inserts raw text into `<head>` in a separate JS scope and breaks access to SugarCube globals (`Macro`, `State`, `Save`, `Setting`).

Self-closing macros should omit the `tags` property entirely; `tags: null` causes SugarCube to expect a closing tag.

## Extension interfaces

- `ModAPI` (`src/scripts/engine.js`): runtime mod loading via `loadModData()` — supports CSS, JS, event hooks.
- `CustomSave` (`src/scripts/save-system.js`): 8 localStorage slots plus JSON file export/import.
- `ThemeEngine` (`src/scripts/engine.js`): theme switching and dynamic resource registration.
- `LLMEngine` + `PromptBuilder` + `NarrativeUI` (`src/scripts/llm-*.js`): optional LLM-powered dynamic scenes and chat via Ollama/OpenAI-compatible APIs.
- `LLMStructured` (`src/scripts/llm-structured.js`): JSON generation/validation for LLM-driven content (scenes, NPCs, quests).

## Docs

- `README.md` — user-facing setup and feature list
- `docs/architecture.md` — component/data flow overview
- `docs/build-notes.md` — detailed build pitfalls and the `--head` issue
- `docs/llm-integration.md` — LLM setup, streaming macros, and CORS troubleshooting
- `docs/llm-content.md` — LLM-driven content generation (scenes, options, NPCs, quests)

## Red lines

- Do not add external build tools beyond Tweego unless the user explicitly asks.
- Keep `dist/` gitignored.
- Do not commit `tools/tweego.exe` if the repository is meant to be lightweight; document that Tweego is required instead.
