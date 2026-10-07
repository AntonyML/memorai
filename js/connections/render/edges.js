// @ts-check

import { svgElement } from './elements.js';

/** @typedef {import('../types.js').GraphEdge} GraphEdge */
/** @typedef {import('../types.js').LinkType} LinkType */
/** @typedef {import('../types.js').EdgeRoute} EdgeRoute */
/** @typedef {{group: SVGGElement, label: SVGGElement, labelWidth: number, update: (route: EdgeRoute) => void}} EdgeView */

const LABELS = { 'part-of': 'Part of', related: 'Related to', 'depends-on': 'Depends on' };
const TYPES = /** @type {const} */ (['part-of', 'related', 'depends-on']);

/** @param {string} prefix @returns {SVGDefsElement} */
export function createMarkers(prefix) {
  const defs = svgElement('defs');
  for (const type of TYPES) {
    const marker = svgElement('marker', {
      id: `${prefix}-${type}`, viewBox: '0 0 10 10', refX: 10, refY: 5,
      markerWidth: 10, markerHeight: 10, markerUnits: 'userSpaceOnUse', orient: 'auto'
    });
    const shapes = {
      'part-of': 'M0 0L10 5L0 10Z',
      related: 'M1 1L9 5L1 9',
      'depends-on': 'M0 5L5 1L10 5L5 9Z'
    };
    marker.append(svgElement('path', { class: `graph-arrow ${type}`, d: shapes[type] }));
    defs.append(marker);
  }
  return defs;
}

/** @param {GraphEdge} edge @param {string} markerPrefix @returns {EdgeView} */
export function createEdge(edge, markerPrefix) {
  const group = svgElement('g', { class: `graph-connection ${edge.type}`, 'data-edge-id': edge.id });
  const tooltip = svgElement('title', {}, LABELS[edge.type]);
  const hit = svgElement('path', { class: 'graph-edge-hit', 'aria-hidden': 'true' });
  const path = svgElement('path', { class: `graph-edge ${edge.type}`, 'marker-end': `url(#${markerPrefix}-${edge.type})` });
  const start = svgElement('circle', { class: `graph-port ${edge.type}`, r: 3.5 });
  const end = svgElement('circle', { class: `graph-port ${edge.type}`, r: 3.5 });
  const startHit = svgElement('circle', { class: 'graph-port-hit', r: 10, 'aria-hidden': 'true' });
  const endHit = svgElement('circle', { class: 'graph-port-hit', r: 10, 'aria-hidden': 'true' });
  group.append(tooltip, hit, path, start, end, startHit, endHit);
  const label = svgElement('g', { class: `graph-edge-pill ${edge.type}`, 'aria-hidden': 'true' });
  const labelWidth = Math.ceil(LABELS[edge.type].length * 7.2 + 20);
  const background = svgElement('rect', { class: 'graph-edge-label-bg', x: -labelWidth / 2, y: -13, width: labelWidth, height: 26, rx: 13 });
  const text = svgElement('text', { class: 'graph-edge-label', 'text-anchor': 'middle', y: 4.5 }, LABELS[edge.type]);
  label.append(background, text);

  /** @param {EdgeRoute} route */
  function update(route) {
    path.setAttribute('d', route.path);
    hit.setAttribute('d', route.path);
    for (const item of [start, startHit]) { item.setAttribute('cx', String(route.start.x)); item.setAttribute('cy', String(route.start.y)); }
    for (const item of [end, endHit]) { item.setAttribute('cx', String(route.end.x)); item.setAttribute('cy', String(route.end.y)); }
  }
  return { group, label, labelWidth, update };
}
