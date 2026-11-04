import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let server, base;

async function freePort() {
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => srv.once('listening', resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

// fetch() can't set Host or X-Forwarded-For, so header-guard checks use node:http directly.
function rawGet(path, headers) {
  return new Promise((resolve, reject) => {
    http.get(`${base}${path}`, { headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

const upload = (body, type, name = 'a.png') =>
  fetch(`${base}/api/media`, { method: 'POST', headers: { 'Content-Type': type, 'X-Filename': encodeURIComponent(name) }, body });

// /api/post streams one JSON event per line; returns them all once the stream ends.
async function events(res) {
  assert.match(res.headers.get('content-type'), /ndjson/);
  return (await res.text()).trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

const post = (body) =>
  fetch(`${base}/api/post`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  // No platform credentials: an empty env keeps a developer's .env out of the test.
  server = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    env: { PORT: String(port), SystemRoot: process.env.SystemRoot },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('running') && resolve()));
});

after(() => server.kill());

test('serves the page, the shared rules and the platform list', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/rules.js`)).status, 200);
  const platforms = await (await fetch(`${base}/api/platforms`)).json();
  assert.ok(platforms.length >= 9);
  assert.ok(platforms.every((p) => p.configured === false && Array.isArray(p.envVars) && p.media));
});

test('rejects foreign hosts and tunnelled requests to the app', async () => {
  assert.equal(await rawGet('/api/platforms', { Host: 'evil.example' }), 403);
  assert.equal(await rawGet('/api/platforms', { 'X-Forwarded-For': '1.2.3.4' }), 403);
  assert.equal(await rawGet('/', { 'X-Forwarded-For': '1.2.3.4' }), 403);
});

test('rejects requests that could be sent cross-site without a preflight', async () => {
  const res = await fetch(`${base}/api/post`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('uploads, serves (with ranges and through a tunnel) and deletes media', async () => {
  const res = await upload(PNG, 'image/png');
  assert.equal(res.status, 201);
  const { id, size, type } = await res.json();
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal(size, PNG.length);
  assert.equal(type, 'image/png');

  const file = await fetch(`${base}/media/${id}.png`);
  assert.equal(file.status, 200);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);

  const range = await fetch(`${base}/media/${id}.png`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 10);

  assert.equal(await rawGet(`/media/${id}.png`, { Host: 'abc.trycloudflare.com', 'X-Forwarded-For': '1.2.3.4' }), 200);

  assert.equal((await fetch(`${base}/api/media/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/media/${id}.png`)).status, 404);
});

test('rejects unsupported and empty uploads', async () => {
  assert.equal((await upload(PNG, 'image/heic')).status, 415);
  assert.equal((await upload(Buffer.alloc(0), 'image/png')).status, 400);
});

test('validates posts', async () => {
  assert.equal((await post({ text: 'hi', platforms: [] })).status, 400);
  assert.equal((await post({ text: ' ', platforms: ['x'] })).status, 400);
  assert.equal((await post({ text: 'hi', platforms: ['x'], media: ['0'.repeat(32)] })).status, 400);

  const all = await events(await post({ text: 'hi', platforms: ['x'] }));
  const result = all.find((e) => e.type === 'result');
  assert.equal(result.ok, false);
  assert.match(result.error, /Not configured/);
  assert.deepEqual(all.at(-1).results.map((r) => r.id), ['x']);
  assert.equal(all.at(-1).type, 'done');

  // A malformed body is the client's mistake: a 400 with a plain message, not a 500.
  const bad = await fetch(`${base}/api/post`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /valid JSON/);
});

test('serves a logo for every platform and nothing else from /icons/', async () => {
  const platforms = await (await fetch(`${base}/api/platforms`)).json();
  for (const p of platforms) {
    const res = await fetch(`${base}/icons/${p.id}.svg`);
    assert.equal(res.status, 200, p.id);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  }
  assert.equal((await fetch(`${base}/icons/unknown.svg`)).status, 404);
  assert.equal((await fetch(`${base}/icons/..%2Fserver.svg`)).status, 404);
});

test('accepts media as { id, duration } and per-platform text', async () => {
  const { id } = await (await upload(PNG, 'image/png')).json();
  const res = await post({ text: '', platforms: ['x'], media: [{ id, duration: 12 }], options: { x: { text: 'Only for X' } } });
  assert.equal(res.status, 200);
  const result = (await events(res)).find((e) => e.type === 'result');
  assert.match(result.error, /Not configured/);

  // Per-platform text alone is enough to post.
  assert.equal((await post({ text: '', platforms: ['x'], options: { x: { text: 'Only for X' } } })).status, 200);
  assert.equal((await post({ text: '', platforms: ['x'], media: [{ id: 42 }] })).status, 400);
  await fetch(`${base}/api/media/${id}`, { method: 'DELETE' });
});
