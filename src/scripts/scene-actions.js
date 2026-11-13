/* Ordinary scene actions share the scoped tool runner, not NPC knowledge or quest authority. */
(function () {
  'use strict';
  var running = null, view = null;
  // Author-owned consumables. Prices/effects are never accepted from model output.
  var PRODUCTS = [
    { id: 'breakfast-pancake', name: '煎饼果子', locationId: 'Street', areaId: 'food_stall', price: 6, effects: { stamina: 6, hunger: -15 } },
    { id: 'breakfast-soymilk', name: '热豆浆', locationId: 'Street', areaId: 'food_stall', price: 2, effects: { stamina: 2, hunger: -5 } },
    { id: 'breakfast-combo', name: '煎饼果子配豆浆', locationId: 'Street', areaId: 'food_stall', price: 8, effects: { stamina: 8, hunger: -20, stress: -3 } },
    { id: 'shop-meal', name: '快餐', locationId: 'Shop', areaId: 'shop_entrance', price: 5, effects: { health: 15, stamina: 20, hunger: -30 } }
  ];
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function position() { return State.variables.position || {}; }
  function catalog() {
    var p = position();
    return copy(PRODUCTS.filter(function (item) {
      if (item.locationId !== p.locationId || item.areaId !== p.areaId) return false;
      var hour = State.variables.time && State.variables.time.hour;
      return item.locationId !== 'Shop' || typeof hour !== 'number' || hour >= 6 && hour < 22;
    }));
  }
  function catalogPrompt() {
    return '=== 程序商品清单（仅当前位置，购买后立即食用） ===\n' + JSON.stringify(catalog()) +
      '\n购买必须使用 action.purchase.productId，价格和收益以清单为准。未列出的商品不能结算，不能承诺已经买到。';
  }
  function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function only(value, keys) { return Object.keys(value).every(function (key) { return keys.indexOf(key) !== -1; }); }
  function validate(action) {
    if (!plain(action) || action.type !== 'scene_action' || !only(action, ['type', 'intent', 'purchase'])) return { ok: false, error: '普通行动需要 scene_action、intent，以及可选的 purchase' };
    if (typeof action.intent !== 'string' || !action.intent.trim() || action.intent.length > 2000) return { ok: false, error: '行动 intent 必须是 1–2000 字的非空文本' };
    var normalized = { type: 'scene_action', intent: action.intent.trim() }, product;
    if (action.purchase !== undefined) {
      if (!plain(action.purchase) || !only(action.purchase, ['productId']) || typeof action.purchase.productId !== 'string') return { ok: false, error: '购买只允许指定商品 productId，不接受模型价格或奖励' };
      product = catalog().find(function (item) { return item.id === action.purchase.productId; });
      if (!product) return { ok: false, error: '商品不在当前位置的可购买清单中' };
      normalized.purchase = { productId: product.id };
    }
    return { ok: true, action: normalized, product: product };
  }
  function text(value) { return window.normalizeLLMText ? normalizeLLMText(value) : value; }
  function log(event, detail, actionId) {
    try {
      if (window.GameLogger && GameLogger.debug) GameLogger.debug(event, detail);
      if (window.LLMTrace) LLMTrace.list().forEach(function (row) {
        var trace = LLMTrace.get(row.id), context = trace.traceContext && trace.traceContext.context;
        if (context && context.sceneActionId === actionId) LLMTrace.event(row.id, event, detail);
      });
    } catch (_) { /* Diagnostics never change gameplay. */ }
  }
  function begin(option, source) {
    var checked = validate(option && option.action);
    if (!checked.ok) return checked;
    if (checked.product && State.variables.player.money < checked.product.price) return { ok: false, error: '金钱不足：' + checked.product.name + '需要 $' + checked.product.price + '，未扣款。' };
    if (running) return { ok: false, error: '已有行动正在生成，请先等待或取消。' };
    source = source || {};
    var st = State.variables;
    st.sceneActionSequence = (st.sceneActionSequence || 0) + 1;
    var id = 'scene-action-' + st.sceneActionSequence;
    st.sceneAction = { id: id, action: checked.action, label: option.label, sourceText: source.text || '', title: source.title || '现场行动',
      position: copy(position()), returnTo: copy(source.returnTo || { passage: State.passage }), status: 'pending' };
    log('scene-action-selected', { actionId: id, action: checked.action, product: checked.product || null, sourceKey: source.sourceKey, index: source.index }, id);
    Engine.play('SceneAction');
    return { ok: true, actionId: id };
  }
  function effectsCheck(value, purchase) {
    if (!plain(value) || !only(value, ['stamina', 'stress', 'hunger', 'skills'])) return { ok: false, error: '只允许 stamina、stress、hunger 和 skills；不能更改金钱、物品、NPC、任务或位置' };
    if (purchase && Object.keys(value).length) return { ok: false, error: '购买收益由商品清单决定，effects 必须为空对象' };
    var error = '';
    ['stamina', 'stress', 'hunger'].forEach(function (key) {
      if (value[key] !== undefined && (!Number.isInteger(value[key]) || Math.abs(value[key]) > 10)) error = '单项身体变化必须是 -10 到 10 的整数';
    });
    if (value.skills !== undefined) {
      if (!plain(value.skills)) error = 'skills 必须是对象';
      else {
        var total = 0, skills = State.variables.player.skills || {};
        Object.keys(value.skills).forEach(function (key) {
          var xp = value.skills[key];
          if (!Object.prototype.hasOwnProperty.call(skills, key) || !Number.isInteger(xp) || xp < 0 || xp > 4) error = '只能增加玩家已有技能经验，每次总计最多 4';
          total += xp;
        });
        if (total > 4) error = '每次行动技能经验总计最多 4';
      }
    }
    return error ? { ok: false, error: error } : { ok: true, effects: copy(value) };
  }
  function definitions() {
    return [{ type: 'function', function: { name: 'resolve_scene_action', description: '提交玩家刚刚选择的普通行动结果。只暂存，完整回合结束且程序校验成功才生效。不得替 NPC 发奖、交付或推进任务。', parameters: {
      type: 'object', additionalProperties: false, required: ['description', 'options', 'effects'], properties: {
        description: { type: 'string', description: '行动之后的现场与结果，不重复开场；不要替不在场 NPC 形成记忆' },
        options: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object' }, description: '与场景选项协议相同，每项 action/tool/target 三选一，不填写无关字段' },
        effects: { type: 'object', additionalProperties: false, properties: {
          stamina: { type: 'integer', minimum: -10, maximum: 10 }, stress: { type: 'integer', minimum: -10, maximum: 10 }, hunger: { type: 'integer', minimum: -10, maximum: 10 },
          skills: { type: 'object', description: '仅已有技能，总经验最多4，纯叙事可省略' }
        } }
      }
    } } }];
  }
  function messagesFor(entry, product) {
    return [
      { role: 'system', content: '你是当前现场的叙事者，不是 NPC 决策者。玩家已经明确选择了一个行动。根据意图自由生成具体后果，不得重新叙述尚未选择的开场。\n' +
        '必须先调用 resolve_scene_action；收到 STAGED 后给一句非空确认，界面只展示工具中经校验的结果。只允许暂存一个不同结果。\n' +
        '普通行动不能移动玩家、完成任务、交付任务、发放 NPC 奖励或更新 NPC 记忆。不能凭文字冒充这些操作成功。没有购买授权不能叙述交易成功或获得商品。\n' +
        '身体变化每项最多正负10；已有技能经验总计最多4。不需要数值变化时 effects={}。购买时 effects={}，扣款和食用收益由程序统一执行。\n' +
        PromptBuilder.optionsPrompt(entry.sourceText, 3, { toolResult: true }) },
      { role: 'user', content: JSON.stringify({ currentScene: entry.sourceText, playerAction: entry.action, player: {
        money: State.variables.player.money, stamina: State.variables.player.stamina, stress: State.variables.player.stress,
        hunger: State.variables.player.hunger, skills: State.variables.player.skills
      }, purchase: product ? { status: 'authorized_pending_commit', product: product, note: '本回合完整成功后才扣款并立即食用；失败或取消不交易。' } : null }) }
    ];
  }
  async function run() {
    var st = State.variables, entry = st.sceneAction;
    if (!entry) return { ok: false, error: '没有待执行的行动' };
    if (entry.status === 'completed') return { ok: true, sceneId: entry.sceneId, duplicate: true };
    if (entry.status === 'cancelled') return { ok: false, error: '行动已取消，未结算' };
    if (running) return running.promise;
    if (!window.LLMEngine || !LLMEngine.isAvailable()) return { ok: false, error: 'LLM 未启用，行动未执行' };
    var checked = validate(entry.action);
    if (!checked.ok) return checked;
    if (JSON.stringify(entry.position) !== JSON.stringify(position())) return { ok: false, error: '已离开行动地点' };
    if (checked.product && st.player.money < checked.product.price) return { ok: false, error: '金钱不足，未扣款' };
    var messages = messagesFor(entry, checked.product);
    var snapshot = JSON.stringify({ player: st.player, regions: st.regions, world: st.world, entry: entry });
    var scope = LLMOperationScope.create({ operation: 'scene-action', validate: function () {
      return State.variables === st && State.passage === 'SceneAction' && snapshot === JSON.stringify({ player: st.player, regions: st.regions, world: st.world, entry: st.sceneAction });
    } });
    var token = { scope: scope }, staged = null;
    running = token;
    token.promise = LLMToolRunner.run({ operation: 'scene-action', scope: scope, maxRounds: 4, maxCalls: 6, maxTokens: 4096,
      messages: messages, tools: definitions(), debugContext: { sceneActionId: entry.id },
      promptAssembly: { source: 'SceneActions.messagesFor', rule: '现场执行约束 → 普通选项协议和地点商品清单 → 当前现场、玩家选择及受程序约束的交易', sections: messages.map(function (message, index) { return { messageIndex: index, label: index === 0 ? '执行约束与后续选项协议' : '玩家行动与交易授权', content: message.content }; }) },
      stage: function (call) {
        var a = call.arguments;
        if (!plain(a) || !only(a, ['description', 'options', 'effects']) || typeof a.description !== 'string' || !a.description.trim() || a.description.length > 12000 || !Array.isArray(a.options) || a.options.length < 2 || a.options.length > 4) return { status: 'REJECTED', error: '需要非空 description、2–4 个 options 和 effects 对象' };
        var effect = effectsCheck(a.effects, checked.product);
        if (!effect.ok) return { status: 'REJECTED', error: effect.error };
        var meta = { operation: 'scene-action', stage: 'tool-validation' }, options = SceneOptions.normalize(a.options, meta);
        // New action turns have a repair loop: never settle with an unusable next step.
        if (meta.report.rejected || !options.length) return { status: 'REJECTED', error: '请修复选项后重新提交', diagnostics: meta.report };
        var proposal = { description: text(a.description), options: options, effects: effect.effects, report: meta.report };
        if (staged && JSON.stringify(staged) !== JSON.stringify(proposal)) return { status: 'REJECTED', error: '本回合已暂存一个结果，请结束回合' };
        staged = proposal;
        return { status: 'STAGED', message: '结果与交易尚未生效，请给出非空确认结束回合。' };
      }
    }).then(function (result) {
      if (result.status !== 'completed') return { ok: false, error: result.error && result.error.message || '生成失败，可重试；未结算' };
      if (!scope.isCurrent() || !staged) return { ok: false, error: '行动已过期或模型未提交有效工具，未结算' };
      var current = validate(entry.action);
      if (!current.ok || current.product && st.player.money < current.product.price) return { ok: false, error: '交易条件已改变，未扣款' };
      // Compute the complete player replacement before publishing any changes.
      var player = copy(st.player), effects = current.product ? current.product.effects : staged.effects;
      if (current.product) player.money -= current.product.price;
      ['health', 'stamina', 'stress', 'hunger'].forEach(function (key) {
        if (effects[key] === undefined) return;
        var max = key === 'health' ? player.maxHealth || 100 : key === 'stamina' ? player.maxStamina || 80 : 100;
        player[key] = Math.max(0, Math.min(max, (player[key] || 0) + effects[key]));
      });
      Object.keys(effects.skills || {}).forEach(function (key) {
        var skill = player.skills[key]; skill.xp = (skill.xp || 0) + effects.skills[key];
        while (skill.value < 100 && skill.xp >= (skill.value + 1) * 10) { skill.xp -= (skill.value + 1) * 10; skill.value++; }
      });
      var sceneId = entry.id + '-result', scene = { id: sceneId, title: entry.title, location: position().locationId,
        text: staged.description, options: staged.options, optionDiagnostics: staged.report };
      if (window.LLMTrace) { var latest = LLMTrace.list().find(function (row) { return row.operation === 'scene-action'; }); scene.requestId = latest && latest.id; }
      st.generatedScenes = st.generatedScenes || {};
      st.player = player; st.generatedScenes[sceneId] = scene; entry.status = 'completed'; entry.sceneId = sceneId;
      entry.settlement = { actionId: entry.id, productId: current.product && current.product.id || null, money: current.product ? -current.product.price : 0, effects: copy(effects) };
      // Deliberately no NPCAgency fact / dialogue / reward / quest callback.
      log('scene-action-committed', { actionId: entry.id, settlement: entry.settlement, scene: scene }, entry.id);
      SceneOptions.log('scene-options-stored', { sceneId: sceneId, options: scene.options, report: scene.optionDiagnostics }, { requestId: scene.requestId, operation: 'scene-action' });
      try { if (window.PromptBuilder) PromptBuilder.addToHistory('assistant', entry.action.intent + '\n' + scene.text, 'scene'); }
      catch (error) { log('scene-action-history-failed', { error: error.message, committed: true }, entry.id); }
      return { ok: true, sceneId: sceneId };
    }).catch(function (error) { return { ok: false, error: error.message }; }).then(function (result) {
      log('scene-action-outcome', result, entry.id); return result;
    }).finally(function () {
      scope.release();
      if (running === token) {
        running = null;
        // A save load can replace the view before this old request unwinds.
        // Refresh that view too, so pending saves regain a retry button.
        if (view && view.current()) view.refresh();
      }
    });
    return token.promise;
  }
  function enterResult(id) { State.variables.dynamicSceneId = id; Engine.play('DynamicScene'); }
  function leave() {
    if (running) running.scope.invalidate('player-cancelled');
    var entry = State.variables.sceneAction;
    if (entry && entry.status !== 'completed') entry.status = 'cancelled';
    var back = entry && entry.returnTo || {}, destination = back.passage || 'Street';
    if (back.dynamicSceneId) State.variables.dynamicSceneId = back.dynamicSceneId;
    Engine.play(destination === 'SceneAction' ? 'Street' : destination);
  }
  function element(tag, content) { var el = document.createElement(tag); if (content !== undefined) el.textContent = content; return el; }
  function button(root, label, fn) { var el = element('button', label); el.className = 'action-link'; el.type = 'button'; el.addEventListener('click', fn); root.appendChild(el); }
  function render(output) {
    var root = element('div'), st = State.variables; output.appendChild(root);
    function current() { return root.isConnected && State.variables === st && State.passage === 'SceneAction'; }
    function refresh(error) {
      if (!current()) return;
      root.textContent = '';
      var entry = st.sceneAction;
      if (!entry) { root.appendChild(element('p', '行动已失效')); button(root, '返回', leave); return; }
      root.appendChild(element('h1', entry.title)); root.appendChild(element('p', entry.label));
      if (error) { var notice = element('p', error); notice.className = 'llm-error-banner'; root.appendChild(notice); }
      if (entry.status === 'completed') button(root, '查看行动结果', function () { enterResult(entry.sceneId); });
      else if (running) root.appendChild(element('p', '正在生成行动结果…尚未扣款或结算。'));
      else if (entry.status !== 'cancelled') button(root, '重试行动', execute);
      button(root, running ? '取消并返回现场' : '返回现场', leave);
    }
    function execute() {
      if (!current()) return;
      var promise = run(); refresh(); promise.then(function (result) { if (!current()) return; if (result.ok) enterResult(result.sceneId); else refresh(result.error); });
    }
    view = { current: current, refresh: refresh, execute: execute }; refresh();
  }
  async function retryOptions(scene, root) {
    if (root.sceneOptionsRetry) return;
    var st = State.variables, original = JSON.stringify(scene), owner = State.passage;
    var scope = LLMOperationScope.create({ validate: function () { return root.isConnected && State.variables === st && State.passage === owner && JSON.stringify(scene) === original; } });
    root.sceneOptionsRetry = true;
    try {
      var response = await SceneOptionTools.generate({ prompt: PromptBuilder.optionsPrompt(scene.text || scene.narration || '', 3, { toolRegistration: true }), operation: 'scene-options-retry', scope: scope, withScene: false });
      if (!scope.isCurrent()) return;
      var meta = { requestId: response.requestId, operation: 'scene-options-retry', stage: 'retry' };
      scene.options = response.options; scene.optionDiagnostics = response.report; scene.requestId = response.requestId;
      SceneOptions.log('scene-options-stored', { sceneId: scene.id, options: response.options, report: response.report }, meta);
      scope.release(); Engine.play(owner);
    } catch (error) { if (scope.isCurrent()) NarrativeUI.showToast(error.message || '选项重试失败'); }
    finally { root.sceneOptionsRetry = false; scope.release(); }
  }
  window.SceneActions = { validate: validate, catalog: catalog, catalogPrompt: catalogPrompt, begin: begin, run: run, leave: leave, render: render, retryOptions: retryOptions, definitions: definitions, messagesFor: messagesFor };
  function install() {
    Macro.add('sceneaction', { handler: function () { render(this.output); } });
    if (typeof jQuery !== 'undefined') jQuery(document).on(':passagedisplay.sceneActions', function () {
      if (!view || !view.current()) return;
      var entry = State.variables.sceneAction;
      if (entry && entry.status === 'pending' && !running) view.execute(); else view.refresh();
    });
  }
  if (typeof whenSugarCubeReady === 'function') whenSugarCubeReady(install);
}());
