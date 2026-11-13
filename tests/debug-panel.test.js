const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.whenSugarCubeReady = function () {};
global.State = {
  variables: {
    location: 'Park',
    position: { locationId: 'Park', areaId: 'park_entrance' },
    regions: {
      Park: {
        name: '中央公园', defaultAreaId: 'park_entrance',
        areas: { park_entrance: { name: '公园入口' }, park_path: { name: '林间小径' } }
      }
    },
    player: { name: 'Player' },
    proactiveDialogueUsage: {},
    activeNPCId: 'lin',
    npcs: {
      lin: {
        id: 'lin', name: '林晚晴', role: '管理员', locationId: 'Park', location: 'Park', areaId: 'park_entrance',
        proactiveDialogue: { limitPerArea: 1, usedByArea: {} }
      },
      remote: {
        id: 'remote', name: '远处的人', role: '路人', locationId: 'Park', location: 'Park', areaId: 'park_path',
        proactiveDialogue: { limitPerArea: 1, usedByArea: {} }
      }
    },
    characterCards: {}
  }
};
global.RegionSystem = { ensure() {} };
global.passage = function () { return 'Park'; };

require('../src/scripts/npc-state.js');
require('../src/scripts/debug-panel.js');

test('debug snapshot shows current position and only local NPC quota data', () => {
  const data = DebugPanel.snapshot();
  assert.equal(data.locationId, 'Park');
  assert.equal(data.areaId, 'park_entrance');
  assert.equal(data.passage, 'Park');
  assert.equal(data.dialogueToolEnabled, true);
  assert.equal(data.npcs.length, 1);
  assert.deepEqual(data.npcs[0], {
    id: 'lin', name: '林晚晴', role: '管理员', source: 'runtime', limit: 1, used: 0, remaining: 1, active: true,
    duplicateName: false
  });

  NPCState.consumeByName('林晚晴');
  const exhausted = DebugPanel.snapshot();
  assert.equal(exhausted.dialogueToolEnabled, false);
  assert.equal(exhausted.npcs[0].remaining, 0);
  assert.equal(exhausted.npcs[0].used, 1);
});

test('debug snapshot keeps and marks same-name runtime NPCs', () => {
  State.variables.npcs.lin_copy = {
    id: 'lin_copy', name: '林晚晴', role: '游客', locationId: 'Park', location: 'Park', areaId: 'park_entrance',
    proactiveDialogue: { limitPerArea: 1, usedByArea: {} }
  };

  const data = DebugPanel.snapshot();
  const duplicates = data.npcs.filter((npc) => npc.name === '林晚晴');
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates.every((npc) => npc.duplicateName), true);
});
