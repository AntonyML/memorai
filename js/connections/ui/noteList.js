// @ts-check
import { adjacency, pathsFrom } from '../domain/graph.js';
/** @param {HTMLElement} container @param {import('../types.js').Graph} graph @param {(id: string) => void} navigate @param {AbortSignal} signal */
export function renderNoteList(container, graph, navigate, signal) {
  container.replaceChildren();
  /** @type {Map<string, string[]>} */
  const paths = graph.focus ? pathsFrom(graph.focus, adjacency(graph)) : new Map();
  const lookup = new Map(graph.nodes.map(node => [node.id, node]));
  for (const node of graph.nodes) {
    const row = document.createElement('div'); row.className = 'graph-note-row';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-text graph-note-button'; button.textContent = node.title;
    button.addEventListener('click', () => navigate(node.id), { signal });
    const path = paths.get(node.id);
    let description = String(node.kind);
    if (path && path.length > 2) description = 'Indirect · via ' + path.slice(1, -1).map((/** @type {string} */ id) => lookup.get(id)?.title || 'Untitled').join(' → ');
    else if (node.id === graph.focus) description = 'Selected note · ' + description;
    else if (graph.focus) description = 'Direct connection · ' + description;
    const detail = document.createElement('span'); detail.className = 'graph-path'; detail.textContent = description;
    row.append(button, detail); container.append(row);
  }
}
