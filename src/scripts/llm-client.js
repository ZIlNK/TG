/* LLM Engine: frontend client backed by the server-side persisted configuration. */
(function () {
  'use strict';

  var ACTIVE_REQUEST = null;
  var BACKEND_CONFIG = null;
  var CONFIG_PROMISE = null;

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'llm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function logEvent(level, event, data) {
    if (typeof window.log === 'function') window.log(level, event, data);
  }

  function trace(requestId, data) {
    try { if (window.LLMTrace) window.LLMTrace.record(requestId, data); } catch (_) { /* diagnostics only */ }
  }

  function requestContext() {
    var context = {};
    try {
      if (typeof passage === 'function') context.passage = passage();
      if (typeof State !== 'undefined') context.turn = State.turns;
      if (typeof State !== 'undefined' && State.variables) context.location = State.variables.location || null;
    } catch (e) { /* diagnostics must not block requests */ }
    return context;
  }

  function getConfig() {
    if (BACKEND_CONFIG) return BACKEND_CONFIG;
    if (typeof State !== 'undefined' && State.variables && State.variables.llmConfig) {
      return State.variables.llmConfig;
    }
    return {
      enabled: true,
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
      model: 'llama3.2',
      maxTokens: 512,
      temperature: 0.8,
      apiKeyConfigured: false,
      apiKeyMasked: ''
    };
  }

  function applyBackendConfig(config) {
    if (!config || typeof config !== 'object') return getConfig();
    BACKEND_CONFIG = config;
    if (typeof State !== 'undefined' && State.variables) State.variables.llmConfig = config;
    return config;
  }

  function parseConfigResponse(response) {
    return response.text().then(function (text) {
      var data;
      try { data = JSON.parse(text || '{}'); } catch (e) { throw new Error('后端配置响应不是合法 JSON'); }
      if (!response.ok || !data.ok || !data.config) throw new Error(data.error || ('读取配置失败：HTTP ' + response.status));
      return applyBackendConfig(data.config);
    });
  }

  function loadBackendConfig(force) {
    if (CONFIG_PROMISE && !force) return CONFIG_PROMISE;
    CONFIG_PROMISE = fetch('/api/llm/config', { method: 'GET', cache: 'no-store' })
      .then(parseConfigResponse)
      .then(function (config) {
        logEvent('info', 'llm-config-loaded', {
          provider: config.provider,
          endpoint: config.endpoint,
          model: config.model,
          apiKeyConfigured: config.apiKeyConfigured
        });
        return config;
      })
      .catch(function (err) {
        CONFIG_PROMISE = null;
        logEvent('error', 'llm-config-load-failed', { message: err.message || String(err) });
        throw err;
      });
    return CONFIG_PROMISE;
  }

  function saveBackendConfig(updates) {
    return fetch('/api/llm/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates || {})
    }).then(parseConfigResponse).then(function (config) {
      CONFIG_PROMISE = Promise.resolve(config);
      logEvent('info', 'llm-config-saved', {
        provider: config.provider,
        endpoint: config.endpoint,
        model: config.model,
        apiKeyConfigured: config.apiKeyConfigured
      });
      return config;
    });
  }

  function abortError(signal) {
    var error = new Error('LLM 请求已取消');
    error.name = 'AbortError';
    error.code = signal.reason && signal.reason.code === 'STALE_SCOPE' ? 'STALE_SCOPE' : 'CANCELLED';
    return error;
  }

  // Race even configuration/body reads: cancellation must settle without waiting
  // for a shared config fetch or a transport which ignores AbortSignal.
  function waitForRequest(work, signal) {
    return new Promise(function (resolve, reject) {
      function aborted() { reject(abortError(signal)); }
      if (signal.aborted) { aborted(); return; }
      signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve().then(function () {
        if (signal.aborted) throw abortError(signal);
        return work();
      }).then(resolve, reject).finally(function () {
        signal.removeEventListener('abort', aborted);
      });
    });
  }

  function makeRequest(isChat) {
    return async function request(input, options) {
      options = options || {};
      var controller = new AbortController();
      var signal = controller.signal;
      var external = options.signal;
      function cancel() { controller.abort(external.reason); }
      if (external) {
        if (external.aborted) cancel();
        else external.addEventListener('abort', cancel, { once: true });
      }
      // Legacy abort() affects the most recently started pending request only.
      ACTIVE_REQUEST = controller;
      var requestId = createRequestId();
      var started = Date.now();
      var operation = options.operation || (isChat ? 'chat' : 'generate');
      trace(requestId, { startedAt: started, operation: operation, status: 'preparing',
        traceContext: options.traceContext || null, assembly: options.promptAssembly || null });
      try {
        if (signal.aborted) throw abortError(signal);
        await waitForRequest(function () { return loadBackendConfig(false); }, signal);
        if (signal.aborted) throw abortError(signal);
        var config = getConfig();
        var payload = isChat || Array.isArray(input)
          ? { messages: Array.isArray(input) ? input : [{ role: 'user', content: input }] }
          : { prompt: input };
        payload.temperature = typeof options.temperature === 'number' ? options.temperature : config.temperature;
        payload.maxTokens = Math.max(config.maxTokens || 0, options.maxTokens || 0);
        payload.stream = options.stream !== false;
        payload.operation = operation;
        payload.context = requestContext();
        if (options.tools && options.tools.length) payload.tools = options.tools;
        trace(requestId, { status: 'pending', model: config.model, provider: config.provider, payload: payload });
        logEvent('info', 'llm-request-start', {
          requestId: requestId, operation: operation, model: config.model,
          inputLength: JSON.stringify(payload.messages || payload.prompt || '').length,
          inputType: payload.messages ? 'chat' : 'prompt', messageCount: payload.messages ? payload.messages.length : 0,
          maxTokens: payload.maxTokens, temperature: payload.temperature,
          toolsCount: payload.tools ? payload.tools.length : 0
        });
        var response = await waitForRequest(function () {
          return fetch('/api/llm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
            body: JSON.stringify(payload), signal: signal
          });
        }, signal);
        var bodyText = await waitForRequest(function () { return response.text(); }, signal);
        if (signal.aborted) throw abortError(signal);
        var data;
        try { data = JSON.parse(bodyText); }
        catch (err) { throw new Error('后端返回了无法解析的响应（HTTP ' + response.status + '）'); }
        trace(requestId, { response: { text: data && data.text || '', tool_calls: data && data.tool_calls || [],
          finishReason: data && data.finishReason, requestId: data && data.requestId || requestId } });
        if (!response.ok) {
          var responseError = new Error(data && data.error || ('HTTP ' + response.status));
          responseError.requestId = data && data.requestId || requestId;
          responseError.status = response.status;
          throw responseError;
        }
        var text = data && typeof data.text === 'string' ? data.text : '';
        var toolCalls = data && Array.isArray(data.tool_calls) && data.tool_calls.length ? data.tool_calls : null;
        if (!text.trim() && !(options.returnRaw && toolCalls)) {
          var emptyError = new Error('LLM 返回了空响应');
          emptyError.code = 'EMPTY_RESPONSE';
          throw emptyError;
        }
        if (signal.aborted) throw abortError(signal);
        if (typeof options.onChunk === 'function') options.onChunk(text, text);
        if (signal.aborted) throw abortError(signal);
        trace(requestId, { status: 'success', ms: Date.now() - started });
        logEvent('info', 'llm-request-success', {
          requestId: data.requestId || requestId, operation: operation,
          ms: Date.now() - started, responseLength: text.length,
          toolCallCount: toolCalls ? toolCalls.length : 0
        });
        return options.returnRaw ? {
          text: text, tool_calls: toolCalls, message: data.message,
          finishReason: data.finishReason, requestId: data.requestId || requestId
        } : text;
      } catch (err) {
        if (signal.aborted) err = abortError(signal);
        var networkFailure = err.message && err.message.indexOf('Failed to fetch') !== -1;
        if (networkFailure) {
          err = new Error('NETWORK_ERROR：无法连接到后端。请先运行 node server/index.js，然后打开 http://localhost:3000');
        }
        err.requestId = err.requestId || requestId;
        trace(requestId, { status: err.name === 'AbortError' ? 'cancelled' : 'failed', ms: Date.now() - started,
          error: { message: err.message, code: err.code || null, status: err.status || null } });
        logEvent(err.name === 'AbortError' ? 'warn' : 'error',
          err.name === 'AbortError' ? 'llm-request-aborted' : 'llm-request-failed', {
            requestId: err.requestId, operation: operation, ms: Date.now() - started,
            message: err.message, code: err.code || null, status: err.status || null,
            stage: networkFailure ? 'network' : err.status ? 'backend-http' : 'client-response', stack: err.stack || ''
          });
        throw err;
      } finally {
        if (external) external.removeEventListener('abort', cancel);
        if (ACTIVE_REQUEST === controller) ACTIVE_REQUEST = null;
      }
    };
  }

  window.LLMEngine = {
    isAvailable: function () {
      var config = getConfig();
      return config.enabled && config.model;
    },

    getConfig: getConfig,

    setConfig: function (updates) {
      return saveBackendConfig(updates);
    },

    loadConfig: loadBackendConfig,

    saveConfig: saveBackendConfig,

    generate: makeRequest(false),

    chat: makeRequest(true),

    chatRaw: function (input, options) {
      options = Object.assign({}, options || {});
      options.returnRaw = true;
      options.stream = false;
      return makeRequest(true)(input, options);
    },

    abort: function () {
      if (ACTIVE_REQUEST) {
        ACTIVE_REQUEST.abort();
        ACTIVE_REQUEST = null;
      }
    }
  };

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      console.log('[LLMEngine] Loaded. (backend proxy mode)');
      if (typeof jQuery !== 'undefined') {
        $(document).on(':storyready', function () {
          loadBackendConfig(true).catch(function () { /* the config page will show the connection error */ });
        });
      }
    });
  }
}());
