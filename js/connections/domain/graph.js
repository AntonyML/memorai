// @ts-check
/** @typedef {import('../types.js').Graph} Graph */

/** @param {Graph} graph */
export function adjacency(graph) {
  const result = new Map(graph.nodes.map(node => [node.id, new Set(/** @type {string[]} */ ([]))]));
  for (const edge of graph.edges) {
    result.get(edge.source)?.add(edge.target);
    result.get(edge.target)?.add(edge.source);
  }
  return new Map([...result].map(([id, neighbors]) => [id, [...neighbors].sort()]));
}

/** @param {string} root @param {Map<string, string[]>} neighbors */
export function pathsFrom(root, neighbors) {
  const paths = new Map([[root, [root]]]);
  const queue = [root];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of neighbors.get(id) || []) {
      if (paths.has(next)) continue;
      paths.set(next, [...(paths.get(id) || []), next]);
      queue.push(next);
    }
  }
  return paths;
}
