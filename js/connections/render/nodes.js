// @ts-check

import { svgElement } from './elements.js';
import { titleLines } from './measure.js';

/** @typedef {import('../types.js').GraphNode} GraphNode */
/** @typedef {{group: SVGGElement, update: (node: GraphNode, focused: boolean) => void}} NodeView */

/** Simple local icons keep type badges recognisable without a font or asset dependency. */
const ICONS = {
  note: 'M3 1H10L13 4V15H3Z M9 1V5H13 M5 8H11 M5 11H10',
  context: 'M1 4H6L8 6H15V14H1Z M1 4V2H6L8 4H15V6',
  project: 'M2 5H14V14H2Z M5 5V2H11V5 M2 9H14 M7 8V10H9V8',
  skill: 'M9 1L3 9H7L6 15L13 6H9Z',
  decision: 'M8 1L15 8L8 15L1 8Z M5 8L7 10L11 6',
  meeting: 'M2 3H14V15H2Z M2 6H14 M5 1V4 M11 1V4 M5 9H7 M9 9H11 M5 12H7',
  reference: 'M8 3C5 1 2 1 1 2V13C3 12 5 12 8 14C11 12 13 12 15 13V2C13 1 11 1 8 3Z M8 3V14'
};

/** @param {GraphNode} node @param {boolean} focused @returns {NodeView} */
export function createNode(node, focused) {
  const group = svgElement('g', { class: 'graph-node', 'data-node-id': node.id, tabindex: '-1', role: 'link' });
  const tooltip = svgElement('title');
  const ring = svgElement('rect', { class: 'graph-node-focus-ring', rx: 16, 'aria-hidden': 'true' });
  const card = svgElement('rect', { class: 'graph-node-card', rx: 12 });
  const accent = svgElement('path', { class: 'graph-node-accent', 'aria-hidden': 'true' });
  const title = svgElement('text', { class: 'graph-node-title', 'aria-hidden': 'true' });
  const badge = svgElement('g', { class: 'graph-node-badge', 'aria-hidden': 'true' });
  const badgeBox = svgElement('rect', { class: 'graph-node-badge-bg', rx: 10 });
  const badgeIcon = svgElement('path', { class: 'graph-node-badge-icon' });
  const kind = svgElement('text', { class: 'graph-node-kind' });
  badge.append(badgeBox, badgeIcon, kind);
  group.append(tooltip, ring, card, accent, title, badge);

  /** @param {GraphNode} value @param {boolean} isFocused */
  function update(value, isFocused) {
    const x = -value.width / 2;
    const y = -value.height / 2;
    group.setAttribute('aria-label', `${value.title || 'Untitled'}, ${value.kind}${isFocused ? ', central note' : ''}. Open note`);
    group.classList.toggle('focused', isFocused);
    group.classList.toggle('context-node', value.kind === 'context');
    tooltip.textContent = `${value.title || 'Untitled'} (${value.kind})`;
    for (const rect of [card, ring]) {
      const padding = rect === ring ? 4 : 0;
      rect.setAttribute('x', String(x - padding));
      rect.setAttribute('y', String(y - padding));
      rect.setAttribute('width', String(value.width + padding * 2));
      rect.setAttribute('height', String(value.height + padding * 2));
    }
    accent.setAttribute('d', `M ${x + 1} ${y + 20} V ${y + value.height - 20}`);
    title.replaceChildren();
    titleLines(value.title, value.width - 36).forEach((line, index) => {
      title.append(svgElement('tspan', { x: x + 18, y: y + 26 + index * 19 }, line));
    });
    const badgeWidth = Math.max(67, value.kind.length * 7 + 34);
    badge.setAttribute('transform', `translate(${x + 16} ${y + 62})`);
    badgeBox.setAttribute('width', String(badgeWidth));
    badgeBox.setAttribute('height', '23');
    badgeIcon.setAttribute('d', ICONS[value.kind]);
    badgeIcon.setAttribute('transform', 'translate(7 4) scale(.85)');
    kind.setAttribute('x', '26');
    kind.setAttribute('y', '16');
    kind.textContent = value.kind;
  }
  update(node, focused);
  return { group, update };
}
