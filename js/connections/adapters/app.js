// @ts-check
/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').NoteKind} NoteKind */
/** @typedef {import('../types.js').LinkType} LinkType */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** @param {unknown} kind @returns {NoteKind} */
function noteKind(kind) {
  switch (kind) {
    case 'context': case 'project': case 'skill': case 'decision': case 'meeting': case 'reference': return kind;
    default: return 'note';
  }
}
/** @param {unknown} type @returns {type is LinkType} */
function linkType(type) { return type === 'part-of' || type === 'related' || type === 'depends-on'; }

/** The legacy knowledge API remains the authority for filtering and links.
 * @param {unknown} input @param {string | null} focus @returns {Graph}
 */
export function adaptGraph(input, focus) {
  if (!record(input) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) throw new Error('Invalid graph');
  /** @type {Graph['nodes']} */
  const nodes = [];
  const ids = new Set();
  for (const node of input.nodes) {
    if (!record(node) || typeof node.id !== 'string' || ids.has(node.id)) continue;
    ids.add(node.id);
    nodes.push({ id: node.id, title: typeof node.title === 'string' && node.title ? node.title : 'Untitled', kind: noteKind(node.kind), width: 232, height: 96 });
  }
  nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  /** @type {Graph['edges']} */
  const edges = [];
  for (const edge of input.edges) {
    if (!record(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string' || !linkType(edge.type)) continue;
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    edges.push({ id: '', source: edge.source, target: edge.target, type: edge.type, explicit: edge.explicit === true });
  }
  edges.sort((a, b) => {
    const first = JSON.stringify([a.source, a.target, a.type, a.explicit]);
    const second = JSON.stringify([b.source, b.target, b.type, b.explicit]);
    return first < second ? -1 : first > second ? 1 : 0;
  });
  edges.forEach((edge, index) => { edge.id = 'edge-' + index; });
  return { nodes, edges, focus: focus && ids.has(focus) ? focus : null };
}
