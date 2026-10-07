import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/gestures.js', import.meta.url), 'utf8');
const notesSource = readFileSync(new URL('../js/notes.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const hammerSource = readFileSync(new URL('../node_modules/hammerjs/hammer.js', import.meta.url), 'utf8');

function environment({ hammer = true, touch = false, coarse = false } = {}) {
  const elements = {};
  let document;
  let clock = 1000;
  let selection = { isCollapsed: true };
  let modal = false;
  function element(id = '', tagName = 'DIV', parent = null) {
    const classes = new Set();
    const listeners = {};
    const attributes = {};
    const node = {
      id, tagName, nodeType: 1, parentNode: parent, parentElement: parent,
      style: { touchAction: '', userSelect: 'text' }, ownerDocument: document,
      hidden: false, disabled: false, value: '', textContent: '',
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { force ? classes.add(name) : classes.delete(name); }
      },
      setAttribute(name, value) { attributes[name] = value; },
      getAttribute(name) { return attributes[name]; },
      addEventListener(name, listener) { (listeners[name] ||= new Set()).add(listener); },
      removeEventListener(name, listener) { listeners[name]?.delete(listener); },
      dispatchEvent(event) {
        event.target ||= node;
        [...(listeners[event.type] || [])].forEach(listener => listener(event));
      },
      listenerCount(name) { return listeners[name]?.size || 0; },
      closest() {
        const blockedTags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'LABEL', 'FORM', 'PRE', 'CODE', 'TABLE', 'SUMMARY'];
        for (let current = node; current; current = current.parentElement) {
          if (blockedTags.includes(current.tagName) || current.blocked) return current;
        }
        return null;
      }
    };
    if (id) elements[id] = node;
    return node;
  }
  const browser = {
    navigator: { userAgent: 'Test', maxTouchPoints: touch ? 5 : 0 },
    matchMedia: () => ({ matches: coarse }),
    getSelection: () => selection,
    CSS: { supports: () => true }
  };
  document = {
    defaultView: browser,
    createElement: () => element(),
    getElementById: id => elements[id] || null,
    querySelector: selector => selector.includes('.modal-overlay') ? (modal ? {} : null) : null
  };
  const preview = element('notePreview');
  ['noteNavigation', 'notePreviousBtn', 'noteNextBtn', 'noteNavigationHint'].forEach(id => element(id));
  const searchInput = element('searchInput', 'INPUT');
  const app = {
    dom: { notePreview: preview, searchInput },
    libs: {},
    state: {
      notes: [
        { id: 'z', title: 'Zebra', content: 'selected', tags: [], pinned: false, createdAt: 1, updatedAt: 4 },
        { id: 'a', title: 'Alpha', content: 'selected', tags: [], pinned: false, createdAt: 4, updatedAt: 1 },
        { id: 'b', title: 'Beta', content: 'other', tags: ['selected'], pinned: true, createdAt: 2, updatedAt: 2 },
        { id: 'x', title: 'Excluded', content: 'other', tags: [], pinned: false, createdAt: 3, updatedAt: 3 }
      ],
      settings: { sortBy: 'title' }, activeNoteId: 'a', isPreview: true
    }
  };
  browser.App = app;
  class Clock extends Date { static now() { return clock; } }
  const context = vm.createContext({ window: browser, document, navigator: browser.navigator, Date: Clock, setTimeout, clearTimeout });
  const managers = [];
  if (hammer) {
    vm.runInContext(hammerSource, context, { filename: 'hammer.js' });
    const Hammer = browser.Hammer;
    const RealManager = Hammer.Manager;
    Hammer.Manager = function (...args) {
      const manager = new RealManager(...args);
      managers.push(manager);
      return manager;
    };
    app.libs.Hammer = Hammer;
  }
  vm.runInContext(notesSource, context, { filename: 'js/notes.js' });
  vm.runInContext(uiSource, context, { filename: 'js/ui.js' });
  const opened = [];
  app.openNote = id => { opened.push(id); app.state.activeNoteId = id; };
  vm.runInContext(source, context, { filename: 'js/gestures.js' });
  function swipe({ dx = -120, dy = 0, duration = 100, target = preview, pointerType = 'touch' } = {}) {
    if (pointerType !== 'touch') {
      preview.dispatchEvent({ type: 'mousedown', target, clientX: 200, clientY: 200 });
      preview.dispatchEvent({ type: 'mouseup', target, clientX: 200 + dx, clientY: 200 + dy });
      return;
    }
    const start = { identifier: 1, clientX: 200, clientY: 200, target };
    preview.dispatchEvent({ type: 'touchstart', target, touches: [start], changedTouches: [start], preventDefault() { throw new Error('Gestures must preserve native scrolling'); } });
    clock += duration;
    const end = { ...start, clientX: 200 + dx, clientY: 200 + dy };
    preview.dispatchEvent({ type: 'touchend', target, touches: [], changedTouches: [end], preventDefault() { throw new Error('Gestures must preserve native scrolling'); } });
  }
  return {
    app, preview, elements, opened, managers, swipe, element,
    selection(value) { selection = value; }, modal(value) { modal = value; }
  };
}

