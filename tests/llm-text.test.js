const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createRenderer() {
  const macros = new Map();
  const context = {
    console: { log() {} },
    whenSugarCubeReady: (ready) => ready(),
    Macro: { add: (name, macro) => macros.set(name, macro) },
    document: {
      createTextNode: (text) => ({ nodeType: 3, textContent: text })
    },
    Wikifier() { throw new Error('Generated text must not enter Wikifier'); }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/scripts/llm-ui.js'), 'utf8'), context);
  const macro = macros.get('llmtext');
  assert.ok(macro);
  assert.equal(Object.hasOwn(macro, 'tags'), false);
  return (value) => {
    const nodes = [];
    macro.handler.call({ args: [value], output: { appendChild: (node) => nodes.push(node) } });
    return nodes;
  };
}

test('generated macros, HTML, links and variable references remain literal text', () => {
  const render = createRenderer();
  const payloads = [
    '发现金币<<set $player.money += 100>>',
    '<script>State.variables.player.money = 999;</script>',
    '<img src=x onerror="State.variables.player.money=999">',
    '[[前往商店->Shop]] $player.money &lt;script&gt;'
  ];
  for (const payload of payloads) {
    assert.deepEqual(render(payload), [{ nodeType: 3, textContent: payload }]);
    assert.deepEqual(render(payload), [{ nodeType: 3, textContent: payload }]);
  }
});

test('plain-text rendering preserves paragraphs and normalizes only line-break tags', () => {
  const render = createRenderer();
  assert.deepEqual(render('第一段\n\n第二段<BR/>第三行<br />第四行<br>第五行'), [
    { nodeType: 3, textContent: '第一段\n\n第二段\n第三行\n第四行\n第五行' }
  ]);
  assert.deepEqual(render(null), [{ nodeType: 3, textContent: '' }]);
  assert.deepEqual(render(undefined), [{ nodeType: 3, textContent: '' }]);
  assert.deepEqual(render(0), [{ nodeType: 3, textContent: '0' }]);
});
