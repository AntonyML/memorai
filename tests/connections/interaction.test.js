import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager } from '../../js/connections/state/history.js';
import { Viewport } from '../../js/connections/interaction/viewport.js';
import { adaptGraph } from '../../js/connections/adapters/app.js';
import { adjacency, pathsFrom } from '../../js/connections/domain/graph.js';
import { tween } from '../../js/connections/animation/tween.js';
import { LayoutRunner } from '../../js/connections/state/layoutRunner.js';

const snapshot = x => ({ positions: { a: { x, y: 0 } }, camera: { x: 12, y: 34, scale: 0.5 } });

test('history restores independent positions and camera, and new edits discard redo', () => {
  const history = new HistoryManager();
  const first = snapshot(0); history.push(first); first.positions.a.x = 99;
  const previous = history.undo(snapshot(100));
  assert.deepEqual(previous, snapshot(0));
  previous.positions.a.x = -1;
  assert.deepEqual(history.redo(snapshot(0)), snapshot(100));
  history.undo(snapshot(100)); history.push(snapshot(50));
  assert.equal(history.canRedo, false);
  history.clear(); assert.equal(history.canUndo, false);
});

function cameraFixture() {
  const svg = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 400 }), setAttribute() {} };
  let camera;
  const viewport = new Viewport(svg, next => { camera = next; });
  viewport.resize(800, 400);
  return { viewport, camera: () => camera };
}

test('zoom keeps the graph point under the pointer, including clamped zoom', () => {
  const { viewport } = cameraFixture();
  viewport.restore({ x: 120, y: -30, scale: 0.8 });
  const point = viewport.point(230, 120);
  viewport.zoom(1.5, viewport.screen(230, 120));
  assert.deepEqual(viewport.point(230, 120), point);
  viewport.zoom(100, viewport.screen(230, 120));
  assert.ok(Math.abs(viewport.point(230, 120).x - point.x) < 1e-10);
  assert.equal(viewport.camera.scale, 3);
});

test('fit includes all box bounds and resize preserves graph center', () => {
  const { viewport, camera } = cameraFixture();
  const bounds = { x: -500, y: -250, width: 1000, height: 500 };
  viewport.fit(bounds);
  const initial = camera();
  assert.ok(initial.x + bounds.x * initial.scale >= 31.99);
  assert.ok(initial.y + bounds.y * initial.scale >= 31.99);
  assert.ok(initial.x + (bounds.x + bounds.width) * initial.scale <= 768.01);
  assert.ok(initial.y + (bounds.y + bounds.height) * initial.scale <= 368.01);
  viewport.resize(1000, 600);
  assert.equal(viewport.camera.x, initial.x + 100);
  assert.equal(viewport.camera.y, initial.y + 100);
});

test('adapter preserves semantic directions and parallel links while ignoring missing endpoints', () => {
  const input = { nodes: [{ id: 'a', title: 'A', kind: 'context' }, { id: 'b', title: 'B', kind: 'skill' }], edges: [
    { source: 'b', target: 'a', type: 'part-of', explicit: true },
    { source: 'a', target: 'b', type: 'related', explicit: false },
    { source: 'b', target: 'missing', type: 'depends-on' }
  ] };
  const graph = adaptGraph(input, 'b');
  assert.equal(graph.edges.length, 2); assert.equal(graph.focus, 'b');
  assert.ok(graph.edges.some(edge => edge.source === 'b' && edge.target === 'a' && edge.type === 'part-of'));
  assert.deepEqual(adaptGraph({ nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() }, 'b'), graph);
  assert.deepEqual(pathsFrom('a', adjacency(graph)).get('b'), ['a', 'b']);
  const subset = adaptGraph({ nodes: input.nodes, edges: [input.edges[0]] }, 'b');
  assert.equal(subset.edges[0].id, graph.edges.find(edge => edge.type === 'part-of').id);
});

test('reduced motion renders the final positions immediately without scheduling animation', async () => {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const target = { a: { x: 123, y: 456 } };
    let rendered;
    await tween({ a: { x: 0, y: 0 } }, target, positions => { rendered = positions; }, new AbortController().signal);
    assert.deepEqual(rendered, target);
    rendered.a.x = 0; assert.equal(target.a.x, 123);
  } finally {
    if (original) globalThis.matchMedia = original; else delete globalThis.matchMedia;
  }
});

test('large graphs use a module worker and ignore results from canceled requests', async () => {
  const original = globalThis.Worker;
  const workers = [];
  class TestWorker {
    handlers = {};
    terminated = false;
    constructor(url, options) { this.url = url; this.options = options; workers.push(this); }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = TestWorker;
  try {
    const runner = new LayoutRunner();
    const graph = { nodes: Array.from({ length: 201 }, (_, i) => ({ id: String(i), title: String(i), kind: 'note', width: 232, height: 96 })), edges: [], focus: null };
    const first = runner.run(graph, 'smart');
    assert.equal(workers[0].options.type, 'module');
    assert.match(workers[0].url.pathname, /workers\/layout\.worker\.js$/);
    const second = runner.run(graph, 'force');
    assert.equal(await first, null); assert.equal(workers[0].terminated, true);
    workers[0].handlers.message({ data: { result: { positions: { stale: { x: 1, y: 2 } }, bounds: {} } } });
    const expected = { positions: { '0': { x: 12, y: 34 } }, bounds: { x: 0, y: 0, width: 232, height: 96 } };
    workers[1].handlers.message({ data: { result: expected } });
    assert.deepEqual(await second, expected); assert.equal(workers[1].terminated, true);
    const canceled = runner.run(graph, 'layered'); runner.cancel(); assert.equal(await canceled, null);
  } finally {
    if (original) globalThis.Worker = original; else delete globalThis.Worker;
  }
});
