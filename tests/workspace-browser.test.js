import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sources = ['knowledge', 'storage', 'notes', 'ui', 'workspace'].map(name => ({
  name,
  code: readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8')
}));
const clone = value => JSON.parse(JSON.stringify(value));
const timestamp = 1700000000000;
const note = (id, updates = {}) => ({ id, title: id, content: `Content of ${id}`, tags: [], kind: 'note', links: [], pinned: false, createdAt: timestamp, updatedAt: timestamp, ...updates });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(body) });

// The real browser IIFEs run against a revisioned server double. Timers are
// driven explicitly so races at the GET/PUT boundary stay reproducible.
function browser({ local = [], remote = [], storage = new Map(), origin = 'http://localhost:8080' } = {}) {
  const timeouts = new Map();
  const intervals = new Map();
  const listeners = new Map();
  const requests = [];
  const toasts = [];
  const workspaceStatus = { textContent: '' };
  let nextTimer = 1;
  let snapshot = { version: 1, revision: remote.length ? 1 : 0, notes: clone(remote) };
  let offline = false;
  let getHook;
  let putHook;
  const app = {
    STORE_NOTES: 'memorai_notes',
    state: { notes: clone(local), activeNoteId: null, currentTags: [], saveTimeout: null, settings: { sortBy: 'updated' }, isPreview: false },
    dom: { noteTitle: { value: '' }, noteContent: { value: '' } },
    toast: (message, type) => toasts.push({ message, type })
  };
  const context = vm.createContext({
    window: { App: app, addEventListener: (name, callback) => listeners.set(name, callback) },
    location: { origin, hostname: new URL(origin).hostname },
    document: { hidden: false, getElementById: id => id === 'workspaceStatus' ? workspaceStatus : null },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    confirm: () => true,
    AbortSignal,
    setTimeout: (callback, delay) => { const id = nextTimer++; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout: id => timeouts.delete(id),
    setInterval: (callback, delay) => { const id = nextTimer++; intervals.set(id, { callback, delay }); return id; },
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ url, method, body });
      if (offline) throw new Error('Connection unavailable');
      if (method === 'GET') return getHook ? getHook() : reply(200, snapshot);
      if (putHook) {
        const result = await putHook(body);
        if (result) return result;
      }
      if (body.revision !== snapshot.revision) return reply(409, { snapshot });
      snapshot = { version: 1, revision: snapshot.revision + 1, notes: clone(body.notes) };
      return reply(200, snapshot);
    }
  });
  for (const source of sources) {
    vm.runInContext(source.code, context, { filename: `js/${source.name}.js` });
    if (source.name === 'ui') {
      // Keep actual editor saving and note/storage hooks; rendering is outside
      // this test's scope and requires a real DOM.
      for (const name of ['renderNotesList', 'updateNoteCount', 'renderTagChips', 'updateFooterMeta', 'updatePinButton', 'routeFromHash', 'renderConnections']) app[name] = () => {};
      app.showEmptyEditor = () => { app.state.activeNoteId = null; };
    }
  }
  async function settle() {
    // Let fetch/json continuations complete without waiting on captured timers.
    for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve));
  }
  return {
    app, storage, requests, toasts, workspaceStatus, intervals,
    remote: () => clone(snapshot),
    replaceRemote: notes => { snapshot = { version: 1, revision: snapshot.revision + 1, notes: clone(notes) }; },
    disconnect: value => { offline = value; },
    onGet: hook => { getHook = hook; },
    onPut: hook => { putHook = hook; },
    cached: () => JSON.parse(storage.get(app.STORE_NOTES)),
    async save() {
      const timer = [...timeouts.entries()].find(([, value]) => value.delay === 250);
      if (!timer) throw new Error('No browser workspace save was scheduled');
      timeouts.delete(timer[0]);
      timer[1].callback();
      await settle();
    },
    async poll() {
      const callback = [...intervals.values()].find(value => value.delay === 2000)?.callback;
      if (!callback) throw new Error('Workspace polling is not running');
      callback();
      await settle();
    },
    settle
  };
}

test('initial browser migration retains local and existing agent notes', async () => {
  const local = note('browser', { tags: ['ugp'], kind: 'meeting' });
  const agent = note('agent', { tags: ['femucaribe'], kind: 'context' });
  const env = browser({ local: [local], remote: [agent] });
  await env.app.initWorkspace();
  expect(env.remote().notes).toEqual(expect.arrayContaining([local, agent]));
  expect(env.app.state.notes).toHaveLength(2);
  expect(env.cached()).toEqual(env.remote().notes);
  expect(env.workspaceStatus.textContent).toContain('connected');
});

