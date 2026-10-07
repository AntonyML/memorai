import { mkdir, open, readFile, rename, rmdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import '../js/knowledge.js';
import { PROJECT_ROOT } from './site.js';

const Knowledge = globalThis.MemoraiKnowledge;
export const MAX_WORKSPACE_BYTES = 8 * 1024 * 1024;
export const MAX_NOTES = 5000;
const KINDS = new Set(['context', 'project', 'skill', 'note', 'decision', 'meeting', 'reference']);
const LINK_TYPES = new Set(['part-of', 'related', 'depends-on']);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const FIELDS = ['id', 'title', 'content', 'tags', 'pinned', 'createdAt', 'updatedAt', '_sha', 'kind', 'links'];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class WorkspaceError extends Error {
  constructor(code, message, status = 400, snapshot) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    this.status = status;
    if (snapshot) this.snapshot = snapshot;
  }
}

function invalid(message) {
  throw new WorkspaceError('invalid-notes', message);
}

function validateFields(note) {
  if (!note || typeof note !== 'object' || Array.isArray(note)) invalid('Each note must be an object.');
  if (typeof note.id !== 'string' || !ID_PATTERN.test(note.id)) invalid('Note IDs must start with a letter or digit and contain 1–128 letters, digits, underscores, or hyphens.');
  for (const field of ['title', 'content', '_sha']) {
    if (note[field] !== undefined && typeof note[field] !== 'string') invalid(`${field} must be a string.`);
  }
  if (note.pinned !== undefined && typeof note.pinned !== 'boolean') invalid('pinned must be a boolean.');
  if (note.kind !== undefined && !KINDS.has(note.kind)) invalid('Unknown note kind.');
  if (note.tags !== undefined && (!Array.isArray(note.tags) || note.tags.some(tag => typeof tag !== 'string'))) invalid('tags must be an array of strings.');
  for (const field of ['createdAt', 'updatedAt']) {
    if (note[field] !== undefined && (!Number.isFinite(note[field]) || note[field] <= 0)) invalid(`${field} must be a positive timestamp in milliseconds.`);
  }
  if (note.links !== undefined) {
    if (!Array.isArray(note.links)) invalid('links must be an array.');
    for (const link of note.links) {
      if (!link || typeof link !== 'object' || typeof link.target !== 'string' || !ID_PATTERN.test(link.target) || !LINK_TYPES.has(link.type)) invalid('Each link needs a valid target ID and type: part-of, related, or depends-on.');
    }
  }
}

function normalizeGraph(notes) {
  if (!Array.isArray(notes) || notes.length > MAX_NOTES) invalid(`notes must be an array of at most ${MAX_NOTES} notes.`);
  notes.forEach(validateFields);
  try {
    const normalized = Knowledge.normalizeNotes(notes);
    Knowledge.validateGraph(normalized);
    return normalized;
  } catch (error) {
    invalid(error.message || 'Invalid note relationships.');
  }
}

function sameNotes(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

// An abandoned lock is reclaimed with nonrecursive removals. A child directory
// elects one reclaimer; a newly acquired lock can never be recursively deleted.
async function reclaimLock(lockPath) {
  let owner;
  try {
    owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'));
    if (isAlive(owner.pid)) return;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) return;
    try { if (Date.now() - (await stat(lockPath)).mtimeMs < 30000) return; } catch { return; }
  }
  const reapPath = join(lockPath, 'reap');
  try { await mkdir(reapPath); } catch { return; }
  try {
    let current;
    try { current = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) return;
    }
    if (current && (current.token !== owner?.token || isAlive(current.pid))) return;
    // If there was no owner, the directory may now belong to a fresh acquirer.
    if (!owner && !current && Date.now() - (await stat(lockPath)).birthtimeMs < 30000) return;
    await unlink(join(lockPath, 'owner.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  } finally {
    await rmdir(reapPath).catch(() => {});
  }
  await rmdir(lockPath).catch(() => {});
}

async function lockWorkspace(directory, operation) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, 'workspace.lock');
  const token = randomUUID();
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      try {
        await writeDurable(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, token }));
      } catch (error) {
        await unlink(join(lockPath, 'owner.json')).catch(() => {});
        await rmdir(lockPath).catch(() => {});
        throw error;
      }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await reclaimLock(lockPath);
      if (Date.now() - started > 10000) throw new WorkspaceError('workspace-busy', 'The workspace is busy. Retry after the other writer finishes.', 503);
      await delay(25 + Math.floor(Math.random() * 25));
    }
  }
  try { return await operation(); } finally {
    let owner;
    try { owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')); } catch {}
    if (owner?.token === token) {
      await unlink(join(lockPath, 'owner.json'));
      await rmdir(lockPath);
    }
  }
}

async function writeDurable(path, text) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
}

function parseSnapshot(text) {
  let snapshot;
  try { snapshot = JSON.parse(text); } catch {
    throw new WorkspaceError('workspace-corrupt', 'workspace.json contains invalid JSON. Preserve it and recover from workspace.json.bak.', 500);
  }
  if (snapshot?.version !== 1 || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || !Array.isArray(snapshot.notes)) {
    throw new WorkspaceError('workspace-corrupt', 'The workspace format is invalid or unsupported. Preserve the workspace files before recovery.', 500);
  }
  try { return { version: 1, revision: snapshot.revision, notes: normalizeGraph(snapshot.notes) }; } catch {
    throw new WorkspaceError('workspace-corrupt', 'The workspace contains invalid notes or relationships. Preserve the workspace files before recovery.', 500);
  }
}

