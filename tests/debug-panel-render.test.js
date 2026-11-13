const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.scrollTop = 0; this._text = ''; this.classList = { toggle() {} }; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  get firstChild() { return this.children[0]; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  set innerHTML(value) { throw new Error('Unsafe HTML: ' + value); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return descendants;
    if (selector === 'details[data-trace-key]') return descendants.filter(child => child.tagName === 'details' && child.attributes['data-trace-key']);
    return descendants.filter(child => (child.className || '').split(' ').includes(selector.slice(1)));
  }
}
function harness() {
  const body = new Element('body');
  const context = { JSON, State: { variables: {} }, whenSugarCubeReady() {}, setInterval() { return 1; }, document: { body, createElement: tag => new Element(tag) } };
  context.window = context; vm.createContext(context);
  ['llm-trace.js', 'debug-panel.js'].forEach(file => vm.runInContext(fs.readFileSync('src/scripts/' + file, 'utf8'), context));
  context.DebugPanel.mount();
  const tabs = body.querySelectorAll('.debug-inspector-tabs')[0].children;
  tabs[1].listeners.click();
  return { context, body, tabs, trace: context.LLMTrace, view: body.querySelectorAll('.debug-llm-body')[0] };
}
function add(h, id = 'first') {
  h.trace.record(id, { startedAt: Date.now(), operation: 'npc-agency', status: 'success', payload: {
    messages: [{ role: 'system', content: '=== 规则 ===\n不要编造。' }, { role: 'user', content: '<img src=x onerror=alert(1)><<set $money=999>>' }],
    tools: [{ function: { name: 'give' } }]
  }, response: { text: '你好', tool_calls: [] } });
  h.context.DebugPanel.refresh();
}

test('LLM tab empty state, latest request, tool results and payloads all render as plain text', () => {
  const h = harness(); assert.match(h.view.textContent, /暂无调用/);
  add(h);
  assert.match(h.view.textContent, /Prompt 拼接规则/);
  assert.match(h.view.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(h.view.textContent, /<<set \$money=999>>/);
  assert.match(h.view.textContent, /give/);
  h.trace.event('first', 'npc-tool-result', { callId: 'c1', result: { status: 'REJECTED', error: '资源不足' } });
  h.context.DebugPanel.refresh();
  assert.match(h.view.textContent, /资源不足/);
  assert.equal(h.body.querySelectorAll('*').some(node => node.tagName === 'img' || node.tagName === 'script'), false);
  h.tabs[0].listeners.click(); assert.equal(h.view.hidden, true);
  h.tabs[1].listeners.click(); assert.equal(h.view.hidden, false);
});

test('unchanged traces keep DOM identity; updates preserve folds and nested reading positions', () => {
  const h = harness(); add(h);
  let fold = h.view.querySelectorAll('details[data-trace-key]').find(node => node.getAttribute('data-trace-key') === 'first:message-0');
  fold.open = true; fold.children[1].scrollTop = 45; h.view.scrollTop = 80;
  const section = h.view.firstChild;
  h.context.DebugPanel.refresh(); assert.equal(h.view.firstChild, section);
  h.trace.record('first', { ms: 123 }); h.context.DebugPanel.refresh();
  fold = h.view.querySelectorAll('details[data-trace-key]').find(node => node.getAttribute('data-trace-key') === 'first:message-0');
  assert.equal(fold.open, true); assert.equal(fold.children[1].scrollTop, 45); assert.equal(h.view.scrollTop, 80);
});

test('selecting history pins the request; dropping an evicted request returns to latest', () => {
  const h = harness(); add(h);
  let select = h.view.querySelectorAll('.debug-llm-select')[0];
  select.value = 'first'; select.listeners.change();
  add(h, 'second'); assert.match(h.view.textContent, /requestIdfirst/);
  for (let i = 0; i < 12; i++) add(h, 'new-' + i);
  assert.match(h.view.textContent, /requestIdnew-11/);
});

test('large prompts with trace truncation still render without changing payload array shapes', () => {
  const h = harness();
  h.trace.record('huge', { startedAt: 1, operation: 'chat', status: 'pending', payload: {
    messages: Array.from({ length: 10 }, () => ({ role: 'user', content: 'x'.repeat(100000) })), tools: []
  } });
  h.context.DebugPanel.refresh(); assert.match(h.view.textContent, /truncated:/);
});

test('the newest final-reply round also shows earlier tools from the same run, not other runs', () => {
  const h = harness();
  add(h, 'first'); h.trace.record('first', { traceContext: { runId: 1, round: 1 }, response: { text: '', tool_calls: [{ function: { name: 'give' } }] } });
  h.trace.event('first', 'npc-tool-result', { result: { status: 'STAGED', detail: '赠礼草稿' } });
  add(h, 'unrelated'); h.trace.record('unrelated', { traceContext: { runId: 2, round: 1 } });
  h.trace.event('unrelated', 'npc-tool-result', { result: { detail: '不应混入' } });
  add(h, 'final'); h.trace.record('final', { traceContext: { runId: 1, round: 2 } });
  h.context.DebugPanel.refresh();
  assert.match(h.view.textContent, /同一回合 · 第 1 轮 · 1 次工具调用/);
  assert.match(h.view.textContent, /赠礼草稿/);
  assert.doesNotMatch(h.view.textContent, /不应混入/);
});

test('quest event traces distinguish staged tools from the actual committed event outcome',()=>{
  const h=harness();add(h,'event');h.trace.record('event',{operation:'quest-event',eventOutcome:{ok:true,status:'completed',summary:'已确认老人平安'}});
  h.context.DebugPanel.refresh();assert.match(h.view.textContent,/任务事件最终提交结果/);assert.match(h.view.textContent,/已确认老人平安/);
});
