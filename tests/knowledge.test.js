import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../js/knowledge.js', import.meta.url), 'utf8'), context);
const K = context.MemoraiKnowledge;
const note = (id, updates = {}) => K.normalizeNote({ id, title: id, content: '', createdAt: 1700000000000, updatedAt: 1700000000000, ...updates });

test('Markdown roundtrip preserves Unicode, escapes, note metadata and content', () => {
  const original = note('ugp-skill', {
    title: 'UGP: "Gestión" \\ Caribe\nLínea dos 🧭',
    content: '\n# Decisión\n\nRuta: C:\\DEV\\memorai\n[[ugp|Unidad gestora de proyectos]]\n',
    tags: ['ugp', 'gestión', 'c:\\archivo', 'con "comillas"'],
    kind: 'skill',
    pinned: true,
    links: [{ target: 'ugp', type: 'part-of' }, { target: 'manual', type: 'depends-on' }]
  });
  expect(K.mdToNote(K.noteToMD(original))).toEqual(original);
});

test('legacy exports gain default graph metadata without changing note content', () => {
  const legacy = '---\nid: old-note\ntitle: "Legacy"\ntags: [\'ugp\', \'gestión\']\npinned: false\ncreated: 2023-11-14T22:13:20.000Z\nupdated: 2023-11-14T22:13:20.000Z\n---\n\nLegacy content';
  const imported = K.mdToNote(legacy);
  expect(imported.kind).toBe('note');
  expect(imported.links).toEqual([]);
  expect(imported.tags).toEqual(['ugp', 'gestión']);
  expect(imported.content).toBe('Legacy content');
});

test('UGP provides an indirect path between the skill and web project without inventing a direct edge', () => {
  const notes = [
    note('ugp', { kind: 'context' }),
    note('ugp-skill', { kind: 'skill', links: [{ target: 'ugp', type: 'part-of' }] }),
    note('ugp-web', { kind: 'project', links: [{ target: 'ugp', type: 'part-of' }] }),
    note('unrelated', { tags: ['ugp'] })
  ];
  const oneHop = K.getGraph(notes, { focus: 'ugp-skill', depth: 1 });
  expect(oneHop.nodes.map(node => node.id).sort()).toEqual(['ugp', 'ugp-skill']);
  const twoHops = K.getGraph(notes, { focus: 'ugp-skill', depth: 2 });
  expect(twoHops.nodes.map(node => node.id).sort()).toEqual(['ugp', 'ugp-skill', 'ugp-web']);
  expect(twoHops.edges).toHaveLength(2);
  expect(twoHops.edges.every(edge => edge.target === 'ugp')).toBe(true);
  expect(K.getConnections(notes, 'ugp-skill').map(connection => connection.note.id)).toEqual(['ugp']);
});

test('wiki references derive edges and backlinks while code samples and missing targets do not create graph nodes', () => {
  const notes = [
    note('skill', { content: 'Uses [[ugp|UGP]] and [[ugp]]. `[[code-inline]]`\n```md\n[[code-fenced]]\n```\n[[missing]]', links: [{ target: 'ugp', type: 'part-of' }] }),
    note('web', { content: 'Built for [[ugp]]' }),
    note('ugp'),
    note('code-inline'),
    note('code-fenced')
  ];
  const graph = K.getGraph(notes, { focus: 'skill', depth: 2 });
  expect(graph.nodes.map(node => node.id).sort()).toEqual(['skill', 'ugp', 'web']);
  expect(graph.edges).toHaveLength(2);
  expect(graph.edges.find(edge => edge.source === 'skill')).toEqual({ source: 'skill', target: 'ugp', type: 'part-of', explicit: true });
  expect(K.getConnections(notes, 'ugp').map(connection => connection.direction)).toEqual(['incoming', 'incoming']);
});

test('GitHub SHA bookkeeping does not create false content conflicts', () => {
  const before = note('unchanged', { _sha: 'old' });
  const local = note('unchanged', { _sha: 'browser-sha' });
  const remote = note('unchanged', { _sha: 'new-sha' });
  expect(K.fingerprint(local)).toBe(K.fingerprint(remote));
  const result = K.reconcileNotes(K.baseline([before]), [local], [remote]);
  expect(result.conflicts).toBe(0);
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0]._sha).toBe('new-sha');
});

test('conflict copies retain the remote author relationship metadata for review', () => {
  const ugp = note('ugp', { kind: 'context' });
  const before = note('skill', { kind: 'skill' });
  const local = note('skill', { kind: 'skill', content: 'Browser content', updatedAt: 1700000000001 });
  const remote = note('skill', { kind: 'skill', content: 'Agent content', links: [{ target: 'ugp', type: 'part-of' }], updatedAt: 1700000000002 });
  const result = K.reconcileNotes(K.baseline([ugp, before]), [ugp, local], [ugp, remote]);
  const copy = result.notes.find(item => item.id !== 'ugp' && item.id !== 'skill');
  expect(copy.content).toBe('Agent content');
  expect(copy.links).toContainEqual({ target: 'ugp', type: 'part-of' });
  expect(copy.links).toContainEqual({ target: 'skill', type: 'related' });
});

test('editing concurrently with deletion retains the edited note for explicit review', () => {
  const before = note('edited');
  const edited = note('edited', { content: 'Work that must survive', updatedAt: 1700000000001 });
  const result = K.reconcileNotes(K.baseline([before]), [edited], []);
  expect(result.notes[0].content).toBe('Work that must survive');
  expect(result.conflicts).toBe(1);
});
