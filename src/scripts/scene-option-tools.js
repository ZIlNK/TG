/* Scene option registration is a tool submission, not prose parsing or gameplay execution. */
(function () {
  'use strict';
  var nextRun = 0;
  function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function definition(withScene) {
    var properties = {
      options: { type: 'array', minItems: withScene ? 2 : 1, maxItems: withScene ? 4 : 8, items: {
        type: 'object', additionalProperties: false, required: ['label'], properties: {
          label: { type: 'string', minLength: 1 }, tooltip: { type: 'string' },
          action: { type: 'object', additionalProperties: false, required: ['type', 'intent'], properties: {
            type: { type: 'string', enum: ['scene_action'] }, intent: { type: 'string', minLength: 1 },
            purchase: { type: 'object', additionalProperties: false, required: ['productId'], properties: { productId: { type: 'string' } } }
          } },
          tool: { type: 'object', additionalProperties: false, required: ['name', 'arguments'], properties: {
            name: { type: 'string', enum: ['start_dialogue', 'move_player'] }, arguments: { type: 'object' }
          } },
          target: { type: 'string' }, questAction: { type: 'object' }
        }, description: 'action/tool/target 必须且只能选择一种；工具只是玩家点击后的入口，注册时不执行。禁止 effects。'
      } }
    };
    var required = ['options'];
    if (withScene) {
      ['id', 'title', 'text', 'location', 'mood'].forEach(function (key) { properties[key] = { type: 'string' }; });
      required = required.concat(['id', 'title', 'text']);
    }
    return { type: 'function', function: { name: 'register_scene_options',
      description: withScene ? '一次提交完整场景及所有可点击选项。校验全部成功才保存，不执行玩家行动。' : '一次提交当前现场的所有可点击选项，不重写现场、不执行行动。',
      parameters: { type: 'object', additionalProperties: false, required: required, properties: properties }
    } };
  }
  function validate(args, withScene, meta) {
    meta = meta || {};
    var errors = [], keys = withScene ? ['id', 'title', 'text', 'location', 'mood', 'options'] : ['options'];
    if (!plain(args)) errors.push({ path: 'arguments', message: '必须是 JSON 对象' });
    else {
      Object.keys(args).forEach(function (key) { if (keys.indexOf(key) < 0) errors.push({ path: key, message: '不允许此字段' }); });
      if (withScene) {
        ['id', 'title', 'text'].forEach(function (key) {
          if (typeof args[key] !== 'string' || !args[key].trim()) errors.push({ path: key, message: '必须是非空字符串' });
        });
        ['location', 'mood'].forEach(function (key) {
          if (args[key] !== undefined && typeof args[key] !== 'string') errors.push({ path: key, message: '必须是字符串' });
        });
        if (args.id === '__proto__' || args.id === 'constructor' || args.id === 'prototype') errors.push({ path: 'id', message: '不能使用保留标识' });
      }
      if (!Array.isArray(args.options) || args.options.length < (withScene ? 2 : 1) || args.options.length > (withScene ? 4 : 8)) {
        errors.push({ path: 'options', message: withScene ? '必须包含 2–4 个选项' : '必须包含 1–8 个选项' });
      }
      (Array.isArray(args.options) ? args.options : []).forEach(function (option, index) {
        if (!plain(option)) return;
        Object.keys(option).forEach(function (key) {
          if (['label', 'tooltip', 'action', 'tool', 'target', 'questAction'].indexOf(key) < 0) errors.push({ path: 'options[' + index + '].' + key, message: '不允许此字段；选项注册不接收预结算 effects' });
        });
        ['action', 'questAction'].forEach(function (key) { if (option[key] !== undefined && !plain(option[key])) errors.push({ path: 'options[' + index + '].' + key, message: '必须是对象' }); });
        if (option.target !== undefined && (typeof option.target !== 'string' || !option.target.trim())) errors.push({ path: 'options[' + index + '].target', message: '必须是非空字符串' });
        if (option.tooltip !== undefined && typeof option.tooltip !== 'string') errors.push({ path: 'options[' + index + '].tooltip', message: '必须是字符串' });
        if (option.tool !== undefined && (!plain(option.tool) || !plain(option.tool.arguments) || Object.keys(option.tool).some(function (key) { return ['name', 'arguments'].indexOf(key) < 0; }))) {
          errors.push({ path: 'options[' + index + '].tool', message: 'tool 只能包含 name 和对象类型的 arguments' });
        }
      });
    }
    var options = SceneOptions.normalize(plain(args) ? args.options : null, meta);
    meta.report.entries.forEach(function (entry) { if (entry.status === 'rejected') errors.push({ path: 'options[' + entry.index + ']', message: entry.reason }); });
    if (errors.length) {
      meta.report.error = '本批参数校验失败，未注册任何选项';
      meta.report.validationErrors = errors;
      meta.report.entries.forEach(function (entry) {
        if (entry.status !== 'rejected') { entry.status = 'rejected'; entry.reason = '本批含无效参数，整批未注册'; }
      });
      meta.report.kept = 0; meta.report.rejected = meta.report.generated;
      return { ok: false, errors: errors, report: meta.report };
    }
    var scene = withScene ? Object.assign({}, args, { options: options }) : null;
    return { ok: true, options: options, scene: scene, report: meta.report };
  }
  function check(scope) {
    if (scope.isCurrent()) return;
    var error = new Error('选项注册已取消或当前场景已改变'); error.name = 'AbortError'; throw error;
  }
  function failed(message, meta, errors) {
    var error = new Error(message);
    error.report = Object.assign({}, meta.report || { generated: 0, kept: 0, rejected: 0, entries: [] }, { error: message });
    error.requestId = meta.requestId; error.validationErrors = errors || [];
    SceneOptions.log('scene-options-registration-failed', { report: error.report, errors: error.validationErrors }, meta);
    return error;
  }
  async function generate(config) {
    var scope = config.scope, runId = 'scene-options-' + (++nextRun), tools = [definition(!!config.withScene)];
    var messages = [{ role: 'system', content: '必须调用 register_scene_options 提交选项，一次回复恰好一次调用。不能只回复 JSON 或调用选项内的行动工具。参数校验失败会返回具体错误，最多修正重试一次；每次必须提交完整参数。注册只创建可点击入口，不执行、扣款、移动或发奖。' }, { role: 'user', content: config.prompt }];
    for (var attempt = 0; attempt < 2; attempt++) {
      check(scope);
      var response = await LLMEngine.chatRaw(messages.slice(), { operation: config.operation, tools: tools, stream: false, maxTokens: 4096, signal: scope.signal,
        traceContext: { runId: runId, round: attempt + 1, context: { kind: 'scene-options-registration', repairAttempt: attempt } },
        promptAssembly: { source: 'SceneOptionTools.generate', rule: '注册工具协议 → 场景或选项提示词 → 校验失败时追加 assistant 工具调用及逐项 tool 错误（仅一次）', sections: [
          { messageIndex: 0, label: '注册与重试规则', content: messages[0].content }, { messageIndex: 1, label: '场景、地点与选项约束', content: messages[1].content }
        ].concat(messages.slice(2).map(function (message, index) {
          return { messageIndex: index + 2, label: message.role === 'tool' ? '工具参数错误反馈' : '上一轮模型工具调用', content: message.content || '', toolCalls: message.tool_calls };
        })) }
      });
      check(scope);
      var meta = { requestId: response.requestId, operation: config.operation, stage: attempt ? 'tool-repair' : 'tool-registration' };
      if (response.finishReason === 'length' || response.finishReason === 'max_tokens') throw failed('模型响应被截断，未注册选项。', meta);
      var calls = response.tool_calls;
      if (!Array.isArray(calls) || !calls.length) throw failed('模型未调用 register_scene_options，未注册选项。', meta);
      var replay = [], results = [], accepted = null;
      calls.forEach(function (call, index) {
        call = call || {}; var fn = call.function || {}, args = fn.arguments, parseError = null;
        try { if (typeof args === 'string') args = JSON.parse(args); if (!plain(args)) throw new Error('not object'); }
        catch (_) { parseError = 'arguments 不是合法 JSON 对象'; }
        // Unique local IDs also tolerate duplicate/missing provider call IDs.
        var id = typeof call.id === 'string' && call.id && !replay.some(function (item) { return item.id === call.id; }) ? call.id : 'register-' + attempt + '-' + index;
        replay.push({ id: id, type: 'function', function: { name: fn.name || 'unknown', arguments: JSON.stringify(parseError ? {} : args) } });
        SceneOptions.log('scene-options-tool-call', { attempt: attempt, callId: id, name: fn.name, arguments: fn.arguments }, meta);
        var errors = [];
        if (calls.length !== 1) errors.push({ path: 'tool_calls', message: '每次回复必须且只能调用一次 register_scene_options；本批全部不注册' });
        if (fn.name !== 'register_scene_options') errors.push({ path: 'name', message: '未知或未授权工具；这里只能调用 register_scene_options' });
        if (parseError) errors.push({ path: 'arguments', message: parseError });
        var checked = errors.length ? null : validate(args, !!config.withScene, meta);
        if (checked) {
          if (!checked.ok) errors = checked.errors;
          SceneOptions.log('scene-options-registration-checked', { report: checked.report, ok: checked.ok }, meta);
        }
        var result = errors.length ? { status: 'REJECTED', errors: errors, receivedArguments: parseError ? fn.arguments : undefined, diagnostics: meta.report, retriesRemaining: attempt ? 0 : 1 }
          : { status: 'VALIDATED', count: checked.options.length, message: '参数校验通过，等待当前操作提交；未执行任何玩家行动。' };
        if (!errors.length) accepted = checked;
        results.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(result) });
        SceneOptions.log('scene-options-tool-result', { attempt: attempt, callId: id, name: fn.name, result: result }, meta);
      });
      check(scope);
      if (accepted) return Object.assign(accepted, { requestId: response.requestId });
      var assistant = { role: 'assistant', content: response.text || null, tool_calls: replay };
      ['thinking', 'reasoning_content'].forEach(function (key) { if (response.message && typeof response.message[key] === 'string') assistant[key] = response.message[key]; });
      messages.push(assistant); Array.prototype.push.apply(messages, results);
      if (attempt === 1) throw failed('选项工具参数仍无效，已达到一次修正重试上限；未注册任何选项。', meta, results.map(function (result) { return JSON.parse(result.content).errors; }));
      SceneOptions.log('scene-options-tool-retry', { attempt: 1, reason: '参数校验失败', feedback: results }, meta);
    }
  }
  window.SceneOptionTools = { generate: generate, definition: definition, validate: validate };
}());
