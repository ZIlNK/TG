/* Runtime-only operation ownership. Never store a scope in State.variables. */
(function () {
  'use strict';

  var sessionEpoch = 0;
  var nextId = 0;
  var live = new Set();
  var eventsInstalled = false;
  var saveHookInstalled = false;

  function staleReason(reason) {
    var error = new Error(reason || 'LLM 操作上下文已失效');
    error.name = 'AbortError';
    error.code = 'STALE_SCOPE';
    return error;
  }

  function invalidate(reason) {
    sessionEpoch += 1;
    Array.from(live).forEach(function (scope) { scope.invalidate(reason, true); });
  }

  function install() {
    if (!eventsInstalled && typeof jQuery !== 'undefined' && typeof document !== 'undefined') {
      jQuery(document).on(':historyupdate.llmOperationScope :passageinit.llmOperationScope', function (event) {
        invalidate(event.type);
      });
      eventsInstalled = true;
    }
    if (!saveHookInstalled) {
      var onLoad = function () { invalidate('save-load'); };
      if (typeof Save !== 'undefined' && Save.onLoad && typeof Save.onLoad.add === 'function') {
        Save.onLoad.add(onLoad);
        saveHookInstalled = true;
      } else if (typeof Config !== 'undefined' && Config.saves) {
        // Bundled SugarCube 2.30.0 has Config.saves.onLoad, not Save.onLoad.
        var previous = Config.saves.onLoad;
        Config.saves.onLoad = function () {
          onLoad();
          if (typeof previous === 'function') return previous.apply(this, arguments);
        };
        saveHookInstalled = true;
      }
    }
  }

  function snapshot(options) {
    if (typeof State === 'undefined') return {};
    var variables = State.variables;
    var position = variables && variables.position || {};
    var agency = variables && variables.npcAgency || {};
    var actor = agency.actors && agency.actors[options.actorId] || {};
    var encounter = agency.encounters && agency.encounters[options.actorId] || {};
    var player = variables && variables.player || {};
    return {
      time: JSON.stringify(variables && variables.time),
      agencyRevision: agency.revision, actorRevision: actor.revision,
      actorResources: JSON.stringify(actor.resources), encounter: encounter.id,
      playerMoney: player.money, playerInventory: JSON.stringify(player.inventory),
      variables: variables, passage: State.passage, index: State.activeIndex,
      location: variables && variables.location, locationId: position.locationId,
      areaId: position.areaId, activeNPCId: variables && variables.activeNPCId
    };
  }

  function create(options) {
    options = options || {};
    install();
    var initial = snapshot(options);
    var controller = new AbortController();
    var epoch = sessionEpoch;
    var scope = {
      id: 'operation-' + (++nextId), sessionEpoch: epoch,
      decisionId: options.decisionId, actorId: options.actorId, npcId: options.npcId,
      encounterId: options.encounterId, revision: options.revision,
      signal: controller.signal,
      isCurrent: function () {
        if (controller.signal.aborted || epoch !== sessionEpoch) return false;
        var current = snapshot(options);
        var valid = Object.keys(initial).every(function (key) { return initial[key] === current[key]; });
        if (valid && typeof options.validate === 'function') {
          try { valid = options.validate(scope) === true; } catch (err) { valid = false; }
        }
        if (!valid) scope.invalidate('context-changed', true);
        return valid;
      },
      // Explicit per-operation invalidation is cancellation; lifecycle/context
      // invalidation is stale. Both abort outstanding requests.
      invalidate: function (reason, stale) {
        live.delete(scope);
        if (!controller.signal.aborted) {
          var error = staleReason(reason);
          if (!stale) error.code = 'CANCELLED';
          controller.abort(error);
        }
      },
      // Release after committing/discarding and retiring callbacks, not before.
      release: function () { live.delete(scope); }
    };
    live.add(scope);
    return scope;
  }

  window.LLMOperationScope = {
    create: create,
    isCurrent: function (scope) { return !!scope && typeof scope.isCurrent === 'function' && scope.isCurrent(); },
    invalidate: invalidate,
    install: install
  };
  if (typeof whenSugarCubeReady === 'function') whenSugarCubeReady(install);
  else install();
}());
