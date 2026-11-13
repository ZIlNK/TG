/* LLM Structured Output: JSON generation, parsing, validation, and fallbacks */
(function () {
  'use strict';

  // Minimum token budget for structured (JSON) generation. Acts as a floor so a
  // low config value still leaves room for reasoning + JSON; a higher user
  // setting always wins (see llm-client.js maxTokens handling).
  var STRUCTURED_MIN_TOKENS = 4096;

  function sanitizeJSON(text) {
    if (!text || typeof text !== 'string') return '';
    var trimmed = text.trim();

    // Extract from markdown code fence
    var fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      trimmed = fenceMatch[1].trim();
    }

    // Find the first { or [
    var startObj = trimmed.indexOf('{');
    var startArr = trimmed.indexOf('[');
    var start;
    if (startObj === -1 && startArr === -1) return '';
    if (startObj === -1) start = startArr;
    else if (startArr === -1) start = startObj;
    else start = Math.min(startObj, startArr);

    // Balanced scan from the opening bracket to its matching close. If the
    // structure is never balanced (truncated output), keep everything from the
    // opening bracket to the end so a later repair step can salvage it.
    var depth = 0;
    var inString = false;
    for (var i = start; i < trimmed.length; i++) {
      var c = trimmed.charAt(i);
      if (inString) {
        if (c === '\\') { i++; continue; }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{' || c === '[') { depth++; }
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          return trimmed.substring(start, i + 1);
        }
      }
    }

    // Unbalanced: return the whole remainder (truncated JSON).
    return trimmed.substring(start);
  }

  function validate(object, schema) {
    if (!object || typeof object !== 'object') return { valid: false, error: 'Not an object' };
    if (!schema || !schema.required) return { valid: true };

    for (var i = 0; i < schema.required.length; i++) {
      var key = schema.required[i];
      if (!(key in object)) {
        return { valid: false, error: 'Missing required field: ' + key };
      }
      if (schema.types && schema.types[key]) {
        var expected = schema.types[key];
        var actual = Array.isArray(object[key]) ? 'array' : typeof object[key];
        if (actual !== expected) {
          return { valid: false, error: 'Field ' + key + ' expected ' + expected + ' but got ' + actual };
        }
      }
    }
    return { valid: true };
  }

  // Tokenize a (possibly malformed) JSON string into a flat token stream.
  // Strings are decoded to plain values (for safe re-serialization); everything
  // else is kept as raw source text so it passes through untouched.
  function tokenizeJSON(text) {
    var tokens = [];
    var i = 0;
    var n = text.length;
    while (i < n) {
      var ch = text.charAt(i);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':' || ch === ',') {
        tokens.push({ type: 'punct', raw: ch });
        i++;
        continue;
      }
      if (ch === '"') {
        var j = i + 1;
        var value = '';
        while (j < n) {
          var c = text.charAt(j);
          if (c === '\\') {
            var nc = text.charAt(j + 1);
            if (nc === 'u') {
              var code = parseInt(text.substr(j + 2, 4), 16);
              value += (isNaN(code) ? '' : String.fromCharCode(code));
              j += 6;
            } else {
              var escMap = { '"': '"', '\\': '\\', '/': '/', 'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t' };
              value += (escMap[nc] !== undefined ? escMap[nc] : nc);
              j += 2;
            }
          } else if (c === '"') {
            j++;
            break;
          } else {
            value += c;
            j++;
          }
        }
        tokens.push({ type: 'string', value: value, raw: text.substring(i, j) });
        i = j;
        continue;
      }
      // Non-string atom (number / true / false / null / anything else): keep raw.
      var k = i;
      while (k < n && ',:{}[] \t\n\r'.indexOf(text.charAt(k)) === -1) {
        k++;
      }
      if (k > i) {
        tokens.push({ type: 'raw', raw: text.substring(i, k) });
        i = k;
        continue;
      }
      i++; // safety: skip unrecognized character
    }
    return tokens;
  }

  // Repair the most common LLM JSON mistake: multi-paragraph text emitted as
  // several bare strings instead of a single one. Merges orphan string literals
  // (a string in key position that is not followed by ':') into the previous
  // string value, joined by newlines. Never touches arrays or valid JSON.
  function repairJSON(text) {
    var tokens = tokenizeJSON(text);
    if (!tokens.length) return text;
    var out = [];
    var scopes = [];
    var repaired = false;
    var skipNextComma = false;

    function findLastStringValue() {
      for (var k = out.length - 1; k >= 0; k--) {
        if (out[k].type === 'string') {
          var after = out[k + 1];
          if (!after || after.type !== ':') return out[k];
        }
      }
      return null;
    }

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type === 'punct') {
        if (t.raw === '{' || t.raw === '[') {
          out.push(t);
          scopes.push(t.raw === '{' ? 'object' : 'array');
        } else if (t.raw === '}' || t.raw === ']') {
          scopes.pop();
          out.push(t);
        } else if (t.raw === ',') {
          if (skipNextComma) { skipNextComma = false; }
          else { out.push(t); }
        } else { // ':'
          out.push(t);
        }
        continue;
      }
      if (t.type === 'raw') {
        out.push(t);
        continue;
      }
      // string token
      var scope = scopes[scopes.length - 1];
      var next = tokens[i + 1];
      var isKey = scope === 'object' && next && next.type === 'punct' && next.raw === ':';
      if (isKey) {
        out.push(t);
        continue;
      }
      var prev = out.length ? out[out.length - 1] : null;
      var prevIsOpenOrComma = prev && prev.type === 'punct' && (prev.raw === '{' || prev.raw === ',');
      if (scope === 'object' && prevIsOpenOrComma) {
        // Orphan string: merge into the previous string value and drop it.
        var target = findLastStringValue();
        if (target) {
          target.value += '\n' + t.value;
          repaired = true;
          skipNextComma = true;
        }
        continue;
      }
      out.push(t);
    }

    if (!repaired) return text;

    var result = '';
    for (var m = 0; m < out.length; m++) {
      result += (out[m].type === 'string') ? JSON.stringify(out[m].value) : out[m].raw;
    }
    return result;
  }

  // Repair a JSON response that was truncated (e.g. the model hit its token
  // limit mid-object). Drops the incomplete trailing element and closes any
  // still-open containers so the salvageable prefix parses as valid JSON.
  function repairTruncated(text) {
    var tokens = tokenizeJSON(text);
    if (!tokens.length) return text;

    var stack = []; // frames: { type: 'object'|'array', state: ... }
    var lastGood = -1;
    var closersAtGood = '';

    function statesAreClosable() {
      for (var s = 0; s < stack.length; s++) {
        var st = stack[s].state;
        if (st === 'needColon' || st === 'needValue') return false;
      }
      return true;
    }

    function snapshotClosers() {
      var closers = '';
      for (var s = stack.length - 1; s >= 0; s--) {
        closers += (stack[s].type === 'object' ? '}' : ']');
      }
      return closers;
    }

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type === 'punct') {
        if (t.raw === '{' || t.raw === '[') {
          var parent = stack[stack.length - 1];
          if (parent && (parent.state === 'needValue' || parent.state === 'needValueOrClose')) {
            parent.state = 'needCommaOrClose';
          }
          stack.push({
            type: t.raw === '{' ? 'object' : 'array',
            state: t.raw === '{' ? 'needKeyOrClose' : 'needValueOrClose'
          });
        } else if (t.raw === '}' || t.raw === ']') {
          stack.pop();
          var p = stack[stack.length - 1];
          if (p) p.state = 'needCommaOrClose';
        } else if (t.raw === ':') {
          var c = stack[stack.length - 1];
          if (c && c.state === 'needColon') c.state = 'needValue';
        } else { // ','
          var c2 = stack[stack.length - 1];
          if (c2 && c2.state === 'needCommaOrClose') {
            c2.state = (c2.type === 'object' ? 'needKeyOrClose' : 'needValueOrClose');
          }
        }
      } else if (t.type === 'string') {
        var sc = stack[stack.length - 1];
        if (sc) {
          if (sc.type === 'object') {
            if (sc.state === 'needKeyOrClose') sc.state = 'needColon';
            else if (sc.state === 'needValue') sc.state = 'needCommaOrClose';
          } else if (sc.state === 'needValueOrClose') {
            sc.state = 'needCommaOrClose';
          }
        }
      } else { // raw atom (number / true / false / null)
        var sc2 = stack[stack.length - 1];
        if (sc2 && (sc2.state === 'needValue' || sc2.state === 'needValueOrClose')) {
          sc2.state = 'needCommaOrClose';
        }
      }

      if (statesAreClosable()) {
        var endsOnDelimiter = t.type === 'punct' && (t.raw === ',' || t.raw === ':');
        if (!endsOnDelimiter) {
          lastGood = i;
          closersAtGood = snapshotClosers();
        }
      }
    }

    if (lastGood === -1) return text;
    if (lastGood === tokens.length - 1 && stack.length === 0) return text;

    var result = '';
    for (var m = 0; m <= lastGood; m++) {
      result += (tokens[m].type === 'string') ? JSON.stringify(tokens[m].value) : tokens[m].raw;
    }
    result += closersAtGood;
    return result;
  }

  function parseJSON(text) {
    var cleaned = sanitizeJSON(text);
    if (!cleaned) return { ok: false, error: 'No JSON found in response' };

    try {
      return { ok: true, data: JSON.parse(cleaned) };
    } catch (firstError) {
      var repaired = repairJSON(cleaned);
      if (repaired !== cleaned) {
        try {
          var data1 = JSON.parse(repaired);
          console.warn('[LLMStructured] Repaired malformed JSON (merged orphan strings).');
          return { ok: true, data: data1 };
        } catch (e1) {
          cleaned = repaired; // fall through, try truncation repair on the improved string
        }
      }

      var completed = repairTruncated(cleaned);
      if (completed !== cleaned) {
        try {
          var data2 = JSON.parse(completed);
          console.warn('[LLMStructured] Repaired truncated JSON (closed incomplete output).');
          return { ok: true, data: data2 };
        } catch (e2) {
          return { ok: false, error: 'JSON parse error (after repair): ' + e2.message };
        }
      }

      return { ok: false, error: 'JSON parse error: ' + firstError.message };
    }
  }

  window.LLMStructured = {
    sanitizeJSON: sanitizeJSON,
    validate: validate,
    parseJSON: parseJSON,

    generateJSON: function (prompt, schema, fallbackFn, operation) {
      return new Promise(function (resolve, reject) {
        if (typeof LLMEngine === 'undefined') {
          resolve(typeof fallbackFn === 'function' ? fallbackFn('LLMEngine not available') : null);
          return;
        }

        LLMEngine.generate(prompt, {
          stream: false,
          maxTokens: STRUCTURED_MIN_TOKENS,
          operation: operation || 'structured-json'
        }).then(function (text) {
          var parsed = parseJSON(text);
          if (!parsed.ok) {
            console.warn('[LLMStructured] Parse failed:', parsed.error,
              'responseLength=' + (text ? text.length : 0),
              'preview=' + (text || '').replace(/\s+/g, ' ').slice(0, 300));
            resolve(typeof fallbackFn === 'function' ? fallbackFn(parsed.error, text) : null);
            return;
          }

          var validation = validate(parsed.data, schema);
          if (!validation.valid) {
            console.warn('[LLMStructured] Validation failed:', validation.error,
              'keys=' + (parsed.data && typeof parsed.data === 'object' ? Object.keys(parsed.data).join(',') : 'none'));
            resolve(typeof fallbackFn === 'function' ? fallbackFn(validation.error, text, parsed.data) : null);
            return;
          }

          resolve(parsed.data);
        }).catch(function (err) {
          console.warn('[LLMStructured] Generation failed:', err);
          resolve(typeof fallbackFn === 'function' ? fallbackFn(err.message || String(err)) : null);
        });
      });
    },

    fallbackScene: function (seed) {
      return {
        id: 'fallback-' + Date.now(),
        title: '意外的静谧',
        location: 'Unknown',
        mood: 'neutral',
        text: '世界仿佛屏住了呼吸。什么也没发生，但空气中却充满了某种可能性。也许你应该继续前行。',
        options: [
          { label: '返回街道', target: 'Street', tooltip: '离开这里' }
        ]
      };
    },

    fallbackOptions: function (count) {
      count = count || 3;
      var options = [];
      var defaults = [
        { label: '四处看看', target: 'Street', tooltip: '观察周围环境' },
        { label: '去公园', target: 'Park', tooltip: '一个更安静的地方' },
        { label: '去商店', target: 'Shop', tooltip: '购买补给' },
        { label: '休息', target: 'Bedroom', tooltip: '恢复体力' }
      ];
      for (var i = 0; i < count && i < defaults.length; i++) {
        options.push(defaults[i]);
      }
      return options;
    },

    fallbackNPC: function () {
      return {
        id: 'fallback-npc-' + Date.now(),
        name: '陌生人',
        location: 'Street',
        role: '流浪者',
        traits: ['神秘', '安静'],
        memory: '',
        disposition: 0,
        dialogue: []
      };
    },

    fallbackQuest: function () {
      var position = (typeof State !== 'undefined' && State.variables && State.variables.position) || { locationId: 'Street', areaId: 'street_main' };
      return {
        id: 'fallback-quest-' + Date.now(),
        title: '平静的一天',
        description: '此刻没有什么特别需要你关注的事情。',
        giver: '',
        objectives: [{ id: 'wait', text: '等待事情发生', type: 'action', actionId: 'fallback:wait', locations: [position.locationId], areas: [position.areaId], required: 1, current: 0, completed: false, promptHint: '等待并观察周围' }],
        rewards: [],
        status: 'active',
        turnIn: { type: 'automatic' },
        rewardsClaimed: false
      };
    }
  };

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      console.log('[LLMStructured] Loaded.');
    });
  }
}());