test('Hammer recognizes touch swipes through the same filtered and sorted notebook as the list', () => {
  const ui = environment();
  ui.app.dom.searchInput.value = 'selected';
  ui.app.initGestures();
  // Pinned Beta, then Alpha and Zebra; Excluded is outside the search.
  expect(ui.app.getFilteredNotes().map(note => note.id)).toEqual(['b', 'a', 'z']);
  expect(ui.elements.noteNavigationHint.textContent).toContain('Note 2 of 3');
  ui.swipe();
  expect(ui.opened).toEqual(['z']);
  expect(ui.elements.noteNextBtn.disabled).toBe(true);
  ui.swipe();
  expect(ui.opened).toEqual(['z']);
  ui.swipe({ dx: 120 });
  ui.swipe({ dx: 120 });
  expect(ui.opened).toEqual(['z', 'a', 'b']);
  expect(ui.elements.notePreviousBtn.disabled).toBe(true);
  ui.swipe({ dx: 120 });
  expect(ui.opened).toEqual(['z', 'a', 'b']);
});

test('short, slow, diagonal, mouse and vertical movements retain the current note', () => {
  const ui = environment();
  ui.app.initGestures();
  ui.swipe({ dx: -20 });
  ui.swipe({ duration: 1500 });
  ui.swipe({ dx: -100, dy: 80 });
  ui.swipe({ dx: 0, dy: 140 });
  ui.swipe({ pointerType: 'mouse' });
  expect(ui.opened).toEqual([]);
  const manager = ui.managers[0];
  // Even a manually emitted mouse recognition cannot bypass the touch guard.
  manager.emit('hammer.input', { isFirst: true, pointerType: 'mouse', pointers: [{}], target: ui.preview });
  manager.emit('swipeleft', { pointerType: 'mouse', deltaX: -140, deltaY: 0, target: ui.preview });
  expect(ui.opened).toEqual([]);
});

test('editing, modal dialogs, selected text and interactive or horizontally scrollable content ignore swipes', () => {
  const ui = environment();
  ui.app.initGestures();
  ui.app.state.isPreview = false;
  ui.swipe();
  ui.app.state.isPreview = true;
  ui.modal(true);
  ui.swipe();
  ui.modal(false);
  ui.selection({ isCollapsed: false });
  ui.swipe();
  ui.selection({ isCollapsed: true });
  for (const tagName of ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'FORM', 'PRE', 'CODE', 'TABLE']) {
    const control = ui.element('', tagName, ui.preview);
    const child = ui.element('', 'SPAN', control);
    ui.swipe({ target: child });
  }
  const editable = ui.element('', 'DIV', ui.preview);
  editable.blocked = true;
  ui.swipe({ target: editable });
  expect(ui.opened).toEqual([]);
  ui.swipe();
  expect(ui.opened).toEqual(['x']);
});

test('a swipe keeps the origin guard when the ending target or active note changes', () => {
  const ui = environment();
  ui.app.initGestures();
  const manager = ui.managers[0];
  const link = ui.element('', 'A', ui.preview);
  const start = target => manager.emit('hammer.input', { isFirst: true, pointerType: 'touch', pointers: [{}], target });
  const end = () => manager.emit('swipeleft', { pointerType: 'touch', deltaX: -150, deltaY: 0, target: ui.preview });
  start(link);
  end();
  start(ui.preview);
  ui.app.state.activeNoteId = 'x';
  end();
  start(ui.preview);
  manager.emit('hammer.input', { isFirst: false, pointerType: 'touch', pointers: [{}, {}], target: ui.preview });
  end();
  expect(ui.opened).toEqual([]);
});

