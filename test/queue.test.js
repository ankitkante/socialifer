import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPhoneServer, signature, sha256 } from '../phone.js';
import { createQueue } from '../queue.js';
import { getMedia } from '../media.js';

const KEY = 'c'.repeat(32);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const newId = () => crypto.randomBytes(16).toString('hex');

let dir, server, base, queue;
// Every publish() call the queue makes: { text, ids, media, options }.
const calls = [];
let publishDelay = 0;
let active = 0;
let maxActive = 0;

async function fakePublish(text, ids, media, options) {
  active++;
  maxActive = Math.max(maxActive, active);
  // The copies must exist while posting; they're checked again after.
  calls.push({ text, ids, media: await Promise.all(media.map((m) => getMedia(m.id))), options });
  await new Promise((resolve) => setTimeout(resolve, publishDelay));
  active--;
  return ids.map((id) => ({ id, name: id, ok: true, url: `https://example.com/${id}`, warnings: [], error: null }));
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sp-queue-'));
  queue = createQueue({ dir: pathToFileURL(`${dir}/`), publish: fakePublish });
  await queue.load();
  server = createPhoneServer(KEY, queue);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

function send(method, path, { json, file, type } = {}) {
  const body = json === undefined ? file : JSON.stringify(json);
  const digest = file ? `${type}:${file.length}` : sha256(body ?? '');
  const time = String(Date.now());
  const nonce = newId();
  const headers = {
    'X-SP-Time': time, 'X-SP-Nonce': nonce,
    'X-SP-Signature': signature(KEY, { method, path, time, nonce, digest }),
    ...(json !== undefined && { 'Content-Type': 'application/json' }),
    ...(file && { 'Content-Type': type }),
  };
  return fetch(`${base}${path}`, { method, headers, ...(body !== undefined && { body }) });
}

async function until(id, state) {
  for (let i = 0; i < 200; i++) {
    const [s] = await (await send('GET', `/app/posts?ids=${id}`)).json();
    if (s.state === state) return s;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`post never reached ${state}`);
}

const imagePost = (extra = {}) => ({
  text: 'Hello from the phone',
  platforms: ['x', 'youtube'],
  files: [{ name: 'a.png', type: 'image/png', size: PNG.length }, { name: 'thumb.png', type: 'image/png', size: PNG.length }],
  media: [0],
  options: { youtube: { title: 'Title', thumbnail: { file: 1 } } },
  ...extra,
});

test('a post arrives in parts, is queued, posted and collected', async () => {
  const id = newId();
  const created = await (await send('PUT', `/app/posts/${id}`, { json: imagePost() })).json();
  assert.equal(created.state, 'receiving');
  assert.deepEqual(created.missing, [0, 1]);

  assert.equal((await send('POST', `/app/posts/${id}/ready`)).status, 409);
  for (const n of [0, 1]) {
    assert.equal((await send('PUT', `/app/posts/${id}/files/${n}`, { file: PNG, type: 'image/png' })).status, 200);
  }
  // A resend after a dropped connection changes nothing.
  assert.equal((await send('PUT', `/app/posts/${id}/files/0`, { file: PNG, type: 'image/png' })).status, 200);

  const before = calls.length;
  assert.equal((await send('POST', `/app/posts/${id}/ready`)).status, 200);
  const done = await until(id, 'done');
  assert.equal(done.results.length, 2);
  assert.ok(done.results.every((r) => r.ok));

  const call = calls[before];
  assert.equal(call.text, 'Hello from the phone');
  assert.deepEqual(call.ids, ['x', 'youtube']);
  assert.equal(call.media.length, 1);
  assert.equal(call.media[0].size, PNG.length);
  // The thumbnail reference became the id of its copy in uploads/.
  assert.match(call.options.youtube.thumbnail, /^[a-f0-9]{32}$/);
  assert.equal(call.options.youtube.title, 'Title');
  // The copies are gone once posting is over.
  assert.equal(await getMedia(call.media[0].id), null);
  assert.equal(await getMedia(call.options.youtube.thumbnail), null);

  // Sending the same post again doesn't post it twice.
  const again = await (await send('PUT', `/app/posts/${id}`, { json: imagePost() })).json();
  assert.equal(again.state, 'done');
  assert.equal(calls.length, before + 1);

  assert.equal((await send('DELETE', `/app/posts/${id}`)).status, 204);
  const [gone] = await (await send('GET', `/app/posts?ids=${id}`)).json();
  assert.equal(gone.state, 'missing');
});

test('a text-only post needs no files', async () => {
  const id = newId();
  await send('PUT', `/app/posts/${id}`, { json: { text: 'Just text', platforms: ['x'] } });
  assert.equal((await send('POST', `/app/posts/${id}/ready`)).status, 200);
  assert.equal((await until(id, 'done')).results[0].ok, true);
});

test('refuses posts and files that are not what they should be', async () => {
  const bad = async (json) => (await send('PUT', `/app/posts/${newId()}`, { json })).status;
  assert.equal(await bad({ text: 'x', platforms: ['myspace'] }), 400);
  assert.equal(await bad({ text: 'x', platforms: [] }), 400);
  assert.equal(await bad({ text: '', platforms: ['x'] }), 400);
  assert.equal(await bad({ text: 'x', platforms: ['x'], files: [{ name: 'a.exe', type: 'application/x-msdownload', size: 3 }], media: [0] }), 400);
  // A file the post doesn't use.
  assert.equal(await bad({ text: 'x', platforms: ['x'], files: [{ name: 'a.png', type: 'image/png', size: 3 }] }), 400);

  const id = newId();
  await send('PUT', `/app/posts/${id}`, { json: imagePost() });
  assert.equal((await send('PUT', `/app/posts/${id}/files/0`, { file: PNG, type: 'image/jpeg' })).status, 400);
  assert.equal((await send('PUT', `/app/posts/${id}/files/5`, { file: PNG, type: 'image/png' })).status, 404);
  assert.equal((await send('PUT', `/app/posts/${newId()}/files/0`, { file: PNG, type: 'image/png' })).status, 404);
});

test('posts go out one at a time, in the order they became ready', async () => {
  publishDelay = 50;
  maxActive = 0;
  const ids = [newId(), newId(), newId()];
  const start = calls.length;
  for (const [i, id] of ids.entries()) {
    await send('PUT', `/app/posts/${id}`, { json: { text: `Post ${i}`, platforms: ['x'] } });
    await send('POST', `/app/posts/${id}/ready`);
  }
  for (const id of ids) await until(id, 'done');
  publishDelay = 0;
  assert.equal(maxActive, 1);
  assert.deepEqual(calls.slice(start).map((c) => c.text), ['Post 0', 'Post 1', 'Post 2']);
});

test('a post caught mid-posting by a restart becomes unknown and is not retried', async () => {
  const other = await mkdtemp(join(tmpdir(), 'sp-queue-'));
  const id = newId();
  await mkdir(join(other, id));
  await writeFile(join(other, id, 'post.json'), JSON.stringify({
    id, text: 'x', platforms: ['x'], options: {}, files: [], media: [], state: 'posting', received: [], results: null, createdAt: Date.now(),
  }));
  let posted = 0;
  const restarted = createQueue({ dir: pathToFileURL(`${other}/`), publish: async () => { posted++; return []; } });
  await restarted.load();
  const [s] = restarted.status([id]);
  assert.equal(s.state, 'unknown');
  assert.match(s.results[0].error, /stopped while posting/);
  assert.equal(posted, 0);
  assert.equal(JSON.parse(await readFile(join(other, id, 'post.json'), 'utf8')).state, 'unknown');
  await rm(other, { recursive: true, force: true });
});
