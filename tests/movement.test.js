const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.whenSugarCubeReady = function () {};
global.State = {
  variables: {
    location: 'Street',
    position: { locationId: 'Street', areaId: 'street_main' },
    regions: {}
  }
};

let destination = '';
let movementLogs = [];
global.log = function (level, event, data) {
  movementLogs.push({ level, event, data });
};
global.Engine = {
  play(passage) {
    destination = passage;
  }
};

require('../src/scripts/movement.js');

test.beforeEach(() => {
  State.variables = {
    location: 'Street',
    position: { locationId: 'Street', areaId: 'street_main' },
    regions: {}
  };
  destination = '';
  movementLogs = [];
});

test('existing child areas use the persistent area scene', async () => {
  const result = await MoveTool.invoke(
    { locationId: 'Street', areaId: 'bus_stop' },
    { source: 'test' }
  );

  assert.equal(result.ok, true);
  assert.equal(result.createdArea, false);
  assert.equal(destination, 'AreaScene');
  assert.equal(RegionSystem.currentArea().name, '公交站');
});

test('new child areas are registered once and reused', async () => {
  await MoveTool.invoke(
    { locationId: 'Street', areaId: 'street_main' },
    { source: 'test' }
  );

  const proposedArea = {
    name: '旧书摊',
    description: '沿街摆放着旧书的小摊。',
    aliases: ['书摊'],
    tags: ['vendor']
  };
  const created = await MoveTool.invoke(
    { locationId: 'Street', proposedArea },
    { source: 'test' }
  );
  const firstAreaId = created.to.areaId;

  assert.equal(created.createdArea, true);
  assert.equal(destination, 'AreaScene');
  assert.equal(State.variables.regions.Street.areas[firstAreaId].generated, true);

  await MoveTool.invoke(
    { locationId: 'Street', areaId: 'street_main' },
    { source: 'test' }
  );
  const reused = await MoveTool.invoke(
    { locationId: 'Street', proposedArea },
    { source: 'test' }
  );

  assert.equal(reused.createdArea, false);
  assert.equal(reused.to.areaId, firstAreaId);
  assert.equal(destination, 'AreaScene');
});

test('default areas keep their fixed region passages', async () => {
  await MoveTool.invoke(
    { locationId: 'Street', areaId: 'street_main' },
    { source: 'test' }
  );
  const result = await MoveTool.invoke(
    { locationId: 'Park' },
    { source: 'test' }
  );

  assert.equal(result.ok, true);
  assert.equal(result.to.areaId, 'park_entrance');
  assert.equal(destination, 'Park');
});


test('location ID casing is corrected for a registered convenience store entrance', () => {
  const args = { locationId: 'street', areaId: 'convenience_store_entrance' };
  const before = structuredClone(State.variables);
  const result = MoveTool.validate(args);

  assert.equal(result.ok, true);
  assert.deepEqual(result.args, { locationId: 'Street', areaId: 'convenience_store_entrance' });
  assert.deepEqual(result.corrections, [{ field: 'locationId', from: 'street', to: 'Street' }]);
  assert.deepEqual(args, { locationId: 'street', areaId: 'convenience_store_entrance' });
  assert.deepEqual(State.variables, before);
  assert.deepEqual(movementLogs, []);
  assert.equal(destination, '');
});

test('area ID casing is corrected within the resolved region', () => {
  const result = MoveTool.validate({ locationId: 'Street', areaId: 'CONVENIENCE_STORE_ENTRANCE' });

  assert.equal(result.ok, true);
  assert.equal(result.args.areaId, 'convenience_store_entrance');
  assert.deepEqual(result.corrections, [{ field: 'areaId', from: 'CONVENIENCE_STORE_ENTRANCE', to: 'convenience_store_entrance' }]);
});

