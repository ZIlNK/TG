'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const clone = (value) => JSON.parse(JSON.stringify(value));

function initialState() {
  return {
    player: { name: '玩家', money: 10, inventory: {} },
    location: 'Park', position: { locationId: 'Park', areaId: 'entrance' },
    time: { day: 1, hour: 10, minute: 0 }, quests: {}, activeNPCId: 'lin',
    regions: { Park: { areas: { entrance: {}, path: {} } } },
    characterCards: {
      linwanqing: {
        name: '林晚晴', personality: '谨慎且重视承诺', scenario: '在公园寻找旧照片',
        description: '保存着家人的回忆', locationId: 'Park', areaId: 'entrance',
        agencyResources: { money: 30, items: { tea: 2, 'blank-paper': 1 } },
        agencyItemDefinitions: {
          tea: { title: '茶包', kind: 'item' },
          'blank-paper': { title: '空白纸', kind: 'material' }
        }
      }
    },
    npcs: {
      lin: {
        id: 'lin', name: '林晚晴', cardId: 'linwanqing', locationId: 'Park', areaId: 'entrance',
        dialogue: [], relationship: { value: 50, history: [] }, disposition: 0
      },
      other: {
        id: 'other', name: '另一位访客', locationId: 'Park', areaId: 'entrance',
        dialogue: [], agencyResources: { money: 8, items: {} }
      }
    }
  };
}

// Only environmental boundaries are faked: SugarCube lifecycle, model transport,
// and event delivery. Agency, tools, director and operation scope run from source.
function createRuntime(options = {}) {
  const events = new Map();
  const calls = [];
  const context = vm.createContext({
    console, AbortController, setTimeout, clearTimeout,
    State: { variables: clone(options.variables || initialState()), passage: 'NPCChat', activeIndex: 0 },
    Config: { saves: {} },
    ModAPI: { on(name, handler) { events.set(name, handler); } },
    whenSugarCubeReady(callback) { callback(); },
    LLMEngine: { isAvailable() { return true; }, chatRaw: options.chatRaw },
    LLMToolRunner: {
      run(request) {
        calls.push(request);
        return options.runner ? options.runner(request, calls.length) : Promise.resolve({ status: 'completed', content: '谢谢你。' });
      }
    }
  });
  context.window = context;
  const modules = ['npc-agency-state.js', 'npc-tools.js', 'llm-operation-scope.js'];
  if (options.chatRaw) modules.push('llm-tool-runner.js');
  if (options.director) modules.push('npc-director.js');
  for (const file of modules) {
    const filename = path.resolve(__dirname, '../../src/scripts', file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  context.NPCAgency.ensure();
  return {
    context, calls,
    get state() { return context.State.variables; },
    get db() { return context.NPCAgency.ensure(); },
    get agency() { return context.NPCAgency; },
    get tools() { return context.NPCTools; },
    get director() { return context.NPCDirector; },
    actor(npcId = 'lin') { return context.NPCAgency.resolveActor(npcId); },
    draft(id = 'turn:1', npcId = 'lin') {
      return context.NPCAgency.createTurnDraft(npcId, id, null);
    },
    fact(type = 'quest_settled', data = { questId: 'photo' }, source = 'quest:photo:settled', npcId = 'lin') {
      const actor = context.NPCAgency.resolveActor(npcId);
      return context.NPCAgency.recordFact(context.NPCAgency.ensure(), actor.actorId, type, data, source);
    },
    emit(name, data) { const handler = events.get(name); if (handler) handler(data); },
    save() { return clone(context.State.variables); },
    load(snapshot) {
      // Actual scope save hook runs even for identical same-ID save contents.
      context.Config.saves.onLoad();
      context.State.variables = clone(snapshot);
      context.NPCAgency.ensure();
    },
    setMinute(absoluteMinute) {
      context.State.variables.time = {
        day: Math.floor(absoluteMinute / 1440),
        hour: Math.floor((absoluteMinute % 1440) / 60), minute: absoluteMinute % 60
      };
    }
  };
}

function stage(runtime, draft, name, args, id = 'transport:1') {
  return runtime.tools.stage({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }, draft);
}

function staged(runtime, draft, name, args, id) {
  const result = stage(runtime, draft, name, args, id);
  assert.equal(result.status, 'STAGED', JSON.stringify(result));
  return result.reference;
}

function commit(runtime, draft, text = '这是我现在的决定。') {
  const result = runtime.tools.commitTurn(draft, text);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

function money(amount = 12, extra = {}) {
  return { reward: { kind: 'money', amount }, message: '想把这份心意送给你。', ...extra };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

module.exports = { createRuntime, initialState, clone, stage, staged, commit, money, deferred };

