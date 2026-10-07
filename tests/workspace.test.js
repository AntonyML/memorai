import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace, MAX_WORKSPACE_BYTES } from '../scripts/workspace.js';
import { runCLI } from '../scripts/notes-cli.js';
import { createAppHandler, createStaticHandler } from '../scripts/server.js';

const fixtures = [];
const servers = [];
const cliPath = fileURLToPath(new URL('../scripts/notes-cli.js', import.meta.url));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memorai-workspace-'));
  fixtures.push(root);
  await writeFile(join(root, 'index.html'), '<!DOCTYPE html><title>memorai</title>');
  return root;
}

afterAll(async () => {
  servers.forEach(server => server.stop(true));
  for (const path of fixtures) {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep) || !path.includes('memorai-workspace-')) throw new Error('Unexpected fixture path.');
    await rm(path, { recursive: true, force: true });
  }
});

test('persists an explicit graph, retains timestamps, and exports/imports Markdown', async () => {
  const root = await fixture();
  const workspace = createWorkspace(root);
  const result = await workspace.replace(0, [
    { id: 'ugp', title: 'UGP · FEMUCARIBE', content: '# Unidad gestora\n\nContexto compartido.', kind: 'context', tags: ['femucaribe'], createdAt: 100, updatedAt: 200 },
    { id: 'skill', title: 'Skill específica', content: 'Se desarrolla dentro de [[ugp|UGP]].', kind: 'skill', links: [{ target: 'ugp', type: 'part-of' }], createdAt: 101, updatedAt: 201 }
  ]);
  expect(result.snapshot.revision).toBe(1);
  const reopened = await createWorkspace(root).read();
  expect(reopened.notes[0].updatedAt).toBe(200);
  expect(reopened.notes[1].links).toEqual([{ target: 'ugp', type: 'part-of' }]);
  const markdown = globalThis.MemoraiKnowledge.noteToMD(reopened.notes[1]);
  const parsed = globalThis.MemoraiKnowledge.mdToNote(markdown);
  expect(parsed.id).toBe('skill');
  expect(parsed.content).toBe(reopened.notes[1].content);
  expect(parsed.links).toEqual(reopened.notes[1].links);
  const graph = await runCLI(['graph', 'skill'], { root });
  expect(graph.nodes.map(note => note.id).sort()).toEqual(['skill', 'ugp']);
  expect(graph.edges.some(edge => edge.source === 'skill' && edge.target === 'ugp' && edge.type === 'part-of')).toBe(true);
});

test('partial upsert preserves fields and idempotent changes do not advance revisions', async () => {
  const root = await fixture();
  const workspace = createWorkspace(root);
  await workspace.replace(0, [{ id: 'note', title: 'Inicial', content: 'Contenido', tags: ['ugp'], pinned: true, createdAt: 100, updatedAt: 200 }]);
  const before = await workspace.read();
  const unchanged = await workspace.upsert({ id: 'note', title: 'Inicial' });
  expect(unchanged.changed).toBe(false);
  expect(unchanged.snapshot.revision).toBe(1);
  expect(unchanged.note.updatedAt).toBe(200);
  const changed = await workspace.upsert({ id: 'note', title: 'Revisada' });
  expect(changed.changed).toBe(true);
  expect(changed.snapshot.revision).toBe(2);
  expect(changed.note.content).toBe('Contenido');
  expect(changed.note.tags).toEqual(['ugp']);
  expect(changed.note.pinned).toBe(true);
  expect(changed.note.createdAt).toBe(100);
  expect(changed.note.updatedAt).toBeGreaterThan(200);
  expect(JSON.parse(await readFile(join(root, '.memorai/workspace.json.bak'), 'utf8'))).toEqual(before);
});

test('invalid references, duplicate IDs, and stale revisions preserve all stored notes', async () => {
  const workspace = createWorkspace(await fixture());
  await workspace.upsert({ id: 'ugp', content: 'Autoridad.' });
  const before = await workspace.read();
  await expect(workspace.upsert({ id: 'skill', links: [{ target: 'missing', type: 'part-of' }] })).rejects.toThrow();
  await expect(workspace.link('ugp', 'ugp')).rejects.toThrow();
  await expect(workspace.import([{ id: 'dup' }, { id: 'dup' }])).rejects.toThrow();
  await expect(workspace.replace(0, [])).rejects.toMatchObject({ code: 'revision-conflict', snapshot: before });
  expect(await workspace.read()).toEqual(before);
  await workspace.import([
    { id: 'skill', links: [{ target: 'project', type: 'related' }] },
    { id: 'project', kind: 'project' }
  ]);
  expect((await workspace.read()).notes.map(note => note.id)).toEqual(['ugp', 'skill', 'project']);
});

