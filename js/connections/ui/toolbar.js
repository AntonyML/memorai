// @ts-check
/** @typedef {{layout: () => void, zoom: (factor: number) => void, fit: () => void, undo: () => void, redo: () => void}} ToolbarActions */

/** @param {ToolbarActions} actions @param {AbortSignal} signal */
export function createToolbar(actions, signal) {
  const element = document.createElement('div');
  element.className = 'connections-toolbar'; element.setAttribute('role', 'toolbar'); element.setAttribute('aria-label', 'Graph layout and view');
  const label = document.createElement('label'); label.className = 'connections-mode-label'; label.textContent = 'Layout';
  const mode = document.createElement('select'); mode.className = 'connections-tool'; mode.setAttribute('aria-label', 'Layout mode');
  for (const [value, title] of [['smart', 'Smart'], ['layered', 'Layered'], ['force', 'Force']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = title; mode.append(option);
  }
  label.append(mode); element.append(label);
  /** @param {string} title @param {() => void} action @param {string} [text] */
  const button = (title, action, text = title) => {
    const control = document.createElement('button'); control.type = 'button'; control.className = 'connections-tool';
    control.textContent = text; control.title = title; control.setAttribute('aria-label', title);
    control.addEventListener('click', action, { signal }); element.append(control); return control;
  };
  const layout = button('Auto Layout', actions.layout); layout.classList.add('connections-auto-layout');
  const undo = button('Undo', actions.undo), redo = button('Redo', actions.redo);
  const zoomOut = button('Zoom out', () => actions.zoom(1 / 1.2), '−');
  const zoom = document.createElement('output'); zoom.className = 'connections-zoom'; zoom.setAttribute('aria-label', 'Zoom level'); element.append(zoom);
  const zoomIn = button('Zoom in', () => actions.zoom(1.2), '+');
  const fit = button('Fit', actions.fit);
  let busy = false, hasUndo = false, hasRedo = false, empty = false;
  const update = () => {
    layout.disabled = busy || empty; mode.disabled = busy || empty;
    undo.disabled = busy || !hasUndo; redo.disabled = busy || !hasRedo;
    fit.disabled = empty; zoomIn.disabled = empty; zoomOut.disabled = empty;
    layout.textContent = busy ? 'Arranging…' : 'Auto Layout';
  };
  return { element, mode, layout,
    /** @param {boolean} value */ setBusy(value) { busy = value; update(); },
    /** @param {boolean} value */ setEmpty(value) { empty = value; update(); },
    /** @param {boolean} canUndo @param {boolean} canRedo */ setHistory(canUndo, canRedo) { hasUndo = canUndo; hasRedo = canRedo; update(); },
    /** @param {number} scale */ setZoom(scale) { zoom.value = (scale < 0.01 ? (scale * 100).toFixed(1) : Math.round(scale * 100)) + '%'; }
  };
}
