/* LLM proxy: forwards /api/llm requests to Ollama or an OpenAI-compatible API,
   logging every request/response to the server log. */
'use strict';

var fs = require('fs');
var path = require('path');
var logger = require('./logger');

var CONFIG_PATH = process.env.LLM_CONFIG_FILE || path.join(__dirname, 'llm-config.local.json');
var runtimeConfig = null;

function environmentConfig() {
  return {
    enabled: true,
    provider: process.env.LLM_PROVIDER || 'ollama',
    endpoint: process.env.LLM_ENDPOINT || 'http://localhost:11434',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'llama3.2',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '1024', 10),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.8'),
    logFullContent: String(process.env.LLM_LOG_CONTENT || '').toLowerCase() === 'true'
  };
}

function loadConfig() {
  if (runtimeConfig) return runtimeConfig;
  runtimeConfig = environmentConfig();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      var saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      ['enabled', 'provider', 'endpoint', 'apiKey', 'model', 'maxTokens', 'temperature'].forEach(function (key) {
        if (saved[key] !== undefined) runtimeConfig[key] = saved[key];
      });
    }
  } catch (err) {
    logger.write('server', 'llm-config-load-failed', { level: 'warn', message: err.message, path: CONFIG_PATH });
  }
  return runtimeConfig;
}

function getConfig() {
  return loadConfig();
}

function publicConfig(config) {
  config = config || getConfig();
  return {
    enabled: config.enabled !== false,
    provider: config.provider,
    endpoint: config.endpoint,
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    apiKeyConfigured: !!config.apiKey,
    apiKeyMasked: config.apiKey ? ('••••' + config.apiKey.slice(-4)) : ''
  };
}

function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: '配置必须是对象' };
  var current = getConfig();
  var next = {
    enabled: input.enabled !== undefined ? !!input.enabled : current.enabled,
    provider: typeof input.provider === 'string' ? input.provider.trim().toLowerCase() : current.provider,
    endpoint: typeof input.endpoint === 'string' ? input.endpoint.trim() : current.endpoint,
    apiKey: current.apiKey || '',
    model: typeof input.model === 'string' ? input.model.trim() : current.model,
    maxTokens: input.maxTokens !== undefined ? Number(input.maxTokens) : current.maxTokens,
    temperature: input.temperature !== undefined ? Number(input.temperature) : current.temperature,
    logFullContent: current.logFullContent
  };
  if (next.provider !== 'ollama' && next.provider !== 'openai') return { ok: false, error: 'provider 只能是 ollama 或 openai' };
  try {
    var parsed = new URL(next.endpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: 'endpoint 只支持 HTTP 或 HTTPS' };
  } catch (err) {
    return { ok: false, error: 'endpoint 不是合法 URL' };
  }
  next.endpoint = next.endpoint.replace(/\/$/, '');
  if (!next.model || next.model.length > 200) return { ok: false, error: 'model 必须是 1-200 个字符' };
  if (!Number.isFinite(next.maxTokens) || next.maxTokens < 64 || next.maxTokens > 131072) return { ok: false, error: 'maxTokens 必须在 64-131072 之间' };
  next.maxTokens = Math.floor(next.maxTokens);
  if (!Number.isFinite(next.temperature) || next.temperature < 0 || next.temperature > 2) return { ok: false, error: 'temperature 必须在 0-2 之间' };
  if (input.clearApiKey === true) next.apiKey = '';
  else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    if (input.apiKey.trim().length > 1000) return { ok: false, error: 'API Key 过长' };
    next.apiKey = input.apiKey.trim();
  }
  return { ok: true, config: next };
}

