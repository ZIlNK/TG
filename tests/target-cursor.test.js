const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const events = {}, windowEvents = {}, media = [];
  function element() {
    const classes = new Set();
    return {
      style: {}, children: [],
      classList: {
        toggle(name, value) { if (value) classes.add(name); else classes.delete(name); },
        add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); }
      },
      setAttribute() {}, appendChild(child) { this.children.push(child); },
      contains(node) { return !!node; }
    };
  }
  const body = element();
  const document = { body, readyState: 'complete', hidden: false,
    createElement: element, addEventListener(name, fn) { events[name] = fn; }
  };
  const window = { innerWidth: 1280, innerHeight: 800, requestAnimationFrame() {},
    addEventListener(name, fn) { windowEvents[name] = fn; },
    matchMedia(query) {
      const result = { matches: !query.includes('reduce'), addEventListener(name, fn) { this.change = fn; } };
      media.push(result); return result;
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/scripts/target-cursor.js'), 'utf8'), { document, window });
  function move(control = '') {
    events.mousemove({ clientX: 300, clientY: 200, target: {
      closest(selector) { return selector.split(',').some((part) => part.trim() === control) ? {} : null; }
    } });
  }
  function expectVisible(visible) {
    assert.equal(body.children[0].classList.contains('is-visible'), visible);
    assert.equal(body.classList.contains('target-cursor-surface'), visible);
  }
  return { move, expectVisible, events, windowEvents, media, document };
}

test('native pointer is hidden exactly when replacement is visible', () => {
  const h = harness(); h.expectVisible(false);
  h.move(); h.expectVisible(true);
  h.move('select'); h.expectVisible(false);
  h.move(); h.expectVisible(true);
  h.events.mouseleave(); h.expectVisible(false);
});

test('window blur and hidden document restore native pointer', () => {
  const h = harness(); h.move(); h.windowEvents.blur(); h.expectVisible(false);
  h.move(); h.document.hidden = true; h.events.visibilitychange(); h.expectVisible(false);
});

test('reduced motion and small/touch viewport disable replacement', () => {
  const h = harness(); h.move();
  h.media[1].matches = true; h.media[1].change(); h.expectVisible(false);
  h.move(); h.expectVisible(false);
  h.media[1].matches = false; h.media[1].change(); h.move(); h.expectVisible(true);
  h.media[0].matches = false; h.media[0].change(); h.move(); h.expectVisible(false);
});

 test('text entry controls keep custom pointer visible', () => {
  const h = harness();
  for (const control of ['input', 'textarea', '[contenteditable="true"]']) {
    h.move(control); h.expectVisible(true);
  }
});
