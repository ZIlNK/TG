/* Session-only, bounded diagnostics. Never part of SugarCube State or model input. */
(function () {
  'use strict';
  var records = [], revision = 0;
  var LIMIT = 12, TEXT_LIMIT = 80000, BUDGET = 240000;

  function safe(value, budget) {
    var remaining = budget || BUDGET;
    function visit(item, key, depth) {
      if (/api.?key|authorization|password|secret/i.test(key)) return '[REDACTED]';
      if (/^(thinking|reasoning_content|reasoning)$/i.test(key)) return '[OMITTED]';
      if (depth > 24) return '[truncated: 日志容量限制]';
      if (typeof item === 'string') {
        // Decode JSON-in-string tool arguments before redacting nested fields.
        try { var decoded = JSON.parse(item); if (decoded && typeof decoded === 'object') return JSON.stringify(visit(decoded, '', depth + 1)); } catch (_) { /* plain text */ }
        var text = item.replace(/(["']?(?:api[_-]?key|password|secret|authorization)["']?\s*[:=]\s*)(["'])(.*?)\2/ig, '$1$2[REDACTED]$2')
          .replace(/(bearer\s+)[^\s"']+/ig, '$1[REDACTED]')
          .replace(/((?:api[_-]?key|password|secret)\s*[:=]\s*)[^\s,"']+/ig, '$1[REDACTED]');
        var limit = Math.min(TEXT_LIMIT, remaining); remaining -= Math.min(text.length, limit);
        return text.length > limit ? text.slice(0, limit) + '\n[truncated: 日志容量限制]' : text;
      }
      if (!item || typeof item !== 'object') return item;
      var result = Array.isArray(item) ? [] : Object.create(null);
      Object.keys(item).slice(0, 200).forEach(function (name) { result[name] = visit(item[name], name, depth + 1); });
      if (Object.keys(item).length > 200) result[Array.isArray(item) ? result.length : '_truncated'] = '[truncated: 最多 200 项]';
      return result;
    }
    return visit(value, '', 0);
  }
  function trim() {
    var sizes = records.map(function (entry) { return JSON.stringify(entry).length; });
    var total = sizes.reduce(function (sum, size) { return sum + size; }, 0);
    while (total > 4000000 && records.length > 1) { records.pop(); total -= sizes.pop(); }
  }
  function record(id, patch) {
    try {
      var entry = records.find(function (item) { return item.id === id || item.response && item.response.requestId === id; });
      if (!entry) {
        if (!patch.startedAt) return;
        entry = { id: id, events: [] }; records.unshift(entry); records.length = Math.min(records.length, LIMIT);
      }
      Object.assign(entry, safe(patch)); trim(); revision += 1;
    } catch (_) { /* inspection must never break requests */ }
  }
  function event(id, name, detail) {
    try {
      var entry = records.find(function (item) { return item.id === id || item.response && item.response.requestId === id; });
      if (!entry) return;
      if (entry.events.length >= 60) { entry.events.shift(); entry.eventsTruncated = true; }
      entry.events.push(safe({ name: name, detail: detail }, 16000)); trim(); revision += 1;
    } catch (_) { /* diagnostics only */ }
  }
  window.LLMTrace = {
    record: record,
    event: event,
    runEvent: function (runId, round, name, detail) {
      var entry = records.find(function (item) { return item.traceContext && item.traceContext.runId === runId && item.traceContext.round === round; });
      if (entry) event(entry.id, name, detail);
    },
    decision: function (decisionId, result, traceAttemptId) {
      records.filter(function (item) { return item.traceContext && item.traceContext.context && item.traceContext.context.decisionId === decisionId && (traceAttemptId === undefined || item.traceContext.context.traceAttemptId === traceAttemptId); })
        .forEach(function (item) { record(item.id, { decision: result }); });
    },
    version: function () { return revision; },
    list: function () { return records.map(function (item) { return { id: item.id, operation: item.operation, status: item.status, startedAt: item.startedAt, round: item.traceContext && item.traceContext.round, runId: item.traceContext && item.traceContext.runId }; }); },
    get: function (id) { var entry = records.find(function (item) { return item.id === id; }); return entry ? JSON.parse(JSON.stringify(entry)) : null; }
  };
}());
