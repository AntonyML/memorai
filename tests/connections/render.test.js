// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '../../js/connections/render/svg.js';

/** @typedef {import('../../js/connections/types.js').Graph} Graph */

/** Minimal SVG surface for checking the worker waiting state with native Node tools. */
class FakeElement extends EventTarget {
  /** @type {FakeElement[]} */ children = [];
  /** @type {FakeElement | null} */ parent = null;
  /** @type {Map<string, string>} */ attributes = new Map();
  /** @type {Set<string>} */ tokens = new Set();
  style = { display: '' };
  textContent = '';
  classList = {
    /** @param {string} token @param {boolean} enabled */
    toggle: (token, enabled) => { if (enabled) this.tokens.add(token); else this.tokens.delete(token); }
  };
  /** @param {string} tag */
  constructor(tag) { super(); this.tag = tag; }
  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes.set(name, value);
    if (name === 'class') this.tokens = new Set(value.split(/\s+/u));
  }
  /** @param {string} name */
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  /** @param {FakeElement[]} items */
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  /** @param {FakeElement[]} items */
  replaceChildren(...items) {
    for (const item of this.children) item.parent = null;
    this.children = [];
    this.append(...items);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this);
    this.parent = null;
  }
  getContext() { return null; }
}

/** @param {FakeElement} element @param {(element: FakeElement) => boolean} matches @returns {FakeElement[]} */
function matching(element, matches) {
  return [...(matches(element) ? [element] : []), ...element.children.flatMap(child => matching(child, matches))];
}

test('renderer hides waiting cards and never routes missing worker coordinates through the origin', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    /** @param {string} _namespace @param {string} tag */
    createElementNS: (_namespace, tag) => new FakeElement(tag),
    /** @param {string} tag */
    createElement: tag => new FakeElement(tag)
  } });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: FakeElement });
  const signal = new AbortController();
  const container = new FakeElement('div');
  const renderer = createRenderer(/** @type {HTMLElement} */ (/** @type {unknown} */ (container)), { navigate: () => {} }, signal.signal);
  /** @type {Graph} */
  const graph = {
    nodes: ['a', 'b'].map(id => ({ id, title: id, kind: 'note', width: 220, height: 96 })),
    edges: [
      { id: 'ab', source: 'a', target: 'b', type: 'part-of', explicit: true },
      { id: 'bb', source: 'b', target: 'b', type: 'related', explicit: true }
    ], focus: 'a'
  };
  const cards = () => matching(container, item => item.tokens.has('graph-node'));
  const connections = () => matching(container, item => item.tokens.has('graph-connection'));
  const labels = () => matching(container, item => item.tokens.has('graph-edge-pill'));
  const paths = () => matching(container, item => item.tokens.has('graph-edge'));
  try {
    renderer.setGraph(graph);
    assert.ok(cards().every(card => card.style.display === 'none'), 'All worker-waiting cards are hidden');
    assert.ok(connections().every(connection => connection.style.display === 'none'));
    assert.ok(paths().every(path => path.getAttribute('d') === null), 'Missing endpoints create no origin routes');

    renderer.render({ a: { x: 100, y: 100 } });
    assert.equal(cards().find(card => card.getAttribute('data-node-id') === 'a')?.style.display, '');
    assert.equal(cards().find(card => card.getAttribute('data-node-id') === 'b')?.style.display, 'none');
    assert.ok(connections().every(connection => connection.style.display === 'none'), 'An edge waits for both endpoints, including self loops');

    renderer.render({ a: { x: 100, y: 100 }, b: { x: 500, y: 100 } });
    assert.ok(cards().every(card => card.style.display === ''));
    assert.ok(connections().every(connection => connection.style.display === ''));
    assert.ok(paths().every(path => path.getAttribute('d')?.startsWith('M ')));
    const originalCards = cards();

    renderer.setZoom(1.5);
    renderer.setGraph({ ...graph, nodes: [...graph.nodes, { id: 'c', title: 'c', kind: 'note', width: 220, height: 96 }] });
    assert.ok(cards().every(card => card.style.display === 'none'), 'Replacing a graph clears previous coordinates');
    assert.ok(connections().every(connection => connection.style.display === 'none'), 'Old routes are hidden during the next worker request');
    assert.ok(labels().every(label => label.style.display === 'none'), 'Old curve labels are cleared');
    assert.equal(cards()[0], originalCards[0], 'Existing SVG cards remain keyed and are reused');

    renderer.render({ a: { x: 100, y: 100 }, b: { x: Number.NaN, y: 100 } });
    assert.equal(cards().find(card => card.getAttribute('data-node-id') === 'b')?.style.display, 'none');
    assert.ok(connections().every(connection => connection.style.display === 'none'), 'Nonfinite coordinates cannot produce visible paths');
  } finally {
    renderer.destroy();
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (originalElement) Object.defineProperty(globalThis, 'Element', originalElement); else Reflect.deleteProperty(globalThis, 'Element');
  }
});
