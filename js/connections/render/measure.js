// @ts-check

/** @typedef {import('../types.js').Graph} Graph */

export const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const TITLE_SIZE = 14;
export const NODE_HEIGHT = 96;
const TITLE_FONT = `600 ${TITLE_SIZE}px ${SYSTEM_FONT}`;
/** @type {CanvasRenderingContext2D | null} */
let context = null;

/** @returns {CanvasRenderingContext2D | null} */
function textContext() {
  if (!context && typeof document !== 'undefined') context = document.createElement('canvas').getContext('2d');
  if (context) context.font = TITLE_FONT;
  return context;
}

/** @param {string} text @returns {number} */
export function textWidth(text) {
  return textContext()?.measureText(text).width ?? Array.from(text).length * TITLE_SIZE * 0.55;
}

/** @param {string} text @param {number} maxWidth @returns {string} */
function ellipsis(text, maxWidth) {
  if (textWidth(text) <= maxWidth) return text;
  const letters = Array.from(text);
  while (letters.length && textWidth(`${letters.join('')}…`) > maxWidth) letters.pop();
  return `${letters.join('')}…`;
}

/** Wrap at word boundaries where possible and truncate only the second line.
 * @param {string} title @param {number} maxWidth @returns {string[]}
 */
export function titleLines(title, maxWidth) {
  const text = (title || 'Untitled').replace(/\s+/gu, ' ').trim();
  if (textWidth(text) <= maxWidth) return [text];
  const letters = Array.from(text);
  let firstLength = 0;
  while (firstLength < letters.length && textWidth(letters.slice(0, firstLength + 1).join('')) <= maxWidth) firstLength++;
  const fitted = letters.slice(0, firstLength).join('');
  const lastSpace = fitted.lastIndexOf(' ');
  if (lastSpace > fitted.length * 0.4) firstLength = Array.from(fitted.slice(0, lastSpace)).length;
  const first = letters.slice(0, firstLength).join('').trim();
  const rest = letters.slice(firstLength).join('').trim();
  return [first, ellipsis(rest, maxWidth)];
}

/** Text measurement is performed once before the pure layout functions.
 * @param {Graph} graph @returns {Graph}
 */
export function measureNodes(graph) {
  return {
    ...graph,
    nodes: graph.nodes.map(node => ({
      ...node,
      width: Math.min(256, Math.max(204, Math.ceil(textWidth(node.title || 'Untitled') * 0.57 + 36))),
      height: NODE_HEIGHT
    }))
  };
}
