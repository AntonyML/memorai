// @ts-check

import { routeEdges } from '../layout/geometry.js';
import { svgElement } from './elements.js';
import { createNode } from './nodes.js';
import { createEdge, createMarkers } from './edges.js';

/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').Positions} Positions */
/** @typedef {import('../types.js').EdgeRoute} EdgeRoute */
/** @typedef {import('../types.js').Bounds} Bounds */
/** @typedef {import('./nodes.js').NodeView} NodeView */
/** @typedef {import('./edges.js').EdgeView} EdgeView */

let instance = 0;

/** @param {Bounds} a @param {Bounds} b @returns {boolean} */
function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** @param {EventTarget | null} target @param {string} attribute @returns {string | null} */
function targetId(target, attribute) {
  return target instanceof Element ? target.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null : null;
}

/** Keyed SVG views are reused during every drag and animation frame.
 * @param {HTMLElement} container
 * @param {{navigate: (id: string) => void}} _callbacks
 * @param {AbortSignal} signal
 */
export function createRenderer(container, _callbacks, signal) {
  const controller = new AbortController();
  const ownSignal = controller.signal;
  const prefix = `connections-arrow-${++instance}`;
  const svg = svgElement('svg', {
    class: 'knowledge-svg', width: '100%', height: '100%', viewBox: '0 0 960 420',
    tabindex: '0', role: 'group', 'aria-label': 'Connections graph. Arrow keys move between connected notes; Enter opens a note. Plus and minus zoom; zero fits the graph.'
  });
  const scene = svgElement('g', { class: 'graph-scene' });
  const edgeLayer = svgElement('g', { class: 'graph-edges' });
  const labelLayer = svgElement('g', { class: 'graph-labels', 'pointer-events': 'none' });
  const nodeLayer = svgElement('g', { class: 'graph-nodes' });
  const empty = svgElement('text', { class: 'graph-empty-text', x: 24, y: 36 }, 'No notes in this map.');
  scene.append(edgeLayer, labelLayer, nodeLayer);
  svg.append(createMarkers(prefix), scene, empty);
  container.replaceChildren(svg);

  /** @type {Graph} */
  let graph = { nodes: [], edges: [], focus: null };
  /** @type {Positions} */
  let positions = {};
  /** @type {Map<string, NodeView>} */
  const nodes = new Map();
  /** @type {Map<string, EdgeView>} */
  const edges = new Map();
  /** @type {EdgeRoute[]} */
  let routes = [];
  /** @type {string | null} */
  let selectedId = null;
  /** @type {string | null} */
  let hoveredId = null;
  /** @type {string | null} */
  let focusedId = null;
  /** @type {string | null} */
  let hoveredEdge = null;
  let zoom = 1;
  let destroyed = false;

  function updateAppearance() {
    const active = hoveredId ?? focusedId ?? selectedId;
    const neighbors = new Set(active ? [active] : []);
    for (const edge of graph.edges) {
      if (edge.source === active) neighbors.add(edge.target);
      if (edge.target === active) neighbors.add(edge.source);
    }
    for (const [id, view] of nodes) {
      view.group.classList.toggle('is-highlighted', id === active);
      view.group.classList.toggle('is-muted', active !== null && !neighbors.has(id));
      view.group.classList.toggle('is-selected', id === selectedId);
    }
    for (const edge of graph.edges) {
      const view = edges.get(edge.id);
      if (!view) continue;
      const related = active !== null && (edge.source === active || edge.target === active);
      view.group.classList.toggle('is-highlighted', related || edge.id === hoveredEdge);
      view.group.classList.toggle('is-muted', active !== null && !related && edge.id !== hoveredEdge);
    }
    placeLabels();
  }

  function placeLabels() {
    for (const view of edges.values()) view.label.style.display = 'none';
    const active = hoveredId ?? focusedId ?? selectedId;
    /** @type {Bounds[]} */
    const occupied = graph.nodes.flatMap(node => {
      const point = positions[node.id];
      return point ? [{ x: point.x - node.width / 2 - 10, y: point.y - node.height / 2 - 10, width: node.width + 20, height: node.height + 20 }] : [];
    });
    const ordered = routes.slice().sort((a, b) => {
      const isActive = /** @param {EdgeRoute} route */ route => route.edge.id === hoveredEdge || (active !== null && (route.edge.source === active || route.edge.target === active));
      return Number(isActive(b)) - Number(isActive(a)) || a.edge.id.localeCompare(b.edge.id);
    });
    for (const route of ordered) {
      const view = edges.get(route.edge.id);
      if (!view) continue;
      const connected = active !== null && (route.edge.source === active || route.edge.target === active);
      const visible = zoom >= 1.2 || connected || hoveredEdge === route.edge.id;
      const box = { x: route.label.x - view.labelWidth / 2 - 4, y: route.label.y - 17, width: view.labelWidth + 8, height: 34 };
      const clear = visible && !occupied.some(other => overlaps(box, other));
      view.label.style.display = clear ? '' : 'none';
      if (clear) {
        view.label.setAttribute('transform', `translate(${route.label.x} ${route.label.y})`);
        occupied.push(box);
      }
    }
  }

  /** @param {Graph} value */
  function setGraph(value) {
    graph = value;
    const nodeIds = new Set(value.nodes.map(node => node.id));
    const edgeIds = new Set(value.edges.map(edge => edge.id));
    for (const [id, view] of nodes) if (!nodeIds.has(id)) { view.group.remove(); nodes.delete(id); }
    for (const [id, view] of edges) if (!edgeIds.has(id)) { view.group.remove(); view.label.remove(); edges.delete(id); }
    for (const node of value.nodes) {
      let view = nodes.get(node.id);
      if (!view) { view = createNode(node, value.focus === node.id); nodes.set(node.id, view); nodeLayer.append(view.group); }
      else view.update(node, value.focus === node.id);
    }
    for (const edge of value.edges) {
      if (edges.has(edge.id)) continue;
      const view = createEdge(edge, prefix);
      edges.set(edge.id, view);
      edgeLayer.append(view.group);
      labelLayer.append(view.label);
    }
    if (selectedId && !nodeIds.has(selectedId)) selectedId = null;
    if (focusedId && !nodeIds.has(focusedId)) focusedId = null;
    hoveredId = null;
    hoveredEdge = null;
    const tabStop = focusedId ?? value.focus ?? value.nodes[0]?.id;
    for (const [id, view] of nodes) view.group.setAttribute('tabindex', id === tabStop ? '0' : '-1');
    empty.style.display = value.nodes.length ? 'none' : '';
    updateAppearance();
  }

  /** @param {Positions} value */
  function render(value) {
    positions = value;
    for (const [id, view] of nodes) {
      const point = value[id];
      if (point) view.group.setAttribute('transform', `translate(${point.x} ${point.y})`);
      view.group.style.display = point ? '' : 'none';
    }
    routes = routeEdges(graph, value);
    const routedIds = new Set(routes.map(route => route.edge.id));
    for (const [id, view] of edges) view.group.style.display = routedIds.has(id) ? '' : 'none';
    for (const route of routes) edges.get(route.edge.id)?.update(route);
    placeLabels();
  }

  /** @param {string | null} id */
  function highlight(id) { selectedId = id; updateAppearance(); }
  /** @param {number} scale */
  function setZoom(scale) { zoom = scale; placeLabels(); }
  /** @param {string} id */
  function focusNode(id) {
    const view = nodes.get(id);
    if (!view) return;
    for (const [nodeId, item] of nodes) item.group.setAttribute('tabindex', nodeId === id ? '0' : '-1');
    view.group.focus({ preventScroll: true });
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    controller.abort();
    signal.removeEventListener('abort', destroy);
    nodes.clear();
    edges.clear();
    svg.remove();
  }

  svg.addEventListener('pointerover', event => {
    hoveredId = targetId(event.target, 'data-node-id');
    hoveredEdge = targetId(event.target, 'data-edge-id');
    updateAppearance();
  }, { signal: ownSignal });
  svg.addEventListener('pointerout', event => {
    hoveredId = targetId(event.relatedTarget, 'data-node-id');
    hoveredEdge = targetId(event.relatedTarget, 'data-edge-id');
    updateAppearance();
  }, { signal: ownSignal });
  svg.addEventListener('pointerleave', () => { hoveredId = null; hoveredEdge = null; updateAppearance(); }, { signal: ownSignal });
  svg.addEventListener('focusin', event => { focusedId = targetId(event.target, 'data-node-id'); updateAppearance(); }, { signal: ownSignal });
  svg.addEventListener('focusout', event => { focusedId = targetId(event.relatedTarget, 'data-node-id'); updateAppearance(); }, { signal: ownSignal });
  signal.addEventListener('abort', destroy, { once: true });
  if (signal.aborted) destroy();
  return { svg, scene, setGraph, render, highlight, setZoom, focusNode, destroy };
}