test('corrupt data fails without overwriting the workspace or its backup', async () => {
  const root = await fixture();
  const workspace = createWorkspace(root);
  await workspace.upsert({ id: 'ugp', content: 'Contenido importante.' });
  const backup = await readFile(join(root, '.memorai/workspace.json.bak'), 'utf8');
  await writeFile(join(root, '.memorai/workspace.json'), '{corrupt');
  await expect(workspace.upsert({ id: 'other' })).rejects.toMatchObject({ code: 'workspace-corrupt' });
  expect(await readFile(join(root, '.memorai/workspace.json'), 'utf8')).toBe('{corrupt');
  expect(await readFile(join(root, '.memorai/workspace.json.bak'), 'utf8')).toBe(backup);
});

test('CLI writers in separate processes merge changes under the same lock', async () => {
  const root = await fixture();
  // Simulate a writer that exited before releasing its lock. The contenders
  // must safely reclaim that lock before merging their own notes.
  const prior = Bun.spawn([process.execPath, '-e', 'console.log(process.pid)'], { stdout: 'pipe', stderr: 'pipe' });
  await prior.exited;
  const ownerPID = Number((await new Response(prior.stdout).text()).trim());
  await mkdir(join(root, '.memorai/workspace.lock'), { recursive: true });
  await writeFile(join(root, '.memorai/workspace.lock/owner.json'), JSON.stringify({ pid: ownerPID, token: 'abandoned-test-lock' }));
  const operations = [];
  for (let index = 0; index < 6; index++) {
    const path = join(root, `input-${index}.json`);
    await writeFile(path, JSON.stringify({ id: `note-${index}`, title: `Nota ${index}`, content: 'Texto.' }));
    operations.push(Bun.spawn([process.execPath, cliPath, 'upsert', '--root', root, '--file', path], { stdout: 'pipe', stderr: 'pipe' }));
  }
  const results = await Promise.all(operations.map(async child => ({
    exitCode: await child.exited,
    output: await new Response(child.stdout).text(),
    error: await new Response(child.stderr).text()
  })));
  for (const result of results) {
    expect(result.error).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output).changed).toBe(true);
  }
  const snapshot = await createWorkspace(root).read();
  expect(snapshot.revision).toBe(6);
  expect(snapshot.notes.length).toBe(6);
  const list = await runCLI(['list', '--query', 'Nota 2'], { root });
  expect(list.notes).toHaveLength(1);
  expect(list.notes[0].id).toBe('note-2');
  expect(list.notes[0]).not.toHaveProperty('content');
});

test('export produces an importable array and CLI error paths return nonzero JSON', async () => {
  const root = await fixture();
  await createWorkspace(root).upsert({ id: 'ugp', title: 'UGP', content: '# UGP' });
  const directory = join(root, 'export');
  await runCLI(['export', '--dir', directory], { root });
  const exported = JSON.parse(await readFile(join(directory, 'notes.json'), 'utf8'));
  expect(Array.isArray(exported)).toBe(true);
  const destination = await fixture();
  const result = await runCLI(['import', '--file', join(directory, 'notes.json')], { root: destination });
  expect(result.notesCount).toBe(1);
  expect((await runCLI(['get', 'ugp'], { root: destination })).note.content).toBe('# UGP');
  expect((await createWorkspace(destination).read()).notes[0].updatedAt).toBe(exported[0].updatedAt);
  const child = Bun.spawn([process.execPath, cliPath, 'get', 'missing', '--root', root], { stdout: 'pipe', stderr: 'pipe' });
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stdout).text()).toBe('');
  expect(JSON.parse(await new Response(child.stderr).text()).error).toBe('note-not-found');
});

test('CLI optimistic revisions reject changes prepared against an older snapshot', async () => {
  const root = await fixture();
  const workspace = createWorkspace(root);
  await workspace.import([{ id: 'ugp' }, { id: 'skill' }]);
  const observed = await workspace.read();
  await workspace.upsert({ id: 'ugp', content: 'Una edición más reciente.' });
  const input = join(root, 'stale-input.json');
  await writeFile(input, JSON.stringify({ id: 'ugp', content: 'Preparada antes de la otra edición.' }));
  await expect(runCLI(['upsert', '--file', input, '--revision', String(observed.revision)], { root })).rejects.toMatchObject({ code: 'revision-conflict' });
  await expect(runCLI(['link', 'skill', 'ugp', 'part-of', '--revision', String(observed.revision)], { root })).rejects.toMatchObject({ code: 'revision-conflict' });
  expect((await workspace.read()).notes[0].content).toBe('Una edición más reciente.');
});

