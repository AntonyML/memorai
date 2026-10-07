import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createWorkspace, MAX_WORKSPACE_BYTES, WorkspaceError } from './workspace.js';
import { PROJECT_ROOT } from './site.js';

const Knowledge = globalThis.MemoraiKnowledge;
const HELP = {
  usage: 'bun run notes -- <command>',
  commands: {
    list: 'list [--query text]: summaries filtered by title, tags, ID, kind, or content',
    get: 'get <id>: one complete note',
    upsert: 'upsert --file <path.json|path.md> [--revision number]: create or partially update one note; omitted fields are preserved',
    link: 'link <source> <target> [part-of|related|depends-on] [--revision number]: add an explicit relationship',
    context: 'context <id>: note and its incoming/outgoing connections',
    graph: 'graph [id] [--depth 1..10]: complete graph or neighborhood of a note',
    import: 'import --file <path.json> [--revision number]: merge a JSON array of notes by ID without deleting existing notes',
    export: 'export --dir <directory>: Markdown files and an importable notes.json array'
  },
  options: '--root <directory> selects a separate project workspace; defaults to this repository.',
  storage: '.memorai/workspace.json; works without a running server',
  limits: { maxBytes: MAX_WORKSPACE_BYTES, maxNotes: 5000 }
};

function fail(message) { throw new WorkspaceError('invalid-command', message); }

function parseArguments(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg.startsWith('--')) {
      if (arg === '--help') { options.help = true; continue; }
      if (!['--root', '--file', '--dir', '--query', '--depth', '--revision'].includes(arg)) fail(`Unknown option: ${arg}`);
      const name = arg.slice(2);
      if (options[name] !== undefined) fail(`Duplicate option: ${arg}`);
      if (args[index + 1] === undefined || args[index + 1].startsWith('--')) fail(`Missing value for ${arg}.`);
      options[name] = args[++index];
    } else positional.push(arg);
  }
  return { positional, options };
}

function checkArguments(positional, options, count, allowed) {
  if (positional.length !== count) fail('Unexpected or missing command arguments. Run bun run notes -- help.');
  for (const key of Object.keys(options)) if (!['root', 'help', ...allowed].includes(key)) fail(`--${key} is not valid for this command.`);
}

async function readInput(path, markdown = false) {
  if (!path) fail('Supply --file <path>.');
  const size = (await stat(resolve(path))).size;
  if (size > MAX_WORKSPACE_BYTES) throw new WorkspaceError('input-too-large', 'The input exceeds the 8 MiB limit.', 413);
  const text = await readFile(resolve(path), 'utf8');
  if (markdown && /\.md$/i.test(path)) {
    let note;
    try { note = Knowledge.mdToNote(text); } catch (error) { fail(error.message || 'Invalid Markdown note.'); }
    if (!note) fail('The Markdown file needs valid memorai frontmatter, including an ID.');
    return note;
  }
  try { return JSON.parse(text); } catch { fail('The input file contains invalid JSON.'); }
}

function findNote(snapshot, id) {
  const note = snapshot.notes.find(note => note.id === id);
  if (!note) throw new WorkspaceError('note-not-found', `Note ${id} does not exist.`, 404);
  return note;
}

export async function runCLI(args, settings = {}) {
  const { positional, options } = parseArguments(args);
  if (options.help || positional.length === 0 || positional[0] === 'help') return HELP;
  const command = positional.shift();
  const workspace = createWorkspace(options.root || settings.root || PROJECT_ROOT);
  const revision = options.revision === undefined ? undefined : Number(options.revision);
  if (revision !== undefined && (!/^\d+$/.test(options.revision) || !Number.isSafeInteger(revision))) fail('--revision must be a nonnegative integer.');
  if (command === 'list') {
    checkArguments(positional, options, 0, ['query']);
    const snapshot = await workspace.read();
    const query = (options.query || '').toLocaleLowerCase();
    const notes = snapshot.notes.filter(note => !query || [note.id, note.title, note.kind, note.content, ...note.tags].join(' ').toLocaleLowerCase().includes(query));
    return {
      revision: snapshot.revision,
      notes: notes.map(({ content, _sha, ...summary }) => summary)
    };
  }
  if (command === 'get' || command === 'context') {
    checkArguments(positional, options, 1, []);
    const snapshot = await workspace.read();
    const note = findNote(snapshot, positional[0]);
    const result = { revision: snapshot.revision, note };
    if (command === 'context') result.connections = Knowledge.getConnections(snapshot.notes, note.id);
    return result;
  }
  if (command === 'graph') {
    if (positional.length > 1) fail('graph accepts at most one note ID.');
    checkArguments(positional, options, positional.length, ['depth']);
    const depth = options.depth === undefined ? 2 : Number(options.depth);
    if (!Number.isInteger(depth) || depth < 1 || depth > 10) fail('--depth must be an integer between 1 and 10.');
    const snapshot = await workspace.read();
    if (positional[0]) findNote(snapshot, positional[0]);
    return { revision: snapshot.revision, ...Knowledge.getGraph(snapshot.notes, { focus: positional[0], depth }) };
  }
  if (command === 'upsert') {
    checkArguments(positional, options, 0, ['file', 'revision']);
    const { snapshot, changed, note } = await workspace.upsert(await readInput(options.file, true), { revision });
    return { revision: snapshot.revision, changed, note };
  }
  if (command === 'link') {
    if (positional.length < 2 || positional.length > 3) fail('link needs source, target, and optionally a relationship type.');
    checkArguments(positional, options, positional.length, ['revision']);
    const { snapshot, changed, note } = await workspace.link(positional[0], positional[1], positional[2], { revision });
    return { revision: snapshot.revision, changed, note };
  }
  if (command === 'import') {
    checkArguments(positional, options, 0, ['file', 'revision']);
    const { snapshot, changed } = await workspace.import(await readInput(options.file), { revision });
    return { revision: snapshot.revision, changed, notesCount: snapshot.notes.length };
  }
  if (command === 'export') {
    checkArguments(positional, options, 0, ['dir']);
    if (!options.dir) fail('Supply --dir <directory>.');
    const snapshot = await workspace.read();
    const directory = resolve(options.dir);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const note of snapshot.notes) await writeFile(join(directory, `${note.id}.md`), Knowledge.noteToMD(note), { mode: 0o600 });
    await writeFile(join(directory, 'notes.json'), JSON.stringify(snapshot.notes, null, 2) + '\n', { mode: 0o600 });
    return { revision: snapshot.revision, notesCount: snapshot.notes.length, directory };
  }
  fail(`Unknown command: ${command}`);
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await runCLI(Bun.argv.slice(2))));
  } catch (error) {
    const code = error instanceof WorkspaceError ? error.code : 'command-failed';
    const message = error instanceof WorkspaceError ? error.message : `Unable to complete the command (${error.code || error.name}).`;
    const output = { error: code, message };
    if (error.snapshot) output.revision = error.snapshot.revision;
    console.error(JSON.stringify(output));
    process.exitCode = 1;
  }
}
