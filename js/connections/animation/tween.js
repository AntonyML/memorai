// @ts-check
/** @typedef {import('../types.js').Positions} Positions */

/** @param {Positions} from @param {Positions} to @param {(positions: Positions) => void} render
 * @param {AbortSignal} signal @returns {Promise<void>}
 */
export function tween(from, to, render, signal) {
  if (signal.aborted) return Promise.resolve();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !Object.keys(from).length) {
    render(structuredClone(to));
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const start = performance.now();
    let frame = 0;
    const finish = () => { cancelAnimationFrame(frame); signal.removeEventListener('abort', finish); resolve(); };
    signal.addEventListener('abort', finish, { once: true });
    /** @param {number} now */
    const tick = now => {
      if (signal.aborted) { finish(); return; }
      const progress = Math.min(1, (now - start) / 420);
      const eased = 1 - (1 - progress) ** 3;
      /** @type {Positions} */
      const positions = Object.create(null);
      for (const [id, end] of Object.entries(to)) {
        const begin = from[id] || end;
        positions[id] = { x: begin.x + (end.x - begin.x) * eased, y: begin.y + (end.y - begin.y) * eased };
      }
      render(positions);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else { render(structuredClone(to)); finish(); }
    };
    frame = requestAnimationFrame(tick);
  });
}