test('polling does not rewrite an unchanged editor or rebuild an unchanged view', async () => {
  const active = note('active');
  const env = browser({ local: [active], remote: [active] });
  await env.app.initWorkspace();
  env.app.startWorkspacePolling();
  env.app.state.activeNoteId = active.id;
  let titleWrites = 0;
  let contentWrites = 0;
  let renders = 0;
  Object.defineProperty(env.app.dom.noteTitle, 'value', { get: () => active.title, set: () => { titleWrites++; } });
  Object.defineProperty(env.app.dom.noteContent, 'value', { get: () => active.content, set: () => { contentWrites++; } });
  env.app.renderNotesList = () => { renders++; };
  await env.poll();
  expect(renders).toBe(0);
  env.replaceRemote([active, note('agent')]);
  await env.poll();
  expect(renders).toBe(1);
  expect(titleWrites).toBe(0);
  expect(contentWrites).toBe(0);
});

test('editor typing during an in-flight PUT survives the response and next poll', async () => {
  const base = note('active');
  const env = browser({ local: [base], remote: [base] });
  await env.app.initWorkspace();
  env.app.startWorkspacePolling();
  env.app.state.activeNoteId = base.id;
  env.app.dom.noteTitle.value = base.title;
  env.app.dom.noteContent.value = 'First edit';
  env.app.doAutoSave();
  const entered = deferred();
  const resume = deferred();
  env.onPut(async () => { entered.resolve(); await resume.promise; env.onPut(undefined); });
  await env.save();
  await entered.promise;
  env.app.dom.noteContent.value = 'A later edit while the request is pending';
  env.app.scheduleSave();
  resume.resolve();
  await env.settle();
  expect(env.app.state.notes[0].content).toBe('A later edit while the request is pending');
  expect(env.cached()[0].content).toBe('A later edit while the request is pending');
  expect(env.remote().notes[0].content).toBe('First edit');
  await env.poll();
  expect(env.remote().notes[0].content).toBe('A later edit while the request is pending');
});

test('revision conflicts retry against the agent snapshot without dropping either writer', async () => {
  const base = note('base');
  const env = browser({ local: [base], remote: [base] });
  await env.app.initWorkspace();
  env.app.updateNote(base.id, { content: 'Browser update' });
  env.onPut(() => {
    env.onPut(undefined);
    env.replaceRemote([base, note('agent-created', { kind: 'decision' })]);
    return reply(409, { snapshot: env.remote() });
  });
  await env.save();
  expect(env.remote().notes.find(item => item.id === 'base').content).toBe('Browser update');
  expect(env.remote().notes.find(item => item.id === 'agent-created').kind).toBe('decision');
  expect(env.requests.filter(request => request.method === 'PUT')).toHaveLength(2);
});

test('concurrent edits of one note preserve both contents as distinct notes', async () => {
  const base = note('shared');
  const env = browser({ local: [base], remote: [base] });
  await env.app.initWorkspace();
  env.app.startWorkspacePolling();
  env.app.updateNote(base.id, { content: 'Browser version' });
  env.replaceRemote([note('shared', { content: 'Agent version', updatedAt: timestamp + 1 })]);
  await env.save();
  expect(env.remote().notes.map(item => item.content).sort()).toEqual(['Agent version', 'Browser version']);
  expect(env.remote().notes.find(item => item.id !== 'shared').links).toContainEqual({ target: 'shared', type: 'related' });
  const count = env.remote().notes.length;
  await env.poll();
  expect(env.remote().notes).toHaveLength(count);
});

test('deletion during an in-flight PUT stays deleted on the next poll and reload', async () => {
  const base = note('delete-me');
  const env = browser({ local: [base], remote: [base] });
  await env.app.initWorkspace();
  env.app.startWorkspacePolling();
  env.app.updateNote(base.id, { content: 'Update before deletion' });
  const entered = deferred();
  const resume = deferred();
  env.onPut(async () => { entered.resolve(); await resume.promise; env.onPut(undefined); });
  await env.save();
  await entered.promise;
  env.app.deleteNote(base.id);
  resume.resolve();
  await env.settle();
  expect(env.app.state.notes).toEqual([]);
  expect(env.cached()).toEqual([]);
  await env.poll();
  expect(env.remote().notes).toEqual([]);
  const reload = browser({ local: env.cached(), remote: env.remote().notes, storage: env.storage });
  await reload.app.initWorkspace();
  expect(reload.app.state.notes).toEqual([]);
});