test('accessible buttons work without Hammer and react to search, bounds and preview state', () => {
  const ui = environment({ hammer: false });
  ui.app.dom.searchInput.value = 'selected';
  ui.app.initGestures();
  expect(ui.elements.noteNavigation.hidden).toBe(false);
  expect(ui.elements.noteNavigationHint.textContent).toBe('Note 2 of 3');
  expect(ui.elements.noteNextBtn.getAttribute('aria-label')).toBe('Next note: Zebra');
  ui.elements.noteNextBtn.dispatchEvent({ type: 'click' });
  ui.elements.noteNextBtn.dispatchEvent({ type: 'click' });
  expect(ui.opened).toEqual(['z']);
  ui.app.state.settings.sortBy = 'created';
  ui.app.refreshNoteNavigation();
  expect(ui.elements.noteNextBtn.disabled).toBe(true);
  ui.app.dom.searchInput.value = 'missing';
  ui.app.refreshNoteNavigation();
  expect(ui.elements.noteNavigationHint.textContent).toBe('Current note is outside this search.');
  expect(ui.elements.notePreviousBtn.disabled).toBe(true);
  expect(ui.elements.noteNextBtn.disabled).toBe(true);
  ui.elements.notePreviousBtn.dispatchEvent({ type: 'click' });
  expect(ui.opened).toEqual(['z']);
  ui.app.state.isPreview = false;
  ui.app.refreshNoteNavigation();
  expect(ui.elements.noteNavigation.hidden).toBe(true);
  expect(ui.app.navigatePreviewNote(1)).toBe(false);
  ui.app.state.isPreview = true;
  ui.app.state.activeNoteId = null;
  ui.app.refreshNoteNavigation();
  expect(ui.elements.noteNavigation.hidden).toBe(true);
});

test('Hammer configuration preserves native scroll and text selection; reinitialization removes old listeners', () => {
  const ui = environment();
  const destroy = ui.app.initGestures();
  const manager = ui.managers[0];
  const Hammer = ui.app.libs.Hammer;
  expect(manager.options.inputClass).toBe(Hammer.TouchInput);
  expect(manager.options.touchAction).toBe('auto');
  expect(Object.keys(manager.options.cssProps)).toHaveLength(0);
  expect(manager.get('swipe').options.direction).toBe(Hammer.DIRECTION_HORIZONTAL);
  expect(manager.get('swipe').options.threshold).toBe(48);
  expect(manager.get('swipe').options.velocity).toBe(0.3);
  expect(ui.preview.style.userSelect).toBe('text');
  expect(ui.preview.listenerCount('mousedown')).toBe(0);
  expect(ui.preview.listenerCount('touchstart')).toBe(1);
  ui.app.initGestures();
  expect(manager.element).toBe(null);
  expect(ui.preview.listenerCount('touchstart')).toBe(1);
  expect(ui.elements.noteNextBtn.listenerCount('click')).toBe(1);
  destroy();
  expect(ui.preview.listenerCount('touchstart')).toBe(0);
  expect(ui.elements.noteNextBtn.listenerCount('click')).toBe(0);
  expect(ui.preview.style.touchAction).toBe('');
  expect(ui.elements.noteNavigation.hidden).toBe(true);
  ui.elements.noteNextBtn.dispatchEvent({ type: 'click' });
  expect(ui.opened).toEqual([]);
});

test('the swipe hint appears for touch devices and coarse pointers, while desktop shows only note position', () => {
  for (const options of [{}, { touch: true }, { coarse: true }, { hammer: false, touch: true }]) {
    const ui = environment(options);
    ui.app.initGestures();
    expect(ui.elements.noteNavigationHint.textContent.includes('Swipe')).toBe(!!(options.hammer !== false && (options.touch || options.coarse)));
    expect(ui.elements.noteNavigationHint.textContent).toContain('Note 2 of 4');
  }
});
