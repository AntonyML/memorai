import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import '../js/knowledge.js';
import { openNotebook } from '../scripts/lib/offline-notebook.js';

const K = globalThis.MemoraiKnowledge;
const sources = ['knowledge', 'storage', 'offline'].map(name => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const time = 1700000000000;
const note = (id, changes = {}) => K.normalizeNote({ id, title: id, content: '', createdAt: time, updatedAt: time, ...changes });
let sequence = 0;
const configuration = () => ({ name: 'browser-offline-' + Date.now() + '-' + sequence++, multiInstance: false, storage: getRxStorageDexie({ indexedDB, IDBKeyRange }), knowledge: K });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function browser(options = {}) {
  const storage = options.storage || new Map();
  const messages = [];
  const listeners = new Map();
  const offlineStatus = { textContent: '', dataset: {} };
  let store;
  let changes = 0;
  const App = {
    state: { notes: [], pendingImages: [], settings: {}, saveTimeout: null }, dom: {}, STORE_NOTES: 'memorai_notes',
    generateId: () => 'generated', toast: (...args) => messages.push(args),
    refreshWorkspaceView: () => { changes++; if (options.refreshError) throw options.refreshError; },
    libs: { openNotebook: async () => {
      if (options.openError) throw options.openError;
      store = options.store || await openNotebook(options.configuration);
      return options.wrap ? options.wrap(store) : store;
    } }
  };
  const context = vm.createContext({
    window: { App, addEventListener: (name, callback) => listeners.set(name, callback) },
    document: { getElementById: id => id === 'offlineStatus' ? offlineStatus : null, addEventListener: (name, callback) => listeners.set(name, callback), hidden: false },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => { if (options.fullStorage || (options.fullBackup && key === 'memorai_notes')) throw new Error('Quota exceeded'); storage.set(key, value); }
    },
    setTimeout, clearTimeout, Promise
  });
  sources.forEach(source => vm.runInContext(source, context));
  App.loadNotes();
  return { App, messages, storage, listeners, offlineStatus, context, get changes() { return changes; }, get store() { return store; } };
}

test('legacy browser notes migrate once and an empty database does not resurrect a stale backup', async () => {
  const settings = configuration();
  const original = [note('legacy', { content: 'Profesional 🧭', kind: 'skill' })];
  const storage = new Map([['memorai_notes', JSON.stringify(original)]]);
  const first = browser({ configuration: settings, storage });
  try {
    expect(await first.App.initOfflineStorage()).toBe(true);
    expect(await first.store.read()).toEqual(original);
    await first.store.write(K.baseline(original), []);
  } finally { await first.store.close(); }
  storage.set('memorai_notes', JSON.stringify(original));
  const second = browser({ configuration: settings, storage });
  try {
    await second.App.initOfflineStorage();
    expect(clone(second.App.state.notes)).toEqual([]);
    expect(await second.store.read()).toEqual([]);
  } finally { await second.store.close(); }
});

test('migration preserves existing database notes and legacy notes together', async () => {
  const settings = configuration();
  const existing = await openNotebook(settings);
  await existing.write({}, [note('database')]);
  await existing.close();
  const storage = new Map([['memorai_notes', JSON.stringify([note('legacy')])]]);
  const page = browser({ configuration: settings, storage });
  try {
    await page.App.initOfflineStorage();
    expect(clone(page.App.state.notes).map(item => item.id).sort()).toEqual(['database', 'legacy']);
  } finally { await page.store.close(); }
});

test('the durable migration marker prevents resurrection even when all localStorage writes fail', async () => {
  const settings = configuration();
  const original = [note('legacy')];
  const storage = new Map([['memorai_notes', JSON.stringify(original)]]);
  const first = browser({ configuration: settings, storage, fullStorage: true });
  try {
    await first.App.initOfflineStorage();
    await first.store.write(K.baseline(original), []);
  } finally { await first.store.close(); }
  const second = browser({ configuration: settings, storage, fullStorage: true });
  try {
    await second.App.initOfflineStorage();
    expect(clone(second.App.state.notes)).toEqual([]);
    expect(await second.store.read()).toEqual([]);
  } finally { await second.store.close(); }
});

