/* Server-side JSONL logger: appends structured events to logs/*.jsonl and echoes to stdout. */
'use strict';

var fs = require('fs');
var path = require('path');

var LOG_DIR = path.join(__dirname, '..', 'logs');

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function write(source, event, data) {
  var entry = {
    ts: new Date().toISOString(),
    level: (data && data.level) || 'info',
    source: source,
    event: event
  };
  if (data && typeof data === 'object') {
    for (var k in data) {
      if (data.hasOwnProperty(k)) entry[k] = data[k];
    }
  }

  var filename = source === 'llm' ? 'llm.jsonl' : (source === 'server' ? 'server.jsonl' : 'game.jsonl');
  try {
    ensureDir();
    fs.appendFileSync(path.join(LOG_DIR, filename), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[logger] write failed:', err && err.message ? err.message : err);
  }

  var requestId = entry.requestId ? ' [' + entry.requestId + ']' : '';
  var msg = entry.message || '';
  var output = '[' + source + ']' + requestId + ' ' + event + (msg ? ' ' + msg : '');
  if (entry.level === 'error') console.error(output);
  else if (entry.level === 'warn') console.warn(output);
  else console.log(output);
}

module.exports = { write: write, LOG_DIR: LOG_DIR };
