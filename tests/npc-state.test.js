const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.State = {
  variables: {
    location: 'Park',
    position: { locationId: 'Park', areaId: 'park_entrance' },
    regions: {
      Park: {
        defaultAreaId: 'park_entrance',
        areas: { park_entrance: {}, park_path: {} }
      }
    },
    proactiveDialogueUsage: {},
    characterCards: {
      linwanqing: { name: '林晚晴', location: 'Park', locationId: 'Park', areaId: 'park_entrance' }
    },
    npcs: {
      lin: { id: 'lin', name: '林晚晴', location: 'Park' }
    }
  }
};

require('../src/scripts/npc-state.js');

test('legacy NPCs inherit their character-card sub-area', () => {
  NPCState.ensureAll();
  assert.equal(State.variables.npcs.lin.locationId, 'Park');
  assert.equal(State.variables.npcs.lin.areaId, 'park_entrance');
});

test('showing one proactive invite exhausts only that NPC sub-area', () => {
  const first = NPCState.consumeByName('林晚晴');
  assert.equal(first.ok, true);
  assert.equal(NPCState.canInviteByName('林晚晴').reason, 'proactive-dialogue-quota-exhausted');
  assert.equal(State.variables.npcs.lin.proactiveDialogue.usedByArea['Park|park_entrance'], 1);

  State.variables.npcs.lin.areaId = 'park_path';
  State.variables.characterCards.linwanqing.areaId = 'park_path';
  State.variables.position.areaId = 'park_path';
  assert.equal(NPCState.canInviteByName('林晚晴').ok, true);
});

test('a known NPC cannot proactively speak from another sub-area', () => {
  State.variables.position.areaId = 'park_entrance';
  State.variables.npcs.lin.areaId = 'park_path';
  State.variables.characterCards.linwanqing.areaId = 'park_path';
  assert.equal(NPCState.canInviteByName('林晚晴').reason, 'npc-not-in-current-area');
});

test('player names and unregistered NPCs cannot start proactive dialogue', () => {
  State.variables.player = { name: 'Player' };
  assert.equal(NPCState.canInviteByName('Player').reason, 'reserved-player-name');
  assert.equal(NPCState.canInviteByName('玩家').reason, 'reserved-player-name');
  assert.equal(NPCState.canInviteByName('不存在的路人').reason, 'npc-not-registered');
});