test('agent deletion removes an unchanged browser note and explicit inbound links', async () => {
  const target = note('target');
  const source = note('source', { links: [{ target: 'target', type: 'part-of' }] });
  const env = browser({ local: [source, target], remote: [source, target] });
  await env.app.initWorkspace();
  env.app.startWorkspacePolling();
  env.replaceRemote([note('source', { links: [], updatedAt: timestamp + 1 })]);
  await env.poll();
  expect(env.app.state.notes).toHaveLength(1);
  expect(env.app.state.notes[0].links).toEqual([]);
  expect(env.cached()).toEqual(env.remote().notes);
});

test('disconnect preserves browser backup and reconnect saves pending edits', async () => {
  const base = note('offline');
  const env = browser({ local: [base], remote: [base] });
  await env.app.initWorkspace();
  env.app.startWorkspacePolling();
  env.disconnect(true);
  env.app.updateNote(base.id, { content: 'Written while disconnected' });
  await env.save();
  await env.poll();
  expect(env.cached()[0].content).toBe('Written while disconnected');
  expect(env.remote().notes[0].content).toBe(base.content);
  expect(env.toasts.filter(toast => toast.type === 'error')).toHaveLength(1);
  env.disconnect(false);
  await env.poll();
  expect(env.remote().notes[0].content).toBe('Written while disconnected');
  expect(env.workspaceStatus.textContent).toContain('connected');
});

test('failed PUT keeps the merged local and agent notes in the browser backup for retry', async () => {
  const base = note('browser');
  const env = browser({ local: [base], remote: [base] });
  await env.app.initWorkspace();
  env.app.startWorkspacePolling();
  env.app.updateNote(base.id, { content: 'Pending browser edit' });
  env.replaceRemote([base, note('new-agent-note')]);
  env.onPut(() => { throw new Error('Connection dropped after GET'); });
  await env.save();
  expect(env.cached().map(item => item.id).sort()).toEqual(['browser', 'new-agent-note']);
  expect(env.cached().find(item => item.id === 'browser').content).toBe('Pending browser edit');
  env.onPut(undefined);
  await env.poll();
  expect(env.remote().notes.find(item => item.id === 'browser').content).toBe('Pending browser edit');
  expect(env.remote().notes.find(item => item.id === 'new-agent-note')).toBeDefined();
});

test('unsent browser deletion survives reload before the server receives it', async () => {
  const base = note('delete-offline');
  const env = browser({ local: [base], remote: [base] });
  await env.app.initWorkspace();
  env.disconnect(true);
  env.app.deleteNote(base.id);
  await env.save();
  expect(env.remote().notes).toHaveLength(1);
  const reload = browser({ local: env.cached(), remote: env.remote().notes, storage: env.storage });
  await reload.app.initWorkspace();
  expect(reload.app.state.notes).toEqual([]);
  expect(reload.remote().notes).toEqual([]);
});

test('initial network failure on localhost can recover through polling', async () => {
  const env = browser({ local: [note('browser')], remote: [note('agent')] });
  env.disconnect(true);
  await env.app.initWorkspace();
  env.app.startWorkspacePolling();
  expect(env.app.state.notes).toHaveLength(1);
  env.disconnect(false);
  await env.poll();
  expect(env.remote().notes).toHaveLength(2);
});

test('static hosting without the API keeps browser edits and disables polling', async () => {
  const base = note('static');
  const env = browser({ local: [base], origin: 'https://notes.example.test' });
  env.onGet(() => reply(404, { error: 'not-found' }));
  await env.app.initWorkspace();
  env.app.startWorkspacePolling();
  env.app.updateNote(base.id, { content: 'Browser-only edit' });
  expect(env.cached()[0].content).toBe('Browser-only edit');
  expect(env.intervals.size).toBe(0);
  expect(env.requests.filter(request => request.method === 'PUT')).toHaveLength(0);
});

test('malformed server notes cannot replace the recoverable browser copy', async () => {
  const base = note('valid');
  const env = browser({ local: [base] });
  env.onGet(() => reply(200, { version: 1, revision: 1, notes: [{ id: 'invalid', links: 'bad' }] }));
  await env.app.initWorkspace();
  expect(env.app.state.notes).toEqual([base]);
  expect(env.requests.filter(request => request.method === 'PUT')).toHaveLength(0);
});
