import { expect, test } from 'bun:test';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import '../js/knowledge.js';
import { openNotebook } from '../scripts/lib/offline-notebook.js';

const K = globalThis.MemoraiKnowledge;
const time = 1700000000000;
const note = (id, changes = {}) => K.normalizeNote({ id, title: id, content: '', createdAt: time, updatedAt: time, ...changes });
const options = name => ({ name, multiInstance: false, knowledge: K, storage: getRxStorageDexie({ indexedDB, IDBKeyRange }) });
let sequence = 0;
const uniqueName = () => 'offline-test-' + Date.now() + '-' + sequence++;

test('RxDB reopens an atomic notebook with Unicode, kinds, relationships and transport metadata', async () => {
  const configuration = options(uniqueName());
  const notes = [note('ugp', { title: 'Unidad gestora de proyectos 🧭', kind: 'context' }), note('skill', {
    kind: 'skill', content: 'Gestión [[ugp|UGP]]\n\n```js\nconst x = "é";\n```', tags: ['gestión'], _sha: 'github-sha',
    links: [{ target: 'ugp', type: 'part-of' }]
  })];
  const first = await openNotebook(configuration);
  try {
    expect(await first.read()).toEqual([]);
    await first.write({}, notes);
  } finally { await first.close(); }
  const reopened = await openNotebook(configuration);
  try { expect(await reopened.read()).toEqual(notes); }
  finally { await reopened.close(); }
});

test('incremental writes preserve independent concurrent changes and conflict copies', async () => {
  const store = await openNotebook(options(uniqueName()));
  const original = [note('shared'), note('independent')];
  try {
    await store.write({}, original);
    const baseline = K.baseline(original);
    await Promise.all([
      store.write(baseline, [note('shared', { content: 'First writer', updatedAt: time + 1 }), original[1]]),
      store.write(baseline, [note('shared', { content: 'Second writer', updatedAt: time + 2 }), note('independent', { content: 'Other edit', updatedAt: time + 2 })])
    ]);
    const saved = await store.read();
    expect(saved.find(item => item.id === 'independent').content).toBe('Other edit');
    expect(saved.filter(item => item.id === 'shared' || item.id.startsWith('shared-conflict-')).map(item => item.content).sort()).toEqual(['First writer', 'Second writer']);
    expect(saved.some(item => item.id.startsWith('shared-conflict-') && item.links.some(link => link.target === 'shared'))).toBe(true);
  } finally { await store.close(); }
});

test('offline deletions survive reopen and remove inbound links without removing wiki evidence', async () => {
  const configuration = options(uniqueName());
  const original = [note('target'), note('source', { content: '[[target]]', links: [{ target: 'target', type: 'related' }] })];
  const store = await openNotebook(configuration);
  try {
    await store.write({}, original);
    await store.write(K.baseline(original), [note('source', { content: '[[target]]', updatedAt: time + 1 })]);
  } finally { await store.close(); }
  const reopened = await openNotebook(configuration);
  try {
    const saved = await reopened.read();
    expect(saved.map(item => item.id)).toEqual(['source']);
    expect(saved[0].links).toEqual([]);
    expect(saved[0].content).toBe('[[target]]');
  } finally { await reopened.close(); }
});

test('invalid graph writes reject without altering the previous notebook', async () => {
  const store = await openNotebook(options(uniqueName()));
  const original = [note('safe')];
  try {
    await store.write({}, original);
    await expect(store.write(K.baseline(original), [note('bad', { links: [{ target: 'missing', type: 'related' }] })])).rejects.toThrow('Missing link target');
    await expect(store.write({}, [note('same'), note('same')])).rejects.toThrow('Duplicate note id');
    expect(await store.read()).toEqual(original);
  } finally { await store.close(); }
});

test('image binary and upload status persist after closing, and unsafe image input is rejected', async () => {
  const configuration = options(uniqueName());
  const image = { filename: '20261007-120001.png', name: 'Diagrama UGP', dataUrl: 'data:image/png;base64,aGVsbG8=', pushed: false };
  const first = await openNotebook(configuration);
  try {
    await first.putImage(image);
    await expect(first.putImage({ ...image, filename: '../outside.png' })).rejects.toThrow('filename');
    await expect(first.putImage({ ...image, dataUrl: 'data:image/svg+xml;base64,aGVsbG8=' })).rejects.toThrow('raster image');
  } finally { await first.close(); }
  const second = await openNotebook(configuration);
  try {
    expect(await second.readImages()).toEqual([image]);
    await second.putImage({ ...image, pushed: true });
  } finally { await second.close(); }
  const third = await openNotebook(configuration);
  try { expect(await third.readImages()).toEqual([{ ...image, pushed: true }]); }
  finally { await third.close(); }
});

test('an unchanged graph does not publish a new database revision', async () => {
  const store = await openNotebook(options(uniqueName()));
  const notes = [note('stable')];
  let events = 0;
  const unsubscribe = store.subscribe(() => { events++; });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await store.write({}, notes);
    await tick();
    const afterWrite = events;
    await store.write(K.baseline(notes), notes);
    await tick();
    expect(events).toBe(afterWrite);
  } finally { unsubscribe(); await store.close(); }
});

test('clearing offline images is durable and leaves notebook notes intact', async () => {
  const configuration = options(uniqueName());
  const original = [note('preserved')];
  const first = await openNotebook(configuration);
  try {
    await first.write({}, original);
    await first.putImage({ filename: 'local.png', name: 'Local', dataUrl: 'data:image/png;base64,aGVsbG8=' });
    await first.clearImages();
    expect(await first.readImages()).toEqual([]);
  } finally { await first.close(); }
  const reopened = await openNotebook(configuration);
  try {
    expect(await reopened.readImages()).toEqual([]);
    expect(await reopened.read()).toEqual(original);
  } finally { await reopened.close(); }
});
