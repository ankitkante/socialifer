// Phone posts waiting on the laptop. Each lives in queue/<id>/ (post.json, and its files named by index) until
// the phone has collected the results. Posts go out one at a time, in the order they became ready.
// States: receiving (files still arriving) → waiting → posting → done. A post caught mid-posting by a restart
// becomes unknown and is never retried, since some platforms may already have it.
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { platforms } from './platforms/index.js';
import { isVideo } from './public/rules.js';
import { EXTENSIONS, MAX_UPLOAD_BYTES, httpError, importFile, getMedia, deleteMedia, probeDuration } from './media.js';
import { log } from './log.js';

const ID_RE = /^[a-f0-9]{32}$/;
const MAX_FILES = 20;
const MAX_TEXT = 100_000;
// Posts the phone never collects (or never finished sending) go after a week.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const POST_TYPES = new Set(Object.keys(EXTENSIONS).filter((t) => /^(image|video)\//.test(t)));
const KNOWN = new Set(platforms.map((p) => p.id));

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// An image field (thumbnail, cover) refers to one of the post's files as { file: n }.
const isFileRef = (v) => isPlainObject(v) && Object.keys(v).length === 1 && Number.isInteger(v.file);

// Checks what the phone sends and keeps only what's expected. Throws 400 with a message to show.
function checkPost(body) {
  const bad = (message) => httpError(400, message);
  if (!isPlainObject(body)) throw bad('Invalid request');
  const { text = '', platforms: ids, options = {}, files = [], media = [] } = body;
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw bad('Invalid request');
  if (!Array.isArray(ids) || ids.length === 0) throw bad('Select at least one platform');
  if (ids.some((id) => !KNOWN.has(id)) || new Set(ids).size !== ids.length) throw bad('Unknown platform. Update the app.');
  if (!isPlainObject(options) || Object.entries(options).some(([id, o]) => !KNOWN.has(id) || !isPlainObject(o))) throw bad('Invalid request');
  if (!Array.isArray(files) || files.length > MAX_FILES) throw bad(`A post can have at most ${MAX_FILES} files.`);
  const cleanFiles = files.map((f) => {
    if (!isPlainObject(f) || typeof f.name !== 'string' || !f.name || f.name.length > 200) throw bad('Invalid request');
    if (!POST_TYPES.has(f.type)) throw bad(`${f.name}: unsupported file type. Use JPEG, PNG, GIF, WebP, MP4 or MOV.`);
    if (!Number.isSafeInteger(f.size) || f.size <= 0) throw bad('Invalid request');
    if (f.size > MAX_UPLOAD_BYTES) throw bad(`${f.name} is larger than ${MAX_UPLOAD_BYTES / 1_000_000} MB.`);
    const duration = Number.isFinite(f.duration) && f.duration > 0 ? f.duration : null;
    return { name: f.name, type: f.type, size: f.size, duration };
  });
  const inRange = (n) => Number.isInteger(n) && n >= 0 && n < cleanFiles.length;
  if (!Array.isArray(media) || !media.every(inRange) || new Set(media).size !== media.length) throw bad('Invalid request');
  const used = new Set(media);
  for (const own of Object.values(options)) {
    for (const value of Object.values(own)) {
      if (!isFileRef(value)) continue;
      if (!inRange(value.file) || isVideo(cleanFiles[value.file])) throw bad('Invalid request');
      used.add(value.file);
    }
  }
  if (used.size !== cleanFiles.length) throw bad('Invalid request');
  const anyText = text.trim() || Object.values(options).some((o) => typeof o.text === 'string' && o.text.trim());
  if (!anyText && media.length === 0) throw bad('Add some text, an image or a video');
  return { text: text.trim(), platforms: ids, options, files: cleanFiles, media };
}

// Swaps each { file: n } in the options for the upload id that file was copied to.
function withUploadIds(options, ids) {
  return Object.fromEntries(Object.entries(options).map(([id, own]) => [
    id, Object.fromEntries(Object.entries(own).map(([key, value]) => [key, isFileRef(value) ? ids[value.file] : value])),
  ]));
}

const everyPlatform = (post, error) => post.platforms.map((id) => ({
  id, name: platforms.find((p) => p.id === id)?.name ?? id, ok: false, url: null, warnings: [], error,
}));

