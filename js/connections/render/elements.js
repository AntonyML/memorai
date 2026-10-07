// @ts-check

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @template {keyof SVGElementTagNameMap} T
 * @param {T} tag @param {Record<string, string | number>} [attributes] @param {string} [text]
 * @returns {SVGElementTagNameMap[T]}
 */
export function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}
