import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isPublicPath, PROJECT_ROOT } from './site.js';
import { createWorkspace, MAX_WORKSPACE_BYTES, WorkspaceError } from './workspace.js';

export async function createStaticHandler(directory = PROJECT_ROOT) {
  const root = await realpath(directory);

  return async function fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' }
      });
    }

    let path;
    try {
      path = decodeURIComponent(new URL(request.url).pathname).slice(1) || 'index.html';
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (!isPublicPath(path)) {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const filePath = await realpath(join(root, path));
      const fromRoot = relative(root, filePath);
      if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('..' + sep)) {
        return new Response('Not Found', { status: 404 });
      }
      if (!isPublicPath(fromRoot.split(sep).join('/'))) {
        return new Response('Not Found', { status: 404 });
      }
      if (!(await stat(filePath)).isFile()) {
        return new Response('Not Found', { status: 404 });
      }

      const file = Bun.file(filePath);
      return new Response(request.method === 'HEAD' ? null : file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'Content-Length': String(file.size),
          'Cache-Control': 'no-store'
        }
      });
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EINVAL'].includes(error.code)) {
        return new Response('Not Found', { status: 404 });
      }
      console.error('Unable to serve static file:', error.code || error.name);
      return new Response('Internal Server Error', { status: 500 });
    }
  };
}

export function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
  });
}

function localRequest(request, server) {
  const url = new URL(request.url);
  if (!isLoopbackHost(url.hostname)) return false;
  const host = request.headers.get('host');
  if (host && host.toLowerCase() !== url.host.toLowerCase()) return false;
  if (server?.requestIP) {
    const peer = server.requestIP(request)?.address;
    if (!peer || (!isLoopbackHost(peer) && peer !== '::ffff:127.0.0.1')) return false;
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return false;
  // Browser writes need an explicit same-origin Origin. This prevents a remote
  // page, a form submission, or a rebinding hostname from changing local notes.
  if (request.method === 'PUT' && origin !== url.origin) return false;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  return true;
}

async function readJSONBody(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') || '')) {
    throw new WorkspaceError('unsupported-content-type', 'Use Content-Type: application/json.', 415);
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_WORKSPACE_BYTES)) {
    throw new WorkspaceError('request-too-large', 'The request exceeds the 8 MiB limit.', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError('invalid-json', 'Supply a JSON request body.');
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_WORKSPACE_BYTES) {
        await reader.cancel();
        throw new WorkspaceError('request-too-large', 'The request exceeds the 8 MiB limit.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch {
    throw new WorkspaceError('invalid-json', 'The request body must contain valid UTF-8 JSON.');
  }
}

// The app handler alone opts into private local note storage. Static handlers
// and built previews continue to expose public assets only.
export async function createAppHandler(directory = PROJECT_ROOT, options = {}) {
  const staticHandler = await createStaticHandler(directory);
  const workspace = createWorkspace(options.workspaceRoot || directory);
  return async function fetch(request, server) {
    let url;
    try { url = new URL(request.url); } catch { return new Response('Bad Request', { status: 400 }); }
    if (!url.pathname.startsWith('/api/')) return staticHandler(request);
    if (options.apiEnabled === false || url.pathname !== '/api/notes') return new Response('Not Found', { status: 404 });
    if (!localRequest(request, server)) return jsonResponse({ error: 'local-access-only', message: 'The notes API requires a same-origin loopback connection.' }, 403);
    if (!['GET', 'PUT'].includes(request.method)) return jsonResponse({ error: 'method-not-allowed', message: 'Use GET or PUT.' }, 405, { Allow: 'GET, PUT' });
    try {
      if (request.method === 'GET') return jsonResponse(await workspace.read());
      const body = await readJSONBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WorkspaceError('invalid-request', 'Supply an object containing revision and notes.');
      const { snapshot } = await workspace.replace(body.revision, body.notes);
      return jsonResponse(snapshot);
    } catch (error) {
      if (error instanceof WorkspaceError) {
        const body = { error: error.code, message: error.message };
        if (error.snapshot) body.snapshot = error.snapshot;
        return jsonResponse(body, error.status);
      }
      console.error('Unable to access local notes:', error.code || error.name);
      return jsonResponse({ error: 'workspace-error', message: 'Unable to access local notes. Existing workspace files were preserved.' }, 500);
    }
  };
}

if (import.meta.main) {
  const preview = Bun.argv.includes('--preview');
  if (!preview) {
    const { buildVendor } = await import('./vendor.js');
    await buildVendor();
  }
  const root = preview ? resolve(PROJECT_ROOT, 'dist') : PROJECT_ROOT;
  if (!(await Bun.file(join(root, 'index.html')).exists())) {
    console.error(preview ? 'Run "bun run build" before previewing dist/.' : 'index.html is missing.');
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exit(1);
  }

  const hostname = process.env.HOST || 'localhost';
  const server = Bun.serve({
    hostname,
    port,
    fetch: preview ? await createStaticHandler(root) : await createAppHandler(root, { apiEnabled: isLoopbackHost(hostname) })
  });
  console.log(`memorai ${preview ? 'preview' : 'server'} running at ${server.url}`);
}
