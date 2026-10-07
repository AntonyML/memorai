import { expect, test } from 'bun:test';
import vm from 'node:vm';

const sources = await Promise.all(['dialogs', 'notes'].map(name => Bun.file(new URL(`../js/${name}.js`, import.meta.url)).text()));

function browser() {
  const nodes = [];
  const document = { activeElement: null, getElementById: id => refs[id], querySelector: () => nodes.find(node => node.open) || null };
  function element() {
    const listeners = {};
    const classes = new Set();
    const node = {
      open: false, isConnected: true, disabled: false, hidden: false, returnValue: '', controls: [],
      classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
      addEventListener(name, callback, options) { (listeners[name] ||= []).push({ callback, once: !!options?.once }); },
      emit(name, event = {}) {
        for (const entry of [...listeners[name] || []]) {
          if (entry.once) listeners[name].splice(listeners[name].indexOf(entry), 1);
          entry.callback({ target: node, ...event });
        }
      },
      getClientRects: () => node.hidden ? [] : [{}],
      getBoundingClientRect: () => ({ left: 20, right: 420, top: 20, bottom: 220 }),
      querySelectorAll: () => node.controls,
      contains: target => target === node || node.controls.includes(target),
      appendChild(child) { child.parentNode = node; return child; },
      focus: () => { document.activeElement = node; },
      showModal() { this.open = true; },
      close(value) {
        if (!this.open) return;
        this.open = false;
        if (value !== undefined) this.returnValue = value;
        queueMicrotask(() => this.emit('close'));
      }
    };
    nodes.push(node);
    return node;
  }
  const refs = Object.fromEntries(['confirmationDialog', 'confirmationTitle', 'confirmationMessage', 'confirmationCancel', 'confirmationAccept'].map(id => [id, element()]));
  refs.confirmationDialog.controls = [refs.confirmationCancel, refs.confirmationAccept];
  const opener = element();
  const search = element();
  const toastHome = element();
  const toastContainer = element();
  toastHome.appendChild(toastContainer);
  opener.focus();
  const calls = [];
  const note = id => ({ id, title: id, content: '', tags: [], links: [], updatedAt: 100 });
  const app = {
    dom: { searchInput: search, toastContainer }, state: { notes: [note('ugp'), note('skill'), note('other')], activeNoteId: 'ugp' },
    saveNotes: () => calls.push('save'), renderNotesList: () => calls.push('render'), updateNoteCount: () => calls.push('count'),
    showEmptyEditor: () => { opener.hidden = true; calls.push('clear'); }, toast: (message, type) => calls.push({ message, type })
  };
  app.state.notes[1].links = [{ target: 'ugp', type: 'part-of' }, { target: 'other', type: 'related' }];
  const context = vm.createContext({ window: { App: app }, document, setTimeout });
  sources.forEach(source => vm.runInContext(source, context));
  return { app, refs, opener, search, toastContainer, toastHome, calls, document, element };
}

const afterClose = async () => {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 10));
};

test('delete waits for affirmative confirmation and preserves all post-delete operations', async () => {
  const env = browser();
  const deletion = env.app.deleteNote('ugp');
  expect(env.refs.confirmationDialog.open).toBe(true);
  expect(env.document.activeElement).toBe(env.refs.confirmationCancel);
  expect(env.refs.confirmationTitle.textContent).toBe('Delete note');
  expect(env.refs.confirmationAccept.classList.contains('btn-danger-filled')).toBe(true);
  expect(env.calls).toHaveLength(0);
  expect(env.app.state.notes).toHaveLength(3);
  env.refs.confirmationAccept.emit('click');
  await deletion;
  await afterClose();
  expect(env.app.state.notes.map(note => note.id)).toEqual(['skill', 'other']);
  expect(env.app.state.notes[0].links).toEqual([{ target: 'other', type: 'related' }]);
  expect(env.app.state.notes[0].updatedAt).toBeGreaterThan(100);
  expect(env.app.state.notes[1].updatedAt).toBe(100);
  expect(env.app.state.activeNoteId).toBe(null);
  expect(env.document.activeElement).toBe(env.search);
  expect(env.calls).toEqual(['save', 'clear', 'render', 'count', { message: 'Note deleted', type: 'info' }]);
});

test('Cancel, Escape closure and backdrop closure preserve notes, links and opener focus', async () => {
  for (const reason of ['cancel', 'escape', 'backdrop']) {
    const env = browser();
    const before = JSON.stringify(env.app.state);
    const deletion = env.app.deleteNote('ugp');
    if (reason === 'cancel') env.refs.confirmationCancel.emit('click');
    if (reason === 'escape') env.refs.confirmationDialog.close();
    if (reason === 'backdrop') env.refs.confirmationDialog.emit('click', { clientX: 0, clientY: 0 });
    await deletion;
    await afterClose();
    expect(JSON.stringify(env.app.state)).toBe(before);
    expect(env.calls).toHaveLength(0);
    expect(env.document.activeElement).toBe(env.opener);
  }
});

test('all dialogs share focus trapping, restoration and a single open modal', async () => {
  const env = browser();
  const dialog = env.element();
  const first = env.element();
  const last = env.element();
  const disabled = env.element();
  disabled.disabled = true;
  dialog.controls = [first, disabled, last];
  expect(env.app.openDialog(dialog, first)).toBe(true);
  expect(env.toastContainer.parentNode).toBe(dialog);
  expect(env.app.openDialog(env.element())).toBe(false);
  expect(await env.app.confirmAction({ title: 'Blocked', message: 'Another dialog is open.' })).toBe(false);
  let prevented = 0;
  last.focus();
  dialog.emit('keydown', { key: 'Tab', preventDefault() { prevented++; } });
  expect(env.document.activeElement).toBe(first);
  dialog.emit('keydown', { key: 'Tab', shiftKey: true, preventDefault() { prevented++; } });
  expect(env.document.activeElement).toBe(last);
  expect(prevented).toBe(2);
  dialog.close();
  await afterClose();
  expect(env.document.activeElement).toBe(env.opener);
  expect(env.toastContainer.parentNode).toBe(env.toastHome);
  env.opener.hidden = true;
  expect(env.app.openDialog(dialog, first)).toBe(true);
  dialog.close();
  await afterClose();
  expect(env.document.activeElement).toBe(env.search);
});

test('closing a map preserves focus assigned by navigation to another note', async () => {
  const env = browser();
  const dialog = env.element();
  env.app.openDialog(dialog);
  dialog.close();
  const editor = env.element();
  editor.focus();
  await afterClose();
  expect(env.document.activeElement).toBe(editor);
});

test('duplicate deletion requests and stale IDs cannot delete twice or reopen a pending confirmation', async () => {
  const env = browser();
  const first = env.app.deleteNote('ugp');
  await env.app.deleteNote('ugp');
  expect(env.refs.confirmationDialog.open).toBe(true);
  env.refs.confirmationAccept.emit('click');
  expect(await env.app.confirmAction({ title: 'Too soon', message: 'Do not replace pending result.' })).toBe(false);
  await first;
  expect(env.calls.filter(call => call === 'save')).toHaveLength(1);
  await env.app.deleteNote('ugp');
  expect(env.refs.confirmationDialog.open).toBe(false);
});

test('a note removed by concurrent synchronization while confirming is not deleted again', async () => {
  const env = browser();
  const deletion = env.app.deleteNote('ugp');
  env.app.state.notes = env.app.state.notes.filter(note => note.id !== 'ugp');
  env.refs.confirmationAccept.emit('click');
  await deletion;
  expect(env.calls).toHaveLength(0);
});
