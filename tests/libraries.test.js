import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import lodash from 'lodash';
import * as luxon from 'luxon';

const source = readFileSync(new URL('../js/utils.js', import.meta.url), 'utf8');

function utilities({ libs = {}, reducedMotion = false, clipboardFailure = false } = {}) {
  const timers = [];
  function element() {
    const listeners = {};
    return {
      children: [], style: {}, attributes: {}, removed: false,
      appendChild(child) { this.children.push(child); },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { listeners[name] = callback; },
      emit(name, event) { listeners[name]?.(event); },
      remove() { this.removed = true; }
    };
  }
  const app = { libs, state: { settings: { timeFormat: '24h' } }, dom: { toastContainer: element() } };
  vm.runInNewContext(source, {
    window: { App: app, matchMedia: () => ({ matches: reducedMotion }) },
    document: { createElement: element },
    navigator: { clipboard: { writeText: async () => { if (clipboardFailure) throw new Error('Internal clipboard details'); } } },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }
  }, { filename: 'js/utils.js' });
  return { app, timers };
}

test('HTML escaping protects content and quoted attributes with or without Lodash', () => {
  const attack = `<img src=x onerror="alert('x')">&`;
  const escaped = '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;';
  for (const libs of [{ lodash }, {}]) {
    const { app } = utilities({ libs });
    expect(app.escapeHtml(attack)).toBe(escaped);
    expect(app.escapeHtml(null)).toBe('');
    expect(app.escapeHtml(7)).toBe('7');
  }
});

test('toasts announce results and report clipboard failures without internal details', async () => {
  const { app } = utilities({ clipboardFailure: true });
  app.toast('Could not save', 'error');
  const error = app.dom.toastContainer.children[0];
  expect(error.attributes.role).toBe('alert');
  expect(error.children[1].attributes['aria-label']).toBe('Copy error');
  error.children[1].emit('click', { stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  const fallback = app.dom.toastContainer.children[1];
  expect(fallback.attributes.role).toBe('status');
  expect(fallback.children[0].textContent).toContain('Select and copy');
  expect(fallback.children[0].textContent).not.toContain('Internal');
});

test('Luxon preserves the local date and honors both time display settings', () => {
  const date = new Date(2025, 6, 9, 23, 8);
  for (const libs of [{ luxon }, {}]) {
    const { app } = utilities({ libs });
    expect(app.formatDate(date.getTime())).toBe(date.toLocaleDateString(undefined, { month: 'short' }) + ' 9, 2025');
    expect(app.formatTime(date.getTime())).toBe('23:08');
    app.state.settings.timeFormat = '12h';
    expect(app.formatTime(date.getTime())).toBe(date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }));
    expect(app.formatDateTime(date.getTime())).toBe(app.formatDate(date) + ' ' + app.formatTime(date));
  }
});

test('toast animation respects reduced motion and always removes the message', () => {
  for (const reducedMotion of [false, true]) {
    const calls = [];
    let cancellations = 0;
    const anime = { animate(target, options) { calls.push({ target, options }); return { cancel() { cancellations++; } }; } };
    const { app, timers } = utilities({ libs: { anime }, reducedMotion });
    app.toast('Saved', 'success');
    const toast = app.dom.toastContainer.children[0];
    expect(toast.children[0].textContent).toBe('Saved');
    expect(timers[0].delay).toBe(3000);
    timers[0].callback();
    if (reducedMotion) {
      expect(calls).toHaveLength(0);
      expect(toast.removed).toBe(true);
    } else {
      expect(calls).toHaveLength(2);
      expect(calls[0].options.translateY).toEqual([8, 0]);
      timers[1].callback();
      expect(toast.removed).toBe(true);
      expect(cancellations).toBe(2);
    }
  }
});

test('toast fallback retains error copy and expiry even if animation fails', () => {
  for (const libs of [{}, { anime: { animate() { throw new Error('Animation unavailable'); } } }]) {
    const { app, timers } = utilities({ libs });
    app.toast('Failure details', 'error');
    const toast = app.dom.toastContainer.children[0];
    expect(toast.children[1].title).toBe('Copy error');
    expect(timers[0].delay).toBe(8000);
    timers[0].callback();
    expect(toast.style.opacity).toBe('0');
    timers[1].callback();
    expect(toast.removed).toBe(true);
  }
});
