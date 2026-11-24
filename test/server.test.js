import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const logDir = mkdtempSync(join(tmpdir(), 'sp-logs-'));
const postsDir = mkdtempSync(join(tmpdir(), 'sp-posts-'));

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
    // LOG_DIR keeps the test's log lines out of the real logs/.
    env: { PORT: String(port), PHONE_PORT: 'off', LOG_DIR: logDir, POSTS_DIR: postsDir, SystemRoot: process.env.SystemRoot },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('running') && resolve()));
});

after(() => {
  server.kill();
  rmSync(logDir, { recursive: true, force: true });
  rmSync(postsDir, { recursive: true, force: true });
});

test('serves the page, the shared rules and the platform list', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/rules.js`)).status, 200);
  assert.equal((await fetch(`${base}/fields.js`)).status, 200);
  assert.equal((await fetch(`${base}/slides.js`)).status, 200);
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
  const slides = await fetch(`${base}/api/slides`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(slides.status, 415);
});

test('draws the slides of a text-only post for the preview', async () => {
  const res = await fetch(`${base}/api/slides`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'A first sentence. हिंदी में दूसरा वाक्य।', style: 'cover', background: 'midnight' }),
  });
  const { slides } = await res.json();
  assert.equal(res.status, 200);
  assert.equal(slides.length, 2);
  assert.ok(slides.every((s) => s.startsWith('data:image/jpeg;base64,')));
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

test('accepts SRT subtitles, but only alongside a video', async () => {
  const srt = Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHello\n');
  const res = await upload(srt, 'application/x-subrip', 'hi.srt');
  assert.equal(res.status, 201);
  const { id, type } = await res.json();
  assert.equal(type, 'application/x-subrip');

  // Subtitles are sent per video and per language: { videoId: { lang: srtId } }.
  const noVideo = await post({ text: 'hi', platforms: ['x'], subtitles: { [id]: { en: id } } });
  assert.equal(noVideo.status, 400);
  assert.match((await noVideo.json()).error, /Subtitles need a video/);
  // Not usable as an ordinary attachment either.
  assert.equal((await post({ text: 'hi', platforms: ['x'], media: [id] })).status, 400);
  assert.equal((await post({ text: 'hi', platforms: ['x'], subtitles: id })).status, 400);
  await fetch(`${base}/api/media/${id}`, { method: 'DELETE' });
});

test('making subtitles needs a real video, a plain language code and a JSON request', async () => {
  const make = (body, type = 'application/json') =>
    fetch(`${base}/api/subtitles`, { method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify(body) });
  assert.equal((await make({ video: '0'.repeat(32), language: 'hi', subtitles: ['hi', 'en'] })).status, 400);
  assert.equal((await make({}, 'text/plain')).status, 415);

  // A PNG isn't a video; and only codes like "hi" reach transcribe's command line.
  const { id } = await (await upload(PNG, 'image/png')).json();
  assert.match((await (await make({ video: id, language: 'hi', subtitles: ['hi'] })).json()).error, /expired/);
  await fetch(`${base}/api/media/${id}`, { method: 'DELETE' });

  // Only Hindi and English, refused before any job starts.
  const video = (await (await upload(Buffer.from('not really a video'), 'video/mp4', 'v.mp4')).json()).id;
  const only = /only be in Hindi or English/;
  assert.match((await (await make({ video, language: 'fr', subtitles: ['en'] })).json()).error, only);
  assert.match((await (await make({ video, language: 'hi', subtitles: ['hi', 'fr'] })).json()).error, only);
  assert.match((await (await make({ video, language: '--fresh', subtitles: ['en'] })).json()).error, only);
  // Hindi and English get past the language check (this test's server has no transcribe).
  assert.match((await (await make({ video, language: 'hi', subtitles: ['hi', 'en'] })).json()).error, /TRANSCRIBE_DIR/);
  assert.match((await (await make({ video, language: 'en', subtitles: ['en'] })).json()).error, /TRANSCRIBE_DIR/);

  // Subtitles sent with a post are held to the same languages.
  const srt = (await (await upload(Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nBonjour\n'), 'application/x-subrip', 'fr.srt')).json()).id;
  const french = await post({ text: 'hi', platforms: ['x'], media: [video], subtitles: { [video]: { fr: srt } } });
  assert.equal(french.status, 400);
  assert.match((await french.json()).error, only);
  await fetch(`${base}/api/media/${srt}`, { method: 'DELETE' });
  await fetch(`${base}/api/media/${video}`, { method: 'DELETE' });

  const stop = (jobId) => fetch(`${base}/api/subtitles/${jobId}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await stop('0'.repeat(32))).status, 404);
  assert.equal((await stop('nope')).status, 404);
});

