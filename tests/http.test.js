import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import axios from 'axios';

const code = readFileSync(new URL('../js/http.js', import.meta.url), 'utf8');

function client(instance, fetchFallback) {
  const App = { libs: instance ? { axios: instance } : {} };
  vm.runInNewContext(code, { window: { App }, fetch: fetchFallback });
  return App.http;
}

test('Axios requests preserve JSON, credentials and fetch-shaped HTTP error responses', async () => {
  let sent;
  const instance = axios.create({ adapter: async config => {
    sent = config;
    return { status: 409, data: '{"error":"revision-conflict","snapshot":{"revision":7}}', headers: {}, config };
  } });
  const response = await client(instance).fetch('/api/notes', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"revision":6,"notes":[]}'
  });
  expect(response.status).toBe(409);
  expect(response.ok).toBe(false);
  expect(await response.json()).toEqual({ error: 'revision-conflict', snapshot: { revision: 7 } });
  expect(JSON.parse(sent.data)).toEqual({ revision: 6, notes: [] });
  expect(sent.withCredentials).toBe(false);
  expect(sent.timeout).toBe(15000);
});

test('malformed JSON stays an error rather than silently becoming an empty snapshot', async () => {
  const instance = axios.create({ adapter: async config => ({ status: 200, data: '<html>offline</html>', headers: {}, config }) });
  const response = await client(instance).fetch('/api/notes');
  await expect(response.json()).rejects.toThrow();
});

test('Axios network errors expose no request config or credentials and are not retried', async () => {
  let calls = 0;
  const instance = axios.create({ adapter: async () => {
    calls++;
    const error = new Error('authorization: private-example');
    error.code = 'ECONNABORTED';
    throw error;
  } });
  await expect(client(instance).fetch('https://api.github.com/repos/example/notes')).rejects.toThrow('Request timed out');
  expect(calls).toBe(1);
});

test('native fetch remains an adapter when libraries are unavailable', async () => {
  const original = new Response('{"ok":true}', { status: 200 });
  const fallback = async (url, options) => {
    expect(url).toBe('/api/notes');
    expect(options.method).toBe('GET');
    return original;
  };
  const response = await client(undefined, fallback).fetch('/api/notes', { method: 'GET' });
  expect(response).toBe(original);
  expect(await response.json()).toEqual({ ok: true });
});
