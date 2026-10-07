// @ts-check
import { Viewport } from './viewport.js';
/** @typedef {import('../types.js').Point} Point */
/** @typedef {{positions: () => import('../types.js').Positions, start: (id: string | null) => void, move: (id: string, point: Point) => void, end: (changed: boolean, id: string | null) => void, activate: (id: string) => void, highlight: (id: string | null) => void}} PointerCallbacks */

/** @param {EventTarget | null} target */
export function nodeId(target) {
  return target instanceof Element ? target.closest('[data-node-id]')?.getAttribute('data-node-id') || null : null;
}

/** @param {SVGSVGElement} svg @param {Viewport} viewport @param {PointerCallbacks} callbacks @param {AbortSignal} signal */
export function bindPointers(svg, viewport, callbacks, signal) {
  /** @type {Map<number, Point>} */
  const pointers = new Map();
  /** @type {string | null} */ let dragged = null;
  let changed = false, pinched = false;
  /** @type {Point} */ let origin = { x: 0, y: 0 };
  /** @type {Point} */ let originalPosition = { x: 0, y: 0 };
  /** @type {Point} */ let clientStart = { x: 0, y: 0 };
  let suppressClick = false;
  /** @type {string | null} */ let clickedId = null;
  const options = { signal };
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (!pointers.size) {
      dragged = nodeId(event.target);
      clickedId = null;
      changed = false; pinched = false;
      clientStart = { x: event.clientX, y: event.clientY };
      callbacks.start(dragged);
      origin = viewport.point(event.clientX, event.clientY);
      originalPosition = { ...(dragged && callbacks.positions()[dragged] || origin) };
      const node = event.target instanceof Element ? event.target.closest('[data-node-id]') : null;
      if (node instanceof SVGElement) node.focus({ preventScroll: true });
      else svg.focus({ preventScroll: true });
    }
    pointers.set(event.pointerId, viewport.screen(event.clientX, event.clientY));
    if (pointers.size > 1) pinched = true;
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('is-panning');
  }, options);
  svg.addEventListener('pointermove', event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = viewport.screen(event.clientX, event.clientY);
    if (pointers.size >= 2) {
      const before = [...pointers.values()].slice(0, 2);
      pointers.set(event.pointerId, next);
      const after = [...pointers.values()].slice(0, 2);
      const center = (/** @type {Point[]} */ pair) => ({ x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 });
      const distance = (/** @type {Point[]} */ pair) => Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      const oldCenter = center(before), newCenter = center(after);
      viewport.pan(newCenter.x - oldCenter.x, newCenter.y - oldCenter.y);
      viewport.zoom(distance(after) / Math.max(1, distance(before)), newCenter);
      changed = true;
      return;
    }
    pointers.set(event.pointerId, next);
    if (Math.hypot(event.clientX - clientStart.x, event.clientY - clientStart.y) > 4) changed = true;
    if (!changed) return;
    if (dragged && !pinched) {
      const point = viewport.point(event.clientX, event.clientY);
      callbacks.move(dragged, { x: originalPosition.x + point.x - origin.x, y: originalPosition.y + point.y - origin.y });
    } else viewport.pan(next.x - previous.x, next.y - previous.y);
  }, options);
  /** @param {PointerEvent} event */
  const finish = event => {
    if (!pointers.delete(event.pointerId)) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (pointers.size) return;
    suppressClick = changed || pinched || event.type !== 'pointerup';
    clickedId = suppressClick ? null : dragged;
    svg.classList.remove('is-panning');
    callbacks.end(changed, dragged);
    dragged = null;
  };
  svg.addEventListener('pointerup', finish, options);
  svg.addEventListener('pointercancel', finish, options);
  svg.addEventListener('lostpointercapture', finish, options);
  svg.addEventListener('click', event => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    // Pointer capture retargets a mouse click to the SVG surface.
    const id = nodeId(event.target) || clickedId;
    clickedId = null;
    if (id) callbacks.activate(id);
  }, options);
  svg.addEventListener('pointerover', event => { if (!pointers.size) callbacks.highlight(nodeId(event.target)); }, options);
  svg.addEventListener('pointerleave', () => { if (!pointers.size) callbacks.highlight(null); }, options);
  svg.addEventListener('wheel', event => {
    event.preventDefault();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.getBoundingClientRect().height : 1;
    const delta = Math.max(-120, Math.min(120, event.deltaY * units));
    viewport.zoom(Math.exp(-delta * 0.0025), viewport.screen(event.clientX, event.clientY));
  }, { signal, passive: false });
  signal.addEventListener('abort', () => {
    for (const id of pointers.keys()) if (svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
    pointers.clear();
  }, { once: true });
}
