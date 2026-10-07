// @ts-check
/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').Positions} Positions */

export class Store extends EventTarget {
  /** @type {Graph} */ #graph = { nodes: [], edges: [], focus: null };
  /** @type {Positions} */ #positions = {};
  get graph() { return this.#graph; }
  get positions() { return this.#positions; }
  /** @param {Graph} graph */
  setGraph(graph) { this.#graph = graph; this.#positions = {}; this.dispatchEvent(new Event('graph')); }
  /** @param {Positions} positions */
  setPositions(positions) { this.#positions = positions; this.dispatchEvent(new Event('positions')); }
}
