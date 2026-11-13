/* Compact runtime inspector for position, local NPCs and dialogue quotas. */
(function () {
  'use strict';

  var panel = null;
  var body = null;
  var collapsed = false;
  var refreshTimer = null;
  var llmBody = null, llmTab = null, stateTab = null;
  var activeView = 'state', selectedRequest = '', renderedVersion = -1;
  var statusLabels = { preparing: '读取配置', pending: '等待模型', success: '已收到响应', failed: '失败', cancelled: '已取消' };

  function state() {
    return typeof State !== 'undefined' && State.variables ? State.variables : null;
  }

  function cleanName(value) {
    return String(value == null ? '' : value).trim().toLocaleLowerCase();
  }

  function snapshot() {
    var st = state();
    if (!st) return { ready: false, npcs: [] };
    if (typeof RegionSystem !== 'undefined' && RegionSystem.ensure) RegionSystem.ensure();
    if (typeof NPCState !== 'undefined' && NPCState.ensureAll) NPCState.ensureAll();

    var position = st.position || { locationId: st.location || '', areaId: '' };
    var region = st.regions && st.regions[position.locationId];
    var area = region && region.areas && region.areas[position.areaId];
    var runtimeNameCounts = {};
    var npcs = [];

    function addNPC(id, npc, source) {
      if (!npc || typeof npc.name !== 'string') return;
      var key = cleanName(npc.name);
      if (!key) return;
      var present = typeof NPCState !== 'undefined' && NPCState.isPresent
        ? NPCState.isPresent(npc, position)
        : (npc.locationId || npc.location) === position.locationId && npc.areaId === position.areaId;
      if (!present) return;
      if (source === 'runtime') runtimeNameCounts[key] = (runtimeNameCounts[key] || 0) + 1;
      var limit = npc.proactiveDialogue && typeof npc.proactiveDialogue.limitPerArea === 'number'
        ? Math.max(0, npc.proactiveDialogue.limitPerArea)
        : 1;
      var remaining = typeof NPCState !== 'undefined' && NPCState.remaining
        ? NPCState.remaining(npc, position)
        : limit;
      npcs.push({
        id: id,
        name: npc.name,
        role: npc.role || '未设置',
        source: source,
        limit: limit,
        used: Math.max(0, limit - remaining),
        remaining: remaining,
        active: st.activeNPCId === id
      });
    }

    var runtimeNPCs = st.npcs || {};
    var cards = st.characterCards || {};
    Object.keys(runtimeNPCs).forEach(function (id) { addNPC(id, runtimeNPCs[id], 'runtime'); });
    Object.keys(cards).forEach(function (id) { addNPC(id, cards[id], 'card'); });
    npcs.forEach(function (npc) {
      npc.duplicateName = npc.source === 'runtime' && runtimeNameCounts[cleanName(npc.name)] > 1;
    });

    return {
      ready: true,
      passage: typeof passage === 'function' ? passage() : '',
      locationId: position.locationId || '',
      locationName: region && region.name || position.locationId || '未知',
      areaId: position.areaId || '',
      areaName: area && area.name || position.areaId || '未知',
      dialogueToolEnabled: typeof NPCState !== 'undefined' && NPCState.hasEligibleSpeaker
        ? NPCState.hasEligibleSpeaker(position)
        : npcs.some(function (npc) { return npc.remaining > 0; }),
      npcs: npcs
    };
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text !== 'undefined') node.textContent = text;
    return node;
  }

  function row(label, value, valueClass) {
    var item = element('div', 'debug-inspector-row');
    item.appendChild(element('span', 'debug-inspector-label', label));
    item.appendChild(element('span', 'debug-inspector-value ' + (valueClass || ''), value));
    return item;
  }

  function render() {
    if (!body || collapsed) return;
    renderLLM();
    if (activeView === 'llm') return;
    var data = snapshot();
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!data.ready) {
      body.appendChild(element('div', 'debug-inspector-empty', '等待游戏状态…'));
      return;
    }

    var positionSection = element('section', 'debug-inspector-section');
    positionSection.appendChild(element('div', 'debug-inspector-kicker', 'POSITION'));
    positionSection.appendChild(row('区域', data.locationName, 'debug-inspector-strong'));
    positionSection.appendChild(row('locationId', data.locationId));
    positionSection.appendChild(row('子场景', data.areaName, 'debug-inspector-strong'));
    positionSection.appendChild(row('areaId', data.areaId));
    positionSection.appendChild(row('passage', data.passage || '—'));
    body.appendChild(positionSection);

    var toolSection = element('section', 'debug-inspector-section');
    toolSection.appendChild(element('div', 'debug-inspector-kicker', 'DIALOGUE TOOL'));
    toolSection.appendChild(row('传给 LLM', data.dialogueToolEnabled ? 'ON' : 'OFF', data.dialogueToolEnabled ? 'is-on' : 'is-off'));
    body.appendChild(toolSection);

    var npcSection = element('section', 'debug-inspector-section');
    var title = element('div', 'debug-inspector-kicker', 'LOCAL NPC · ' + data.npcs.length);
    npcSection.appendChild(title);
    if (!data.npcs.length) {
      npcSection.appendChild(element('div', 'debug-inspector-empty', '当前子场景没有 NPC'));
    } else {
      data.npcs.forEach(function (npc) {
        var card = element('div', 'debug-npc-card' + (npc.active ? ' is-active' : ''));
        var heading = element('div', 'debug-npc-heading');
        heading.appendChild(element('span', 'debug-npc-name', npc.name));
        if (npc.duplicateName) heading.appendChild(element('span', 'debug-npc-duplicate', '同名冲突'));
        heading.appendChild(element('span', 'debug-npc-source', npc.source));
        card.appendChild(heading);
        card.appendChild(element('div', 'debug-npc-meta', npc.role + ' · ' + npc.id));
        var quota = element('div', 'debug-npc-quota');
        quota.appendChild(element('span', '', '主动搭话'));
        quota.appendChild(element('span', npc.remaining > 0 ? 'is-on' : 'is-off', npc.used + '/' + npc.limit + ' · 剩余 ' + npc.remaining));
        card.appendChild(quota);
        npcSection.appendChild(card);
      });
    }
    body.appendChild(npcSection);
  }

  function fold(parent, key, title, text, open) {
    var details = element('details', 'debug-llm-fold');
    details.setAttribute('data-trace-key', key);
    details.open = !!open;
    details.appendChild(element('summary', '', title));
    if (typeof text !== 'undefined') details.appendChild(element('pre', 'debug-llm-text', typeof text === 'string' ? text : JSON.stringify(text, null, 2)));
    parent.appendChild(details);
    return details;
  }

  function renderOptionSummary(parent, key, entry) {
    var names = {
      'scene-options-normalized': '规范化',
      'scene-options-registration-checked': '整批注册校验',
      'scene-options-registration-failed': '注册失败',
      'scene-options-stored': '存储',
      'scene-options-rendered': '渲染'
    };
    var events = (entry.events || []).filter(function (event) {
      return Object.prototype.hasOwnProperty.call(names, event.name);
    });
    if (!events.length) return;
    var section = fold(parent, key + 'option-summary', '5 · 选项处理摘要', undefined, true);
    section.appendChild(element('p', 'debug-llm-note', '以下为程序处理诊断，不改写模型原始回复；保留、修正或渲染选项均不代表行动已结算。'));
    events.forEach(function (event, index) {
      var detail = event.detail || {};
      var report = detail.report || {};
      var item = fold(section, key + 'option-summary-' + index, names[event.name] + ' · ' + event.name, undefined, true);
      ['generated', 'kept', 'rejected'].forEach(function (field) {
        item.appendChild(row(field, typeof report[field] === 'number' ? String(report[field]) : '—'));
      });
      if (detail.sceneId) item.appendChild(row('sceneId', detail.sceneId));
      if (typeof detail.count === 'number') item.appendChild(row('rendered', String(detail.count)));
      if (Array.isArray(detail.labels)) fold(item, key + 'option-summary-' + index + '-labels', '实际渲染选项', detail.labels);
      if (report.error) fold(item, key + 'option-summary-' + index + '-error', '处理错误', report.error, true);
      var entries = Array.isArray(report.entries) ? report.entries : [];
      entries.forEach(function (diagnostic, n) {
        if (!diagnostic || typeof diagnostic !== 'object') return;
        var label = typeof diagnostic.label === 'string' ? ' · ' + diagnostic.label : '';
        var diagnosticKey = key + 'option-summary-' + index + '-entry-' + n;
        var entrySection = fold(item, diagnosticKey, '选项 ' + (typeof diagnostic.index === 'number' ? diagnostic.index + 1 : n + 1) + label, undefined, true);
        if (diagnostic.status) entrySection.appendChild(row('status', diagnostic.status));
        if (diagnostic.reason != null) fold(entrySection, diagnosticKey + '-reason', 'reason · 处理原因', diagnostic.reason, true);
        if (diagnostic.corrections != null) fold(entrySection, diagnosticKey + '-corrections', 'corrections · 修正记录', diagnostic.corrections, true);
      });
    });
  }

  function renderLLM() {
    if (!llmBody) return;
    var trace = window.LLMTrace;
    var list = trace ? trace.list() : [];
    llmTab.textContent = 'LLM 调用' + (list.length ? ' · ' + list.length : '');
    if (activeView !== 'llm') return;
    var version = trace ? trace.version() : 0;
    if (renderedVersion === version) return;
    if (renderedVersion >= 0 && document.activeElement && document.activeElement.className === 'debug-llm-select') return;
    renderedVersion = version;
    var opened = {}, textScroll = {};
    llmBody.querySelectorAll('details[data-trace-key]').forEach(function (node) { opened[node.getAttribute('data-trace-key')] = node.open; });
    llmBody.querySelectorAll('.debug-llm-text').forEach(function (node) { textScroll[node.parentNode.getAttribute('data-trace-key')] = node.scrollTop; });
    var scroll = llmBody.scrollTop;
    while (llmBody.firstChild) llmBody.removeChild(llmBody.firstChild);
    var section = element('section', 'debug-inspector-section');
    llmBody.appendChild(section);
    section.appendChild(element('div', 'debug-inspector-kicker', 'LLM / REQUEST INSPECTOR'));
    section.appendChild(element('p', 'debug-llm-note', '当前页面最近最多 12 次请求（容量上限 4M 字符）；刷新后清空。内容脱敏、超限明确截断，不展示模型思维过程。'));
    if (!list.length) {
      section.appendChild(element('p', 'debug-inspector-empty', '暂无调用。触发一次 NPC 对话或场景生成后，这里会显示实际请求。'));
      return;
    }
    if (selectedRequest && !list.some(function (item) { return item.id === selectedRequest; })) selectedRequest = '';
    var select = element('select', 'debug-llm-select');
    select.setAttribute('aria-label', '选择 LLM 请求');
    var latest = element('option', '', '跟随最新调用'); latest.value = ''; select.appendChild(latest);
    list.forEach(function (item) {
      var option = element('option', '', new Date(item.startedAt).toLocaleTimeString() + ' · ' + item.operation + (item.round ? ' / 第 ' + item.round + ' 轮' : '') + ' · ' + statusLabels[item.status]);
      option.value = item.id; select.appendChild(option);
    });
    select.value = selectedRequest;
    select.addEventListener('change', function () { selectedRequest = select.value; renderedVersion = -1; renderLLM(); });
    section.appendChild(select);
    var entry = trace.get(selectedRequest || list[0].id);
    var payload = entry.payload || {};
    var key = entry.id + ':';
    section.appendChild(row('状态', statusLabels[entry.status] || entry.status, entry.status === 'failed' ? 'is-off' : 'is-on'));
    section.appendChild(row('调用', entry.operation + (entry.traceContext ? ' · 第 ' + entry.traceContext.round + ' 轮 / run ' + entry.traceContext.runId : '')));
    section.appendChild(row('模型', (entry.provider || '—') + ' / ' + (entry.model || '配置读取中')));
    section.appendChild(row('耗时', typeof entry.ms === 'number' ? entry.ms + ' ms' : '进行中'));
    section.appendChild(row('requestId', entry.id));
    if (entry.error) fold(section, key + 'error', '错误 / 取消原因', entry.error, true);
    if (!entry.payload) {
      section.appendChild(element('p', 'debug-inspector-empty', '尚未发送模型请求，暂无实际 Prompt。'));
    } else {
      var assembly = entry.assembly;
      var recipe = fold(section, key + 'assembly', '1 · Prompt 拼接规则与顺序', undefined, true);
      recipe.appendChild(element('p', 'debug-llm-note', assembly ? assembly.source + '\n' + assembly.rule : '统一客户端输入：数组按原顺序作为 messages；chat 字符串包装成一条 user；generate 字符串作为 prompt。下面按实际消息与已有标题展示结构，不推测未提供的构建来源。'));
      recipe.appendChild(element('p', 'debug-llm-note', '这里是前端发送到 /api/llm 的脱敏内容。后端再适配供应商格式；tools 与 messages 分开传递。'));
      var messages = payload.messages || [{ role: 'prompt', content: payload.prompt }];
      messages.forEach(function (message, index) {
        if (!message || typeof message !== 'object') message = { role: '日志截断', content: String(message) };
        var text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
        var title = (index + 1) + '. ' + message.role + (message.name ? ' / ' + message.name : '') + ' · ' + (text || '').length + ' 字符';
        var item = fold(recipe, key + 'message-' + index, title, text || '(无文本)');
        if (message.tool_call_id) item.appendChild(element('p', 'debug-llm-note', 'tool_call_id: ' + message.tool_call_id));
        if (message.tool_calls) fold(item, key + 'message-calls-' + index, '这一条 assistant 携带的 tool_calls', message.tool_calls);
        var parts = assembly && assembly.sections && assembly.sections.filter(function (part) { return part.messageIndex === index; });
        if (parts && parts.length) {
          item.appendChild(element('p', 'debug-llm-note', '构建片段（按换行连接）：'));
          parts.forEach(function (part, n) { fold(item, key + 'part-' + index + '-' + n, (n + 1) + '. ' + part.label, part.content); });
        } else {
          var headings = (text || '').match(/^={2,}[^\n]+/gm);
          if (headings) item.appendChild(element('p', 'debug-llm-note', '实际段落标题：' + headings.join(' → ')));
        }
      });
      fold(section, key + 'params', '2 · 请求参数与可用工具定义（' + (payload.tools || []).length + '）', {
        temperature: payload.temperature, maxTokens: payload.maxTokens, stream: payload.stream,
        context: payload.context, traceContext: entry.traceContext, tools: payload.tools || []
      });
    }
    var response = entry.response;
    var toolSection = fold(section, key + 'tools', '3 · 模型 Tool 调用与程序执行结果', undefined, true);
    var previousRounds = entry.traceContext ? list.filter(function (item) {
      return item.runId === entry.traceContext.runId && item.round < entry.traceContext.round;
    }).reverse() : [];
    previousRounds.forEach(function (item) {
      var previous = trace.get(item.id);
      var previousCalls = previous.response && previous.response.tool_calls || [];
      var round = fold(toolSection, key + 'previous-' + item.id, '同一回合 · 第 ' + item.round + ' 轮 · ' + previousCalls.length + ' 次工具调用', undefined, true);
      fold(round, key + 'previous-calls-' + item.id, '模型工具参数', previousCalls);
      (previous.events || []).filter(function (event) { return event.name !== 'npc-model-tool-preamble'; }).forEach(function (event, index) {
        fold(round, key + 'previous-event-' + item.id + '-' + index, event.name, event.detail, true);
      });
    });
    if (response && response.tool_calls && response.tool_calls.length) {
      fold(toolSection, key + 'calls', '模型请求的工具及原始参数', response.tool_calls, true);
    } else toolSection.appendChild(element('p', 'debug-llm-note', response ? '本轮未请求工具。' : '等待模型返回工具调用。'));
    toolSection.appendChild(element('p', 'debug-llm-note', 'STAGED = 暂存草稿，不等于已生效；REJECTED = 拒绝执行；选项注册的 VALIDATED = 参数通过，实际保存看 scene-options-stored，仍未执行玩家行动。最终提交仍由对应的 NPC、任务事件或普通行动检查控制；真实结算请看 committed / outcome 记录。未出现执行结果不代表成功。'));
    (entry.events || []).forEach(function (event, index) { fold(toolSection, key + 'event-' + index, event.name, event.detail, true); });
    if (entry.eventsTruncated) toolSection.appendChild(element('p', 'debug-llm-note', '较早工具事件已因容量限制移除。'));
    if (entry.decision) fold(toolSection, key + 'decision', 'NPC 最终提交结果', entry.decision, true);
    if (entry.eventOutcome) fold(toolSection, key + 'event-outcome', '任务事件最终提交结果', entry.eventOutcome, true);
    fold(section, key + 'reply', '4 · 模型回复' + (response && response.tool_calls && response.tool_calls.length ? '（工具前置文本，非最终答复）' : ''), response ? response.text || '(本轮仅调用工具或无正文)' : '等待响应…', true);
    if (response && response.finishReason) section.appendChild(row('finishReason', response.finishReason));
    renderOptionSummary(section, key, entry);
    llmBody.querySelectorAll('details[data-trace-key]').forEach(function (node) {
      var id = node.getAttribute('data-trace-key');
      if (Object.prototype.hasOwnProperty.call(opened, id)) node.open = opened[id];
    });
    llmBody.querySelectorAll('.debug-llm-text').forEach(function (node) { node.scrollTop = textScroll[node.parentNode.getAttribute('data-trace-key')] || 0; });
    llmBody.scrollTop = scroll;
  }

  function mount() {
    if (panel && panel.parentNode) return;
    panel = element('aside', 'debug-inspector');
    panel.id = 'debug-inspector';
    panel.setAttribute('aria-label', '游戏状态调试窗口');

    var header = element('header', 'debug-inspector-header');
    var identity = element('div', 'debug-inspector-identity');
    identity.appendChild(element('span', 'debug-inspector-pulse'));
    identity.appendChild(element('strong', '', 'STATE MONITOR'));
    header.appendChild(identity);
    var toggle = element('button', 'debug-inspector-toggle', '收起');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.addEventListener('click', function () {
      collapsed = !collapsed;
      panel.classList.toggle('is-collapsed', collapsed);
      toggle.textContent = collapsed ? '展开' : '收起';
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (!collapsed) render();
    });
    header.appendChild(toggle);
    panel.appendChild(header);

    var tabs = element('nav', 'debug-inspector-tabs');
    tabs.setAttribute('aria-label', '调试视图');
    stateTab = element('button', 'debug-inspector-toggle', '游戏状态');
    llmTab = element('button', 'debug-inspector-toggle', 'LLM 调用');
    [stateTab, llmTab].forEach(function (button, index) {
      button.type = 'button'; button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
      button.addEventListener('click', function () {
        activeView = index === 0 ? 'state' : 'llm';
        body.hidden = index !== 0; llmBody.hidden = index === 0;
        panel.classList.toggle('is-llm-view', index === 1);
        stateTab.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
        llmTab.setAttribute('aria-pressed', index === 1 ? 'true' : 'false');
        render();
      });
      tabs.appendChild(button);
    });
    panel.appendChild(tabs);
    llmBody = element('div', 'debug-inspector-body debug-llm-body');
    llmBody.hidden = true;
    panel.appendChild(llmBody);
    body = element('div', 'debug-inspector-body');
    panel.appendChild(body);
    document.body.appendChild(panel);
    render();

    if (!refreshTimer) refreshTimer = setInterval(render, 750);
  }

  window.DebugPanel = { mount: mount, refresh: render, snapshot: snapshot };

  if (typeof whenSugarCubeReady === 'function') {
    whenSugarCubeReady(function () {
      mount();
      if (typeof jQuery !== 'undefined') $(document).on(':passagedisplay', render);
    });
  } else if (typeof document !== 'undefined') {
    function mountWhenReady() {
      if (document.body) mount();
      else setTimeout(mountWhenReady, 20);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountWhenReady);
    setTimeout(mountWhenReady, 0);
  }
}());
