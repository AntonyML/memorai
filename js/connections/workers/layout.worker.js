// @ts-check
import { layoutGraph } from '../layout/index.js';
/** @type {DedicatedWorkerGlobalScope} */
const worker = /** @type {DedicatedWorkerGlobalScope} */ (/** @type {unknown} */ (self));
worker.addEventListener('message', event => {
  /** @type {unknown} */ const input = event.data;
  if (!input || typeof input !== 'object' || !('graph' in input) || !('mode' in input) || !('id' in input)) return;
  // Only our typed controller posts to this private module worker.
  const request = /** @type {{graph: import('../types.js').Graph, mode: import('../types.js').LayoutMode, id: number}} */ (input);
  try { worker.postMessage({ id: request.id, result: layoutGraph(request.graph, request.mode) }); }
  catch { worker.postMessage({ id: request.id, error: 'Unable to arrange this graph.' }); }
});
