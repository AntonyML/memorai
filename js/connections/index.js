// @ts-check
import { adaptGraph } from './adapters/app.js';
import { Store } from './state/store.js';
import { HistoryManager } from './state/history.js';
import { LayoutRunner } from './state/layoutRunner.js';
import { createRenderer } from './render/svg.js';
import { measureNodes } from './render/measure.js';
import { boundsFor } from './layout/geometry.js';
import { Viewport } from './interaction/viewport.js';
import { bindPointers } from './interaction/pointer.js';
import { bindKeyboard } from './interaction/keyboard.js';
import { createToolbar } from './ui/toolbar.js';
import { populateFocus } from './ui/filters.js';
import { renderNoteList } from './ui/noteList.js';
import { tween } from './animation/tween.js';
/** @typedef {import('./types.js').Snapshot} Snapshot */

/** @param {HTMLDialogElement} container @param {import('./types.js').ConnectionsOptions} options
 * @returns {import('./types.js').ConnectionsController}
 */
export function mountConnections(container, options) {
  const { focus, depth, graphElement, list, status } = (() => {
    const focus = container.querySelector('#graphFocus'), depth = container.querySelector('#graphDepth');
    const graphElement = container.querySelector('#knowledgeGraph'), list = container.querySelector('#graphNoteList'), status = container.querySelector('#graphStatus');
    if (!(focus instanceof HTMLSelectElement) || !(depth instanceof HTMLSelectElement) || !(graphElement instanceof HTMLElement) || !(list instanceof HTMLElement) || !(status instanceof HTMLElement)) throw new Error('Connections controls are missing');
    return { focus, depth, graphElement, list, status };
  })();
  const lifetime = new AbortController();
  let rows = new AbortController();
  const store = new Store(), history = new HistoryManager(), runner = new LayoutRunner();
  const renderer = createRenderer(graphElement, { navigate: options.navigate }, lifetime.signal);
  /** @type {AbortController | null} */ let animation = null;
  let generation = 0, signature = '', destroyed = false, fitOnResize = true, expanded = false;
  /** @type {Snapshot | null} */ let dragSnapshot = null;
  /** Graph-only view: the dialog fills the viewport and hides everything except the toolbar and canvas. */
  function setExpanded(/** @type {boolean} */ value) {
    if (expanded === value) return;
    expanded = value; fitOnResize = true;
    container.classList.toggle('connections-graph-only', value);
    if (value) container.scrollTop = 0;
    toolbar.setFullscreen(value);
  }
  const zoom = (/** @type {number} */ factor) => { fitOnResize = false; viewport.zoom(factor); };
  const toolbar = createToolbar({ layout: () => { void arrange(true); }, zoom, fit, undo: () => restore('undo'), redo: () => restore('redo'), fullscreen: () => setExpanded(!expanded) }, lifetime.signal);
  const legend = container.querySelector('.graph-legend');
  if (legend) legend.before(toolbar.element); else graphElement.before(toolbar.element);
  const viewport = new Viewport(renderer.svg, camera => {
    renderer.scene.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
    renderer.setZoom(camera.scale); toolbar.setZoom(camera.scale);
  });
  const updateHistory = () => toolbar.setHistory(history.canUndo, history.canRedo);
  /** @returns {Snapshot} */
  const snapshot = () => ({ positions: structuredClone(store.positions), camera: viewport.camera });
  function stop() {
    generation++; animation?.abort(); animation = null; runner.cancel();
    toolbar.setBusy(false); renderer.svg.setAttribute('aria-busy', 'false');
    status.textContent = `${store.graph.nodes.length} notes · ${store.graph.edges.length} direct links`;
  }
  function fit() {
    fitOnResize = true;
    if (!Object.keys(store.positions).length) return;
    const boxes = boundsFor(store.graph, store.positions);
    // Curved parallel edges may extend beyond the card bounds.
    const drawing = renderer.scene.getBBox();
    const x = Math.min(boxes.x, drawing.x), y = Math.min(boxes.y, drawing.y);
    const right = Math.max(boxes.x + boxes.width, drawing.x + drawing.width);
    const bottom = Math.max(boxes.y + boxes.height, drawing.y + drawing.height);
    viewport.fit({ x, y, width: right - x, height: bottom - y });
  }
  /** @param {'undo' | 'redo'} direction */
  function restore(direction) {
    stop();
    const next = direction === 'undo' ? history.undo(snapshot()) : history.redo(snapshot());
    if (next) { fitOnResize = false; store.setPositions(next.positions); viewport.restore(next.camera); }
    updateHistory();
  }
  /** @param {boolean} remember */
  async function arrange(remember) {
    stop();
    if (!store.graph.nodes.length || destroyed) return;
    const request = generation;
    const previous = snapshot();
    toolbar.setBusy(true); renderer.svg.setAttribute('aria-busy', 'true');
    status.textContent = `${store.graph.nodes.length} notes · ${store.graph.edges.length} direct links · Arranging…`;
    try {
      // Give the busy indicator a paint before a bounded main-thread calculation.
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (request !== generation || destroyed) return;
      const mode = toolbar.mode.value === 'layered' ? 'layered' : toolbar.mode.value === 'force' ? 'force' : 'smart';
      const result = await runner.run(store.graph, mode);
      if (!result || request !== generation || destroyed) return;
      if (remember && Object.keys(previous.positions).length) history.push(previous);
      animation = new AbortController();
      await tween(store.positions, result.positions, positions => store.setPositions(positions), animation.signal);
      if (request !== generation || destroyed) return;
      fit(); updateHistory();
      status.textContent = `${store.graph.nodes.length} notes · ${store.graph.edges.length} direct links`;
    } catch {
      if (request === generation) status.textContent = 'Unable to arrange this graph. Try Auto Layout again.';
    } finally {
      if (request === generation) { animation = null; toolbar.setBusy(false); renderer.svg.setAttribute('aria-busy', 'false'); }
    }
  }
  store.addEventListener('positions', () => renderer.render(store.positions), { signal: lifetime.signal });
  /** @param {boolean} [force] */
  function refresh(force = false) {
    if (destroyed || !container.open) return;
    const selected = focus.value || null;
    depth.disabled = !selected;
    try {
      const graph = measureNodes(adaptGraph(options.getGraph(selected, Number(depth.value)), selected));
      const nextSignature = JSON.stringify(graph);
      if (!force && signature === nextSignature) return;
      stop(); signature = nextSignature;
      rows.abort(); rows = new AbortController();
      store.setGraph(graph); history.clear(); updateHistory();
      renderer.setGraph(graph); toolbar.setEmpty(!graph.nodes.length);
      graphElement.classList.toggle('connections-empty', !graph.nodes.length);
      renderNoteList(list, graph, options.navigate, rows.signal);
      status.textContent = `${graph.nodes.length} notes · ${graph.edges.length} direct links`;
      if (graph.nodes.length) void arrange(false);
    } catch { status.textContent = 'Unable to load this map. Close Connections and try again.'; }
  }
  bindPointers(renderer.svg, viewport, {
    positions: () => store.positions,
    start: id => { fitOnResize = false; if (Object.keys(store.positions).length) stop(); dragSnapshot = id ? snapshot() : null; },
    move: (id, point) => { store.setPositions({ ...store.positions, [id]: point }); renderer.highlight(id); },
    end: (changed, id) => {
      if (changed && id && dragSnapshot) { history.push(dragSnapshot); updateHistory(); }
      dragSnapshot = null;
    }, activate: options.navigate, highlight: id => renderer.highlight(id), viewChange: () => { fitOnResize = false; }
  }, lifetime.signal);
  bindKeyboard(container, renderer.svg, {
    graph: () => store.graph, positions: () => store.positions,
    focus: id => {
      const node = store.graph.nodes.find(candidate => candidate.id === id), point = store.positions[id];
      if (node && point) viewport.reveal(point, node.width, node.height);
      renderer.focusNode(id);
    }, activate: options.navigate, zoom, fit,
    undo: () => restore('undo'), redo: () => restore('redo'), highlight: id => renderer.highlight(id)
  }, lifetime.signal);
  focus.addEventListener('change', () => refresh(true), { signal: lifetime.signal });
  depth.addEventListener('change', () => refresh(true), { signal: lifetime.signal });
  toolbar.mode.addEventListener('change', () => { void arrange(true); }, { signal: lifetime.signal });
  container.addEventListener('close', () => { stop(); setExpanded(false); }, { signal: lifetime.signal });
  container.addEventListener('cancel', event => {
    if (!expanded) return;
    event.preventDefault(); setExpanded(false); toolbar.fullscreen.focus();
  }, { signal: lifetime.signal });
  const resize = new ResizeObserver(entries => {
    const entry = entries[0];
    if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
    viewport.resize(entry.contentRect.width, entry.contentRect.height);
    if (fitOnResize) fit();
  });
  resize.observe(graphElement);
  return {
    open(selected) {
      populateFocus(focus, options.notes(), selected);
      const rect = graphElement.getBoundingClientRect(); viewport.resize(rect.width, rect.height);
      refresh(true);
    },
    update() {
      if (container.open) { populateFocus(focus, options.notes(), focus.value || null); refresh(); }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; stop(); lifetime.abort(); rows.abort(); resize.disconnect(); viewport.destroy(); renderer.destroy(); toolbar.element.remove();
      container.classList.remove('connections-graph-only');
    }
  };
}
