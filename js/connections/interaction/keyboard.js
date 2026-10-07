// @ts-check
import { adjacency } from '../domain/graph.js';
import { nodeId } from './pointer.js';
/** @typedef {{graph: () => import('../types.js').Graph, positions: () => import('../types.js').Positions, focus: (id: string) => void, activate: (id: string) => void, zoom: (factor: number) => void, fit: () => void, undo: () => void, redo: () => void, highlight: (id: string | null) => void}} KeyboardCallbacks */

/** @param {HTMLDialogElement} dialog @param {SVGSVGElement} svg @param {KeyboardCallbacks} callbacks @param {AbortSignal} signal */
export function bindKeyboard(dialog, svg, callbacks, signal) {
  svg.addEventListener('focusin', event => { callbacks.highlight(nodeId(event.target)); }, { signal });
  svg.addEventListener('focusout', event => {
    if (!(event.relatedTarget instanceof Node) || !svg.contains(event.relatedTarget)) callbacks.highlight(null);
  }, { signal });
  dialog.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? callbacks.redo() : callbacks.undo(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault(); callbacks.redo(); return;
    }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); callbacks.zoom(1.2); return; }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); callbacks.zoom(1 / 1.2); return; }
    if (event.key === '0') { event.preventDefault(); callbacks.fit(); return; }
    const graph = callbacks.graph();
    const id = nodeId(event.target) || (event.target === svg ? graph.focus || graph.nodes[0]?.id : null);
    if (!id) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callbacks.activate(id); return; }
    /** @type {Record<string, {x: number, y: number}>} */
    const directions = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const positions = callbacks.positions(), origin = positions[id];
    if (!origin) return;
    const neighbors = adjacency(graph).get(id) || [];
    const candidates = neighbors.filter(next => positions[next]).map(next => {
      const dx = positions[next].x - origin.x, dy = positions[next].y - origin.y;
      const distance = Math.hypot(dx, dy) || 1;
      const dot = (dx * direction.x + dy * direction.y) / distance;
      return { id: next, score: dot * 100000 - distance };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (candidates[0]) callbacks.focus(candidates[0].id);
  }, { signal });
}