test('registered custom IDs can be corrected without adding areas', () => {
  RegionSystem.ensure();
  State.variables.regions.Street.areas.BookStand = {
    id: 'BookStand', name: '旧书摊', description: '沿街摆放着旧书的小摊。', aliases: [], tags: []
  };
  const before = structuredClone(State.variables);
  const result = MoveTool.validate({ locationId: 'STREET', areaId: 'bookstand' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.args, { locationId: 'Street', areaId: 'BookStand' });
  assert.equal(result.corrections.length, 2);
  assert.deepEqual(State.variables, before);
});

test('unknown IDs, names, aliases and IDs from another region are rejected without changing the world', async () => {
  const before = structuredClone(State.variables);
  for (const args of [
    { locationId: 'Unknown', areaId: 'bus_stop' },
    { locationId: '城市街道', areaId: 'bus_stop' },
    { locationId: 'street', areaId: 'convenience_store' },
    { locationId: 'Street', areaId: '便利店门口' },
    { locationId: 'Street', areaId: '便利店外' },
    { locationId: 'Street', areaId: 'PARK_PATH' },
    { locationId: 'toString', areaId: 'bus_stop' },
    { locationId: 'Street', areaId: '__proto__' }
  ]) {
    assert.equal(MoveTool.validate(args).ok, false, JSON.stringify(args));
    const result = await MoveTool.invoke(args, { source: 'test' });
    assert.equal(result.ok, false);
    assert.equal(result.moved, false);
    assert.deepEqual(State.variables, before);
  }
  assert.equal(destination, '');
  assert.equal(movementLogs.some(entry => entry.event === 'movement-area-created'), false);
});

test('ambiguous location casing is rejected even if only one candidate is reachable', () => {
  RegionSystem.ensure();
  State.variables.regions.STREET = { ...structuredClone(State.variables.regions.Street), id: 'STREET' };
  RegionSystem.enterLocation('Bedroom');
  const before = structuredClone(State.variables);
  const result = MoveTool.validate({ locationId: 'street', areaId: 'bus_stop' });

  assert.equal(result.ok, false);
  assert.match(result.error, /不唯一/);
  assert.deepEqual(State.variables, before);
});

test('ambiguous area casing is rejected without modifying the registry', () => {
  RegionSystem.ensure();
  State.variables.regions.Street.areas.BUS_STOP = {
    ...structuredClone(State.variables.regions.Street.areas.bus_stop), id: 'BUS_STOP'
  };
  const before = structuredClone(State.variables);
  const result = MoveTool.validate({ locationId: 'Street', areaId: 'Bus_Stop' });

  assert.equal(result.ok, false);
  assert.match(result.error, /不唯一/);
  assert.deepEqual(State.variables, before);
});

test('exact IDs take priority over other case-insensitive candidates', () => {
  RegionSystem.ensure();
  State.variables.regions.STREET = { ...structuredClone(State.variables.regions.Street), id: 'STREET' };
  State.variables.regions.Street.connections.push('STREET');
  State.variables.regions.Street.areas.BUS_STOP = {
    ...structuredClone(State.variables.regions.Street.areas.bus_stop), id: 'BUS_STOP'
  };
  for (const args of [
    { locationId: 'Street', areaId: 'bus_stop' },
    { locationId: 'Street', areaId: 'BUS_STOP' },
    { locationId: 'STREET', areaId: 'bus_stop' }
  ]) {
    const result = MoveTool.validate(args);
    assert.equal(result.ok, true);
    assert.deepEqual(result.args, args);
    assert.deepEqual(result.corrections, []);
  }
});

test('case correction preserves connectivity and same-region movement constraints', () => {
  RegionSystem.enterLocation('Bedroom');
  assert.equal(MoveTool.validate({ locationId: 'park' }).ok, false);
  const result = MoveTool.validate({ locationId: 'street' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.args, { locationId: 'Street', areaId: 'street_main' });
  assert.equal(MoveTool.validate({ locationId: 'bedroom' }).ok, false);
  assert.equal(MoveTool.validate({
    locationId: 'street', proposedArea: { name: '旧书摊', description: '沿街摆放着旧书的小摊。' }
  }).ok, false);
});

test('validation of proposed areas and legacy state never initializes or repairs the live world', () => {
  State.variables = { location: 'Street', player: { money: 25 } };
  const before = structuredClone(State.variables);
  const result = MoveTool.validate({
    locationId: 'street', proposedArea: { name: '旧书摊', description: '沿街摆放着旧书的小摊。' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.args.proposedArea.name, '旧书摊');
  assert.deepEqual(State.variables, before);
  assert.deepEqual(movementLogs, []);
});

test('real movement logs and results include both ID corrections', async () => {
  const result = await MoveTool.invoke(
    { locationId: 'street', areaId: 'CONVENIENCE_STORE_ENTRANCE' },
    { source: 'test' }
  );
  const corrections = [
    { field: 'locationId', from: 'street', to: 'Street' },
    { field: 'areaId', from: 'CONVENIENCE_STORE_ENTRANCE', to: 'convenience_store_entrance' }
  ];

  assert.equal(result.ok, true);
  assert.equal(result.createdArea, false);
  assert.deepEqual(result.to, { locationId: 'Street', areaId: 'convenience_store_entrance' });
  assert.deepEqual(result.corrections, corrections);
  assert.deepEqual(State.variables.position, result.to);
  assert.equal(destination, 'AreaScene');
  for (const event of ['movement-tool-received', 'player-moved']) {
    const entry = movementLogs.find(item => item.event === event);
    assert.equal(entry.data.source, 'test');
    assert.deepEqual(entry.data.corrections, corrections);
  }
  assert.equal(movementLogs.some(entry => entry.event === 'movement-area-created'), false);
});

test('corrections remain available when navigation is disabled or the position is unchanged', async () => {
  const moved = await MoveTool.invoke({ locationId: 'street', areaId: 'BUS_STOP' }, { navigate: false });
  assert.equal(moved.moved, true);
  assert.equal(moved.navigated, false);
  assert.equal(moved.corrections.length, 2);
  assert.equal(destination, '');

  const unchanged = await MoveTool.invoke({ locationId: 'street', areaId: 'BUS_STOP' });
  assert.equal(unchanged.moved, false);
  assert.equal(unchanged.navigated, false);
  assert.deepEqual(unchanged.corrections, moved.corrections);
  assert.equal(destination, '');
});
