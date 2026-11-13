/* Text Game backend: serves dist/index.html, proxies LLM calls, collects runtime logs. */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var logger = require('./logger');
var llmProxy = require('./llm-proxy');

// Minimal zero-dependency .env loader (server/.env, optional).
(function loadEnvFile() {
  var envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line || line.charAt(0) === '#') return;
    var idx = line.indexOf('=');
    if (idx === -1) return;
    var key = line.substring(0, idx).trim();
    var value = line.substring(idx + 1).trim();
    if (value.length >= 2 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.substring(1, value.length - 1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
})();

var PORT = parseInt(process.env.PORT || '3000', 10);
var DIST = path.join(__dirname, '..', 'dist', 'index.html');

function readJSONBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function createRequestId(req) {
  var supplied = req.headers['x-request-id'];
  if (typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

var server = http.createServer(function (req, res) {
  var url = req.url.split('?')[0];
  var requestId = createRequestId(req);
  var started = Date.now();
  res.setHeader('X-Request-ID', requestId);

  res.on('finish', function () {
    logger.write('server', 'http-response', {
      requestId: requestId,
      method: req.method,
      path: url,
      status: res.statusCode,
      ms: Date.now() - started
    });
  });
  req.on('aborted', function () {
    logger.write('server', 'http-aborted', {
      level: 'warn', requestId: requestId, method: req.method, path: url, ms: Date.now() - started
    });
  });

  // Static hosting: serve the compiled game.
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    fs.readFile(DIST, function (err, data) {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('dist/index.html 不存在。请先运行 build.bat 编译前端。');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // LLM proxy.
  if (req.method === 'GET' && url === '/api/llm/config') {
    sendJSON(res, 200, { ok: true, config: llmProxy.getPublicConfig() });
    return;
  }

  if (req.method === 'PUT' && url === '/api/llm/config') {
    readJSONBody(req).then(function (body) {
      var result = llmProxy.updateConfig(body || {});
      sendJSON(res, result.ok ? 200 : 400, result);
    }).catch(function (err) {
      logger.write('server', 'invalid-json-body', {
        level: 'warn', requestId: requestId, path: url, message: err.message
      });
      sendJSON(res, 400, { ok: false, error: '请求体无效：' + err.message, requestId: requestId });
    });
    return;
  }

  if (req.method === 'POST' && url === '/api/llm') {
    readJSONBody(req).then(function (body) {
      return llmProxy.handle(req, res, body || {}, requestId);
    }, function (err) {
      logger.write('server', 'invalid-json-body', {
        level: 'warn', requestId: requestId, path: url, message: err.message
      });
      sendJSON(res, 400, { error: '请求体无效：' + err.message, requestId: requestId });
    }).catch(function (err) {
      logger.write('server', 'llm-handler-failed', {
        level: 'error', requestId: requestId, path: url,
        message: err.message, stack: err.stack || ''
      });
      if (!res.headersSent) sendJSON(res, 500, { error: 'LLM 请求处理失败', requestId: requestId });
      else if (!res.writableEnded) res.end();
    });
    return;
  }

  // Frontend log ingestion (single entry or { batch: [...] }).
  if (req.method === 'POST' && url === '/api/log') {
    readJSONBody(req).then(function (body) {
      if (body && Array.isArray(body.batch)) {
        body.batch.forEach(function (entry) {
          if (entry && typeof entry === 'object') logger.write('game', entry.event || 'log', entry);
        });
      } else {
        logger.write('game', (body && body.event) || 'log', body);
      }
      sendJSON(res, 200, { ok: true });
    }).catch(function (err) {
      logger.write('server', 'log-ingestion-failed', {
        level: 'warn', requestId: requestId, message: err.message
      });
      sendJSON(res, 200, { ok: false }); // log ingestion is best-effort
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, function () {
  var cfg = llmProxy.getConfig();
  console.log('[server] Text Game 后端已启动: http://localhost:' + PORT);
  console.log('[server] LLM 上游: ' + cfg.provider + ' @ ' + cfg.endpoint + ' (model ' + cfg.model + ')');
  console.log('[server] 日志目录: ' + logger.LOG_DIR);
  logger.write('server', 'startup', {
    port: PORT,
    node: process.version,
    provider: cfg.provider,
    endpoint: cfg.endpoint,
    model: cfg.model,
    logFullContent: cfg.logFullContent
  });
});

server.on('error', function (err) {
  logger.write('server', 'server-error', {
    level: 'error', message: err.message, code: err.code || null, stack: err.stack || ''
  });
});

process.on('unhandledRejection', function (reason) {
  logger.write('server', 'unhandled-rejection', {
    level: 'error', message: reason && reason.message ? reason.message : String(reason), stack: reason && reason.stack ? reason.stack : ''
  });
});