function updateConfig(input) {
  var checked = validateConfig(input);
  if (!checked.ok) return checked;
  var next = checked.config;
  var persisted = {
    enabled: next.enabled,
    provider: next.provider,
    endpoint: next.endpoint,
    apiKey: next.apiKey,
    model: next.model,
    maxTokens: next.maxTokens,
    temperature: next.temperature
  };
  try {
    var temporary = CONFIG_PATH + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(persisted, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, CONFIG_PATH);
    runtimeConfig = next;
    logger.write('server', 'llm-config-updated', {
      provider: next.provider,
      endpoint: next.endpoint,
      model: next.model,
      maxTokens: next.maxTokens,
      temperature: next.temperature,
      apiKeyConfigured: !!next.apiKey
    });
    return { ok: true, config: publicConfig(next) };
  } catch (err) {
    logger.write('server', 'llm-config-save-failed', { level: 'error', message: err.message, path: CONFIG_PATH });
    return { ok: false, error: '保存后端配置失败：' + err.message };
  }
}

function preview(text) {
  text = typeof text === 'string' ? text : JSON.stringify(text || '');
  return text
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|password|secret)\s*[:=]\s*)[^\s,"']+/ig, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

function describeInput(body, includeContent) {
  var messages = Array.isArray(body.messages) ? body.messages : null;
  var text = messages ? JSON.stringify(messages) : (body.prompt || '');
  var result = {
    inputType: messages ? 'chat' : 'prompt',
    inputLength: text.length,
    inputPreview: preview(text)
  };
  if (messages) {
    result.messageCount = messages.length;
    result.messageRoles = messages.map(function (message) { return message && message.role || 'unknown'; });
  }
  if (includeContent) result.input = messages || body.prompt || '';
  return result;
}

function describeError(err) {
  var cause = err && err.cause;
  return {
    name: err && err.name || 'Error',
    message: err && err.message ? err.message : String(err),
    code: err && err.code || (cause && cause.code) || null,
    errno: cause && cause.errno || null,
    address: cause && cause.address || null,
    port: cause && cause.port || null
  };
}

// Internal history uses OpenAI-style call IDs. Ollama uses object arguments
// and tool_name; never forward another provider's tool envelope unchanged.
function normalizeCalls(calls, prefix) {
  if (calls == null) return null;
  if (!Array.isArray(calls)) throw new Error('tool_calls must be an array');
  if (!calls.length) return null;
  var ids = new Set();
  return calls.map(function (call, index) {
    if (!call || !call.function || typeof call.function.name !== 'string' || !call.function.name) {
      throw new Error('invalid function tool call');
    }
    var id = typeof call.id === 'string' && call.id ? call.id : prefix + '-' + index;
    if (ids.has(id)) throw new Error('duplicate tool call id');
    ids.add(id);
    return { id: id, type: 'function', function: {
      name: call.function.name,
      arguments: typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments == null ? {} : call.function.arguments)
    } };
  });
}

function adaptMessages(messages, provider) {
  var pending = new Map();
  return messages.map(function (message, index) {
    var result = { role: message.role, content: message.content == null ? '' : message.content };
    if (message.role === 'assistant') {
      var calls = normalizeCalls(message.tool_calls, 'history-' + index);
      if (calls) {
        calls.forEach(function (call) { pending.set(call.id, call.function.name); });
        result.tool_calls = calls.map(function (call) {
          if (provider !== 'ollama') return call;
          var args;
          try { args = JSON.parse(call.function.arguments); }
          catch (err) { throw new Error('Ollama tool history arguments must be valid JSON'); }
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Ollama tool history arguments must be an object');
          return { function: { name: call.function.name, arguments: args } };
        });
      }
      if (provider === 'ollama' && typeof message.thinking === 'string') result.thinking = message.thinking;
      if (provider === 'openai' && typeof message.reasoning_content === 'string') result.reasoning_content = message.reasoning_content;
    } else if (message.role === 'tool') {
      var id = message.tool_call_id;
      if (!id) {
        var name = message.name || message.tool_name;
        var matches = Array.from(pending.keys()).filter(function (key) { return pending.get(key) === name; });
        if (matches.length === 1) id = matches[0];
      }
      if (!id || !pending.has(id)) throw new Error('tool result has no matching assistant call');
      if (provider === 'ollama') result.tool_name = pending.get(id);
      else result.tool_call_id = id;
      pending.delete(id);
      if (typeof result.content !== 'string') result.content = JSON.stringify(result.content);
    } else if (provider === 'openai' && message.name) result.name = message.name;
    return result;
  });
}

