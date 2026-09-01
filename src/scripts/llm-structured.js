/* LLM Structured Output: JSON generation, parsing, validation, and fallbacks */
(function () {
  'use strict';

  function sanitizeJSON(text) {
    if (!text || typeof text !== 'string') return '';
    var trimmed = text.trim();

    // Extract from markdown code fence
    var fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      trimmed = fenceMatch[1].trim();
    }

    // Find first { or [ and last } or ]
    var startObj = trimmed.indexOf('{');
    var startArr = trimmed.indexOf('[');
    var start = -1;
    var isArray = false;

    if (startObj === -1 && startArr === -1) return '';
    if (startObj === -1) { start = startArr; isArray = true; }
    else if (startArr === -1) { start = startObj; }
    else { start = Math.min(startObj, startArr); isArray = (startArr < startObj); }

    var end = isArray ? trimmed.lastIndexOf(']') : trimmed.lastIndexOf('}');
    if (end === -1 || end <= start) return '';

    return trimmed.substring(start, end + 1);
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

  function parseJSON(text) {
    var cleaned = sanitizeJSON(text);
    if (!cleaned) return { ok: false, error: 'No JSON found in response' };
    try {
      return { ok: true, data: JSON.parse(cleaned) };
    } catch (e) {
      var repaired = repairJSON(cleaned);
      if (repaired !== cleaned) {
        try {
          var data = JSON.parse(repaired);
          console.warn('[LLMStructured] Repaired malformed JSON (merged orphan strings).');
          return { ok: true, data: data };
        } catch (e2) {
          return { ok: false, error: 'JSON parse error (after repair): ' + e2.message };
        }
      }
      return { ok: false, error: 'JSON parse error: ' + e.message };
    }
  }

  window.LLMStructured = {
    sanitizeJSON: sanitizeJSON,
    validate: validate,
    parseJSON: parseJSON,

    generateJSON: function (prompt, schema, fallbackFn) {
      return new Promise(function (resolve, reject) {
        if (typeof LLMEngine === 'undefined') {
          resolve(typeof fallbackFn === 'function' ? fallbackFn('LLMEngine not available') : null);
          return;
        }

        LLMEngine.generate(prompt, { stream: false }).then(function (text) {
          var parsed = parseJSON(text);
          if (!parsed.ok) {
            console.warn('[LLMStructured] Parse failed:', parsed.error, '\nRaw:', text);
            resolve(typeof fallbackFn === 'function' ? fallbackFn(parsed.error, text) : null);
            return;
          }

          var validation = validate(parsed.data, schema);
          if (!validation.valid) {
            console.warn('[LLMStructured] Validation failed:', validation.error, '\nData:', parsed.data);
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
      return {
        id: 'fallback-quest-' + Date.now(),
        title: '平静的一天',
        description: '此刻没有什么特别需要你关注的事情。',
        giver: '',
        objectives: [{ text: '等待事情发生', completed: false }],
        rewards: [],
        status: 'active'
      };
    }
  };

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      console.log('[LLMStructured] Loaded.');
    });
  }
}());
