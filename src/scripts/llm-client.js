/* LLM Engine: provider-agnostic client for Ollama and OpenAI-compatible APIs */
(function () {
  'use strict';

  var ACTIVE_REQUEST = null;

  function getConfig() {
    if (typeof State !== 'undefined' && State.variables && State.variables.llmConfig) {
      return State.variables.llmConfig;
    }
    return {
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
      model: 'llama3.2',
      apiKey: '',
      maxTokens: 512,
      temperature: 0.8
    };
  }

  function buildOllamaPayload(prompt, config, stream) {
    return {
      model: config.model,
      prompt: prompt,
      stream: stream !== false,
      options: {
        temperature: config.temperature,
        num_predict: config.maxTokens
      }
    };
  }

  function buildOllamaChatPayload(messages, config, stream) {
    return {
      model: config.model,
      messages: messages,
      stream: stream !== false,
      options: {
        temperature: config.temperature,
        num_predict: config.maxTokens
      }
    };
  }

  function buildOpenAIPayload(messages, config, stream) {
    return {
      model: config.model,
      messages: messages,
      stream: stream !== false,
      temperature: config.temperature,
      max_tokens: config.maxTokens
    };
  }

  function parseOllamaStreamChunk(chunk) {
    try {
      var data = JSON.parse(chunk);
      if (data.done) return { done: true, text: '' };
      return { done: false, text: data.response || '' };
    } catch (e) {
      return { done: false, text: '' };
    }
  }

  function parseOllamaChatStreamChunk(chunk) {
    try {
      var data = JSON.parse(chunk);
      if (data.done) return { done: true, text: '' };
      if (data.message && data.message.content) {
        return { done: false, text: data.message.content };
      }
      return { done: false, text: '' };
    } catch (e) {
      return { done: false, text: '' };
    }
  }

  function parseOpenAIStreamChunk(chunk) {
    try {
      var line = chunk.replace(/^data:\s*/, '');
      if (line === '[DONE]') return { done: true, text: '' };
      var data = JSON.parse(line);
      if (data.choices && data.choices[0]) {
        var choice = data.choices[0];
        if (choice.delta && choice.delta.content) {
          return { done: false, text: choice.delta.content };
        }
        if (choice.finish_reason) {
          return { done: true, text: '' };
        }
      }
      return { done: false, text: '' };
    } catch (e) {
      return { done: false, text: '' };
    }
  }

  function readStream(reader, parser, onChunk, onDone, onError) {
    var decoder = new TextDecoder();
    var buffer = '';

    function pump() {
      reader.read().then(function (result) {
        if (result.done) {
          onDone();
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(function (line) {
          line = line.trim();
          if (!line || line === '[DONE]') return;
          var parsed = parser(line);
          if (!parsed.done || parsed.text) {
            onChunk(parsed);
          }
          if (parsed.done) {
            onDone();
            return;
          }
        });
        pump();
      }).catch(function (err) {
        onError(err);
      });
    }
    pump();
  }

  function makeRequest(isChat) {
    return function (input, options) {
      options = options || {};
      var config = getConfig();
      var stream = options.stream !== false;
      var url;
      var payload;
      var headers = { 'Content-Type': 'application/json' };
      var isArrayInput = Array.isArray(input);

      if (config.provider === 'ollama') {
        if (isChat || isArrayInput) {
          url = config.endpoint.replace(/\/$/, '') + '/api/chat';
          payload = buildOllamaChatPayload(isArrayInput ? input : [{ role: 'user', content: input }], config, stream);
        } else {
          url = config.endpoint.replace(/\/$/, '') + '/api/generate';
          payload = buildOllamaPayload(input, config, stream);
        }
      } else {
        url = config.endpoint.replace(/\/$/, '') + '/v1/chat/completions';
        var messages = isArrayInput ? input : [{ role: 'user', content: input }];
        payload = buildOpenAIPayload(messages, config, stream);
        if (config.apiKey) {
          headers['Authorization'] = 'Bearer ' + config.apiKey;
        }
      }

      var controller = new AbortController();
      ACTIVE_REQUEST = controller;

      return new Promise(function (resolve, reject) {
        var fullText = '';
        var onChunk = options.onChunk || function () {};

        function selectParser() {
          if (config.provider === 'ollama') {
            return (isChat || isArrayInput) ? parseOllamaChatStreamChunk : parseOllamaStreamChunk;
          }
          return parseOpenAIStreamChunk;
        }

        fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
          signal: controller.signal
        }).then(function (response) {
          if (!response.ok) {
            if (response.status === 0) {
              reject(new Error('CORS_BLOCKED：LLM 服务器阻止了请求。如果使用 Ollama，请用以下命令启动：OLLAMA_ORIGINS=* ollama serve'));
            } else {
              reject(new Error('HTTP ' + response.status + ': ' + response.statusText));
            }
            return;
          }

          if (!stream) {
            return response.json().then(function (data) {
              var text = '';
              if (config.provider === 'ollama') {
                if (isChat || isArrayInput) {
                  text = (data.message && data.message.content) ? data.message.content : '';
                } else {
                  text = data.response || '';
                }
              } else {
                text = (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : '';
              }
              resolve(text);
            });
          }

          var reader = response.body.getReader();
          var parser = selectParser();

          readStream(reader, parser, function (parsed) {
            if (parsed.done) {
              resolve(fullText);
              return;
            }
            if (parsed.text) {
              fullText += parsed.text;
              onChunk(parsed.text, fullText);
            }
          }, function () {
            resolve(fullText);
          }, function (err) {
            if (err.name === 'AbortError') {
              resolve(fullText);
            } else {
              reject(err);
            }
          });
        }).catch(function (err) {
          if (err.name === 'AbortError') {
            resolve(fullText);
          } else if (err.message && err.message.indexOf('Failed to fetch') !== -1) {
            reject(new Error('NETWORK_ERROR：无法连接到 LLM 服务器 ' + config.endpoint + '。它是否正在运行？'));
          } else {
            reject(err);
          }
        });
      });
    };
  }

  window.LLMEngine = {
    isAvailable: function () {
      var config = getConfig();
      return config.enabled && config.endpoint && config.model;
    },

    getConfig: getConfig,

    setConfig: function (updates) {
      var config = getConfig();
      for (var key in updates) {
        if (updates.hasOwnProperty(key)) {
          config[key] = updates[key];
        }
      }
      if (typeof State !== 'undefined' && State.variables) {
        State.variables.llmConfig = config;
      }
    },

    generate: makeRequest(false),

    chat: makeRequest(true),

    abort: function () {
      if (ACTIVE_REQUEST) {
        ACTIVE_REQUEST.abort();
        ACTIVE_REQUEST = null;
      }
    }
  };

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      console.log('[LLMEngine] Loaded. Provider:', getConfig().provider);
    });
  }
}());