test('a corrupt pending browser backup cannot delete valid database notes', async () => {
  const settings = configuration();
  const original = [note('safe')];
  const existing = await openNotebook(settings);
  await existing.migrateLegacy({}, original);
  await existing.close();
  const storage = new Map([
    ['memorai_notes', '{invalid'],
    ['memorai_offline_baseline', JSON.stringify({ version: 1, notes: K.baseline(original), pending: true })]
  ]);
  const page = browser({ configuration: settings, storage });
  try {
    await page.App.initOfflineStorage();
    expect(await page.store.read()).toEqual(original);
    expect(clone(page.App.state.notes)).toEqual(original);
  } finally { await page.store.close(); }
});

test('database failure keeps the backup and pending deletions recover on the next successful open', async () => {
  const settings = configuration();
  const original = [note('old')];
  const existing = await openNotebook(settings);
  await existing.write({}, original);
  await existing.close();
  const storage = new Map([
    ['memorai_notes', JSON.stringify(original)],
    ['memorai_offline_baseline', JSON.stringify({ version: 1, notes: K.baseline(original), pending: false })]
  ]);
  const failed = browser({ storage, openError: new Error('IndexedDB blocked') });
  expect(await failed.App.initOfflineStorage()).toBe(false);
  expect(failed.App.offlineStatus.mode).toBe('fallback');
  failed.App.state.notes = [];
  failed.App.saveNotes();
  await expect(failed.App.flushOfflineNotes()).rejects.toThrow('IndexedDB blocked');
  const recovered = browser({ configuration: settings, storage });
  try {
    expect(await recovered.App.initOfflineStorage()).toBe(true);
    expect(await recovered.store.read()).toEqual([]);
    expect(clone(recovered.App.state.notes)).toEqual([]);
  } finally { await recovered.store.close(); }
});

test('typing while IndexedDB saves persists the newest text without a conflict copy', async () => {
  let unblock;
  let blocked = false;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  const page = browser({ configuration: configuration(), wrap: store => ({
    ...store,
    write: async (...args) => { if (blocked) { blocked = false; entered(); await gate; } return store.write(...args); }
  }) });
  try {
    await page.App.initOfflineStorage();
    page.App.state.notes = [note('draft', { content: 'First input' })];
    blocked = true;
    page.App.saveNotes();
    await started;
    page.App.state.saveTimeout = setTimeout(() => {}, 10000);
    page.App.doAutoSave = () => {
      page.App.state.notes = [note('draft', { content: 'Latest input', updatedAt: time + 1 })];
      page.App.saveNotes();
    };
    unblock();
    await page.App.flushOfflineNotes();
    const saved = await page.store.read();
    expect(saved.length).toBe(1);
    expect(saved[0].content).toBe('Latest input');
    expect(clone(page.App.state.notes)).toEqual(saved);
  } finally { unblock(); await page.store.close(); }
});

test('a full localStorage backup does not block durable RxDB saves or report lost notes', async () => {
  const page = browser({ configuration: configuration(), fullBackup: true });
  try {
    await page.App.initOfflineStorage();
    page.App.state.notes = [note('durable', { content: 'Beyond localStorage quota' })];
    page.App.saveNotes();
    await page.App.flushOfflineNotes();
    expect((await page.store.read())[0].content).toBe('Beyond localStorage quota');
    expect(page.messages.filter(message => message[1] === 'error')).toEqual([]);
  } finally { await page.store.close(); }
});