async function readSnapshot(path) {
  try {
    if ((await stat(path)).size > MAX_WORKSPACE_BYTES) throw new WorkspaceError('workspace-too-large', 'The workspace exceeds the 8 MiB limit.', 413);
    return parseSnapshot(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, revision: 0, notes: [] };
    throw error;
  }
}

async function saveSnapshot(path, previous, notes) {
  const snapshot = { version: 1, revision: previous.revision + 1, notes };
  if (!Number.isSafeInteger(snapshot.revision)) throw new WorkspaceError('revision-limit', 'The workspace revision limit was reached.', 500);
  const text = JSON.stringify(snapshot, null, 2) + '\n';
  if (Buffer.byteLength(text, 'utf8') > MAX_WORKSPACE_BYTES) throw new WorkspaceError('workspace-too-large', 'The workspace exceeds the 8 MiB limit.', 413);
  const temp = `${path}.${randomUUID()}.tmp`;
  const backupTemp = `${path}.bak.${randomUUID()}.tmp`;
  try {
    await writeDurable(temp, text);
    // The backup is the previous validated snapshot, never a corrupt input.
    await writeDurable(backupTemp, JSON.stringify(previous, null, 2) + '\n');
    await rename(backupTemp, `${path}.bak`);
    await rename(temp, path);
    return snapshot;
  } finally {
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await unlink(backupTemp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function mergedNote(existing, input) {
  const note = existing ? { ...existing } : { id: input.id || randomUUID(), createdAt: Date.now() };
  for (const field of FIELDS) if (input[field] !== undefined) note[field] = input[field];
  if (existing) note.createdAt = existing.createdAt;
  validateFields(note);
  let normalized;
  try { normalized = Knowledge.normalizeNote(note); } catch (error) { invalid(error.message || 'Invalid note.'); }
  if (existing) {
    const comparison = { ...normalized, updatedAt: existing.updatedAt };
    if (sameNotes(comparison, existing)) return existing;
  }
  if (existing) normalized.updatedAt = Math.max(Date.now(), existing.updatedAt + 1);
  return normalized;
}

export function createWorkspace(root = PROJECT_ROOT) {
  const directory = join(resolve(root), '.memorai');
  const path = join(directory, 'workspace.json');
  const read = () => readSnapshot(path);
  const mutate = (operation, revision) => {
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) throw new WorkspaceError('invalid-revision', 'revision must be a nonnegative integer.');
    return lockWorkspace(directory, async () => {
      const previous = await read();
      if (revision !== undefined && previous.revision !== revision) throw new WorkspaceError('revision-conflict', 'The workspace changed. Read the latest snapshot and merge before retrying.', 409, previous);
      const result = await operation(previous);
      const notes = normalizeGraph(result.notes);
      const changed = !sameNotes(previous.notes, notes);
      const snapshot = changed ? await saveSnapshot(path, previous, notes) : previous;
      return { snapshot, changed };
    });
  };
  return {
    read,
    async replace(revision, notes) {
      if (!Number.isSafeInteger(revision) || revision < 0) throw new WorkspaceError('invalid-revision', 'revision must be a nonnegative integer.');
      return mutate(() => ({ notes }), revision);
    },
    async upsert(input, options = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('The note must be an object.');
      let id;
      const result = await mutate(previous => {
        const existing = previous.notes.find(note => note.id === input.id);
        const next = mergedNote(existing, input);
        id = next.id;
        return { notes: existing ? previous.notes.map(note => note.id === id ? next : note) : [...previous.notes, next] };
      }, options.revision);
      return { ...result, note: result.snapshot.notes.find(note => note.id === id) };
    },
    async link(source, target, type = 'related', options = {}) {
      if (!LINK_TYPES.has(type)) invalid('Unknown relationship type.');
      const result = await mutate(previous => {
        const note = previous.notes.find(note => note.id === source);
        if (!note) throw new WorkspaceError('note-not-found', 'The source note does not exist.', 404);
        if (!previous.notes.some(note => note.id === target)) throw new WorkspaceError('note-not-found', 'The target note does not exist.', 404);
        const links = [...note.links];
        if (!links.some(link => link.target === target && link.type === type)) links.push({ target, type });
        const next = mergedNote(note, { id: source, links });
        return { notes: previous.notes.map(item => item.id === source ? next : item) };
      }, options.revision);
      return { ...result, note: result.snapshot.notes.find(note => note.id === source) };
    },
    async import(inputs, options = {}) {
      if (!Array.isArray(inputs) || inputs.length > MAX_NOTES) invalid(`The import must be an array of at most ${MAX_NOTES} notes.`);
      const seen = new Set();
      for (const input of inputs) {
        validateFields(input);
        if (seen.has(input.id)) invalid('The import contains duplicate note IDs.');
        seen.add(input.id);
      }
      return mutate(previous => {
        const notes = [...previous.notes];
        for (const input of inputs) {
          const index = notes.findIndex(note => note.id === input.id);
          const next = mergedNote(index >= 0 ? notes[index] : undefined, input);
          if (index >= 0) notes[index] = next; else notes.push(next);
        }
        return { notes };
      }, options.revision);
    }
  };
}