export function createQueue({ dir, publish }) {
  const posts = new Map();
  // What each platform of the post being posted is doing right now: { [platformId]: { step, progress } }.
  const live = new Map();
  let running = false;

  const folder = (id) => new URL(`${id}/`, dir);
  const fileUrl = (post, n) => new URL(`${n}.${EXTENSIONS[post.files[n].type]}`, folder(post.id));
  const missing = (post) => post.files.map((_, n) => n).filter((n) => !post.received.includes(n));

  async function save(post) {
    const tmp = new URL('post.json.tmp', folder(post.id));
    await writeFile(tmp, JSON.stringify(post, null, 2));
    await rename(tmp, new URL('post.json', folder(post.id)));
  }

  function summary(post) {
    return {
      id: post.id,
      state: post.state,
      missing: missing(post),
      steps: live.get(post.id) ?? null,
      results: post.results ?? null,
    };
  }

  function find(id) {
    const post = ID_RE.test(id) ? posts.get(id) : null;
    if (!post) throw httpError(404, "The laptop doesn't have this post. Send it again.");
    return post;
  }

  async function load() {
    await mkdir(dir, { recursive: true });
    for (const name of await readdir(dir)) {
      if (!ID_RE.test(name)) continue;
      try {
        const post = JSON.parse(await readFile(new URL('post.json', folder(name)), 'utf8'));
        if (post.state === 'posting') {
          post.state = 'unknown';
          post.results = everyPlatform(post, "The laptop's server stopped while posting this. Check the platform before posting it again.");
          post.finishedAt = Date.now();
          await save(post);
          log.warn(`Phone post ${name.slice(0, 8)} was being posted when the server stopped; marked unknown.`);
        }
        posts.set(name, post);
      } catch (err) {
        log.warn(`Couldn't read phone post ${name} (${err.message}); left it alone.`);
      }
    }
    await cleanup();
    run();
  }

  async function cleanup() {
    const now = Date.now();
    for (const post of [...posts.values()]) {
      const finished = (post.state === 'done' || post.state === 'unknown') && now - (post.finishedAt ?? 0) > KEEP_MS;
      const abandoned = post.state === 'receiving' && now - post.createdAt > KEEP_MS;
      if (finished || abandoned) await forget(post);
    }
  }

  async function forget(post) {
    posts.delete(post.id);
    await rm(folder(post.id), { recursive: true, force: true });
  }

  // The phone makes the id, so sending the same post again returns it as it is instead of posting it twice.
  async function create(id, body) {
    if (!ID_RE.test(id)) throw httpError(400, 'Invalid request');
    if (posts.has(id)) return summary(posts.get(id));
    const post = { id, ...checkPost(body), state: 'receiving', received: [], results: null, createdAt: Date.now() };
    await mkdir(folder(id), { recursive: true });
    await save(post);
    posts.set(id, post);
    return summary(post);
  }

  async function receiveFile(id, n, req) {
    const post = find(id);
    const file = Number.isInteger(n) ? post.files[n] : null;
    if (!file) throw httpError(404, 'Not found');
    // Already here (a resend after a dropped connection): nothing to store.
    if (post.received.includes(n) || post.state !== 'receiving') {
      req.resume();
      return summary(post);
    }
    if (req.headers['content-type'] !== file.type || Number(req.headers['content-length']) !== file.size) {
      throw httpError(400, `${file.name} doesn't match what the post said it would be. Send the post again.`);
    }
    const part = new URL(`${n}.part`, folder(id));
    let size = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        callback(size > file.size ? httpError(400, `${file.name} is bigger than expected.`) : null, chunk);
      },
    });
    try {
      await pipeline(req, limiter, createWriteStream(part));
      if (size !== file.size) throw httpError(400, `${file.name} didn't arrive in full. It will be sent again.`);
    } catch (err) {
      await rm(part, { force: true });
      throw err;
    }
    await rename(part, fileUrl(post, n));
    post.received.push(n);
    await save(post);
    return summary(post);
  }

  async function ready(id) {
    const post = find(id);
    if (post.state !== 'receiving') return summary(post);
    if (missing(post).length) throw httpError(409, "Some of the post's files haven't arrived yet.");
    post.state = 'waiting';
    post.readyAt = Date.now();
    await save(post);
    log.info(`Phone post ${id.slice(0, 8)} queued for ${post.platforms.join(', ')}`);
    run();
    return summary(post);
  }

  const status = (ids) => ids.map((id) => (posts.has(id) ? summary(posts.get(id)) : { id, state: 'missing' }));

  async function remove(id) {
    const post = find(id);
    if (post.state === 'posting') throw httpError(409, 'This post is being posted right now.');
    await forget(post);
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const next = [...posts.values()].filter((p) => p.state === 'waiting').sort((a, b) => a.readyAt - b.readyAt)[0];
        if (!next) break;
        await postOne(next);
      }
    } finally {
      running = false;
    }
  }

  async function postOne(post) {
    post.state = 'posting';
    await save(post);
    const steps = {};
    live.set(post.id, steps);
    const imported = [];
    try {
      const ids = [];
      for (const [n, f] of post.files.entries()) {
        const meta = await importFile(fileURLToPath(fileUrl(post, n)), f.type, f.name);
        imported.push(meta.id);
        ids[n] = meta.id;
      }
      // ffprobe's length wins, as for the page; the phone's is the fallback.
      const media = await Promise.all(post.media.map(async (n) => {
        const m = await getMedia(ids[n]);
        if (isVideo(m)) m.duration = (await probeDuration(m)) ?? post.files[n].duration;
        return m;
      }));
      post.results = await publish(post.text, post.platforms, media, withUploadIds(post.options, ids), {}, (event) => {
        if (event.type === 'status') steps[event.id] = { step: event.step, progress: event.progress ?? null };
      });
    } catch (err) {
      log.error(`Phone post ${post.id.slice(0, 8)} couldn't be prepared`, err?.stack ?? String(err));
      post.results = everyPlatform(post, "The laptop couldn't prepare this post's files. The details are in the terminal.");
    } finally {
      live.delete(post.id);
      // Posting is over, so the copies (and any compressed versions) can go; the queue keeps its own files.
      for (const id of imported) await deleteMedia(id).catch(() => {});
    }
    post.state = 'done';
    post.finishedAt = Date.now();
    await save(post);
  }

  return { load, cleanup, create, receiveFile, ready, status, remove, idle: () => !running };
}
