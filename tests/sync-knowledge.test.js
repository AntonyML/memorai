import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const knowledgeSource = readFileSync(new URL('../js/knowledge.js', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
const timestamp = 1700000000000;
const note = (id, updates = {}) => ({ id, title: id, content: `Content of ${id}`, tags: [], kind: 'note', links: [], pinned: false, createdAt: timestamp, updatedAt: timestamp, ...updates });
const clone = value => JSON.parse(JSON.stringify(value));
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(body) });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function browser(local, remote) {
  const requests = [];
  const saves = [];
  const refreshes = [];
  const toasts = [];
  const flushed = [];
  let fileHook;
  const app = {
    state: { notes: clone(local), pendingImages: [], activeNoteId: null, saveTimeout: null, settings: { repo: 'example/notes', branch: 'main', githubToken: 'fixture-token' } },
    dom: { syncLabel: { textContent: '' }, syncBtn: { disabled: false }, noteTitle: { value: '' }, noteContent: { value: '' } },
    toast: (message, type) => toasts.push({ message, type }),
    saveNotes: () => saves.push(clone(app.state.notes)),
    saveSettings: () => {},
    renderNotesList: () => {},
    updateNoteCount: () => {},
    showEmptyEditor: () => { app.state.activeNoteId = null; },
    doAutoSave: () => {
      flushed.push(app.state.activeNoteId);
      app.state.saveTimeout = null;
      const active = app.state.notes.find(item => item.id === app.state.activeNoteId);
      if (active) Object.assign(active, { title: app.dom.noteTitle.value, content: app.dom.noteContent.value, updatedAt: Date.now() });
    },
    refreshWorkspaceView: () => {
      refreshes.push(clone(app.state.notes));
      const active = app.state.notes.find(item => item.id === app.state.activeNoteId);
      if (active) { app.dom.noteTitle.value = active.title; app.dom.noteContent.value = active.content; }
    }
  };
  const context = vm.createContext({
    window: { App: app }, TextEncoder, TextDecoder, btoa, atob,
    clearTimeout: () => {},
    console: { warn: () => {} },
    fetch: async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ pathname, method, body });
      if (pathname.endsWith('/contents/notes')) return response(200, remote.map(item => ({ name: `${item.id}.md`, type: 'file', sha: `remote-sha-${item.id}` })));
      if (method === 'PUT') return response(200, { content: { sha: 'saved-sha' } });
      const id = pathname.slice(pathname.lastIndexOf('/') + 1).replace(/\.md$/, '');
      const item = remote.find(candidate => candidate.id === id);
      if (!item) return response(404, { message: 'Missing fixture note' });
      if (fileHook) {
        const result = await fileHook(id);
        if (result) return result;
      }
      return response(200, { sha: `remote-sha-${id}`, content: Buffer.from(app.noteToMD(item), 'utf8').toString('base64') });
    }
  });
  vm.runInContext(knowledgeSource, context, { filename: 'js/knowledge.js' });
  vm.runInContext(syncSource, context, { filename: 'js/sync.js' });
  return { app, requests, saves, refreshes, toasts, flushed, onFile: hook => { fileHook = hook; } };
}

test('GitHub pull stages all files before exposing changed notes and relationships', async () => {
  const localContext = note('ugp', { kind: 'context', content: 'Existing local context' });
  const remoteSkill = note('skill', { kind: 'skill', links: [{ target: 'ugp', type: 'part-of' }], updatedAt: timestamp + 1 });
  const remoteContext = note('ugp', { kind: 'context', content: 'Updated remote context', updatedAt: timestamp + 1 });
  const env = browser([localContext], [remoteSkill, remoteContext]);
  const entered = deferred();
  const resume = deferred();
  env.onFile(async id => { if (id === 'ugp') { entered.resolve(); await resume.promise; } });
  const pull = env.app._pullCore();
  await entered.promise;
  expect(env.app.state.notes).toEqual([localContext]);
  expect(env.app.knowledge.getGraph(env.app.state.notes).edges).toHaveLength(0);
  resume.resolve();
  expect(await pull).toEqual({ changed: true });
  expect(env.app.state.notes).toHaveLength(2);
  expect(env.app.state.notes.find(item => item.id === 'ugp').content).toBe('Updated remote context');
  expect(env.app.state.notes.find(item => item.id === 'skill').links).toEqual([{ target: 'ugp', type: 'part-of' }]);
  expect(env.app.knowledge.validateGraph(env.app.state.notes)).toHaveLength(2);
});

test('a later GitHub file failure cannot partially update an earlier fetched note', async () => {
  const existing = note('first', { content: 'Recoverable browser version' });
  const env = browser([existing], [note('first', { content: 'Remote update', updatedAt: timestamp + 1 }), note('second')]);
  env.onFile(id => id === 'second' ? response(500, { message: 'Fixture network error' }) : undefined);
  await expect(env.app._pullCore()).rejects.toThrow('Fixture network error');
  expect(env.app.state.notes).toEqual([existing]);
  expect(env.saves).toHaveLength(0);
});

