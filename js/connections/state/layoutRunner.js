// @ts-check
import { layoutGraph } from '../layout/index.js';
/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').LayoutResult} LayoutResult */

export class LayoutRunner {
  /** @type {Worker | null} */ #worker = null;
  /** @type {((result: LayoutResult | null) => void) | null} */ #resolve = null;
  /** @param {Graph} graph @param {import('../types.js').LayoutMode} mode @returns {Promise<LayoutResult | null>} */
  run(graph, mode) {
    this.cancel();
    if (graph.nodes.length <= 200 || typeof Worker === 'undefined') return Promise.resolve(layoutGraph(graph, mode));
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/layout.worker.js', import.meta.url), { type: 'module' });
      this.#worker = worker; this.#resolve = resolve;
      const finish = () => { worker.terminate(); this.#worker = null; this.#resolve = null; };
      worker.addEventListener('message', event => {
        /** @type {unknown} */ const data = event.data;
        if (!data || typeof data !== 'object') return;
        if ('result' in data) {
          const result = /** @type {LayoutResult} */ (data.result);
          finish(); resolve(result);
        } else { finish(); reject(new Error('Unable to arrange this graph.')); }
      }, { once: true });
      worker.addEventListener('error', () => { finish(); reject(new Error('Unable to arrange this graph.')); }, { once: true });
      worker.postMessage({ id: 1, graph, mode });
    });
  }
  cancel() {
    this.#worker?.terminate(); this.#worker = null;
    this.#resolve?.(null); this.#resolve = null;
  }
}