function buildUpstream(config, body) {
  var model = body.model || config.model;
  var temperature = typeof body.temperature === 'number' ? body.temperature : config.temperature;
  var maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : config.maxTokens;
  var hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  var isChat = Array.isArray(body.messages) || hasTools;
  var messages = Array.isArray(body.messages) ? body.messages : [{ role: 'user', content: body.prompt || '' }];
  var headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = 'Bearer ' + config.apiKey;
  var payload;
  var url;
  if (config.provider === 'ollama') {
    payload = { model: model, stream: false, options: { temperature: temperature, num_predict: maxTokens } };
    if (isChat) payload.messages = adaptMessages(messages, 'ollama');
    else payload.prompt = body.prompt || '';
    url = config.endpoint.replace(/\/$/, '') + (isChat ? '/api/chat' : '/api/generate');
  } else {
    payload = { model: model, messages: adaptMessages(messages, 'openai'), stream: false,
      temperature: temperature, max_tokens: maxTokens };
    // Accept both host-root and the conventional configured /v1 base URL.
    var base = config.endpoint.replace(/\/$/, '');
    url = base + (/\/v1$/.test(base) ? '/chat/completions' : '/v1/chat/completions');
  }
  if (hasTools) payload.tools = body.tools;
  return { url: url, headers: headers, payload: payload };
}

function responseMessage(config, data) {
  if (config.provider === 'ollama') return data && data.message;
  return data && data.choices && data.choices[0] && data.choices[0].message;
}

function extractText(config, data) {
  var message = responseMessage(config, data);
  var content = message ? message.content : config.provider === 'ollama' && data && data.response;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(function (part) {
    return part && part.type === 'text' && typeof part.text === 'string' ? part.text : '';
  }).join('');
  return '';
}

function extractToolCalls(config, data) {
  var message = responseMessage(config, data);
  return normalizeCalls(message && message.tool_calls, 'call-' + require('crypto').randomUUID());
}