test('pending editor input is flushed after fetching and wins over an older remote version', async () => {
  const existing = note('active');
  const env = browser([existing], [note('active', { content: 'Remote version', updatedAt: timestamp + 1 }), note('other')]);
  env.app.state.activeNoteId = existing.id;
  env.app.dom.noteTitle.value = existing.title;
  env.app.dom.noteContent.value = existing.content;
  const entered = deferred();
  const resume = deferred();
  env.onFile(async id => { if (id === 'other') { entered.resolve(); await resume.promise; } });
  const pull = env.app._pullCore();
  await entered.promise;
  env.app.dom.noteContent.value = 'Typed while GitHub is fetching';
  env.app.state.saveTimeout = 42;
  resume.resolve();
  await pull;
  expect(env.flushed).toEqual(['active']);
  expect(env.app.state.notes.find(item => item.id === 'active').content).toBe('Typed while GitHub is fetching');
  expect(env.app.state.notes.find(item => item.id === 'other')).toBeDefined();
});

test('manual GitHub pull refreshes the active editor from the completed graph', async () => {
  const existing = note('active');
  const updated = note('active', { content: 'Fetched agent content', kind: 'decision', updatedAt: timestamp + 1 });
  const env = browser([existing], [updated]);
  env.app.state.activeNoteId = existing.id;
  env.app.dom.noteTitle.value = existing.title;
  env.app.dom.noteContent.value = existing.content;
  await env.app.pullAllNotes();
  expect(env.refreshes).toHaveLength(1);
  expect(env.app.dom.noteContent.value).toBe('Fetched agent content');
  expect(env.saves[0][0].kind).toBe('decision');
  expect(env.app.dom.syncBtn.disabled).toBe(false);
});

test('GitHub push shares the graph Markdown format and prefers the fetched SHA', async () => {
  const ugp = note('ugp', { kind: 'context' });
  const skill = note('skill', {
    title: 'Gestión "UGP" 🧭', content: '# Procedimiento\n\nC:\\DEV\\memorai\n[[ugp|Unidad gestora]]',
    tags: ['femucaribe', 'gestión'], kind: 'skill', links: [{ target: 'ugp', type: 'part-of' }], _sha: 'stale-browser-sha'
  });
  const env = browser([ugp, skill], [ugp, skill]);
  await env.app._pushCore();
  const request = env.requests.find(item => item.method === 'PUT' && item.pathname.endsWith('/skill.md'));
  expect(request.body.sha).toBe('remote-sha-skill');
  const decoded = Buffer.from(request.body.content, 'base64').toString('utf8');
  const parsed = env.app.knowledge.mdToNote(decoded);
  const { _sha, ...contentNote } = skill;
  expect(parsed).toEqual(contentNote);
  expect(env.app.state.notes.find(item => item.id === 'skill')._sha).toBe('saved-sha');
});

test('image push uploads the whole snapshot when durable markers replace the pending array', async () => {
  const env = browser([], []);
  const filenames = ['first.png', 'second.png', 'third.png'];
  const marked = [];
  env.app.state.pendingImages = filenames.map(filename => ({ filename, dataUrl: 'data:image/png;base64,aGVsbG8=' }));
  env.app.markOfflineImagePushed = async filename => {
    marked.push(filename);
    env.app.state.pendingImages = env.app.state.pendingImages.filter(image => image.filename !== filename);
  };
  await env.app.pushAllImages();
  expect(marked).toEqual(filenames);
  expect(env.requests.filter(request => request.method === 'PUT').map(request => request.pathname.split('/').at(-1))).toEqual(filenames);
  expect(env.app.state.pendingImages).toHaveLength(0);
});

test('GitHub push awaits durable embedded-image migration before publishing references', async () => {
  const inline = '![Diagram](data:image/jpeg;base64,aGVsbG8=)';
  const existing = note('legacy', { content: inline });
  const env = browser([existing], []);
  const entered = deferred();
  const resume = deferred();
  const images = [];
  env.app.generateId = () => 'unique-image';
  env.app.persistOfflineImage = async image => {
    images.push(image);
    entered.resolve();
    await resume.promise;
    env.app.state.pendingImages.push(image);
  };
  const push = env.app._pushCore();
  await entered.promise;
  expect(env.app.state.notes[0].content).toBe(inline);
  expect(env.requests).toHaveLength(0);
  expect(images[0].filename).toBe('img-unique-image.jpg');
  resume.resolve();
  await push;
  expect(env.app.state.notes[0].content).toBe('![Diagram](images/img-unique-image.jpg)');
  const request = env.requests.find(request => request.pathname.endsWith('/legacy.md') && request.method === 'PUT');
  expect(Buffer.from(request.body.content, 'base64').toString('utf8')).toContain('images/img-unique-image.jpg');
  expect(env.requests.some(request => request.pathname.endsWith('/images/img-unique-image.jpg') && request.method === 'PUT')).toBe(true);
});