test('reactive external updates flush pending editor text and preserve both concurrent versions', async () => {
  const original = [note('shared')];
  const page = browser({ configuration: configuration(), storage: new Map([['memorai_notes', JSON.stringify(original)]]) });
  try {
    await page.App.initOfflineStorage();
    page.App.startOfflineSubscriptions();
    await tick();
    await page.App.flushOfflineNotes();
    page.App.state.saveTimeout = setTimeout(() => {}, 10000);
    page.App.doAutoSave = () => {
      page.App.state.notes = [note('shared', { content: 'Pending editor input', updatedAt: time + 1 })];
      page.App.saveNotes();
    };
    await page.store.write(K.baseline(original), [note('shared', { content: 'Other tab input', updatedAt: time + 2 })]);
    await tick();
    await page.App.flushOfflineNotes();
    const saved = await page.store.read();
    expect(saved.map(item => item.content).sort()).toEqual(['Other tab input', 'Pending editor input']);
    expect(page.changes).toBeGreaterThan(0);
  } finally { await page.store.close(); }
});

test('failed writes show an error, retain pending backup and retry without inventing a conflict', async () => {
  let rejectNext = true;
  const page = browser({ configuration: configuration(), wrap: store => ({
    ...store, write: (...args) => { if (rejectNext) { rejectNext = false; return Promise.reject(new Error('Disk quota exceeded')); } return store.write(...args); }
  }) });
  try {
    await page.App.initOfflineStorage();
    page.App.state.notes = [note('draft', { content: 'First pending version' })];
    page.App.saveNotes();
    await expect(page.App.flushOfflineNotes()).rejects.toThrow('Disk quota exceeded');
    expect(page.offlineStatus.textContent).toBe('Offline save failed · browser backup');
    expect(page.App.offlineStatus.pending).toBe(0);
    expect(JSON.parse(page.storage.get('memorai_offline_baseline')).pending).toBe(true);
    page.App.state.notes = [note('draft', { content: 'Retry newest version', updatedAt: time + 1 })];
    page.App.saveNotes();
    await page.App.flushOfflineNotes();
    const saved = await page.store.read();
    expect(saved.length).toBe(1);
    expect(saved[0].content).toBe('Retry newest version');
    expect(page.App.offlineStatus.error).toBeNull();
  } finally { await page.store.close(); }
});

test('page hiding flushes the pending editor synchronously into the backup and then IndexedDB', async () => {
  const page = browser({ configuration: configuration() });
  try {
    await page.App.initOfflineStorage();
    page.App.startOfflineSubscriptions();
    page.App.state.saveTimeout = setTimeout(() => {}, 10000);
    page.App.doAutoSave = () => {
      page.App.state.notes = [note('last-words', { content: 'Last 500 milliseconds' })];
      page.App.saveNotes();
    };
    page.listeners.get('pagehide')();
    expect(JSON.parse(page.storage.get('memorai_notes'))[0].content).toBe('Last 500 milliseconds');
    await page.App.flushOfflineNotes();
    expect((await page.store.read())[0].content).toBe('Last 500 milliseconds');
  } finally { await page.store.close(); }
});

test('external image changes refresh the binary cache and upload queue between tabs', async () => {
  const page = browser({ configuration: configuration() });
  const image = { filename: 'diagram.png', name: 'UGP', dataUrl: 'data:image/png;base64,aGVsbG8=', pushed: false };
  try {
    await page.App.initOfflineStorage();
    page.App.startOfflineSubscriptions();
    await tick();
    await page.App.flushOfflineNotes();
    await page.store.putImage(image);
    await tick();
    await page.App.flushOfflineNotes();
    expect(clone(page.App.state.offlineImages['diagram.png'])).toEqual(image);
    expect(clone(page.App.state.pendingImages)).toEqual([image]);
    await page.store.putImage({ ...image, pushed: true });
    await tick();
    await page.App.flushOfflineNotes();
    expect(page.App.state.offlineImages['diagram.png'].pushed).toBe(true);
    expect(clone(page.App.state.pendingImages)).toEqual([]);
  } finally { await page.store.close(); }
});