async function forward(req, res, body, requestId, signal) {
  var config = getConfig();
  if (config.enabled === false) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'LLM 已在后端配置中禁用', requestId: requestId }));
    return;
  }
  var upstream;
  try { upstream = buildUpstream(config, body); }
  catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message, requestId: requestId }));
    return;
  }
  var inputDetails = describeInput(body, config.logFullContent);

  logger.write('llm', 'request', {
    requestId: requestId,
    model: body.model || config.model,
    provider: config.provider,
    operation: body.operation || null,
    passage: body.context && body.context.passage || null,
    temperature: upstream.payload.options ? upstream.payload.options.temperature : upstream.payload.temperature,
    maxTokens: upstream.payload.options ? upstream.payload.options.num_predict : upstream.payload.max_tokens,
    toolsCount: (body.tools && body.tools.length) ? body.tools.length : 0,
    input: inputDetails
  });

  var started = Date.now();
  var resp;
  try {
    resp = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      body: JSON.stringify(upstream.payload),
      signal: signal
    });
  } catch (err) {
    if (signal.aborted) return;
    logger.write('llm', 'error', {
      level: 'error',
      requestId: requestId,
      stage: 'connect',
      ms: Date.now() - started,
      endpoint: upstream.url,
      error: describeError(err),
      message: 'upstream unreachable: ' + (err && err.message ? err.message : err)
    });
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: '无法连接到 LLM 服务器 ' + config.endpoint + '。请确认它已启动。',
      requestId: requestId
    }));
    return;
  }

  if (signal.aborted) return;
  if (!resp.ok) {
    var errorBody = '';
    try { errorBody = await resp.text(); } catch (readErr) { errorBody = '[unreadable response body: ' + readErr.message + ']'; }
    if (signal.aborted) return;
    var upstreamError = {
      level: 'error',
      requestId: requestId,
      stage: 'upstream-http',
      status: resp.status,
      statusText: resp.statusText,
      ms: Date.now() - started,
      responsePreview: preview(errorBody),
      message: 'upstream HTTP ' + resp.status
    };
    if (config.logFullContent) upstreamError.responseBody = errorBody;
    logger.write('llm', 'error', upstreamError);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'LLM 上游返回 HTTP ' + resp.status, requestId: requestId }));
    return;
  }

  var rawBody;
  var data;
  try {
    rawBody = await resp.text();
    if (signal.aborted) return;
    data = JSON.parse(rawBody);
  } catch (err) {
    if (signal.aborted) return;
    var parseLog = {
      level: 'error',
      requestId: requestId,
      stage: 'response-parse',
      status: resp.status,
      contentType: resp.headers.get('content-type') || '',
      ms: Date.now() - started,
      responsePreview: preview(rawBody || ''),
      message: err.message
    };
    if (config.logFullContent) parseLog.responseBody = rawBody || '';
    logger.write('llm', 'error', parseLog);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'LLM 上游返回了无法解析的响应', requestId: requestId }));
    return;
  }
  var text = extractText(config, data);
  var toolCalls;
  try { toolCalls = extractToolCalls(config, data); }
  catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'LLM 上游工具响应格式无效：' + err.message, requestId: requestId }));
    return;
  }

  var logEntry = {
    model: body.model || config.model,
    requestId: requestId,
    ms: Date.now() - started,
    status: resp.status,
    contentType: resp.headers.get('content-type') || '',
    rawLength: text.length,
    responsePreview: preview(text)
  };
  if (config.logFullContent) logEntry.response = text;

  // Record why generation ended, and the full body when it came back empty.
  if (config.provider === 'openai' && data && data.choices && data.choices[0]) {
    logEntry.finishReason = data.choices[0].finish_reason || null;
  } else if (config.provider === 'ollama' && data) {
    logEntry.doneReason = data.done_reason || null;
  }
  if (toolCalls) logEntry.toolCallCount = toolCalls.length;
  if (config.provider === 'openai' && data && data.usage) {
    logEntry.usage = {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens
    };
  } else if (config.provider === 'ollama' && data) {
    logEntry.usage = {
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
      loadMs: typeof data.load_duration === 'number' ? Math.round(data.load_duration / 1000000) : null,
      promptEvalMs: typeof data.prompt_eval_duration === 'number' ? Math.round(data.prompt_eval_duration / 1000000) : null,
      evalMs: typeof data.eval_duration === 'number' ? Math.round(data.eval_duration / 1000000) : null
    };
  }
  if (!text && !toolCalls) {
    logEntry.level = 'warn';
    logEntry.message = 'upstream returned no text or tool calls';
    logEntry.emptyResponseKeys = data && typeof data === 'object' ? Object.keys(data) : [];
    if (config.logFullContent) logEntry.emptyBody = data;
  }

  logger.write('llm', 'response', logEntry);

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  var message = { role: 'assistant', content: text };
  if (toolCalls) message.tool_calls = toolCalls;
  var rawMessage = responseMessage(config, data);
  ['thinking', 'reasoning_content'].forEach(function (key) {
    if (rawMessage && typeof rawMessage[key] === 'string') message[key] = rawMessage[key];
  });
  res.end(JSON.stringify({ text: text, tool_calls: toolCalls, message: message,
    finishReason: logEntry.finishReason || logEntry.doneReason || null, requestId: requestId }));
}

async function handle(req, res, body, requestId) {
  var controller = new AbortController();
  function disconnected() {
    if (!res.writableEnded) controller.abort();
  }
  if (typeof req.once === 'function') req.once('aborted', disconnected);
  if (typeof res.once === 'function') res.once('close', disconnected);
  try {
    if (req.aborted || res.destroyed) return;
    return await forward(req, res, body, requestId, controller.signal);
  } finally {
    if (typeof req.removeListener === 'function') req.removeListener('aborted', disconnected);
    if (typeof res.removeListener === 'function') res.removeListener('close', disconnected);
  }
}

module.exports = {
  handle: handle,
  getConfig: getConfig,
  getPublicConfig: function () { return publicConfig(getConfig()); },
  updateConfig: updateConfig,
  configPath: CONFIG_PATH
};
