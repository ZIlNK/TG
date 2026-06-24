# LLM-Driven Dynamic Content Generation

This document describes how the game uses a Large Language Model (LLM) to generate playable content: scenes, choices, NPCs, and quests.

## Overview

Unlike the streaming prose macros (`<<llmscene>>`, `<<llmchat>>`) which only produce narrative text, the content-generation macros produce **structured JSON objects** that are stored in `State.variables`. A shared `DynamicScene` passage then renders these objects as playable scenes with action links.

Generated content is automatically saved and loaded with the existing save system.

## Architecture

```
Macro call (<<llmscene2>> / <<llmoptions>> / <<llmnpc>> / <<llmquest>>)
    ↓
PromptBuilder.sceneObjectPrompt() / optionsPrompt() / npcPrompt() / questPrompt()
    ↓
LLMStructured.generateJSON(prompt, schema, fallback)
    ↓
Parsed JSON object
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

Generated scene JSON schema:
```json
{
  "id": "scene-street-fog-1718900000000",
  "title": "Fog-Shrouded Street",
  "location": "Street",
  "mood": "eerie",
  "text": "Mist coils around the lampposts...",
  "options": [
    { "label": "Investigate the alley", "target": "llm:generate:alley", "tooltip": "Look closer" },
    { "label": "Return home", "target": "Bedroom", "tooltip": "Flee the fog" }
  ]
}
```

### `<<llmoptions "Context" "Count">>`

Generates contextual action options and renders them as clickable links.

Example:
```twee
:: CityChoices
!What will you do?

<<llmoptions "You are in the city with a few free hours." 4>>
```

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

Generates a quest tied to an NPC.

Example:
```twee
:: NewQuest
!A Request

<<llmquest $activeNPCId "a missing person">>
```

### `<<npcchat "npcId">>`

Opens a chat interface with a generated NPC. The LLM roleplays using the NPC's traits and memory. Dialogue history is stored **per-NPC** in `npc.dialogue`, completely separate from general chat and scene contexts.

## Context Separation

To prevent scene-generation prompts from being polluted by chat history (and vice versa), all history entries are tagged with a `channel`:

| Channel | Used By | Storage |
|---------|---------|---------|
| `chat` | `<<llmchat>>` | `$llmHistory` entries with `channel: 'chat'` |
| `scene` | `<<llmscene>>`, `<<llmscene2>>` | `$llmHistory` entries with `channel: 'scene'` |
| per-NPC | `<<npcchat>>` | `npc.dialogue` array on each NPC object |

`PromptBuilder.getHistory(channel, limit)` filters by channel, so prompts only see the relevant context.

## Dynamic Passage Simulation

SugarCube-2 cannot create passages at runtime. Generated scenes are rendered by a single `DynamicScene` passage that reads `$generatedScenes[$dynamicSceneId]`. Options with `target: "llm:generate:something"` are routed through the `LLMGateway` passage to generate follow-up content.

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

If the LLM returns malformed JSON or fails to respond, `LLMStructured` returns a safe fallback object so the game never becomes unplayable:
- `fallbackScene()` — a generic scene with a "Return to street" option
- `fallbackOptions(count)` — a few default options
- `fallbackNPC()` — a generic stranger
- `fallbackQuest()` — a trivial placeholder quest

## Testing

1. Build with `build.bat`.
2. Open `dist/index.html`, configure LLM in **LLM Config**.
3. From the sidebar, open **LLM Scene Demo** and verify a scene is generated.
4. Click generated options and verify routing.
5. Open **LLM NPC Demo**, generate an NPC, then click **Talk to ...**.
6. In the NPC chat, click **Ask for a quest** to generate a quest.
7. Save the game, reload, load the save, and verify generated scenes/NPCs/quests persist.

## Customization

Edit `src/scripts/llm-prompts.js` to change:
- The JSON schemas sent to the LLM
- How player stats are described
- The tone and constraints of generated content

Edit `src/styles/llm-ui.css` to change the appearance of generated scene cards, NPC cards, and quest cards.