test('an unchanged browser snapshot does not schedule an IndexedDB write', async () => {
  let writes = 0;
  const page = browser({ configuration: configuration(), wrap: store => ({ ...store, write: (...args) => { writes++; return store.write(...args); } }) });
  try {
    await page.App.initOfflineStorage();
    page.App.state.notes = [note('same')];
    page.App.saveNotes();
    await page.App.flushOfflineNotes();
    expect(writes).toBe(1);
    page.App.saveNotes();
    page.App.saveNotes();
    await page.App.flushOfflineNotes();
    expect(writes).toBe(1);
  } finally { await page.store.close(); }
});

test('clearing images waits for queued writes and subscriptions cannot restore cleared images', async () => {
  const settings = configuration();
  const page = browser({ configuration: settings });
  try {
    await page.App.initOfflineStorage();
    page.App.startOfflineSubscriptions();
    const save = page.App.persistOfflineImage({ filename: 'clear-me.png', name: 'Clear', dataUrl: 'data:image/png;base64,aGVsbG8=' });
    const clear = page.App.clearOfflineImages();
    await save;
    await clear;
    await tick();
    await page.App.flushOfflineNotes();
    expect(await page.store.readImages()).toEqual([]);
    expect(clone(page.App.state.offlineImages)).toEqual({});
    expect(clone(page.App.state.pendingImages)).toEqual([]);
  } finally { await page.store.close(); }
  const reopened = browser({ configuration: settings, storage: page.storage });
  try {
    await reopened.App.initOfflineStorage();
    expect(clone(reopened.App.state.pendingImages)).toEqual([]);
    expect(clone(reopened.App.state.offlineImages)).toEqual({});
  } finally { await reopened.store.close(); }
});

test('another browser instance clearing images removes durable cache entries and pending uploads', async () => {
  // Independent browser adapters subscribe to the same real RxDB storage. A
  // shared handle avoids RxDB's intentionally forbidden duplicate instances
  // within one JavaScript realm; actual browser tabs have separate realms.
  const store = await openNotebook(configuration());
  const first = browser({ store });
  const second = browser({ store });
  try {
    await first.App.initOfflineStorage();
    await second.App.initOfflineStorage();
    first.App.startOfflineSubscriptions();
    second.App.startOfflineSubscriptions();
    await first.App.persistOfflineImage({ filename: 'deleted-elsewhere.png', name: 'Remote', dataUrl: 'data:image/png;base64,aGVsbG8=' });
    await tick();
    await second.App.flushOfflineNotes();
    expect(second.App.state.pendingImages.length).toBe(1);
    expect(Object.keys(second.App.state.offlineImages)).toEqual(['deleted-elsewhere.png']);
    await first.App.clearOfflineImages();
    await tick();
    await second.App.flushOfflineNotes();
    expect(clone(second.App.state.pendingImages)).toEqual([]);
    expect(clone(second.App.state.offlineImages)).toEqual({});
  } finally { await store.close(); }
});

test('an external deletion snapshot in flight cannot discard a newly saved local image', async () => {
  let release;
  let entered;
  let block = false;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const page = browser({ configuration: configuration(), wrap: store => ({
    ...store,
    readImages: async () => {
      const images = await store.readImages();
      if (block) { block = false; entered(); await gate; }
      return images;
    }
  }) });
  const oldImage = { filename: 'old.png', name: 'Old', dataUrl: 'data:image/png;base64,aGVsbG8=' };
  const newImage = { filename: 'new.png', name: 'New', dataUrl: 'data:image/png;base64,aGVsbG8=' };
  try {
    await page.App.initOfflineStorage();
    page.App.startOfflineSubscriptions();
    await page.App.persistOfflineImage(oldImage);
    await tick();
    await page.App.flushOfflineNotes();
    block = true;
    await page.store.clearImages();
    await started;
    await page.App.persistOfflineImage(newImage);
    release();
    await tick();
    await page.App.flushOfflineNotes();
    expect(Object.keys(page.App.state.offlineImages)).toEqual(['new.png']);
    expect(page.App.state.pendingImages.map(image => image.filename)).toEqual(['new.png']);
    expect((await page.store.readImages()).map(image => image.filename)).toEqual(['new.png']);
  } finally { release(); await page.store.close(); }
});
