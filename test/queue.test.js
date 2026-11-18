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

  // Collected by the phone, it stays as history for the Calendar, without its files.
  assert.equal((await send('DELETE', `/app/posts/${id}`)).status, 204);
  const [kept] = await (await send('GET', `/app/posts?ids=${id}`)).json();
  assert.equal(kept.state, 'done');
  assert.equal(kept.collected, true);
  assert.equal(kept.filesRemoved, true);
  await assert.rejects(readFile(join(dir, id, '0.png')));
});

// Text posts are kept an hour apart, so these tests pick a time a moment ahead (picked times aren't moved).
const soon = (ms = 400) => ({ when: 'picked', at: Date.now() + ms });

test('a text-only post needs no files', async () => {
  const id = newId();
  await send('PUT', `/app/posts/${id}`, { json: { text: 'Just text', platforms: ['x'], ...soon() } });
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
    await send('PUT', `/app/posts/${id}`, { json: { text: `Post ${i}`, platforms: ['x'], ...soon(400 + i) } });
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

// ---- Scheduling, on a queue of its own with a fixed clock: 10 AM on Thu 19 Nov 2026, laptop time ----

const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const NOW = at(19, 10);

async function scheduleQueue(saved) {
  const folder = await mkdtemp(join(tmpdir(), 'sp-posts-'));
  for (const post of saved) {
    await mkdir(join(folder, post.id));
    await writeFile(join(folder, post.id, 'post.json'), JSON.stringify(post));
    for (const [n, f] of post.files.entries()) {
      if (!post.filesRemoved) await writeFile(join(folder, post.id, `${n}.${f.type === 'video/mp4' ? 'mp4' : 'png'}`), PNG);
    }
  }
  const posted = [];
  const q = createQueue({
    dir: pathToFileURL(`${folder}/`),
    now: () => NOW,
    publish: async (text, ids, media, options) => {
      posted.push({ text, ids, options });
      return ids.map((id) => ({ id, name: id, ok: true, url: `https://example.com/${id}`, warnings: [], error: null }));
    },
  });
  await q.load();
  // Lets the queue's first run finish.
  for (let i = 0; i < 50 && !q.idle(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  return { q, posted, folder, done: async () => { q.stop(); await rm(folder, { recursive: true, force: true }); } };
}

const saved = (extra) => ({
  id: newId(), source: 'phone', text: 'Saved post', platforms: ['x'], options: {}, files: [], media: [], subtitles: {},
  state: 'waiting', received: [], results: null, createdAt: NOW - 1000, kind: 'text', when: 'auto', at: NOW + 60 * 60 * 1000, ...extra,
});
const videoFiles = { files: [{ name: 'v.mp4', type: 'video/mp4', size: PNG.length, duration: 10 }], media: [0], received: [0], kind: 'video' };

test('posts missed while the laptop was off move to the next free time, never all at once', async () => {
  const history = saved({ state: 'done', at: at(19, 9, 30), postedAt: at(19, 9, 30), kind: 'image', filesRemoved: true });
  const video = saved({ ...videoFiles, when: 'picked', at: at(19, 8) });
  const text = saved({ text: 'Missed text', at: at(19, 9) });
  const { q, posted, done } = await scheduleQueue([history, video, text]);
  const [v, t] = q.status([video.id, text.id]);
  assert.equal(v.state, 'waiting');
  assert.equal(v.at, at(19, 13, 30));
  assert.equal(v.moved.from, at(19, 8));
  // An hour after the X image post at 9:30, since both go to X.
  assert.equal(t.at, at(19, 10, 30));
  assert.deepEqual(posted, []);
  await done();
});

test('missed text posts go an hour apart, the first at once', async () => {
  const texts = [8, 8.1, 8.2].map((h, i) => saved({ text: `Missed ${i}`, at: at(19, 8, i * 10) }));
  const { q, posted, done } = await scheduleQueue(texts);
  const [a, b, c] = q.status(texts.map((p) => p.id));
  assert.equal(a.state, 'done');
  assert.equal(b.at, at(19, 11));
  assert.equal(c.at, at(19, 12));
  assert.deepEqual(posted.map((p) => p.text), ['Missed 0']);
  await done();
});

test('a video for YouTube at a picked time is uploaded now with publishAt; the others wait for the time', async () => {
  const post = saved({ ...videoFiles, platforms: ['youtube', 'x'], when: 'picked', at: at(19, 15), youtube: 'pending', options: { youtube: { title: 'T' } } });
  const { q, posted, done } = await scheduleQueue([post]);
  assert.deepEqual(posted.map((p) => p.ids), [['youtube']]);
  assert.equal(posted[0].options.youtube.publishAt, new Date(at(19, 15)).toISOString());
  const [s] = q.status([post.id]);
  assert.equal(s.state, 'waiting');
  assert.equal(s.youtube, 'done');
  assert.deepEqual(s.results.map((r) => r.id), ['youtube']);

  // Changing it now leaves YouTube as it is, and says so.
  const moved = await q.move(post.id, at(19, 16));
  assert.match(moved.note, /YouTube Studio/);
  const cancelled = await q.cancel(post.id);
  assert.match(cancelled.note, /YouTube already has this video/);
  const [kept] = q.status([post.id]);
  assert.equal(kept.state, 'done');
  assert.deepEqual(kept.platforms, ['youtube']);
  await done();
});

test('a waiting post can be moved, edited, posted now or cancelled; a finished one cannot', async () => {
  const waiting = saved({ text: 'Before' });
  const other = saved({ text: 'Cancel me' });
  const finished = saved({ state: 'done', postedAt: at(19, 9), filesRemoved: true, results: [] });
  const { q, posted, done } = await scheduleQueue([waiting, other, finished]);

  await assert.rejects(q.move(waiting.id, at(19, 9)), /time has passed/);
  assert.equal((await q.move(waiting.id, at(19, 18))).post.at, at(19, 18));
  assert.equal((await q.edit(waiting.id, { text: 'After', options: { x: { altText: 'A' } } })).post.text, 'After');
  await assert.rejects(q.edit(waiting.id, { text: 'x'.repeat(300) }), /X: Too long for one post/);

  await q.postNow(waiting.id);
  for (let i = 0; i < 50 && q.status([waiting.id])[0].state !== 'done'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(posted.map((p) => p.text), ['After']);

  assert.deepEqual(await q.cancel(other.id), { post: null, note: null });
  assert.equal(q.status([other.id])[0].state, 'missing');

  for (const change of [() => q.move(finished.id, at(19, 18)), () => q.cancel(finished.id), () => q.postNow(finished.id), () => q.edit(finished.id, { text: 'x' })]) {
    await assert.rejects(change(), /already on the platforms/);
  }
  await done();
});

test('the clean-up never removes a waiting post, only a phone post whose files never arrived', async () => {
  const old = NOW - 30 * 24 * 60 * 60 * 1000;
  const waiting = saved({ createdAt: old, at: at(25, 10) });
  const stuck = saved({ ...videoFiles, state: 'receiving', received: [], createdAt: old, at: null, when: 'auto' });
  const { q, done } = await scheduleQueue([waiting, stuck]);
  await q.cleanup();
  const [w, s] = q.status([waiting.id, stuck.id]);
  assert.equal(w.state, 'waiting');
  assert.equal(s.state, 'missing');
  await done();
});

test('posts from before scheduling are read as phone posts that went when ready', async () => {
  const legacy = { id: newId(), text: 'Old', platforms: ['x'], options: {}, files: [], media: [], state: 'done', received: [], results: [], createdAt: at(10, 9), readyAt: at(10, 9), finishedAt: at(10, 9) };
  const { q, done } = await scheduleQueue([legacy]);
  const [s] = q.list();
  assert.equal(s.source, 'phone');
  assert.equal(s.kind, 'text');
  assert.equal(s.postedAt, at(10, 9));
  await done();
});