test('failed embedded-image persistence preserves original content and prevents publishing', async () => {
  const existing = note('legacy', { content: '![Diagram](data:image/png;base64,aGVsbG8=)' });
  const env = browser([existing], []);
  env.app.persistOfflineImage = async () => { throw new Error('Offline storage unavailable'); };
  await expect(env.app._pushCore()).rejects.toThrow('Offline storage unavailable');
  expect(env.app.state.notes).toEqual([existing]);
  expect(env.requests).toHaveLength(0);
  expect(env.saves).toHaveLength(0);
});

test('embedded-image migration preserves editor changes made while image storage is pending', async () => {
  const inline = '![Diagram](data:image/png;base64,aGVsbG8=)';
  const existing = note('legacy', { content: inline });
  const env = browser([existing], []);
  const entered = deferred();
  const resume = deferred();
  env.app.state.activeNoteId = existing.id;
  env.app.dom.noteTitle.value = existing.title;
  env.app.dom.noteContent.value = existing.content;
  env.app.generateId = () => 'image';
  env.app.persistOfflineImage = async () => { entered.resolve(); await resume.promise; };
  const migration = env.app.oneTimeMigration();
  await entered.promise;
  env.app.dom.noteTitle.value = 'Edited title';
  env.app.dom.noteContent.value = inline + '\nTyped during image storage';
  env.app.state.saveTimeout = 42;
  resume.resolve();
  await migration;
  expect(env.flushed).toEqual(['legacy']);
  expect(env.app.state.notes[0].title).toBe('Edited title');
  expect(env.app.state.notes[0].content).toBe('![Diagram](images/img-image.png)\nTyped during image storage');
  expect(env.app.dom.noteContent.value).toBe(env.app.state.notes[0].content);
  expect(env.app.state.notes[0].updatedAt).toBeGreaterThan(existing.updatedAt);
});

test('embedded-image migration updates the latest note object and preserves removed images', async () => {
  const inline = '![Diagram](data:image/png;base64,aGVsbG8=)';
  for (const keepImage of [true, false]) {
    const existing = note('legacy', { content: inline });
    const env = browser([existing], []);
    const entered = deferred();
    const resume = deferred();
    env.app.generateId = () => 'image';
    env.app.persistOfflineImage = async () => { entered.resolve(); await resume.promise; };
    const migration = env.app.oneTimeMigration();
    await entered.promise;
    env.app.state.notes = [note('legacy', { title: 'Latest title', content: (keepImage ? inline + '\n' : '') + 'Latest content', updatedAt: timestamp + 20 })];
    resume.resolve();
    await migration;
    expect(env.app.state.notes[0].title).toBe('Latest title');
    expect(env.app.state.notes[0].content).toBe((keepImage ? '![Diagram](images/img-image.png)\n' : '') + 'Latest content');
  }
});

test('embedded-image migration preserves MIME extensions and unique filenames across multiple images', async () => {
  const existing = note('legacy', { content: '![First](data:image/webp;base64,aGVsbG8=)\n![Second](data:image/gif;base64,aGVsbG8=)' });
  const env = browser([existing], []);
  const stored = [];
  let nextId = 0;
  env.app.generateId = () => 'image' + (++nextId);
  env.app.persistOfflineImage = async image => { stored.push(image); };
  await env.app.oneTimeMigration();
  expect(stored.map(image => image.filename)).toEqual(['img-image1.webp', 'img-image2.gif']);
  expect(env.app.state.notes[0].content).toBe('![First](images/img-image1.webp)\n![Second](images/img-image2.gif)');
});

test('wipe awaits durable image removal and note flushing before reporting success', async () => {
  const existing = note('legacy');
  const env = browser([existing], [existing]);
  const clearing = deferred();
  const clearComplete = deferred();
  const flushing = deferred();
  const flushComplete = deferred();
  env.app.state.offlineImages = { 'cached.png': { dataUrl: 'data:image/png;base64,aGVsbG8=' } };
  env.app.clearOfflineImages = async () => {
    clearing.resolve();
    await clearComplete.promise;
    env.app.state.offlineImages = {};
    env.app.state.pendingImages = [];
  };
  env.app.flushOfflineNotes = async () => { flushing.resolve(); await flushComplete.promise; };
  const wipe = env.app.wipeRemoteRepo();
  await clearing.promise;
  expect(env.app.state.notes).toEqual([existing]);
  expect(env.toasts).toHaveLength(0);
  clearComplete.resolve();
  await flushing.promise;
  expect(env.app.state.notes).toHaveLength(0);
  expect(env.app.state.offlineImages).toEqual({});
  expect(env.toasts).toHaveLength(0);
  flushComplete.resolve();
  await wipe;
  expect(env.toasts.at(-1)).toEqual({ message: 'All remote and local data wiped', type: 'success' });
  expect(env.app.dom.syncBtn.disabled).toBe(false);
});

test('wipe storage failures report an error instead of durable success', async () => {
  const env = browser([note('legacy')], []);
  env.app.clearOfflineImages = async () => { throw new Error('Image storage unavailable'); };
  await env.app.wipeRemoteRepo();
  expect(env.app.state.notes).toHaveLength(1);
  expect(env.toasts.at(-1)).toEqual({ message: 'Wipe failed: Image storage unavailable', type: 'error' });
  expect(env.app.dom.syncBtn.disabled).toBe(false);
});
