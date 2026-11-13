/* Hierarchical world position and the move_player tool. */
(function () {
  'use strict';

  var DEFAULT_REGIONS = {
    Bedroom: {
      id: 'Bedroom', name: '卧室', passage: 'Bedroom', defaultAreaId: 'bedroom_main',
      connections: ['Street'],
      areas: {
        bedroom_main: { id: 'bedroom_main', name: '卧室内', aliases: ['房间', '床边'], description: '不大但整洁的卧室。', tags: ['home'] }
      }
    },
    Street: {
      id: 'Street', name: '城市街道', passage: 'Street', defaultAreaId: 'street_main',
      connections: ['Bedroom', 'Park', 'Shop'],
      areas: {
        street_main: { id: 'street_main', name: '街道主路', aliases: ['街上', '主街'], description: '车水马龙的城市街道。', tags: ['street'] },
        food_stall: { id: 'food_stall', name: '早餐摊', aliases: ['小吃摊', '老陈的摊位'], description: '街角冒着热气的早餐摊。', tags: ['food', 'vendor'] },
        convenience_store_entrance: { id: 'convenience_store_entrance', name: '便利店门口', aliases: ['便利店外'], description: '临街便利店的玻璃门外。', tags: ['shop'] },
        bus_stop: { id: 'bus_stop', name: '公交站', aliases: ['公交车站'], description: '主街旁供人候车的公交站。', tags: ['transit'] }
      }
    },
    Park: {
      id: 'Park', name: '中央公园', passage: 'Park', defaultAreaId: 'park_entrance',
      connections: ['Street'],
      areas: {
        park_entrance: { id: 'park_entrance', name: '公园入口', aliases: ['公园门口'], description: '连接街道与公园小径的入口。', tags: ['entrance'] },
        park_path: { id: 'park_path', name: '林间小径', aliases: ['公园小路'], description: '树木沿两侧排布的安静小径。', tags: ['path'] },
        fountain: { id: 'fountain', name: '中央喷泉', aliases: ['喷泉广场'], description: '公园中央的喷泉与开阔空地。', tags: ['landmark'] },
        benches: { id: 'benches', name: '长椅区', aliases: ['公园长椅'], description: '沿小径排列着几张长椅。', tags: ['rest'] }
      }
    },
    Shop: {
      id: 'Shop', name: '街角小店', passage: 'Shop', defaultAreaId: 'shop_entrance',
      connections: ['Street'],
      areas: {
        shop_entrance: { id: 'shop_entrance', name: '商店入口', aliases: ['店门口'], description: '小店临街的入口。', tags: ['entrance'] },
        shop_aisles: { id: 'shop_aisles', name: '货架区', aliases: ['货架间'], description: '摆满食品和日用品的狭窄货架区。', tags: ['shopping'] },
        shop_counter: { id: 'shop_counter', name: '收银台', aliases: ['柜台'], description: '店员值守的收银柜台。', tags: ['checkout'] }
      }
    }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function state() {
    return typeof State !== 'undefined' && State.variables ? State.variables : null;
  }

  function logMovement(level, event, data) {
    if (typeof window.log === 'function') window.log(level, event, data || {});
  }

  function mergeDefaults(target, defaults) {
    Object.keys(defaults).forEach(function (locationId) {
      var source = defaults[locationId];
      if (!target[locationId]) {
        target[locationId] = clone(source);
        return;
      }
      var region = target[locationId];
      if (!region.id) region.id = source.id;
      if (!region.name) region.name = source.name;
      if (!region.passage) region.passage = source.passage;
      if (!region.defaultAreaId) region.defaultAreaId = source.defaultAreaId;
      if (!Array.isArray(region.connections)) region.connections = clone(source.connections);
      if (!region.areas) region.areas = {};
      Object.keys(source.areas).forEach(function (areaId) {
        if (!region.areas[areaId]) region.areas[areaId] = clone(source.areas[areaId]);
      });
    });
  }

  function prepareState(st) {
    if (!st) return null;
    if (!st.regions || typeof st.regions !== 'object') st.regions = {};
    mergeDefaults(st.regions, DEFAULT_REGIONS);

    var legacyLocation = st.location && st.regions[st.location] ? st.location : 'Bedroom';
    if (!st.position || typeof st.position !== 'object' || !st.regions[st.position.locationId]) {
      st.position = {
        locationId: legacyLocation,
        areaId: st.regions[legacyLocation].defaultAreaId
      };
    }
    var region = st.regions[st.position.locationId];
    if (!region.areas[st.position.areaId]) st.position.areaId = region.defaultAreaId;
    st.location = st.position.locationId;
    return st;
  }

  function ensure() {
    return prepareState(state());
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).trim().toLocaleLowerCase();
  }

  function findArea(region, value) {
    if (!region || !region.areas || !value) return null;
    if (region.areas[value]) return region.areas[value];
    var wanted = normalizeText(value);
    var ids = Object.keys(region.areas);
    for (var i = 0; i < ids.length; i++) {
      var area = region.areas[ids[i]];
      if (normalizeText(area.name) === wanted) return area;
      var aliases = Array.isArray(area.aliases) ? area.aliases : [];
      for (var j = 0; j < aliases.length; j++) {
        if (normalizeText(aliases[j]) === wanted) return area;
      }
    }
    return null;
  }

  function parseArguments(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    try {
      var parsed = JSON.parse(value || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function validateProposedArea(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'proposedArea 必须是对象' };
    if (typeof value.name !== 'string' || !value.name.trim()) return { ok: false, error: '新区域必须有名称' };
    if (typeof value.description !== 'string' || !value.description.trim()) return { ok: false, error: '新区域必须有描述' };
    var name = value.name.trim();
    var description = value.description.trim();
    if (name.length > 60) return { ok: false, error: '新区域名称不能超过 60 个字符' };
    if (description.length > 300) return { ok: false, error: '新区域描述不能超过 300 个字符' };
    var aliases = Array.isArray(value.aliases) ? value.aliases.filter(function (item) { return typeof item === 'string' && item.trim(); }).slice(0, 8).map(function (item) { return item.trim().slice(0, 60); }) : [];
    var tags = Array.isArray(value.tags) ? value.tags.filter(function (item) { return typeof item === 'string' && item.trim(); }).slice(0, 8).map(function (item) { return item.trim().slice(0, 30); }) : [];
    return { ok: true, area: { name: name, description: description, aliases: aliases, tags: tags } };
  }

  function matchRegisteredId(registry, value) {
    if (Object.prototype.hasOwnProperty.call(registry, value)) return { id: value };
    var matches = Object.keys(registry).filter(function (id) { return id.toLowerCase() === value.toLowerCase(); });
    return { id: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
  }

  function validate(args) {
    var live = state();
    var st = live ? prepareState(clone({ regions: live.regions, position: live.position, location: live.location })) : null;
    if (!st) return { ok: false, error: '游戏状态尚未初始化' };
    if (!args || typeof args !== 'object') return { ok: false, error: '移动参数必须是对象' };
    if (typeof args.locationId !== 'string' || !args.locationId.trim()) return { ok: false, error: 'locationId 必须是非空字符串' };
    var requestedLocationId = args.locationId.trim();
    var locationMatch = matchRegisteredId(st.regions, requestedLocationId);
    if (locationMatch.ambiguous) return { ok: false, error: '大区域 ID 大小写匹配不唯一：' + requestedLocationId };
    if (!locationMatch.id) return { ok: false, error: '未知大区域：' + requestedLocationId };
    var locationId = locationMatch.id;
    var region = st.regions[locationId];
    var corrections = [];
    if (locationId !== requestedLocationId) corrections.push({ field: 'locationId', from: requestedLocationId, to: locationId });
    if (args.areaId && args.proposedArea) return { ok: false, error: 'areaId 与 proposedArea 不能同时提供' };

    var current = st.position;
    if (locationId !== current.locationId) {
      var currentRegion = st.regions[current.locationId];
      if (!currentRegion || currentRegion.connections.indexOf(locationId) === -1) {
        return { ok: false, error: '当前大区域无法直接前往：' + locationId };
      }
      if (args.proposedArea) return { ok: false, error: '跨大区域移动不能同时创建新子区域' };
    } else if (!args.areaId && !args.proposedArea) {
      return { ok: false, error: '同一大区域内移动必须指定子区域' };
    }

    var normalized = { locationId: locationId };
    if (args.areaId) {
      if (typeof args.areaId !== 'string' || !args.areaId.trim()) return { ok: false, error: 'areaId 必须是字符串' };
      var requestedAreaId = args.areaId.trim();
      var areaMatch = matchRegisteredId(region.areas, requestedAreaId);
      if (areaMatch.ambiguous) return { ok: false, error: '子区域 ID 大小写匹配不唯一：' + requestedAreaId };
      if (!areaMatch.id) return { ok: false, error: '目标子区域不存在：' + requestedAreaId };
      normalized.areaId = areaMatch.id;
      if (areaMatch.id !== requestedAreaId) corrections.push({ field: 'areaId', from: requestedAreaId, to: areaMatch.id });
    } else if (args.proposedArea) {
      var proposed = validateProposedArea(args.proposedArea);
      if (!proposed.ok) return proposed;
      normalized.proposedArea = proposed.area;
    } else {
      normalized.areaId = region.defaultAreaId;
    }
    return { ok: true, args: normalized, corrections: corrections };
  }

  function generatedAreaId(region) {
    var index = 1;
    var id;
    do { id = 'generated_area_' + index++; } while (region.areas[id]);
    return id;
  }

  function resolveArea(region, args) {
    if (args.areaId) return { area: region.areas[args.areaId], created: false };
    var proposed = args.proposedArea;
    var existing = findArea(region, proposed.name);
    if (!existing) {
      var candidates = proposed.aliases || [];
      for (var i = 0; i < candidates.length && !existing; i++) existing = findArea(region, candidates[i]);
    }
    if (existing) return { area: existing, created: false };
    if (Object.keys(region.areas).filter(function (id) { return region.areas[id].generated; }).length >= 24) {
      return { error: '当前大区域的动态子区域数量已达上限' };
    }
    var area = clone(proposed);
    area.id = generatedAreaId(region);
    area.generated = true;
    region.areas[area.id] = area;
    return { area: area, created: true };
  }

  // Draft-only registration: does not move the player or mutate live State.
  function registerQuestArea(args, regions, originId) {
    if (!args || !Object.prototype.hasOwnProperty.call(regions, args.locationId)) return { ok: false, error: '未知大区域，不能创建新大区域' };
    var seen = {}, queue = [originId];
    while (queue.length) {
      var id = queue.shift();
      if (seen[id] || !Object.prototype.hasOwnProperty.call(regions, id)) continue;
      seen[id] = true;
      queue = queue.concat(regions[id].connections || []);
    }
    if (!seen[args.locationId]) return { ok: false, error: '任务地点必须从当前位置可达' };
    var checked = validateProposedArea(args.proposedArea);
    if (!checked.ok) return checked;
    var resolved = resolveArea(regions[args.locationId], { proposedArea: checked.area });
    if (resolved.error) return { ok: false, error: resolved.error };
    return { ok: true, locationId: args.locationId, areaId: resolved.area.id, area: clone(resolved.area), created: resolved.created };
  }

  function catalog() {
    var st = ensure();
    return st ? clone(st.regions) : {};
  }

  function formatPosition() {
    var st = ensure();
    if (!st) return '未知地点';
    var region = st.regions[st.position.locationId];
    var area = region && region.areas[st.position.areaId];
    return (region ? region.name : st.position.locationId) + (area ? ' / ' + area.name : '');
  }

  function currentRegion() {
    var st = ensure();
    return st ? st.regions[st.position.locationId] || null : null;
  }

  function currentArea() {
    var region = currentRegion();
    var st = state();
    return region && st ? region.areas[st.position.areaId] || null : null;
  }

  function enterLocation(locationId) {
    var st = ensure();
    if (!st || !st.regions[locationId]) return false;
    var region = st.regions[locationId];
    if (st.position.locationId !== locationId || !region.areas[st.position.areaId]) {
      st.position = { locationId: locationId, areaId: region.defaultAreaId };
    }
    st.location = locationId;
    return true;
  }

  function promptContext() {
    var st = ensure();
    if (!st) return '';
    var currentRegion = st.regions[st.position.locationId];
    var currentArea = currentRegion.areas[st.position.areaId];
    var lines = [
      '=== 移动区域约束 ===',
      '当前位置：' + currentRegion.id + ' / ' + (currentArea ? currentArea.id : currentRegion.defaultAreaId),
      '当前大区域的已有子区域：'
    ];
    Object.keys(currentRegion.areas).forEach(function (id) {
      var area = currentRegion.areas[id];
      lines.push('- ' + id + '：' + area.name + (area.aliases && area.aliases.length ? '（别名：' + area.aliases.join('、') + '）' : ''));
    });
    lines.push('可直接前往的其他大区域：');
    currentRegion.connections.forEach(function (id) {
      var region = st.regions[id];
      if (region) lines.push('- ' + id + '：' + region.name + '（默认入口：' + region.defaultAreaId + '）');
    });
    lines.push('涉及世界位置变化的选项必须使用 move_player，不要使用 target。');
    lines.push('优先原样使用已有 locationId/areaId；只有当前大区域内确实没有合适子区域时才返回 proposedArea。');
    lines.push('跨大区域只能使用上面列出的已有大区域，不能创建新大区域。');
    return lines.join('\n');
  }

  function invoke(args, options) {
    options = options || {};
    var parsed = parseArguments(args);
    var checked = validate(parsed);
    logMovement(checked.ok ? 'info' : 'warn', checked.ok ? 'movement-tool-received' : 'movement-tool-invalid', {
      source: options.source || 'system',
      locationId: checked.ok ? checked.args.locationId : null,
      areaId: checked.ok ? checked.args.areaId || null : null,
      proposedAreaName: checked.ok && checked.args.proposedArea ? checked.args.proposedArea.name : null,
      corrections: checked.corrections || [],
      error: checked.ok ? null : checked.error
    });
    if (!checked.ok) return Promise.resolve({ ok: false, moved: false, navigated: false, error: checked.error });

    var st = ensure();
    var from = clone(st.position);
    var region = st.regions[checked.args.locationId];
    var resolved = resolveArea(region, checked.args);
    if (resolved.error) return Promise.resolve({ ok: false, moved: false, navigated: false, error: resolved.error });
    var to = { locationId: region.id, areaId: resolved.area.id };
    var moved = from.locationId !== to.locationId || from.areaId !== to.areaId;

    st.position = to;
    st.location = to.locationId;
    if (resolved.created) {
      logMovement('info', 'movement-area-created', {
        locationId: to.locationId,
        areaId: to.areaId,
        areaName: resolved.area.name,
        descriptionLength: resolved.area.description.length
      });
    } else {
      logMovement('info', 'movement-area-reused', { locationId: to.locationId, areaId: to.areaId, areaName: resolved.area.name });
    }
    logMovement('info', 'player-moved', { source: options.source || 'system', from: from, to: to, moved: moved, corrections: checked.corrections });
    if (typeof ModAPI !== 'undefined' && ModAPI.trigger) ModAPI.trigger('playerMoved', { from: from, to: clone(to), area: clone(resolved.area) });

    if (options.navigate === false || !moved) {
      return Promise.resolve({ ok: true, moved: moved, navigated: false, from: from, to: to, createdArea: resolved.created, corrections: checked.corrections });
    }
    if (to.areaId === region.defaultAreaId) {
      Engine.play(region.passage);
    } else {
      Engine.play('AreaScene');
    }
    return Promise.resolve({ ok: true, moved: true, navigated: true, from: from, to: to, createdArea: resolved.created, corrections: checked.corrections });
  }

  window.RegionSystem = {
    defaults: DEFAULT_REGIONS,
    ensure: ensure,
    catalog: catalog,
    registerQuestArea: registerQuestArea,
    enterLocation: enterLocation,
    formatPosition: formatPosition,
    currentRegion: currentRegion,
    currentArea: currentArea,
    promptContext: promptContext,
    findArea: findArea
  };

  window.MoveTool = {
    invoke: invoke,
    validate: validate,
    parseArguments: parseArguments
  };

  function registerMacro() {
    Macro.add('moveaction', {
      handler: function () {
        var label = this.args[0];
        var locationId = this.args[1];
        var areaId = this.args[2] || '';
        var tooltip = this.args[3] || '';
        var link = document.createElement('a');
        link.className = 'action-link';
        link.textContent = label;
        if (tooltip) link.title = tooltip;
        link.addEventListener('click', function (ev) {
          ev.preventDefault();
          MoveTool.invoke({ locationId: locationId, areaId: areaId || undefined }, { source: 'fixed-action' });
        });
        this.output.appendChild(link);
      }
    });
  }

  if (typeof whenSugarCubeReady === 'function') whenSugarCubeReady(registerMacro);
  else (function waitForSugarCube() {
    if (typeof Macro !== 'undefined') registerMacro();
    else setTimeout(waitForSugarCube, 10);
  }());
}());
