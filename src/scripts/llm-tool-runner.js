/* Provider-neutral tool loop. stage only changes a caller-owned draft; the
   caller alone commits, synchronously after completed + scope.isCurrent(). */
(function () {
  'use strict';
  function debug(event, data) {
    try { if (typeof GameLogger !== 'undefined' && GameLogger.debug) GameLogger.debug(event, data); } catch (_) { /* diagnostics never change gameplay */ }
  }


  var nextRun = 0;

  function failure(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function stable(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stable(value[key]);
    }).join(',') + '}';
  }

  async function run(options) {
    options = options || {};
    var scope = options.scope;
    var messages = [];
    var results = [];
    var rounds = 0;
    var callCount = 0;
    var runId = ++nextRun;
    function trace(event, data) {
      try { if (window.LLMTrace) window.LLMTrace.runEvent(runId, rounds, event, data); } catch (_) { /* diagnostics only */ }
      debug(event, { runId: runId, context: options.debugContext || {}, round: rounds, detail: data });
    }
    var signals = [options.signal, scope && scope.signal].filter(Boolean);
    var transport = new AbortController();
    function cancelTransport() {
      var aborted = signals.find(function (signal) { return signal.aborted; });
      if (aborted) transport.abort(aborted.reason);
    }
    signals.forEach(function (signal) { signal.addEventListener('abort', cancelTransport, { once: true }); });
    cancelTransport();
    var rejected = Object.create(null);
    var usedIds = new Set();

    function check() {
      if (scope && !scope.isCurrent()) {
        var reason = scope.signal && scope.signal.reason;
        throw failure(reason && reason.code === 'CANCELLED' ? 'CANCELLED' : 'STALE_SCOPE', 'LLM 操作已取消或过期');
      }
      if (signals.some(function (signal) { return signal.aborted; })) throw failure('CANCELLED', 'LLM 操作已取消');
    }

    function wait(work) {
      check();
      return new Promise(function (resolve, reject) {
        function cleanup() { signals.forEach(function (signal) { signal.removeEventListener('abort', abort); }); }
        function abort() {
          cleanup();
          try { check(); } catch (err) { reject(err); }
        }
        signals.forEach(function (signal) { signal.addEventListener('abort', abort, { once: true }); });
        Promise.resolve().then(function () { check(); return work(); }).then(function (value) {
          cleanup();
          try { check(); resolve(value); } catch (err) { reject(err); }
        }, function (err) { cleanup(); reject(err); });
      });
    }

    try {
      if (!scope || typeof scope.isCurrent !== 'function' || !scope.signal) throw failure('INVALID_OPTIONS', '必须提供 operation scope');
      check();
      if (!Array.isArray(options.messages)) throw failure('INVALID_OPTIONS', 'messages 必须是数组');
      messages = JSON.parse(JSON.stringify(options.messages));
      messages.forEach(function (message) {
        (message.tool_calls || []).forEach(function (call) { if (call.id) usedIds.add(call.id); });
      });
      var tools = options.tools || [];
      var allowed = new Set(tools.map(function (tool) { return tool.function && tool.function.name; }));
      var maxRounds = options.maxRounds === undefined ? 3 : options.maxRounds;
      var maxCalls = options.maxCalls === undefined ? 12 : options.maxCalls;
      if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || !Number.isSafeInteger(maxCalls) || maxCalls < 0) {
        throw failure('INVALID_OPTIONS', 'maxRounds/maxCalls 必须是有效整数');
      }
      var request = options.chatRaw || function (history, requestOptions) { return window.LLMEngine.chatRaw(history, requestOptions); };
      while (rounds < maxRounds) {
        check();
        rounds += 1;
        var response = await wait(function () {
          return request(messages, {
            tools: tools, signal: transport.signal, operation: options.operation || 'npc-tools',
            maxTokens: options.maxTokens, temperature: options.temperature,
            promptAssembly: options.promptAssembly,
            traceContext: { runId: runId, round: rounds, context: options.debugContext || {} }
          });
        });
        check();
        var text = response && typeof response.text === 'string' ? response.text : '';
        var calls = response && response.tool_calls;
        if (response && (response.finishReason === 'length' || response.finishReason === 'max_tokens')) {
          throw failure('TRUNCATED_RESPONSE', 'LLM 响应因长度限制被截断');
        }
        if (!calls || !calls.length) {
          if (!text.trim()) throw failure('EMPTY_RESPONSE', 'LLM 未返回最终答复');
          trace('npc-model-reply', { content: text });
          messages.push({ role: 'assistant', content: text });
          check();
          return { status: 'completed', content: text, messages: messages, toolResults: results, rounds: rounds, callCount: callCount };
        }
        if (text.trim()) trace('npc-model-tool-preamble', { content: text });
        if (!Array.isArray(calls)) throw failure('INVALID_RESPONSE', 'tool_calls 必须是数组');
        if (rounds === maxRounds || callCount + calls.length > maxCalls) {
          throw failure('LIMIT_REACHED', '工具循环或调用次数已达到上限');
        }
        var normalized = calls.map(function (raw, index) {
          raw = raw || {};
          var fn = raw.function || raw;
          var id = typeof raw.id === 'string' && raw.id ? raw.id : 'call-' + runId + '-' + rounds + '-' + index;
          while (usedIds.has(id)) id += '-local';
          usedIds.add(id);
          var args = fn.arguments;
          var error = null;
          try {
            if (typeof args === 'string') args = JSON.parse(args);
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments 必须是 JSON 对象');
          } catch (err) { error = 'arguments 不是合法 JSON 对象'; }
          return { id: id, providerId: raw.id || null, name: fn.name || '', arguments: args,
            argumentError: error, rawArguments: fn.arguments, callSlot: callCount + index };
        });
        var assistant = { role: 'assistant', content: text || null, tool_calls: normalized.map(function (call) {
          return { id: call.id, type: 'function', function: {
            // Invalid calls are rejected below, never staged. Replay a valid empty
            // object so Ollama can accept the error result and let the model repair.
            name: call.name, arguments: JSON.stringify(call.argumentError ? {} : call.arguments)
          } };
        }) };
        // Ollama thinking models require the assistant thinking alongside calls.
        ['thinking', 'reasoning_content'].forEach(function (key) {
          if (response.message && typeof response.message[key] === 'string') assistant[key] = response.message[key];
        });
        messages.push(assistant);
        for (var i = 0; i < normalized.length; i += 1) {
          check();
          var call = normalized[i];
          callCount += 1;
          trace('npc-tool-call', { callId: call.id, name: call.name, arguments: call.argumentError ? call.rawArguments : call.arguments });
          var cacheKey = call.name + ':' + stable(call.argumentError ? call.rawArguments : call.arguments);
          var result = rejected[cacheKey];
          if (!result) {
            if (call.argumentError || !allowed.has(call.name)) {
              result = { status: 'REJECTED', error: call.argumentError || ('未知或未授权工具：' + call.name) };
            } else {
              if (typeof options.stage !== 'function') throw failure('INVALID_OPTIONS', '必须提供 stage handler');
              result = await wait(function () { return options.stage(call, options.draft, { scope: scope }); });
              if (!result || (result.status !== 'STAGED' && result.status !== 'REJECTED')) {
                throw failure('INVALID_STAGE_RESULT', 'stage 必须返回 STAGED 或 REJECTED');
              }
            }
            if (result.status === 'REJECTED') rejected[cacheKey] = result;
            else rejected = Object.create(null); // A staged change is new information for a retry.
          }
          check();
          trace('npc-tool-result', { callId: call.id, name: call.name, result: result });
          results.push({ call: call, result: result });
          messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(result) });
        }
      }
      throw failure('LIMIT_REACHED', '工具循环已达到上限');
    } catch (err) {
      try { check(); } catch (currentError) { err = currentError; }
      // An AbortError from LLMEngine.abort() is also cancellation, never fallback.
      var status = err.code === 'STALE_SCOPE' ? 'stale'
        : err.code === 'CANCELLED' || err.name === 'AbortError' ? 'cancelled'
        : err.code === 'LIMIT_REACHED' ? 'limit_reached' : 'failed';
      trace('npc-tool-run-ended', { status: status, error: { code: err.code, message: err.message } });
      return { status: status, content: '', messages: [], toolResults: results, rounds: rounds,
        callCount: callCount, error: { code: err.code || 'TOOL_RUN_FAILED', message: err.message || String(err) } };
    } finally {
      signals.forEach(function (signal) { signal.removeEventListener('abort', cancelTransport); });
    }
  }

  window.LLMToolRunner = { run: run };
}());
