// @ts-check
/** @typedef {import('../types.js').Camera} Camera */
/** @typedef {import('../types.js').Point} Point */
/** @typedef {import('../types.js').Bounds} Bounds */

export class Viewport {
  /** @type {Camera} */ #camera = { x: 0, y: 0, scale: 1 };
  #width = 1;
  #height = 1;
  #svg;
  #change;
  /** @param {SVGSVGElement} svg @param {(camera: Camera) => void} onChange */
  constructor(svg, onChange) { this.#svg = svg; this.#change = onChange; }
  get camera() { return { ...this.#camera }; }
  /** @param {Camera} camera */
  restore(camera) {
    this.#camera = { ...camera, scale: Math.max(0.08, Math.min(3, camera.scale)) };
    this.#change(this.camera);
  }
  /** @param {number} width @param {number} height */
  resize(width, height) {
    const nextWidth = Math.max(1, width), nextHeight = Math.max(1, height);
    this.#camera.x += (nextWidth - this.#width) / 2;
    this.#camera.y += (nextHeight - this.#height) / 2;
    this.#width = nextWidth; this.#height = nextHeight;
    this.#svg.setAttribute('viewBox', `0 0 ${this.#width} ${this.#height}`);
    this.#change(this.camera);
  }
  /** @param {number} clientX @param {number} clientY @returns {Point} */
  screen(clientX, clientY) {
    const rect = this.#svg.getBoundingClientRect();
    return { x: (clientX - rect.left) * this.#width / (rect.width || 1), y: (clientY - rect.top) * this.#height / (rect.height || 1) };
  }
  /** @param {number} clientX @param {number} clientY @returns {Point} */
  point(clientX, clientY) {
    const screen = this.screen(clientX, clientY);
    return { x: (screen.x - this.#camera.x) / this.#camera.scale, y: (screen.y - this.#camera.y) / this.#camera.scale };
  }
  /** @param {number} factor @param {Point} [anchor] */
  zoom(factor, anchor = { x: this.#width / 2, y: this.#height / 2 }) {
    const scale = Math.max(0.08, Math.min(3, this.#camera.scale * factor));
    const ratio = scale / this.#camera.scale;
    this.restore({ x: anchor.x - (anchor.x - this.#camera.x) * ratio, y: anchor.y - (anchor.y - this.#camera.y) * ratio, scale });
  }
  /** @param {number} dx @param {number} dy */
  pan(dx, dy) { this.restore({ ...this.#camera, x: this.#camera.x + dx, y: this.#camera.y + dy }); }
  /** @param {Bounds} bounds @param {number} [padding] */
  fit(bounds, padding = 32) {
    const scale = Math.max(0.08, Math.min(1, Math.max(1, this.#width - padding * 2) / Math.max(1, bounds.width), Math.max(1, this.#height - padding * 2) / Math.max(1, bounds.height)));
    this.restore({ x: this.#width / 2 - (bounds.x + bounds.width / 2) * scale, y: this.#height / 2 - (bounds.y + bounds.height / 2) * scale, scale });
  }
  /** @param {Point} point @param {number} width @param {number} height */
  reveal(point, width, height) {
    const { x, y, scale } = this.#camera;
    const sx = point.x * scale + x, sy = point.y * scale + y;
    if (sx - width * scale / 2 < 0 || sx + width * scale / 2 > this.#width || sy - height * scale / 2 < 0 || sy + height * scale / 2 > this.#height) {
      this.restore({ scale, x: this.#width / 2 - point.x * scale, y: this.#height / 2 - point.y * scale });
    }
  }
  destroy() { this.#change = () => {}; }
}
