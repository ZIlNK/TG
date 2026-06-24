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

  function parseJSON(text) {
    var cleaned = sanitizeJSON(text);
    if (!cleaned) return { ok: false, error: 'No JSON found in response' };
    try {
      return { ok: true, data: JSON.parse(cleaned) };
    } catch (e) {
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
