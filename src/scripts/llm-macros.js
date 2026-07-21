/* LLM SugarCube macros: llmconfig, llmscene2, llmnpc, llmquest, npcchat, hubscene */
(function () {
  'use strict';

  function ensureDependencies() {
    return {
      llm: typeof LLMEngine !== 'undefined',
      prompt: typeof PromptBuilder !== 'undefined',
      ui: typeof NarrativeUI !== 'undefined'
    };
  }

  function renderMissingDeps(output) {
    var err = document.createElement('div');
    err.className = 'llm-error-banner';
    err.textContent = 'LLM 模块加载失败，请检查控制台。';
    output.appendChild(err);
  }

  function renderDisabled(output) {
    var err = document.createElement('div');
    err.className = 'llm-error-banner';
    err.textContent = 'LLM 未启用。请前往 设置 > LLM 集成 进行配置。';
    output.appendChild(err);
  }

  function fireHook(event, data) {
    if (typeof ModAPI !== 'undefined' && ModAPI.trigger) {
      ModAPI.trigger(event, data);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // <<llmconfig>>
  Macro.add('llmconfig', {
    handler: function () {
      var self = this;
      if (typeof LLMEngine === 'undefined') {
        renderMissingDeps(self.output);
        return;
      }

      var config = State.variables.llmConfig || {};

      function createFormRow(labelText, inputEl) {
        var row = document.createElement('div');
        var label = document.createElement('label');
        label.textContent = labelText;
        row.appendChild(label);
        row.appendChild(inputEl);
        return row;
      }

      function readConfigFromForm() {
        return {
          enabled: enabledCheck.checked,
          provider: providerSelect.value,
          endpoint: endpointInput.value.trim(),
          model: modelInput.value.trim(),
          apiKey: keyInput.value.trim(),
          temperature: parseFloat(tempInput.value) || 0.8,
          maxTokens: parseInt(tokensInput.value, 10) || 512
        };
      }

      var form = document.createElement('div');
      form.className = 'llm-config-form';

      // Enabled toggle
      var enabledRow = document.createElement('div');
      enabledRow.className = 'form-row';
      var enabledLabel = document.createElement('label');
      enabledLabel.textContent = '启用 LLM';
      var enabledCheck = document.createElement('input');
      enabledCheck.type = 'checkbox';
      enabledCheck.checked = !!config.enabled;
      enabledRow.appendChild(enabledLabel);
      enabledRow.appendChild(enabledCheck);
      form.appendChild(enabledRow);

      // Provider
      var providerSelect = document.createElement('select');
      ['ollama', 'openai'].forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p === 'ollama' ? 'Ollama（本地）' : '兼容 OpenAI';
        if (config.provider === p) opt.selected = true;
        providerSelect.appendChild(opt);
      });
      form.appendChild(createFormRow('提供商', providerSelect));

      // Endpoint
      var endpointInput = document.createElement('input');
      endpointInput.type = 'text';
      endpointInput.value = config.endpoint || 'http://localhost:11434';
      form.appendChild(createFormRow('接口地址', endpointInput));

      // Model
      var modelInput = document.createElement('input');
      modelInput.type = 'text';
      modelInput.value = config.model || 'llama3.2';
      form.appendChild(createFormRow('模型', modelInput));

      // API Key
      var keyInput = document.createElement('input');
      keyInput.type = 'password';
      keyInput.value = config.apiKey || '';
      form.appendChild(createFormRow('API 密钥（仅兼容 OpenAI 时需要）', keyInput));

      // Temperature
      var tempInput = document.createElement('input');
      tempInput.type = 'number';
      tempInput.min = '0';
      tempInput.max = '2';
      tempInput.step = '0.1';
      tempInput.value = String(config.temperature !== undefined ? config.temperature : 0.8);
      form.appendChild(createFormRow('温度（0.0 - 2.0）', tempInput));

      // Max Tokens
      var tokensInput = document.createElement('input');
      tokensInput.type = 'number';
      tokensInput.min = '64';
      tokensInput.max = '4096';
      tokensInput.step = '64';
      tokensInput.value = String(config.maxTokens || 512);
      form.appendChild(createFormRow('最大 Token 数', tokensInput));

      function showStatus(text, isError) {
        var existing = form.querySelector('.llm-config-status');
        if (existing) existing.remove();
        var status = document.createElement('div');
        status.className = 'llm-config-status';
        status.style.color = isError ? '#f44336' : '#4caf50';
        status.textContent = text;
        form.appendChild(status);
        setTimeout(function () { status.remove(); }, isError ? 5000 : 3000);
      }

      // Save button
      var saveBtn = document.createElement('button');
      saveBtn.textContent = '保存配置';
      saveBtn.addEventListener('click', function () {
        LLMEngine.setConfig(readConfigFromForm());
        showStatus('配置已保存！');
      });
      form.appendChild(saveBtn);

      // Test connection button
      var testBtn = document.createElement('button');
      testBtn.textContent = '测试连接';
      testBtn.addEventListener('click', function () {
        LLMEngine.setConfig(readConfigFromForm());
        testBtn.textContent = '测试中...';
        testBtn.disabled = true;

        LLMEngine.generate('Respond with exactly: OK', { stream: false }).then(function (text) {
          testBtn.textContent = '测试连接';
          testBtn.disabled = false;
          showStatus('连接成功！响应：' + text.substring(0, 50));
        }).catch(function (err) {
          testBtn.textContent = '测试连接';
          testBtn.disabled = false;
          showStatus('连接失败：' + (err.message || String(err)), true);
        });
      });
      form.appendChild(testBtn);

      self.output.appendChild(form);
    }
  });

  function ensureStructured() {
    return typeof LLMStructured !== 'undefined';
  }

  function generateSceneId(prefix) {
    prefix = prefix || 'scene';
    return prefix + '-' + Date.now();
  }

  function navigateToScene(sceneId) {
    State.variables.dynamicSceneId = sceneId;
    Engine.play('DynamicScene');
  }

  function storeScene(scene) {
    if (!scene || !scene.id) return false;
    State.variables.generatedScenes[scene.id] = scene;
    return true;
  }

  function isValidTarget(target) {
    if (!target || typeof target !== 'string') return false;
    if (target.indexOf('llm:') === 0) return true;
    if (target.indexOf('javascript:') === 0) return false;
    if (typeof Story !== 'undefined' && Story.has(target)) return true;
    return false;
  }

  function normalizeTarget(target) {
    if (!target || typeof target !== 'string') return 'Street';
    if (target.indexOf('llm:') === 0) return target;
    if (isValidTarget(target)) return target;
    // Unknown passage: ask the LLM to generate it as a new dynamic scene.
    return 'llm:generate:' + target;
  }

  function normalizeOptions(options) {
    if (!Array.isArray(options)) return LLMStructured.fallbackOptions(3);
    return options.map(function (opt) {
      if (!opt || typeof opt !== 'object') {
        return { label: '离开', target: 'Street', tooltip: '离开这里', effects: {} };
      }
      return {
        label: opt.label || '继续',
        target: normalizeTarget(opt.target),
        tooltip: opt.tooltip || '',
        effects: opt.effects || {}
      };
    }).filter(function (opt) {
      return opt.label && opt.target;
    });
  }

  // <<llmscene2 "Location" "Mood" "Description">>
  // Generates a structured scene object, stores it, and navigates to DynamicScene.
  Macro.add('llmscene2', {
    handler: function () {
      var self = this;
      var deps = ensureDependencies();
      if (!deps.llm || !deps.prompt || !deps.ui) {
        renderMissingDeps(self.output);
        return;
      }
      if (!ensureStructured()) {
        var err = document.createElement('div');
        err.className = 'llm-error-banner';
        err.textContent = 'LLMStructured 模块未加载。';
        self.output.appendChild(err);
        return;
      }
      if (!LLMEngine.isAvailable()) {
        renderDisabled(self.output);
        return;
      }

      var location = this.args[0] || State.variables.location || 'Unknown';
      var mood = this.args[1] || 'neutral';
      var description = this.args[2] || '';

      var container = NarrativeUI.createChatContainer();
      self.output.appendChild(container);

      var prompt = PromptBuilder.sceneObjectPrompt({
        location: location,
        mood: mood,
        description: description
      });

      var schema = {
        required: ['id', 'title', 'text', 'options'],
        types: {
          id: 'string',
          title: 'string',
          text: 'string',
          options: 'array'
        }
      };

      var hookData = { prompt: prompt, location: location, mood: mood, description: description, type: 'scene2' };
      fireHook('llmPromptReady', hookData);
      prompt = hookData.prompt;

      NarrativeUI.showTyping(container);

      LLMStructured.generateJSON(prompt, schema, function (error, rawText, partialData) {
        return LLMStructured.fallbackScene();
      }).then(function (scene) {
        NarrativeUI.hideTyping(container);

        if (!scene) {
          NarrativeUI.showError(container, '生成场景失败，请重试。', function () {
            Engine.play(passage());
          });
          return;
        }

        // Ensure fields exist
        scene.location = scene.location || location;
        scene.mood = scene.mood || mood;
        scene.options = normalizeOptions(scene.options);

        // Add a "generate more" option if the prompt asked for continuation
        if (description) {
          scene.options.push({
            label: '看看接下来会发生什么',
            target: 'llm:generate:' + description,
            tooltip: '继续探索这个线索'
          });
        }

        var responseData = { scene: scene, type: 'scene2' };
        fireHook('llmResponseReady', responseData);
        scene = responseData.scene;

        storeScene(scene);
        PromptBuilder.addToHistory('assistant', scene.title + '\n\n' + scene.text, 'scene');
        State.variables.llmSession.lastResponse = scene.text;

        // Show preview in container then navigate
        NarrativeUI.appendMessage(container, 'assistant', scene.title + '\n\n' + scene.text);

        setTimeout(function () {
          navigateToScene(scene.id);
        }, 300);
      }).catch(function (err) {
        NarrativeUI.hideTyping(container);
        NarrativeUI.showError(container, err.message || String(err), function () {
          Engine.play(passage());
        });
      });
    }
  });

  // <<llmnpc "Name" "Role" "Location">>
  // Generates an NPC and stores it in $npcs.
  Macro.add('llmnpc', {
    handler: function () {
      var self = this;
      var deps = ensureDependencies();
      if (!deps.llm || !deps.prompt || !deps.ui) {
        renderMissingDeps(self.output);
        return;
      }
      if (!ensureStructured()) {
        var err = document.createElement('div');
        err.className = 'llm-error-banner';
        err.textContent = 'LLMStructured 模块未加载。';
        self.output.appendChild(err);
        return;
      }
      if (!LLMEngine.isAvailable()) {
        renderDisabled(self.output);
        return;
      }

      var name = this.args[0] || '';
      var role = this.args[1] || 'townsperson';
      var location = this.args[2] || State.variables.location || 'Unknown';

      var container = NarrativeUI.createChatContainer();
      self.output.appendChild(container);

      var prompt = PromptBuilder.npcPrompt({
        name: name,
        role: role,
        location: location
      });

      var schema = {
        required: ['id', 'name', 'location', 'role', 'traits'],
        types: {
          id: 'string',
          name: 'string',
          location: 'string',
          role: 'string',
          traits: 'array'
        }
      };

      var hookData = { prompt: prompt, name: name, role: role, location: location, type: 'npc' };
      fireHook('llmPromptReady', hookData);
      prompt = hookData.prompt;

      var typing = NarrativeUI.showTyping(container);

      LLMStructured.generateJSON(prompt, schema, function () {
        return LLMStructured.fallbackNPC();
      }).then(function (npc) {
        NarrativeUI.hideTyping(container);

        if (!npc) {
          NarrativeUI.showError(container, '生成 NPC 失败。', function () {
            Engine.play(passage());
          });
          return;
        }

        npc.dialogue = npc.dialogue || [];
        npc.disposition = typeof npc.disposition === 'number' ? npc.disposition : 0;
        if (typeof initRelationship === 'function') initRelationship(npc);

        var responseData = { npc: npc, type: 'npc' };
        fireHook('llmResponseReady', responseData);
        npc = responseData.npc;

        State.variables.npcs[npc.id] = npc;
        State.variables.activeNPCId = npc.id;

        var intro = document.createElement('div');
        intro.className = 'llm-npc-card';
        intro.innerHTML = '<h3>' + escapeHtml(npc.name) + '</h3>' +
          '<p><em>' + escapeHtml(npc.role) + '</em> at ' + escapeHtml(npc.location) + '</p>' +
          '<p>Traits: ' + escapeHtml(npc.traits ? npc.traits.join(', ') : 'unknown') + '</p>' +
          '<p>' + escapeHtml(npc.memory || '') + '</p>';
        container.appendChild(intro);

        var chatBtn = document.createElement('button');
        chatBtn.textContent = '与 ' + npc.name + ' 交谈';
        chatBtn.addEventListener('click', function () {
          Engine.play('NPCChat');
        });
        container.appendChild(chatBtn);
      }).catch(function (err) {
        NarrativeUI.hideTyping(container);
        NarrativeUI.showError(container, err.message || String(err), function () {
          Engine.play(passage());
        });
      });
    }
  });

  // <<llmquest "GiverNpcId" "Theme">>
  // Generates a quest tied to an NPC.
  Macro.add('llmquest', {
    handler: function () {
      var self = this;
      var deps = ensureDependencies();
      if (!deps.llm || !deps.prompt || !deps.ui) {
        renderMissingDeps(self.output);
        return;
      }
      if (!ensureStructured()) {
        var err = document.createElement('div');
        err.className = 'llm-error-banner';
        err.textContent = 'LLMStructured 模块未加载。';
        self.output.appendChild(err);
        return;
      }
      if (!LLMEngine.isAvailable()) {
        renderDisabled(self.output);
        return;
      }

      var giverId = this.args[0] || State.variables.activeNPCId || '';
      var theme = this.args[1] || 'a local problem';

      if (!giverId) {
        var warn = document.createElement('div');
        warn.className = 'llm-error-banner';
        warn.textContent = '没有可用的任务发布者。请先用 <<llmnpc>> 生成一个 NPC。';
        self.output.appendChild(warn);
        return;
      }

      var container = NarrativeUI.createChatContainer();
      self.output.appendChild(container);

      var prompt = PromptBuilder.questPrompt({
        giverId: giverId,
        theme: theme
      });

      var schema = {
        required: ['id', 'title', 'description', 'objectives', 'rewards', 'status'],
        types: {
          id: 'string',
          title: 'string',
          description: 'string',
          objectives: 'array',
          rewards: 'array',
          status: 'string'
        }
      };

      var hookData = { prompt: prompt, giverId: giverId, theme: theme, type: 'quest' };
      fireHook('llmPromptReady', hookData);
      prompt = hookData.prompt;

      var typing = NarrativeUI.showTyping(container);

      LLMStructured.generateJSON(prompt, schema, function () {
        return LLMStructured.fallbackQuest();
      }).then(function (quest) {
        NarrativeUI.hideTyping(container);

        if (!quest) {
          NarrativeUI.showError(container, '生成任务失败。', function () {
            Engine.play(passage());
          });
          return;
        }

        quest.giver = quest.giver || giverId;

        var responseData = { quest: quest, type: 'quest' };
        fireHook('llmResponseReady', responseData);
        quest = responseData.quest;

        State.variables.quests[quest.id] = quest;
        State.variables.activeQuestId = quest.id;

        var card = document.createElement('div');
        card.className = 'llm-quest-card';
        var objectives = quest.objectives.map(function (o) {
          return '<li>' + (o.completed ? '[✓] ' : '[ ] ') + escapeHtml(o.text) + '</li>';
        }).join('');
        card.innerHTML = '<h3>任务：' + escapeHtml(quest.title) + '</h3>' +
          '<p>' + escapeHtml(quest.description) + '</p>' +
          '<ul>' + objectives + '</ul>' +
          '<p>奖励：' + escapeHtml(quest.rewards ? quest.rewards.join('、') : '无') + '</p>';
        container.appendChild(card);

        var turnInBtn = document.createElement('button');
        turnInBtn.textContent = '提交任务';
        turnInBtn.addEventListener('click', function () {
          var msgs = checkQuestCompletion();
          if (msgs.length > 0) {
            NarrativeUI.showToast(msgs.join('\n'));
          } else {
            NarrativeUI.showToast('任务尚未完成。');
          }
        });
        container.appendChild(turnInBtn);
      }).catch(function (err) {
        NarrativeUI.hideTyping(container);
        NarrativeUI.showError(container, err.message || String(err), function () {
          Engine.play(passage());
        });
      });
    }
  });

  // <<npcchat "npcId">>
  // Chat interface for a generated NPC, using per-NPC dialogue history.
  Macro.add('npcchat', {
    handler: function () {
      var self = this;
      var deps = ensureDependencies();
      if (!deps.llm || !deps.prompt || !deps.ui) {
        renderMissingDeps(self.output);
        return;
      }
      if (!LLMEngine.isAvailable()) {
        renderDisabled(self.output);
        return;
      }

      var npcId = this.args[0] || State.variables.activeNPCId || '';
      var npc = (State.variables.npcs || {})[npcId];

      if (!npc) {
        var warn = document.createElement('div');
        warn.className = 'llm-error-banner';
        warn.textContent = '未选择 NPC。请先用 <<llmnpc>> 生成一个。';
        self.output.appendChild(warn);
        return;
      }

      State.variables.activeNPCId = npcId;
      if (!npc.dialogue) npc.dialogue = [];

      var container = NarrativeUI.createChatContainer();
      self.output.appendChild(container);

      // Render existing dialogue
      npc.dialogue.forEach(function (entry) {
        if (entry.role && entry.content) {
          NarrativeUI.appendMessage(container, entry.role, entry.content);
        }
      });

      var inputRow = NarrativeUI.createInputRow(container, function (userText) {
        NarrativeUI.appendMessage(container, 'user', userText);
        npc.dialogue.push({ role: 'user', content: userText, timestamp: Date.now() });

        var messages = PromptBuilder.npcChatPrompt(npcId, userText);
        fireHook('llmPromptReady', { prompt: messages, npc: npc, type: 'npcchat' });

        NarrativeUI.renderStreaming(container, function (options) {
          return LLMEngine.chat(messages, options);
        }, {
          onComplete: function (text) {
            var responseData = { text: text, npc: npc, type: 'npcchat' };
            fireHook('llmResponseReady', responseData);
            text = responseData.text;

            npc.dialogue.push({ role: 'assistant', content: text, timestamp: Date.now() });
            if (npc.dialogue.length > 50) {
              npc.dialogue = npc.dialogue.slice(-50);
            }
          },
          onError: function (err) {
            console.error('[npcchat] Chat failed:', err);
          },
          onRetry: function () {
            NarrativeUI.renderStreaming(container, function (options) {
              return LLMEngine.chat(messages, options);
            }, {
              onComplete: function (text) {
                var responseData = { text: text, npc: npc, type: 'npcchat' };
                fireHook('llmResponseReady', responseData);
                text = responseData.text;
                npc.dialogue.push({ role: 'assistant', content: text, timestamp: Date.now() });
              }
            });
          }
        });
      });

      setTimeout(function () {
        if (inputRow && inputRow.input) inputRow.input.focus();
      }, 50);
    }
  });

  // <<hubscene "Location" "mood" "anchorText">>
  // 中枢场景组合宏：流式 LLM 叙事 + 情境化动态选项 + NPC/探索入口。
  // 供 Bedroom/Street/Park/Shop 等手写中枢调用。
  Macro.add('hubscene', {
    handler: function () {
      var self = this;
      var deps = ensureDependencies();
      if (!deps.llm || !deps.prompt || !deps.ui) {
        renderMissingDeps(self.output);
        return;
      }
      if (!ensureStructured()) {
        var serr = document.createElement('div');
        serr.className = 'llm-error-banner';
        serr.textContent = 'LLMStructured 模块未加载。';
        self.output.appendChild(serr);
        return;
      }
      if (!LLMEngine.isAvailable()) {
        renderDisabled(self.output);
        return;
      }

      var location = this.args[0] || State.variables.location || 'Unknown';
      var mood = this.args[1] || 'neutral';
      var anchorText = this.args[2] || '';
      var optionCount = parseInt(this.args[3], 10) || 3;

      // --- 1. 流式叙事 ---
      var narration = NarrativeUI.createChatContainer();
      self.output.appendChild(narration);

      var scenePrompt = PromptBuilder.scenePrompt({
        location: location,
        mood: mood,
        description: anchorText
      });
      var sHook = { prompt: scenePrompt, location: location, mood: mood, description: anchorText, type: 'hubscene' };
      fireHook('llmPromptReady', sHook);
      scenePrompt = sHook.prompt;

      function renderNarration() {
        NarrativeUI.renderStreaming(narration, function (options) {
          return LLMEngine.generate(scenePrompt, options);
        }, {
          onComplete: function (text) {
            var rd = { text: text, location: location, mood: mood, type: 'hubscene' };
            fireHook('llmResponseReady', rd);
            PromptBuilder.addToHistory('assistant', rd.text, 'scene');
            State.variables.llmSession.lastResponse = rd.text;
          },
          onError: function (err) {
            console.error('[hubscene] Narration failed:', err);
          },
          onRetry: renderNarration
        });
      }
      renderNarration();

      // --- 2. 情境化动态选项 ---
      var optionsBox = document.createElement('div');
      optionsBox.className = 'llm-options-container';
      self.output.appendChild(optionsBox);

      var context = anchorText
        ? (location + '：' + anchorText)
        : ('玩家正在 ' + location + '，正在决定下一步做什么。');
      var optPrompt = PromptBuilder.optionsPrompt(context, optionCount);
      var oHook = { prompt: optPrompt, context: context, count: optionCount, type: 'hubscene-options' };
      fireHook('llmPromptReady', oHook);
      optPrompt = oHook.prompt;

      NarrativeUI.showTyping(optionsBox);

      LLMStructured.generateJSON(optPrompt, { required: [], types: {} }, function () {
        return LLMStructured.fallbackOptions(optionCount);
      }).then(function (options) {
        NarrativeUI.hideTyping(optionsBox);

        if (!Array.isArray(options)) options = LLMStructured.fallbackOptions(optionCount);
        options = normalizeOptions(options);
        if (options.length === 0) options = LLMStructured.fallbackOptions(optionCount);

        var rd = { options: options, context: context, type: 'hubscene-options' };
        fireHook('llmResponseReady', rd);
        options = rd.options;

        options.forEach(function (opt) {
          var el = document.createElement('a');
          el.className = 'action-link';
          el.textContent = opt.label;
          el.title = opt.tooltip || '';
          el.setAttribute('data-passage', opt.target);
          el.addEventListener('click', function (ev) {
            ev.preventDefault();
            if (opt.effects && typeof applyEffects === 'function') {
              var msgs = applyEffects(opt.effects);
              if (msgs.length > 0) NarrativeUI.showToast(msgs.join('，'));
            }
            if (opt.target.indexOf('llm:') === 0) {
              State.variables.llmGatewayTarget = opt.target;
              Engine.play('LLMGateway');
            } else {
              Engine.play(opt.target);
            }
          });
          optionsBox.appendChild(el);
        });

        // --- 3. 固定入口：探索周围 / 与附近的人交谈 ---
        var explore = document.createElement('a');
        explore.className = 'action-link';
        explore.textContent = '探索周围';
        explore.title = '让 LLM 生成此地的一段动态遭遇';
        explore.addEventListener('click', function (ev) {
          ev.preventDefault();
          State.variables.llmGatewayTarget = 'llm:generate:' + location + '周围发生的事';
          Engine.play('LLMGateway');
        });
        optionsBox.appendChild(explore);

        var talk = document.createElement('a');
        talk.className = 'action-link';
        talk.textContent = '与附近的人交谈';
        talk.title = '遇见并和此地的某个人对话';
        talk.addEventListener('click', function (ev) {
          ev.preventDefault();
          Engine.play('MeetNPC');
        });
        optionsBox.appendChild(talk);
      }).catch(function (err) {
        NarrativeUI.hideTyping(optionsBox);
        NarrativeUI.showError(optionsBox, err.message || String(err), function () {
          Engine.play(passage());
        });
      });
    }
  });

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      console.log('[LLM Macros] Loaded: llmconfig, llmscene2, llmnpc, llmquest, npcchat, hubscene');
    });
  }
}());