test('app API reads and replaces snapshots, and rejects stale writes with current state', async () => {
  const root = await fixture();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: await createAppHandler(root) });
  servers.push(server);
  const url = new URL('/api/notes', server.url);
  expect(await (await fetch(url)).json()).toEqual({ version: 1, revision: 0, notes: [] });
  const headers = { 'Content-Type': 'application/json', Origin: url.origin };
  const initial = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ revision: 0, notes: [{ id: 'ugp', content: 'Local.' }] }) });
  expect(initial.status).toBe(200);
  const snapshot = await initial.json();
  expect(snapshot.revision).toBe(1);
  const conflict = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ revision: 0, notes: [] }) });
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).snapshot).toEqual(snapshot);
  expect((await fetch(new URL('/.memorai/workspace.json', server.url))).status).toBe(404);
  expect((await fetch(new URL('/.memorai/workspace.json.bak', server.url))).status).toBe(404);
});

test('private API requires loopback, same-origin JSON, and bounded bodies', async () => {
  const root = await fixture();
  const handler = await createAppHandler(root);
  const write = (url = 'http://localhost:8080/api/notes', headers = {}, body = '{"revision":0,"notes":[]}') => new Request(url, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body
  });
  expect((await handler(write())).status).toBe(403);
  expect((await handler(write(undefined, { Origin: 'https://evil.example' }))).status).toBe(403);
  expect((await handler(write('http://192.168.1.2:8080/api/notes', { Origin: 'http://192.168.1.2:8080' }))).status).toBe(403);
  expect((await handler(write(undefined, { Origin: 'http://localhost:8080', Host: 'rebind.example:8080' }))).status).toBe(403);
  expect((await handler(new Request('http://localhost:8080/api/notes'), { requestIP: () => ({ address: '192.168.1.3' }) })).status).toBe(403);
  expect((await handler(write(undefined, { Origin: 'http://localhost:8080', 'Content-Type': 'text/plain' }))).status).toBe(415);
  expect((await handler(write(undefined, { Origin: 'http://localhost:8080', 'Content-Length': String(MAX_WORKSPACE_BYTES + 1) }))).status).toBe(413);
  expect((await handler(write(undefined, { Origin: 'http://localhost:8080' }, '{bad'))).status).toBe(400);
  expect((await handler(new Request('http://localhost:8080/api/notes', { headers: { Origin: 'https://evil.example' } }))).status).toBe(403);
  expect((await handler(new Request('http://localhost:8080/api/notes', { method: 'OPTIONS' }))).status).toBe(405);
  const staticHandler = await createStaticHandler(root);
  expect((await staticHandler(new Request('http://localhost:8080/api/notes'))).status).toBe(404);
  const disabled = await createAppHandler(root, { apiEnabled: false });
  expect((await disabled(new Request('http://localhost:8080/api/notes'))).status).toBe(404);
  expect(await createWorkspace(root).read()).toEqual({ version: 1, revision: 0, notes: [] });
});

test('app assets and an isolated workspace can use separate roots without exposing storage', async () => {
  const sourceRoot = await fixture();
  const workspaceRoot = await fixture();
  await createWorkspace(workspaceRoot).upsert({ id: 'private', content: 'Sólo por la API local.' });
  const handler = await createAppHandler(sourceRoot, { workspaceRoot });
  expect((await handler(new Request('http://localhost/index.html'))).status).toBe(200);
  const response = await handler(new Request('http://localhost/api/notes'));
  expect((await response.json()).notes[0].id).toBe('private');
  expect(await createWorkspace(sourceRoot).read()).toEqual({ version: 1, revision: 0, notes: [] });
  expect((await handler(new Request('http://localhost/.memorai/workspace.json'))).status).toBe(404);
});

test('workspace size bounds reject a large note without changing existing notes', async () => {
  const workspace = createWorkspace(await fixture());
  await workspace.upsert({ id: 'ugp', content: 'Existente.' });
  const before = await workspace.read();
  await expect(workspace.upsert({ id: 'large', content: 'x'.repeat(MAX_WORKSPACE_BYTES) })).rejects.toMatchObject({ code: 'workspace-too-large' });
  expect(await workspace.read()).toEqual(before);
});

test('delete removes a note and cleans incoming links via workspace and CLI', async () => {
  const root = await fixture();
  const workspace = createWorkspace(root);
  await workspace.upsert({ id: 'target', title: 'Target note', content: 'To delete' });
  await workspace.upsert({ id: 'source', title: 'Source note', content: 'Keep', links: [{ target: 'target', type: 'related' }] });
  const result = await runCLI(['delete', 'target'], { root });
  expect(result.deletedId).toBe('target');
  expect(result.notesCount).toBe(1);
  const remaining = await workspace.read();
  expect(remaining.notes.map(n => n.id)).toEqual(['source']);
  expect(remaining.notes[0].links).toEqual([]);
});