test('the subtitled preview needs a real video and SRT, and a JSON request', async () => {
  const preview = (body, type = 'application/json') =>
    fetch(`${base}/api/subtitled`, { method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify(body) });
  assert.equal((await preview({ video: '0'.repeat(32), subtitles: '1'.repeat(32) })).status, 400);
  assert.equal((await preview({}, 'text/plain')).status, 415);
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

test('serves the page assets and only known script names', async () => {
  assert.equal((await fetch(`${base}/styles.css`)).status, 200);
  const main = await fetch(`${base}/js/main.js`);
  assert.equal(main.status, 200);
  assert.match(main.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${base}/js/nope.js`)).status, 404);
  assert.equal((await fetch(`${base}/js/..%2Fserver.js`)).status, 404);
});

test('reports ffmpeg and tunnel status', async () => {
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(typeof status.ffmpeg, 'boolean');
  // No TRANSCRIBE_DIR in the test's environment, so no subtitle generator.
  assert.equal(status.subtitles, false);
  assert.equal(status.subtitlesProblem, null);
  assert.deepEqual(status.tunnel, { configured: false, reachable: false });
  // The health file the tunnel check fetches is public, like other /media/ files.
  assert.equal(await rawGet('/media/health', { Host: 'abc.trycloudflare.com', 'X-Forwarded-For': '1.2.3.4' }), 204);
});

const json = (method, path, body) =>
  fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('schedules a post from the page, lists it, and changes it while it waits', async () => {
  const { id: image } = await (await upload(PNG, 'image/png')).json();
  // Noon in 3 days, inside posting hours whenever the test runs.
  const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).setHours(12, 0, 0, 0);

  // Like the other write endpoints, a cross-site form post is refused.
  const plain = await fetch(`${base}/api/schedule`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415);
  assert.equal((await json('POST', '/api/schedule', { text: 'Hi', platforms: ['x'], when: 'picked', at: Date.now() - 1000 })).status, 400);
  assert.equal((await json('POST', '/api/schedule', { text: 'x'.repeat(300), platforms: ['x'], when: 'picked', at: later })).status, 400);

  const res = await json('POST', '/api/schedule', { text: 'Later', platforms: ['x'], media: [image], when: 'picked', at: later });
  assert.equal(res.status, 201);
  const post = await res.json();
  assert.equal(post.state, 'waiting');
  assert.equal(post.kind, 'image');
  assert.equal(post.at, later);
  // The upload was copied, so deleting it doesn't affect the post.
  await fetch(`${base}/api/media/${image}`, { method: 'DELETE' });

  const { posts } = await (await fetch(`${base}/api/schedule`)).json();
  assert.ok(posts.some((p) => p.id === post.id && p.text === 'Later'));

  const moved = await (await json('POST', `/api/schedule/${post.id}/move`, { at: later + 60_000 })).json();
  assert.equal(moved.post.at, later + 60_000);
  const edited = await (await json('PUT', `/api/schedule/${post.id}`, { text: 'Edited', options: {} })).json();
  assert.equal(edited.post.text, 'Edited');
  assert.equal((await (await json('POST', `/api/schedule/${post.id}/cancel`, {})).json()).post.state, 'cancelled');
  assert.equal((await json('POST', `/api/schedule/${post.id}/cancel`, {})).status, 409);
  assert.equal((await json('POST', `/api/schedule/${post.id}/delete`, {})).status, 200);
  assert.equal((await json('POST', `/api/schedule/${post.id}/delete`, {})).status, 404);
});

test('a post sent straight from the page is kept for the Calendar', async () => {
  await events(await post({ text: 'Straight away', platforms: ['x'] }));
  for (let i = 0; i < 50; i++) {
    const { posts } = await (await fetch(`${base}/api/schedule`)).json();
    const kept = posts.find((p) => p.text === 'Straight away');
    if (kept) {
      assert.equal(kept.state, 'done');
      assert.equal(kept.when, 'now');
      assert.equal(kept.results[0].ok, false);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('the post was not kept');
});
