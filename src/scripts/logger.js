/* Frontend log forwarder: wraps console + global errors and reports to /api/log. */
(function () {
  'use strict';

  var queue = [];
  var flushTimer = null;
  var sequence = 0;
  var sessionId = 'game-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  var originalConsole = {};

  function redactString(value) {
    return value
      .replace(/(["']?(?:api[_-]?key|password|secret|authorization)["']?\s*[:=]\s*)(["'])(.*?)\2/ig, '$1$2[REDACTED]$2')
      .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig, '$1[REDACTED]')
      .replace(/((?:api[_-]?key|password|secret)\s*[:=]\s*)[^\s,"']+/ig, '$1[REDACTED]');
  }

  function currentContext() {
    var context = {};
    try {
      if (typeof passage === 'function') context.passage = passage();
      if (typeof State !== 'undefined') context.turn = State.turns;
      if (typeof State !== 'undefined' && State.variables) {
        context.location = State.variables.location || null;
        context.gameDay = State.variables.time && State.variables.time.day;
        context.gameTime = State.variables.time
          ? String(State.variables.time.hour).padStart(2, '0') + ':' + String(State.variables.time.minute).padStart(2, '0')
          : null;
      }
    } catch (e) { /* diagnostics must never break the game */ }
    return context;
  }

  function safeValue(value, key, depth, detailed) {
    if (/api.?key|authorization|password|secret/i.test(key || '')) return '[REDACTED]';
    if (/^(thinking|reasoning_content)$/i.test(key || '')) return '[OMITTED]';
    if (value instanceof Error) {
      value = { name: value.name, message: value.message, stack: value.stack || '' };
    }
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'string') {
      value = redactString(value);
      return !detailed && value.length > 4000 ? value.slice(0, 4000) + '…[truncated]' : value;
    }
    if (value === null || typeof value !== 'object') return value;
    if (depth >= (detailed ? 32 : 4)) return '[Max depth]';
    if (Array.isArray(value)) return value.slice(0, detailed ? value.length : 50).map(function (item) { return safeValue(item, '', depth + 1, detailed); });
    var result = {};
    var count = 0;
    for (var k in value) {
      if (!value.hasOwnProperty(k)) continue;
      if (!detailed && count++ >= 50) { result._truncated = true; break; }
      try { result[k] = safeValue(value[k], k, depth + 1, detailed); } catch (e) { result[k] = '[Unreadable]'; }
    }
    return result;
  }

  function flush() {
    flushTimer = null;
    if (!queue.length) return;
    var batch = queue.splice(0, queue.length);
    var body = JSON.stringify({ batch: batch });
    try {
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        // Large debug batches exceed the browser's keepalive payload limit.
        keepalive: new Blob([body]).size < 48000
      }).then(function (response) {
        if (!response.ok && originalConsole.warn) originalConsole.warn('[logger] 上报失败：HTTP ' + response.status);
      }).catch(function (err) {
        if (originalConsole.warn) originalConsole.warn('[logger] 无法连接日志后端：', err && err.message ? err.message : err);
      });
    } catch (e) { /* ignore */ }
  }

  function enqueue(entry, detailed) {
    var base = currentContext();
    base.sessionId = sessionId;
    base.seq = ++sequence;
    base.clientTs = new Date().toISOString();
    entry = safeValue(entry || {}, '', 0, detailed);
    for (var k in entry) {
      if (entry.hasOwnProperty(k)) base[k] = entry[k];
    }
    queue.push(base);
    if (queue.length >= 20) {
      flush();
      return;
    }
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 400);
    }
  }

  function stringify(arg) {
    if (typeof arg === 'string') return arg;
    try { return JSON.stringify(arg); } catch (e) { return String(arg); }
  }

  // Wrap console.* so existing log calls also reach the backend.
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    if (typeof original !== 'function') return;
    originalConsole[level] = original.bind(console);
    console[level] = function () {
      original.apply(console, arguments);
      var message = Array.prototype.map.call(arguments, stringify).join(' ');
      enqueue({ level: level, event: 'console', message: message });
    };
  });

  // Global errors.
  window.addEventListener('error', function (ev) {
    enqueue({
      level: 'error',
      event: 'js-error',
      message: ev.message || 'Unknown error',
      filename: ev.filename || '',
      line: ev.lineno || null,
      column: ev.colno || null,
      stack: (ev.error && ev.error.stack) || ''
    });
  });
  window.addEventListener('unhandledrejection', function (ev) {
    enqueue({
      level: 'error',
      event: 'unhandledrejection',
      message: (ev.reason && ev.reason.message) || String(ev.reason),
      stack: (ev.reason && ev.reason.stack) || ''
    });
  });

  // Explicit logger for structured events (passage, action, parse, ...).
  window.log = function (level, event, data) {
    var entry = { level: level || 'info', event: event || 'log' };
    if (data && typeof data === 'object') {
      for (var k in data) {
        if (data.hasOwnProperty(k)) entry[k] = data[k];
      }
    }
    enqueue(entry);
  };

  window.GameLogger = {
    sessionId: sessionId,
    debug: function (event, data) {
      // Explicit gameplay diagnostics only: never serialize transport credentials or thinking.
      try { enqueue({ level: 'debug', event: event, data: data }, true); } catch (e) { /* best effort */ }
    },
    flush: flush,
    context: currentContext
  };

  document.addEventListener('click', function (ev) {
    var target = ev.target && ev.target.closest ? ev.target.closest('a,button') : null;
    if (!target) return;
    enqueue({
      level: 'info',
      event: 'ui-action',
      tag: target.tagName.toLowerCase(),
      id: target.id || null,
      label: (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      targetPassage: target.getAttribute('data-passage') || null
    });
  }, true);

  window.addEventListener('pagehide', flush);

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      enqueue({ level: 'info', event: 'session-start', userAgent: navigator.userAgent });
      if (typeof jQuery !== 'undefined') {
        $(document).on(':passagedisplay', function (ev) {
          enqueue({
            level: 'info',
            event: 'passage-display',
            passage: ev.passage && ev.passage.title ? ev.passage.title : (typeof passage === 'function' ? passage() : null)
          });
        });
      }
    });
  }
}());
