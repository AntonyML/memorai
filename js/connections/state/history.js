// @ts-check
/** @typedef {import('../types.js').Snapshot} Snapshot */

export class HistoryManager {
  /** @type {Snapshot[]} */ #past = [];
  /** @type {Snapshot[]} */ #future = [];
  get canUndo() { return this.#past.length > 0; }
  get canRedo() { return this.#future.length > 0; }
  /** @param {Snapshot} snapshot */
  push(snapshot) {
    this.#past.push(structuredClone(snapshot));
    if (this.#past.length > 50) this.#past.shift();
    this.#future = [];
  }
  /** @param {Snapshot} current @returns {Snapshot | null} */
  undo(current) {
    const previous = this.#past.pop();
    if (!previous) return null;
    this.#future.push(structuredClone(current));
    return structuredClone(previous);
  }
  /** @param {Snapshot} current @returns {Snapshot | null} */
  redo(current) {
    const next = this.#future.pop();
    if (!next) return null;
    this.#past.push(structuredClone(current));
    return structuredClone(next);
  }
  clear() { this.#past = []; this.#future = []; }
}
