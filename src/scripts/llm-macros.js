/* LLM SugarCube macros: llmconfig, llmscene2, llmnpc, llmquest, npcchat, hubscene */
(function () {
  'use strict';

  function ensureDependencies() {
    return {
      llm: typeof LLMEngine !== 'undefined',
      prompt: typeof PromptBuilder !== 'undefined',
      ui: typeof NarrativeUI !== 'undefined',
      scope: typeof LLMOperationScope !== 'undefined'
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

  function beginOperation(operation) {
    var time = JSON.stringify(State.variables.time);
    var player = JSON.stringify(State.variables.player);
    return LLMOperationScope.create({ operation: operation, validate: function () {
      return JSON.stringify(State.variables.time) === time && JSON.stringify(State.variables.player) === player;
    } });
  }

  function operationCurrent(scope) { return scope.isCurrent(); }
  function assertOperation(scope) {
    if (operationCurrent(scope)) return;
    var error = new Error('操作已取消或当前场景已改变');
    error.name = 'AbortError';
    error.code = 'STALE_SCOPE';
    throw error;
  }
  function operationCancelled(error, scope) {
    return !operationCurrent(scope) || error && (error.name === 'AbortError' || error.code === 'CANCELLED' || error.code === 'STALE_SCOPE');
  }

  function finishCancelled(error, scope, container) {
    if (!operationCancelled(error, scope)) return false;
    if (operationCurrent(scope)) {
      NarrativeUI.hideTyping(container);
      container.textContent = '请求已取消。';
    }
    return true;
  }

  // Structured helpers used here must not turn cancellation into generated fallback data.
  function generateScopedJSON(prompt, schema, fallback, operation, scope) {
    assertOperation(scope);
    return LLMEngine.generate(prompt, { stream: false, maxTokens: 4096, operation: operation, signal: scope.signal }).then(function (text) {
      assertOperation(scope);
      return parseStructuredText(text, schema, fallback);
    });
  }

  function logDiagnostic(level, event, data) {
    if (typeof window.log === 'function') window.log(level, event, data);
  }

  function parseToolArguments(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    try {
      var parsed = JSON.parse(value || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function validateDialogueArgs(args) {
    if (!args || typeof args !== 'object') return { ok: false, error: '参数必须是对象' };
    if (typeof args.npcName !== 'string' || !args.npcName.trim()) {
      return { ok: false, error: 'npcName 必须是非空字符串' };
    }
    if (typeof args.openingLine !== 'string' || !args.openingLine.trim()) {
      return { ok: false, error: 'openingLine 必须是非空字符串' };
    }
    var npcName = args.npcName.trim();
    var openingLine = args.openingLine.trim();
    if (npcName.length > 80) return { ok: false, error: 'npcName 不能超过 80 个字符' };
    if (openingLine.length > 2000) return { ok: false, error: 'openingLine 不能超过 2000 个字符' };
    var playerName = typeof State !== 'undefined' && State.variables && State.variables.player && State.variables.player.name;
    var wanted = npcName.toLocaleLowerCase();
    var reserved = ['player', '玩家', '主角', '你', '我', '自己', '叙述者', 'narrator'];
    if ((playerName && wanted === String(playerName).trim().toLocaleLowerCase()) || reserved.indexOf(wanted) !== -1) {
      return { ok: false, error: 'npcName 不能使用玩家姓名或主角保留名称' };
    }
    return { ok: true, args: { npcName: npcName, openingLine: openingLine } };
  }

  function captureDialogueReturn() {
    var title = '';
    try { title = typeof passage === 'function' ? passage() : ''; } catch (e) { /* ignore */ }
    if (title === 'LLMGateway' && typeof State !== 'undefined' && State.history && State.history.length > 1) {
      var previousMoment = State.history[State.history.length - 2];
      if (previousMoment && previousMoment.title) title = previousMoment.title;
    }
    if (!title || title === 'LLMGateway' || title === 'NPCChat') {
      title = (State.variables && State.variables.location) || 'Street';
    }
    return {
      passage: title,
      dynamicSceneId: title === 'DynamicScene' ? (State.variables.dynamicSceneId || '') : ''
    };
  }

  function showDialogueDialog(args, scope) {
    return new Promise(function (resolve) {
      logDiagnostic('info', 'dialogue-invite-shown', {
        npcName: args.npcName,
        openingLineLength: args.openingLine.length
      });
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
      var box = document.createElement('div');
      box.style.cssText = 'background:#171717;border:1px solid #282828;border-radius:8px;padding:16px;max-width:420px;width:90%;color:#fafafa;';
      var title = document.createElement('h3');
      title.textContent = args.npcName + '向你搭话';
      var line = document.createElement('p');
      line.textContent = '“' + args.openingLine + '”';
      var prompt = document.createElement('p');
      prompt.textContent = '要回应吗？';
      var buttons = document.createElement('div');
      buttons.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
      function finish(accepted) {
        scope.signal.removeEventListener('abort', cancelled);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(accepted && operationCurrent(scope));
      }
      function cancelled() { finish(false); }
      scope.signal.addEventListener('abort', cancelled, { once: true });
      function makeButton(label, accepted) {
        var button = document.createElement('button');
        button.textContent = label;
        button.addEventListener('click', function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          finish(accepted);
        });
        return button;
      }
      buttons.appendChild(makeButton('回应', true));
      buttons.appendChild(makeButton('忽略', false));
      box.appendChild(title);
      box.appendChild(line);
      box.appendChild(prompt);
      box.appendChild(buttons);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  function findDialogueNPC(name, speaker) {
    if (speaker) return speaker.runtime ? { id: speaker.runtime.id, npc: speaker.runtime.npc } : null;
    var npcs = State.variables.npcs || {};
    var matches = Object.keys(npcs).filter(function (id) {
      var npc = npcs[id];
      return npc && String(npc.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase() &&
        npc.location === State.variables.location;
    });
    return matches.length === 1 ? { id: matches[0], npc: npcs[matches[0]] } : null;
  }

  function hasAmbiguousSpeaker(speaker, position) {
    var actors = {};
    (speaker.records || []).forEach(function (record) {
      var npc = record.npc;
      if ((npc.locationId || npc.location) !== position.locationId || npc.areaId !== position.areaId) return;
      var identity = npc.actorId || (record.type === 'card' ? 'card:' + record.id :
        (npc.cardId || npc.profileRef ? 'card:' + (npc.cardId || npc.profileRef) : 'npc:' + record.id));
      actors[identity] = true;
    });
    return Object.keys(actors).length > 1;
  }

  function createDialogueNPC(name, template, cardId) {
    if (!State.variables.npcs) State.variables.npcs = {};
    var id = 'dialogue-npc-' + Date.now();
    var suffix = 1;
    while (State.variables.npcs[id]) id = 'dialogue-npc-' + Date.now() + '-' + suffix++;
    var position = State.variables.position || {};
    var npc = {
      id: id,
      name: name,
      actorId: cardId ? 'card:' + cardId : 'npc:' + id,
      cardId: cardId || null,
      profileRef: cardId || null,
      personality: template && template.personality || '',
      scenario: template && template.scenario || '',
      description: template && template.description || '',
      location: position.locationId || State.variables.location || 'Unknown',
      locationId: position.locationId || State.variables.location || 'Unknown',
      areaId: position.areaId || '',
      role: template && template.role || '路人',
      traits: template && Array.isArray(template.traits) ? template.traits.slice() : [],
      memory: template && (template.memory || template.scenario) || '在' + (State.variables.location || '此地') + '主动与玩家搭话。',
      disposition: 0,
      dialogue: [],
      proactiveDialogue: template && template.proactiveDialogue
        ? JSON.parse(JSON.stringify(template.proactiveDialogue))
        : { limitPerArea: 1, usedByArea: {} }
    };
    if (typeof NPCState !== 'undefined' && NPCState.ensure) NPCState.ensure(npc, position);
    if (typeof initRelationship === 'function') initRelationship(npc);
    State.variables.npcs[id] = npc;
    return { id: id, npc: npc };
  }

  function invokeDialogue(args, options) {
    options = options || {};
    var scope = options.scope || beginOperation('dialogue-entry');
    var owned = !options.scope;
    return Promise.resolve().then(function () {
      return invokeDialogueInScope(args, Object.assign({}, options, { scope: scope }));
    }).catch(function (error) {
      if (!operationCancelled(error, scope)) throw error;
      return { ok: false, accepted: false, navigated: false, status: 'cancelled', error: '对话已取消' };
    }).finally(function () { if (owned) scope.release(); });
  }

  function invokeDialogueInScope(args, options) {
    options = options || {};
    var scope = options.scope || beginOperation('dialogue-entry');
    if (!operationCurrent(scope)) return Promise.resolve({ ok: false, accepted: false, navigated: false, error: '对话已取消' });
    var validation = validateDialogueArgs(args);
    logDiagnostic(validation.ok ? 'info' : 'warn', validation.ok ? 'dialogue-tool-received' : 'dialogue-tool-invalid', {
      toolCallId: options.toolCallId || null,
      source: options.source || 'system',
      npcName: validation.ok ? validation.args.npcName : null,
      openingLineLength: validation.ok ? validation.args.openingLine.length : 0,
      error: validation.ok ? null : validation.error
    });
    if (!validation.ok) return Promise.resolve({ ok: false, accepted: false, navigated: false, error: validation.error });

    var normalized = validation.args;
    var proactive = options.confirm !== false;
    var speaker = null;
    if (typeof NPCState !== 'undefined' && NPCState.resolveSpeaker) {
      var position = NPCState.currentPosition();
      speaker = NPCState.resolveSpeaker(normalized.npcName, position);
      if (hasAmbiguousSpeaker(speaker, position)) {
        return Promise.resolve({ ok: false, accepted: false, navigated: false, error: '同名 NPC 身份不明确，无法发起对话' });
      }
      if (!speaker.known) {
        logDiagnostic('warn', 'dialogue-tool-blocked', {
          toolCallId: options.toolCallId || null,
          npcName: normalized.npcName,
          reason: 'npc-not-registered',
          locationId: position.locationId,
          areaId: position.areaId
        });
        return Promise.resolve({ ok: false, accepted: false, navigated: false, error: 'NPC 尚未在当前场景注册' });
      }
      if (speaker.known && !speaker.present) {
        logDiagnostic('warn', 'dialogue-tool-blocked', {
          toolCallId: options.toolCallId || null,
          npcName: normalized.npcName,
          reason: 'npc-not-in-current-area',
          locationId: position.locationId,
          areaId: position.areaId
        });
        return Promise.resolve({ ok: false, accepted: false, navigated: false, error: 'NPC 不在当前子场景' });
      }
      if (proactive) {
        var consumed = NPCState.consumeByName(normalized.npcName, position);
        if (!consumed.ok) {
          logDiagnostic('info', 'dialogue-tool-blocked', {
            toolCallId: options.toolCallId || null,
            npcName: normalized.npcName,
            reason: consumed.reason,
            locationId: position.locationId,
            areaId: position.areaId
          });
          return Promise.resolve({ ok: false, accepted: false, navigated: false, error: 'NPC 在当前子场景的主动搭话次数已耗尽' });
        }
        logDiagnostic('info', 'dialogue-proactive-quota-consumed', {
          toolCallId: options.toolCallId || null,
          npcName: normalized.npcName,
          locationId: position.locationId,
          areaId: position.areaId,
          remaining: consumed.remaining
        });
      }
    }
    var confirmation = options.confirm === false ? Promise.resolve(true) : showDialogueDialog(normalized, scope);
    return confirmation.then(function (accepted) {
      assertOperation(scope);
      if (!accepted) {
        logDiagnostic('info', 'dialogue-invite-declined', {
          toolCallId: options.toolCallId || null,
          npcName: normalized.npcName
        });
        return { ok: true, accepted: false, navigated: false };
      }

      logDiagnostic('info', 'dialogue-invite-accepted', {
        toolCallId: options.toolCallId || null,
        npcName: normalized.npcName,
        source: options.source || 'system'
      });

      var match = findDialogueNPC(normalized.npcName, speaker);
      var reused = !!match;
      var template = speaker && speaker.card && speaker.card.npc;
      if (!match) match = createDialogueNPC(normalized.npcName, template, speaker && speaker.card && speaker.card.id);
      if (!match.npc.dialogue) match.npc.dialogue = [];
      var last = match.npc.dialogue[match.npc.dialogue.length - 1];
      if (!last || last.role !== 'assistant' || last.content !== normalized.openingLine) {
        match.npc.dialogue.push({ role: 'assistant', content: normalized.openingLine, timestamp: Date.now() });
      }
      if (typeof initRelationship === 'function') initRelationship(match.npc);

      State.variables.activeNPCId = match.id;
      State.variables.dialogueReturn = options.returnTo || captureDialogueReturn();
      if (typeof PromptBuilder !== 'undefined' && PromptBuilder.addToHistory) {
        PromptBuilder.addToHistory('assistant', normalized.npcName + '主动与玩家搭话，玩家选择回应。', 'scene');
      }
      logDiagnostic('info', reused ? 'dialogue-npc-reused' : 'dialogue-npc-created', {
        npcId: match.id,
        npcName: match.npc.name,
        source: options.source || 'system'
      });
      logDiagnostic('info', 'dialogue-entered', {
        npcId: match.id,
        npcName: match.npc.name,
        returnPassage: State.variables.dialogueReturn && State.variables.dialogueReturn.passage
      });
      Engine.play('NPCChat');
      return { ok: true, accepted: true, navigated: true, npcId: match.id };
    });
  }

  window.DialogueTool = {
    invoke: invokeDialogue,
    validate: validateDialogueArgs,
    parseArguments: parseToolArguments,
    captureReturnTarget: captureDialogueReturn,
    exit: function () {
      var target = State.variables.dialogueReturn;
      State.variables.dialogueReturn = null;
      var destination = target && target.passage;
      if (destination === 'DynamicScene' && target.dynamicSceneId && State.variables.generatedScenes[target.dynamicSceneId]) {
        State.variables.dynamicSceneId = target.dynamicSceneId;
      }
      if (!destination || typeof Story === 'undefined' || !Story.has(destination)) {
        destination = State.variables.location || 'Street';
      }
      if (target && destination !== 'DynamicScene' && typeof setup !== 'undefined') {
        setup.dialogueToolSuppressOnce = destination;
      }
      logDiagnostic('info', 'dialogue-exited', {
        npcId: State.variables.activeNPCId || null,
        destination: destination
      });
      Engine.play(destination);
    }
  };

  function isValidStructuredText(text, schema) {
    if (!text || typeof text !== 'string') return false;
    var parsed = LLMStructured.parseJSON(text);
    return parsed.ok && LLMStructured.validate(parsed.data, schema).valid;
  }

  function parseStructuredText(text, schema, fallbackFn) {
    var parsed = LLMStructured.parseJSON(text || '');
    if (!parsed.ok) {
      console.warn('[scene-tools] Parse failed:', parsed.error,
        'responseLength=' + (text ? text.length : 0),
        'preview=' + (text || '').replace(/\s+/g, ' ').slice(0, 300));
      return typeof fallbackFn === 'function' ? fallbackFn(parsed.error, text) : null;
    }
    var validation = LLMStructured.validate(parsed.data, schema);
    if (!validation.valid) {
      console.warn('[scene-tools] Validation failed:', validation.error);
      return typeof fallbackFn === 'function' ? fallbackFn(validation.error, text, parsed.data) : null;
    }
    return parsed.data;
  }

  function requestWithDialogueTool(prompt, operation, returnTo, usableText, scope) {
    var messages = [{ role: 'user', content: prompt }];
    assertOperation(scope);
    var requestOptions = { operation: operation, signal: scope.signal };
    var dialogueAvailable = PromptBuilder.hasProactiveDialogueCandidates && PromptBuilder.hasProactiveDialogueCandidates();
    if (dialogueAvailable) requestOptions.tools = [PromptBuilder.dialogueTool()];
    else logDiagnostic('info', 'scene-dialogue-tool-omitted', { operation: operation, reason: 'no-eligible-npc' });
    return LLMEngine.chatRaw(messages, requestOptions).then(function (response) {
      assertOperation(scope);
      if (response && (response.finishReason === 'length' || response.finishReason === 'max_tokens')) throw new Error('模型响应被截断，请重试。');
      var text = response && response.text || '';
      var toolCalls = response && response.tool_calls;
      if (!toolCalls || !toolCalls.length) return { text: text, navigated: false, requestId: response.requestId };

      logDiagnostic('info', 'scene-dialogue-tool-calls', {
        requestId: response.requestId || null,
        operation: operation,
        count: toolCalls.length
      });
      var results = [];
      var dialogueClaimed = false;
      var navigated = false;

      function runTool(index) {
        if (navigated) return Promise.resolve();
        assertOperation(scope);
        if (index >= toolCalls.length) return Promise.resolve();
        var call = toolCalls[index] || {};
        var fn = call.function || {};
        var resultPromise;
        if (fn.name !== 'start_dialogue') {
          logDiagnostic('warn', 'scene-dialogue-tool-skipped', {
            toolCallId: call.id || null,
            operation: operation,
            toolName: fn.name || null,
            reason: 'unknown-tool'
          });
          resultPromise = Promise.resolve({ ok: false, accepted: false, navigated: false, error: '未知工具：' + (fn.name || '') });
        } else if (dialogueClaimed) {
          logDiagnostic('warn', 'scene-dialogue-tool-skipped', {
            toolCallId: call.id || null,
            operation: operation,
            toolName: fn.name,
            reason: 'duplicate-dialogue-call'
          });
          resultPromise = Promise.resolve({ ok: false, accepted: false, navigated: false, error: '单个场景只允许一次对话邀请' });
        } else {
          dialogueClaimed = true;
          resultPromise = DialogueTool.invoke(parseToolArguments(fn.arguments), {
            confirm: true,
            returnTo: returnTo,
            source: 'scene-tool',
            scope: scope,
            toolCallId: call.id || null
          });
        }
        return resultPromise.then(function (result) {
          try { if (window.LLMTrace) window.LLMTrace.event(response.requestId, 'scene-tool-result', { callId: call.id, name: fn.name, result: result }); } catch (_) { /* diagnostics only */ }
          results.push({ call: call, result: result });
          if (result && result.navigated) navigated = true;
          return runTool(index + 1);
        });
      }

      return runTool(0).then(function () {
        if (navigated) return { text: '', navigated: true };
        assertOperation(scope);
        if (text && usableText(text)) return { text: text, navigated: false, requestId: response.requestId };

        messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
        results.forEach(function (entry) {
          var toolMessage = {
            role: 'tool',
            content: JSON.stringify(entry.result)
          };
          if (entry.call.id) toolMessage.tool_call_id = entry.call.id;
          messages.push(toolMessage);
        });
        return LLMEngine.chat(messages, {
          stream: false,
          operation: operation + '-after-dialogue',
          signal: scope.signal
        }).then(function (continuedText) {
          assertOperation(scope);
          return { text: continuedText, navigated: false };
        });
      });
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

      var loading = document.createElement('p');
      loading.textContent = '正在读取后端配置...';
      self.output.appendChild(loading);

      function renderConfig(config) {
        if (loading.parentNode) loading.parentNode.removeChild(loading);

      function createFormRow(labelText, inputEl) {
        var row = document.createElement('div');
        var label = document.createElement('label');
        label.textContent = labelText;
        row.appendChild(label);
        row.appendChild(inputEl);
        return row;
      }

      function readConfigFromForm() {
        var temperature = parseFloat(tempInput.value);
        var result = {
          enabled: enabledCheck.checked,
          provider: providerSelect.value,
          endpoint: endpointInput.value.trim(),
          model: modelInput.value.trim(),
          temperature: isFinite(temperature) ? temperature : 0.8,
          maxTokens: parseInt(tokensInput.value, 10) || 512
        };
        if (apiKeyInput.value.trim()) result.apiKey = apiKeyInput.value.trim();
        if (clearKeyCheck.checked) result.clearApiKey = true;
        return result;
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

      // Provider and credentials are persisted by the local backend.
      var note = document.createElement('p');
      note.className = 'llm-config-note';
      note.textContent = '配置保存在本机后端。API Key 读取时只显示脱敏状态，不会把完整密钥返回浏览器。';
      form.appendChild(note);

      var providerSelect = document.createElement('select');
      ['ollama', 'openai'].forEach(function (provider) {
        var option = document.createElement('option');
        option.value = provider;
        option.textContent = provider === 'ollama' ? 'Ollama（本地）' : 'OpenAI 兼容接口';
        providerSelect.appendChild(option);
      });
      providerSelect.value = config.provider || 'ollama';
      form.appendChild(createFormRow('连接方式', providerSelect));

      var endpointInput = document.createElement('input');
      endpointInput.type = 'url';
      endpointInput.value = config.endpoint || 'http://localhost:11434';
      endpointInput.placeholder = 'https://api.example.com';
      form.appendChild(createFormRow('接口地址', endpointInput));

      var apiKeyInput = document.createElement('input');
      apiKeyInput.type = 'password';
      apiKeyInput.autocomplete = 'new-password';
      apiKeyInput.placeholder = config.apiKeyConfigured ? ('已保存 ' + (config.apiKeyMasked || '••••') + '；留空则保持不变') : 'Ollama 可留空';
      form.appendChild(createFormRow('API Key', apiKeyInput));

      var clearKeyCheck = document.createElement('input');
      clearKeyCheck.type = 'checkbox';
      var clearKeyRow = createFormRow('清除已保存的 API Key', clearKeyCheck);
      clearKeyRow.style.display = config.apiKeyConfigured ? '' : 'none';
      form.appendChild(clearKeyRow);

      // Model
      var modelInput = document.createElement('input');
      modelInput.type = 'text';
      modelInput.value = config.model || 'llama3.2';
      form.appendChild(createFormRow('模型', modelInput));

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
      tokensInput.max = '131072';
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
        saveBtn.disabled = true;
        LLMEngine.saveConfig(readConfigFromForm()).then(function (saved) {
          saveBtn.disabled = false;
          apiKeyInput.value = '';
          apiKeyInput.placeholder = saved.apiKeyConfigured ? ('已保存 ' + saved.apiKeyMasked + '；留空则保持不变') : 'Ollama 可留空';
          clearKeyRow.style.display = saved.apiKeyConfigured ? '' : 'none';
          clearKeyCheck.checked = false;
          showStatus('配置已保存到后端！');
        }).catch(function (err) {
          saveBtn.disabled = false;
          showStatus('保存失败：' + (err.message || String(err)), true);
        });
      });
      form.appendChild(saveBtn);

      // Test connection button
      var testBtn = document.createElement('button');
      testBtn.textContent = '测试连接';
      testBtn.addEventListener('click', function () {
        testBtn.textContent = '测试中...';
        testBtn.disabled = true;

        LLMEngine.saveConfig(readConfigFromForm()).then(function () {
          return LLMEngine.generate('Respond with exactly: OK', { stream: false, operation: 'connection-test' });
        }).then(function (text) {
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

      LLMEngine.loadConfig(true).then(renderConfig).catch(function (err) {
        if (loading.parentNode) loading.parentNode.removeChild(loading);
        var failure = document.createElement('div');
        failure.className = 'llm-error-banner';
        failure.textContent = '无法读取后端配置：' + (err.message || String(err));
        self.output.appendChild(failure);
      });
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

  // Generated scenery can affect bodily state, never NPC identity, rewards or quest evidence.
  function sceneEffects(effects) {
    var safe = {};
    ['health', 'stamina', 'stress', 'trauma', 'hunger', 'control', 'arousal'].forEach(function (key) {
      var value = effects && effects[key];
      if (typeof value === 'number' && isFinite(value)) safe[key] = Math.max(-100, Math.min(100, value));
    });
    return safe;
  }

  function sanitizeStoredScene() {
    var scenes = State.variables.generatedScenes || {};
    var scene = scenes[State.variables.dynamicSceneId];
    if (!scene || !Array.isArray(scene.options)) return;
    scene.options.forEach(function (option) {
      if (!option || typeof option !== 'object') return;
      option.effects = sceneEffects(option.effects);
      if (option.questAction && (typeof TaskEngine === 'undefined' || !TaskEngine.validateAction(option.questAction).ok)) {
        delete option.questAction;
      }
    });
  }

  // Keep the raw reply intact; diagnostics describe every accept/reject/correction.
  function optionLog(event, data, meta) {
    try {
      if (window.GameLogger && GameLogger.debug) GameLogger.debug(event, data);
      if (window.LLMTrace) {
        var id = meta && meta.requestId;
        if (!id && meta && meta.operation) {
          var row = LLMTrace.list().find(function (entry) { return entry.operation === meta.operation; });
          id = row && row.id;
        }
        if (id) LLMTrace.event(id, event, data);
      }
    } catch (_) { /* Diagnostics must not affect choices. */ }
  }

  function normalizeOptions(options, meta) {
    meta = meta || {};
    var report = { stage: meta.stage || 'normalize', generated: Array.isArray(options) ? options.length : 0, kept: 0, rejected: 0, entries: [] };
    if (!Array.isArray(options)) report.error = 'options 必须是数组';
    var result = (Array.isArray(options) ? options : []).map(function (opt, index) {
      var entry = { index: index, label: opt && opt.label, status: 'kept' };
      report.entries.push(entry);
      function reject(reason) { entry.status = 'rejected'; entry.reason = reason; report.rejected++; return null; }
      if (!opt || typeof opt !== 'object' || typeof opt.label !== 'string' || !opt.label.trim()) return reject('选项必须包含非空 label');
      var routes = [opt.action, opt.tool, opt.target].filter(function (value) { return value !== undefined && value !== null; });
      if (routes.length !== 1) return reject('action、tool、target 必须且只能选择一种');
      var normalized = { label: opt.label, tooltip: opt.tooltip || '', effects: sceneEffects(opt.effects) };
      if (opt.action) {
        if (!window.SceneActions) return reject('普通行动模块未加载');
        var actionCheck = SceneActions.validate(opt.action);
        if (!actionCheck.ok) return reject(actionCheck.error);
        normalized.action = actionCheck.action;
        normalized.effects = {};
        if (actionCheck.product) normalized.tooltip = actionCheck.product.name + ' · $' + actionCheck.product.price + '（成功执行后结算并食用）';
      } else if (opt.tool) {
        var toolArgs = parseToolArguments(opt.tool.arguments);
        if (opt.tool.name === 'start_dialogue') {
          var toolValidation = validateDialogueArgs(toolArgs);
          if (!toolValidation.ok) return reject(toolValidation.error);
          if (!PromptBuilder.hasProactiveDialogueCandidates || !PromptBuilder.hasProactiveDialogueCandidates()) return reject('当前没有可交谈 NPC');
          if (typeof NPCState !== 'undefined') {
            var speaker = NPCState.resolveSpeaker(toolValidation.args.npcName, NPCState.currentPosition());
            if (!speaker.present) return reject('目标 NPC 不在当前场景');
          }
          normalized.tool = { name: 'start_dialogue', arguments: toolValidation.args };
        } else if (opt.tool.name === 'move_player' && typeof MoveTool !== 'undefined') {
          var moveValidation = MoveTool.validate(toolArgs);
          if (!moveValidation.ok) return reject(moveValidation.error);
          normalized.tool = { name: 'move_player', arguments: moveValidation.args };
          if (moveValidation.corrections && moveValidation.corrections.length) entry.corrections = moveValidation.corrections;
        } else return reject('未知或未授权工具：' + opt.tool.name);
      } else {
        if (typeof opt.target !== 'string' || !opt.target.trim() || /^javascript:/i.test(opt.target)) return reject('无效页面目标');
        normalized.target = normalizeTarget(opt.target);
      }
      if (opt.questAction !== undefined) {
        if (normalized.action) return reject('普通场景行动不能直接推进任务，请使用任务现场入口');
        if (typeof TaskEngine === 'undefined') return reject('任务模块未加载');
        var questValidation = TaskEngine.validateAction(opt.questAction);
        if (!questValidation.ok) return reject(questValidation.error || '无效任务行动');
        normalized.questAction = questValidation.action;
      }
      report.kept++;
      return normalized;
    }).filter(Boolean);
    meta.report = report;
    optionLog('scene-options-normalized', { report: report, rawOptions: options, options: result }, meta);
    return result;
  }

  function renderSceneChoices(root, options, context) {
    context = context || {};
    var variables = State.variables, owner = passage(), used = false;
    options.forEach(function (opt, index) {
      var effectsApplied = false;
      var el = document.createElement('a'); el.className = 'action-link'; el.textContent = opt.label; el.title = opt.tooltip || '';
      if (opt.target) el.setAttribute('data-passage', opt.target);
      el.addEventListener('click', function (event) {
        event.preventDefault();
        if (used || !root.isConnected || State.variables !== variables || passage() !== owner || context.current && !context.current()) return;
        if (opt.action) {
          var started = SceneActions.begin(opt, { text: context.text || '', title: context.title || '现场行动', sourceKey: context.key || owner, index: index, returnTo: DialogueTool.captureReturnTarget() });
          if (!started.ok) NarrativeUI.showToast(started.error); else used = true;
          return;
        }
        if (opt.questAction && window.QuestEvents && QuestEvents.handles(opt.questAction)) { used = true; QuestEvents.begin(opt.questAction); return; }
        // Recheck tools at click time before applying any legacy bodily effects.
        if (opt.tool && opt.tool.name === 'move_player' && !MoveTool.validate(opt.tool.arguments).ok) { NarrativeUI.showToast('地点已改变，请重新生成选项'); return; }
        used = true;
        if (!effectsApplied && opt.effects && typeof applyEffects === 'function') {
          effectsApplied = true;
          applyEffects(sceneEffects(opt.effects));
        }
        if (opt.questAction && typeof TaskEngine !== 'undefined') TaskEngine.progress(opt.questAction);
        function toolFinished(result) {
          if (!result || !result.navigated) used = false;
          if (result && !result.ok && root.isConnected && State.variables === variables && passage() === owner) NarrativeUI.showToast(result.error || '行动未执行，请重试');
        }
        function toolFailed(error) { toolFinished({ ok: false, error: error.message || String(error) }); }
        if (opt.tool && opt.tool.name === 'start_dialogue') DialogueTool.invoke(opt.tool.arguments, { confirm: false, returnTo: DialogueTool.captureReturnTarget(), source: 'scene-option' }).then(toolFinished, toolFailed);
        else if (opt.tool && opt.tool.name === 'move_player') MoveTool.invoke(opt.tool.arguments, { source: 'scene-option' }).then(toolFinished, toolFailed);
        else if (opt.target.indexOf('llm:') === 0) { State.variables.llmGatewayTarget = opt.target; Engine.play('LLMGateway'); }
        else Engine.play(opt.target);
      });
      root.appendChild(el);
    });
    optionLog('scene-options-rendered', { sceneId: context.key, count: options.length, labels: options.map(function (o) { return o.label; }) }, context);
  }

  function renderOptionNotice(root, report, retry) {
    if (!report || !(report.rejected || report.error || report.generated === 0)) return;
    var notice = document.createElement('p'); notice.className = 'llm-error-banner';
    notice.textContent = report.kept ? '部分行动生成无效，已保留可执行选项。拒绝原因见 LLM 调试记录。' : '行动选项生成无效，请重试。没有执行任何选项。';
    root.appendChild(notice);
    if (retry) { var button = document.createElement('button'); button.className = 'action-link'; button.textContent = '重新生成行动选项'; button.addEventListener('click', retry); root.appendChild(button); }
  }

  window.SceneOptions = { normalize: normalizeOptions, render: renderSceneChoices, notice: renderOptionNotice, log: optionLog };
  Macro.add('sceneoptions', { handler: function () {
    var scene = State.variables.generatedScenes[State.variables.dynamicSceneId];
    if (!scene) return;
    var meta = { requestId: scene.requestId, operation: 'scene-generation', stage: 'render-validation' };
    var options = normalizeOptions(scene.options, meta), root = document.createElement('div');
    this.output.appendChild(root);
    renderSceneChoices(root, options, { text: scene.text, title: scene.title, key: scene.id, requestId: scene.requestId });
    renderOptionNotice(root, scene.optionDiagnostics && (scene.optionDiagnostics.rejected || scene.optionDiagnostics.error || scene.optionDiagnostics.generated === 0) ? scene.optionDiagnostics : meta.report, function () {
      if (window.SceneActions) SceneActions.retryOptions(scene, root);
    });
  } });

  // <<llmscene2 "Location" "Mood" "Description">>
  // Generates a structured scene object, stores it, and navigates to DynamicScene.
  Macro.add('llmscene2', {
    handler: function () {
      var self = this;
      var deps = ensureDependencies();
      if (!deps.llm || !deps.prompt || !deps.ui || !deps.scope) {
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

      var container = document.createElement('div');
      container.className = 'scene-narrative scene-generation-state';
      self.output.appendChild(container);

      var prompt = PromptBuilder.sceneObjectPrompt({
        location: location,
        mood: mood,
        description: description
      }, { toolRegistration: true });

      var hookData = { prompt: prompt, location: location, mood: mood, description: description, type: 'scene2' };
      fireHook('llmPromptReady', hookData);
      prompt = hookData.prompt;

      NarrativeUI.showTyping(container);
      var scope = beginOperation('scene-generation');

      SceneOptionTools.generate({ prompt: prompt, operation: 'scene-generation', scope: scope, withScene: true }).then(function (result) {
        assertOperation(scope);
        NarrativeUI.hideTyping(container);

        var scene = result.scene;

        // Normalize <br> tags the model may emit instead of newlines.
        if (typeof normalizeLLMText === 'function') {
          scene.text = normalizeLLMText(scene.text || '');
        }

        // Ensure fields exist
        scene.location = scene.location || location;
        scene.mood = scene.mood || mood;
        var optionMeta = { requestId: result.requestId, operation: 'scene-generation', stage: 'model-output' };
        scene.requestId = result.requestId;
        scene.options = result.options;
        scene.optionDiagnostics = result.report;

        // Add a "generate more" option if the prompt asked for continuation
        if (description) {
          scene.options.push({
            label: '看看接下来会发生什么',
            target: 'llm:generate:' + description,
            tooltip: '继续探索这个线索'
          });
        }
        if (typeof TaskEngine !== 'undefined') scene.options = TaskEngine.ensureQuestOption(scene.options, Math.max(4, scene.options.length + 1), 'DynamicScene');

        var responseData = { scene: scene, type: 'scene2' };
        fireHook('llmResponseReady', responseData);
        scene = responseData.scene;
        var hookMeta = { requestId: scene.requestId, operation: 'scene-generation', stage: 'after-hook' };
        scene.options = normalizeOptions(scene.options, hookMeta);
        if (hookMeta.report.rejected || hookMeta.report.error) scene.optionDiagnostics = hookMeta.report;
        if (typeof TaskEngine !== 'undefined') scene.options = TaskEngine.ensureQuestOption(scene.options, Math.max(4, scene.options.length + 1), 'DynamicScene');

        assertOperation(scope);
        optionLog('scene-options-stored', { sceneId: scene.id, options: scene.options, report: scene.optionDiagnostics }, optionMeta);
        storeScene(scene);
        PromptBuilder.addToHistory('assistant', scene.title + '\n\n' + scene.text, 'scene');
        State.variables.llmSession.lastResponse = scene.text;

        container.textContent = '场景已生成，正在进入…';

        setTimeout(function () {
          if (operationCurrent(scope)) navigateToScene(scene.id);
          scope.release();
        }, 300);
      }).catch(function (err) {
        scope.release();
        if (finishCancelled(err, scope, container)) return;
        NarrativeUI.hideTyping(container);
        NarrativeUI.showError(container, err.message || String(err), function () {
          if (operationCurrent(scope)) Engine.play(passage());
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
      if (!deps.llm || !deps.prompt || !deps.ui || !deps.scope) {
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

      NarrativeUI.showTyping(container);
      var scope = beginOperation('npc-generation');

      generateScopedJSON(prompt, schema, function () {
        return LLMStructured.fallbackNPC();
      }, 'npc-generation', scope).then(function (npc) {
        assertOperation(scope);
        NarrativeUI.hideTyping(container);

        if (!npc) {
          scope.release();
          NarrativeUI.showError(container, '生成 NPC 失败。', function () {
            if (operationCurrent(scope)) Engine.play(passage());
          });
          return;
        }

        var responseData = { npc: npc, type: 'npc' };
        fireHook('llmResponseReady', responseData);
        assertOperation(scope);
        var generated = responseData.npc;
        var npcPosition = State.variables.position || {};
        // Only descriptive fields are model data; resources, history and identity are program-owned.
        npc = {
          name: String(generated.name || '路人'), role: String(generated.role || '路人'),
          traits: Array.isArray(generated.traits) ? generated.traits.filter(function (trait) { return typeof trait === 'string'; }) : [],
          memory: String(generated.memory || ''), personality: String(generated.personality || ''),
          description: String(generated.description || ''), scenario: String(generated.scenario || ''),
          locationId: location, location: location,
          areaId: location === npcPosition.locationId ? npcPosition.areaId : '',
          dialogue: [], disposition: 0
        };
        if (typeof NPCState !== 'undefined' && NPCState.ensure) NPCState.ensure(npc, npcPosition);
        if (typeof initRelationship === 'function') initRelationship(npc);

        // Model-generated names and IDs cannot claim a registered character's identity.
        var selectedNpcId = 'generated-npc-' + Date.now();
        var suffix = 0;
        while (State.variables.npcs[selectedNpcId]) selectedNpcId = 'generated-npc-' + Date.now() + '-' + (++suffix);
        npc.id = selectedNpcId;
        npc.actorId = 'npc:' + selectedNpcId;
        delete npc.cardId;
        delete npc.profileRef;
        State.variables.npcs[selectedNpcId] = npc;

        var intro = document.createElement('div');
        intro.className = 'llm-npc-card';
        [['h3', npc.name], ['p', npc.role + ' · ' + npc.location],
          ['p', '特征：' + (npc.traits || []).join('，')], ['p', npc.memory || '']].forEach(function (field) {
          var line = document.createElement(field[0]);
          line.textContent = field[1];
          intro.appendChild(line);
        });
        container.appendChild(intro);

        var chatBtn = document.createElement('button');
        chatBtn.className = 'action-link game-choice cursor-target';
        chatBtn.textContent = '与 ' + npc.name + ' 交谈';
        chatBtn.addEventListener('click', function () {
          if (!operationCurrent(scope)) return;
          State.variables.activeNPCId = selectedNpcId;
          Engine.play('NPCChat');
        });
        container.appendChild(chatBtn);
        scope.release();
      }).catch(function (err) {
        scope.release();
        if (finishCancelled(err, scope, container)) return;
        NarrativeUI.hideTyping(container);
        NarrativeUI.showError(container, err.message || String(err), function () {
          if (operationCurrent(scope)) Engine.play(passage());
        });
      });
    }
  });

  // Both legacy entry points use the same durable NPC conversation and offer UI.
  Macro.add('llmquest', {
    handler: function () {
      var npcId = this.args[0] || State.variables.activeNPCId || '';
      if (typeof NPCDirector === 'undefined' || !NPCDirector.renderChat || !NPCDirector.enqueue ||
          typeof LLMOperationScope === 'undefined') {
        renderMissingDeps(this.output);
        return;
      }
      NPCDirector.renderChat(this.output, npcId);
      var npc = (State.variables.npcs || {})[npcId];
      if (!npc) return;
      var theme = this.args[1] ? String(this.args[1]) : '';
      var scope = beginOperation('quest-request');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-link';
      button.textContent = '询问是否需要帮忙';
      button.addEventListener('click', function () {
        if (button.disabled || !button.isConnected || !operationCurrent(scope) ||
            (State.variables.npcs || {})[npcId] !== npc) return;
        button.disabled = true;
        NPCDirector.enqueue(npcId, {
          type: 'chat',
          sourceEventId: 'quest-request-' + Date.now() + '-' + (++questRequestSequence),
          text: '你有什么需要我帮忙的事吗？' + (theme ? '（' + theme + '）' : '')
        });
        State.variables.activeNPCId = npcId;
        scope.release();
        Engine.play('NPCChat');
      });
      this.output.appendChild(button);
    }
  });

  var questRequestSequence = 0;
  Macro.add('npcchat', {
    handler: function () {
      if (typeof NPCDirector === 'undefined' || !NPCDirector.renderChat) {
        renderMissingDeps(this.output);
        return;
      }
      NPCDirector.renderChat(this.output, this.args[0] || State.variables.activeNPCId || '');
    }
  });

  Macro.add('enddialogue', {
    handler: function () {
      var link = document.createElement('a');
      link.className = 'action-link';
      link.textContent = '结束对话';
      link.title = '返回进入对话前的场景';
      link.addEventListener('click', function (ev) {
        ev.preventDefault();
        DialogueTool.exit();
      });
      this.output.appendChild(link);
    }
  });

  // <<hubscene "Location" "mood" "anchorText">>
  // 中枢场景组合宏：流式 LLM 叙事 + 情境化动态选项 + NPC/探索入口。
  // 供 Bedroom/Street/Park/Shop 等手写中枢调用。
  Macro.add('hubscene', {
    handler: function () {
      var self = this;
      var deps = ensureDependencies();
      if (!deps.llm || !deps.prompt || !deps.ui || !deps.scope) {
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
      var day = (State.variables.time && State.variables.time.day) || 1;
      var currentAreaId = State.variables.position && State.variables.position.locationId === location
        ? State.variables.position.areaId
        : '';
      var cacheKey = location + '|' + currentAreaId + '|' + mood + '|' + day;
      var scope = beginOperation('hubscene');

      if (!State.variables.hubCache) State.variables.hubCache = {};
      var cacheEntry = State.variables.hubCache[cacheKey];
      if (!cacheEntry) cacheEntry = State.variables.hubCache[cacheKey] = {};

      // Helper: render dynamic options + fixed entries.
      function renderOptions(optionsBox, options, loc) {
        renderSceneChoices(optionsBox, options, { text: cacheEntry.narration || anchorText, title: location, key: cacheKey, requestId: cacheEntry.requestId, operation: 'hub-options', current: function () { return operationCurrent(scope); } });
        renderOptionNotice(optionsBox, cacheEntry.optionDiagnostics, function () {
          if (!operationCurrent(scope)) return;
          if (window.SceneActions) SceneActions.retryOptions(cacheEntry, optionsBox);
        });

        // 固定入口：探索周围 / 与附近的人交谈
        var explore = document.createElement('a');
        explore.className = 'action-link';
        explore.textContent = '探索周围';
        explore.title = '让 LLM 生成此地的一段动态遭遇';
        explore.addEventListener('click', function (ev) {
          ev.preventDefault();
          if (!operationCurrent(scope)) return;
          State.variables.llmGatewayTarget = 'llm:generate:' + loc + '周围发生的事';
          Engine.play('LLMGateway');
        });
        optionsBox.appendChild(explore);

        var talk = document.createElement('a');
        talk.className = 'action-link';
        talk.textContent = '与附近的人交谈';
        talk.title = '遇见并和此地的某个人对话';
        talk.addEventListener('click', function (ev) {
          ev.preventDefault();
          if (!operationCurrent(scope)) return;
          Engine.play('MeetNPC');
        });
        optionsBox.appendChild(talk);
      }

      // Reuse cached scene (same location + mood + day) instead of re-generating.
      if (cacheEntry.narration && cacheEntry.options) {
        var narrBox = document.createElement('div');
        narrBox.className = 'scene-narrative';
        self.output.appendChild(narrBox);
        narrBox.textContent = typeof normalizeLLMText === 'function'
          ? normalizeLLMText(cacheEntry.narration)
          : cacheEntry.narration;

        var optBox = document.createElement('div');
        optBox.className = 'llm-options-container';
        self.output.appendChild(optBox);
        var cachedMeta = { requestId: cacheEntry.requestId, operation: 'hub-options', stage: 'cache-validation' };
        var cachedOptions = normalizeOptions(cacheEntry.options, cachedMeta);
        if (cachedMeta.report.rejected || cachedMeta.report.error) cacheEntry.optionDiagnostics = cachedMeta.report;
        if (typeof TaskEngine !== 'undefined') cachedOptions = TaskEngine.ensureQuestOption(cachedOptions, Math.max(optionCount, cachedOptions.length + 1), typeof passage === 'function' ? passage() : location);
        cacheEntry.options = cachedOptions;
        renderOptions(optBox, cachedOptions, location);
        scope.release();
        return;
      }

      // --- 1. 流式叙事 ---
      var narration = document.createElement('div');
      narration.className = 'scene-narrative';
      self.output.appendChild(narration);

      var scenePrompt = PromptBuilder.scenePrompt({
        location: location,
        mood: mood,
        description: anchorText
      });
      var sHook = { prompt: scenePrompt, location: location, mood: mood, description: anchorText, type: 'hubscene' };
      fireHook('llmPromptReady', sHook);
      scenePrompt = sHook.prompt;
      var ownerPassage = typeof passage === 'function' ? passage() : location;
      var dialogueNavigated = false;
      var narrationFailed = false;
      var suppressDialogueTool = typeof setup !== 'undefined' && setup.dialogueToolSuppressOnce === ownerPassage;
      if (suppressDialogueTool) setup.dialogueToolSuppressOnce = '';

      function renderNarration() {
        if (!operationCurrent(scope)) return Promise.resolve();
        narrationFailed = false;
        NarrativeUI.showTyping(narration);
        var request = suppressDialogueTool
          ? LLMEngine.chat([{ role: 'user', content: scenePrompt }], {
            operation: 'hub-narration-after-dialogue-return', signal: scope.signal
          }).then(function (text) { return { text: text || '', navigated: false }; })
          : requestWithDialogueTool(scenePrompt, 'hub-narration', DialogueTool.captureReturnTarget(),
            function (text) { return !!(text && text.trim()); }, scope);
        return request.then(function (result) {
          dialogueNavigated = result.navigated;
          if (dialogueNavigated) { scope.release(); return; }
          assertOperation(scope);
          var rd = { text: result.text, location: location, mood: mood, type: 'hubscene' };
          fireHook('llmResponseReady', rd);
          assertOperation(scope);
          NarrativeUI.hideTyping(narration);
          narration.textContent = typeof normalizeLLMText === 'function' ? normalizeLLMText(rd.text) : rd.text;
          PromptBuilder.addToHistory('assistant', rd.text, 'scene');
          State.variables.llmSession.lastResponse = rd.text;
          cacheEntry.narration = rd.text;
        }).catch(function (err) {
          narrationFailed = true;
          scope.release();
          if (finishCancelled(err, scope, narration)) return;
          NarrativeUI.hideTyping(narration);
          NarrativeUI.showError(narration, err.message || String(err), function () {
            if (operationCurrent(scope)) renderNarration().then(generateOptions);
          });
        });
      }

      function generateOptions() {
        if (narrationFailed || !operationCurrent(scope) || dialogueNavigated || (typeof passage === 'function' && passage() !== ownerPassage)) return;
        var optionsBox = document.createElement('div');
        optionsBox.className = 'llm-options-container';
        self.output.appendChild(optionsBox);

        var context = cacheEntry.narration || anchorText
          ? (location + '：' + (cacheEntry.narration || anchorText))
          : ('玩家正在 ' + location + '，正在决定下一步做什么。');
        var optPrompt = PromptBuilder.optionsPrompt(context, optionCount, { toolRegistration: true });
        var oHook = { prompt: optPrompt, context: context, count: optionCount, type: 'hubscene-options' };
        fireHook('llmPromptReady', oHook);
        optPrompt = oHook.prompt;

        NarrativeUI.showTyping(optionsBox);
        SceneOptionTools.generate({ prompt: optPrompt, operation: 'hub-options', scope: scope, withScene: false }).then(function (response) {
          assertOperation(scope);
          NarrativeUI.hideTyping(optionsBox);
          if (typeof passage === 'function' && passage() !== ownerPassage) return;

          var optionMeta = { requestId: response.requestId, operation: 'hub-options', stage: 'tool-registration' };
          cacheEntry.requestId = response.requestId;
          var options = response.options;
          cacheEntry.optionDiagnostics = response.report;

          var rd = { options: options, context: context, type: 'hubscene-options' };
          fireHook('llmResponseReady', rd);
          var hookMeta = { requestId: response.requestId, operation: 'hub-options', stage: 'after-hook' };
          options = normalizeOptions(rd.options, hookMeta);
          if (hookMeta.report.rejected || hookMeta.report.error) cacheEntry.optionDiagnostics = hookMeta.report;
          if (typeof TaskEngine !== 'undefined') options = TaskEngine.ensureQuestOption(options, Math.max(optionCount, options.length + 1), ownerPassage);

          assertOperation(scope);
          renderOptions(optionsBox, options, location);
          cacheEntry.options = options;
          optionLog('scene-options-stored', { sceneId: cacheKey, options: options, report: cacheEntry.optionDiagnostics }, optionMeta);
          scope.release();
        }).catch(function (err) {
          scope.release();
          if (finishCancelled(err, scope, optionsBox)) return;
          NarrativeUI.hideTyping(optionsBox);
          cacheEntry.optionDiagnostics = err.report || { generated: 0, kept: 0, rejected: 0, entries: [], error: err.message || String(err) };
          cacheEntry.requestId = err.requestId;
          cacheEntry.options = [];
          optionLog('scene-options-registration-failed', { report: cacheEntry.optionDiagnostics }, { requestId: err.requestId, operation: 'hub-options' });
          renderOptions(optionsBox, cacheEntry.options, location);
        });
      }

      renderNarration().then(generateOptions);
    }
  });

  if (typeof whenSugarCubeReady !== 'undefined') {
    whenSugarCubeReady(function () {
      if (typeof jQuery !== 'undefined') jQuery(document).on(':passageinit.llmOptionSafety', sanitizeStoredScene);
      console.log('[LLM Macros] Loaded: llmconfig, llmscene2, llmnpc, llmquest, npcchat, enddialogue, hubscene');
    });
  }
}());
