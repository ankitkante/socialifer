// Every post the laptop keeps: scheduled posts from the web page and the phone, and the history of finished ones.
// Each lives in POSTS_DIR/<id>/ (post.json, and its files named by index). Posts go out one at a time, each at its
// time. States: receiving (phone files still arriving) → waiting → posting → done, or waiting → cancelled. A post
// caught mid-posting by a restart becomes unknown and is never retried, since some platforms may already have it.
// Finished and cancelled posts keep their post.json as history; their files are deleted. Delete removes a post
// for good; only its id is kept (deleted.json), so the phone can remove its own copy.
import { createWriteStream } from 'node:fs';
import { cp, copyFile, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { platforms } from './platforms/index.js';
import { isVideo, isSubtitleLanguage, postKind, nextFreeTime, outsideHours, problemsFor, formatTime, formatDay, isoTime } from './public/rules.js';
import { EXTENSIONS, MAX_UPLOAD_BYTES, httpError, importFile, getMedia, deleteMedia, probeDuration } from './media.js';
import { describe } from './publish.js';
import { log } from './log.js';

const ID_RE = /^[a-f0-9]{32}$/;
const MAX_FILES = 20;
const MAX_TEXT = 100_000;
// A phone post whose files never all arrived is dropped after a week; it was never scheduled.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// The clock is checked this often; a longer gap means the laptop was asleep, and missed posts are moved.
const TICK_MS = 30_000;
const ASLEEP_MS = 2 * 60_000;
// setTimeout can't wait longer than about 24.8 days.
const MAX_WAIT_MS = 2 ** 31 - 1;
const SRT = 'application/x-subrip';
const POST_TYPES = new Set(Object.keys(EXTENSIONS).filter((t) => /^(image|video)\//.test(t)));
const KNOWN = new Set(platforms.map((p) => p.id));
// 'now': Immediately, whatever the posting hours and gaps (decided 2026-11-19).
const WHEN = new Set(['auto', 'picked', 'now']);
// Keys of platform fields that hold an image (YouTube's thumbnail, Instagram's cover).
const IMAGE_FIELDS = Object.fromEntries(platforms.map((p) => [p.id, new Set(p.mediaOptions ?? [])]));

// Where posts are kept: outside the project, so git clean or a fresh clone can't delete them.
export function postsDir() {
  return process.env.POSTS_DIR?.trim() || join(homedir(), 'Socialifer', 'posts');
}

// Posts are named in the log by where they came from and the start of their id; the phone's activity log
// uses the same 8 characters.
const label = (post) => `${post.source === 'web' ? 'Web' : 'Phone'} post ${post.id.slice(0, 8)}`;
const mb = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;
const when = (at) => `${formatDay(at)}, ${formatTime(at)}`;

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// An image field (thumbnail, cover) refers to one of the post's files as { file: n }.
const isFileRef = (v) => isPlainObject(v) && Object.keys(v).length === 1 && Number.isInteger(v.file);
const hasVideo = (post) => post.media.some((n) => isVideo(post.files[n]));
// A video for YouTube at a time the user picked is uploaded straight away with YouTube's own publish time.
const youtubeAhead = (post) => post.when === 'picked' && post.platforms.includes('youtube') && hasVideo(post);

function checkTime(at) {
  if (!Number.isSafeInteger(at)) throw httpError(400, "The time isn't valid. Pick it again.");
  return at;
}

function checkWhen(body) {
  const kind = body.when ?? 'auto';
  if (!WHEN.has(kind)) throw httpError(400, 'Invalid request');
  return kind === 'picked' ? { when: kind, at: checkTime(body.at) } : { when: kind, at: null };
}

// Checks what the phone sends and keeps only what's expected. Throws 400 with a message to show.
function checkPost(body) {
  const bad = (message) => httpError(400, message);
  if (!isPlainObject(body)) throw bad('Invalid request');
  const { text = '', platforms: ids, options = {}, files = [], media = [] } = body;
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw bad('Invalid request');
  if (!Array.isArray(ids) || ids.length === 0) throw bad('Select at least one platform');
  if (ids.some((id) => !KNOWN.has(id)) || new Set(ids).size !== ids.length) throw bad('Unknown platform. Update the app.');
  checkOptions(options);
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
  // When Post was tapped on the phone, for the log's timing summary; ignored if it isn't a plausible time.
  const madeAt = Number.isSafeInteger(body.madeAt) && body.madeAt > 0 && body.madeAt <= Date.now() + 60 * 60 * 1000 ? body.madeAt : null;
  return { text: text.trim(), platforms: ids, options, files: cleanFiles, media, subtitles: {}, ...checkWhen(body), ...(madeAt && { madeAt }) };
}

function checkOptions(options) {
  if (!isPlainObject(options) || Object.entries(options).some(([id, o]) => !KNOWN.has(id) || !isPlainObject(o))) {
    throw httpError(400, 'Invalid request');
  }
}

// The platform's problems with this post, as the server would find them when posting (problemsFor), so a post
// that can't go isn't scheduled. Image fields are checked by their files' type and size.
function problemsOf(post) {
  const media = post.media.map((n) => post.files[n]);
  const problems = [];
  for (const id of post.platforms) {
    const p = platforms.find((x) => x.id === id);
    const own = Object.fromEntries(Object.entries(post.options[id] ?? {})
      .map(([key, value]) => [key, isFileRef(value) ? post.files[value.file] : value]));
    for (const problem of problemsFor({ ...describe(p), name: p.name }, post.text, media, own)) problems.push(`${p.name}: ${problem}`);
  }
  return problems;
}

// Swaps each { file: n } in the options for the upload id that file was copied to.
function withUploadIds(options, ids) {
  return Object.fromEntries(Object.entries(options).map(([id, own]) => [
    id, Object.fromEntries(Object.entries(own).map(([key, value]) => [key, isFileRef(value) ? ids[value.file] : value])),
  ]));
}

const resultFor = (id, error) => ({ id, name: platforms.find((p) => p.id === id)?.name ?? id, ok: false, url: null, warnings: [], error });

// postingHours: false lets tests pick a time a moment ahead at any hour.
export function createQueue({ dir, publish, now = () => Date.now(), postingHours = true }) {
  const posts = new Map();
  // What each platform of the post being posted is doing right now: { [postId]: { [platformId]: { step, progress } } }.
  const live = new Map();
  let running = false;
  // The post being posted (or uploaded to YouTube ahead of its time), which can't be changed meanwhile.
  let current = null;
  let timer = null;
  let ticker = null;
  let lastTick = now();

  const folder = (id) => new URL(`${id}/`, dir);
  const fileUrl = (post, n) => new URL(`${n}.${EXTENSIONS[post.files[n].type]}`, folder(post.id));
  const missing = (post) => post.files.map((_, n) => n).filter((n) => !post.received.includes(n));
  // When a post went or goes out: its posting time once posted, else its scheduled time.
  const timeOf = (post) => post.postedAt ?? post.at;
  // Ids of deleted posts, kept so the phone learns its copy is gone (no text or files).
  const deleted = new Set();
  const deletedFile = () => new URL('deleted.json', dir);
  const isHistory = (post) => post.state === 'done' || post.state === 'unknown' || post.state === 'cancelled';
  // A picked time must be in posting hours. One already passed isn't refused: a phone post that arrives late is
  // moved instead (see schedule()).
  const refuseOutsideHours = (at) => {
    if (postingHours && at > now() && outsideHours(at)) throw httpError(400, outsideHours(at));
  };

  async function save(post) {
    const tmp = new URL('post.json.tmp', folder(post.id));
    await writeFile(tmp, JSON.stringify(post, null, 2));
    await rename(tmp, new URL('post.json', folder(post.id)));
  }

  // Everything the page and the phone show about a post. received is internal.
  function summary(post) {
    const { received: _, ...rest } = post;
    return { ...rest, missing: missing(post), steps: live.get(post.id) ?? null, results: post.results ?? null };
  }

  function find(id) {
    const post = ID_RE.test(id) ? posts.get(id) : null;
    if (!post) throw httpError(404, "The laptop doesn't have this post. Send it again.");
    return post;
  }

  // The other posts that hold a time, for the slot rules: waiting ones and those already out.
  function taken(except) {
    return [...posts.values()]
      .filter((p) => p !== except && p.state !== 'receiving' && p.state !== 'cancelled' && Number.isFinite(timeOf(p)))
      .map((p) => ({ id: p.id, at: timeOf(p), kind: p.kind, platforms: p.platforms }));
  }

  async function load() {
    await mkdir(dir, { recursive: true });
    try {
      for (const id of JSON.parse(await readFile(deletedFile(), 'utf8'))) if (ID_RE.test(id)) deleted.add(id);
    } catch {}
    for (const name of await readdir(dir)) {
      if (!ID_RE.test(name)) continue;
      try {
        const post = upgrade(JSON.parse(await readFile(new URL('post.json', folder(name)), 'utf8')));
        if (post.state === 'posting') {
          post.state = 'unknown';
          post.results = [
            ...(post.results ?? []),
            ...post.platforms.filter((id) => !post.results?.some((r) => r.id === id))
              .map((id) => resultFor(id, "The laptop's server stopped while posting this. Check the platform before posting it again.")),
          ];
          post.finishedAt = now();
          await save(post);
          log.warn(`${label(post)} was being posted when the server stopped; marked unknown.`);
        }
        posts.set(name, post);
      } catch (err) {
        log.warn(`Couldn't read post ${name} (${err.message}); left it alone.`);
      }
    }
    await cleanup();
    await moveMissed();
    lastTick = now();
    ticker = setInterval(tick, TICK_MS);
    ticker.unref?.();
    run();
  }

  // Posts saved before scheduling had no source, kind or time: they were phone posts, sent as soon as ready.
  function upgrade(post) {
    post.source ??= 'phone';
    post.subtitles ??= {};
    post.kind ??= postKind(post.media.map((n) => post.files[n]));
    if (post.when === undefined) {
      post.when = 'auto';
      post.at = post.readyAt ?? null;
      if (post.state === 'done' || post.state === 'unknown') post.postedAt ??= post.readyAt ?? post.finishedAt ?? null;
    }
    return post;
  }

  function tick() {
    const t = now();
    const slept = t - lastTick > ASLEEP_MS;
    lastTick = t;
    if (slept) moveMissed().then(run).catch((err) => log.warn(`Couldn't move missed posts: ${err.message}`));
  }

  // Posts whose time passed while the laptop was off or asleep move to the next free time, never all at once:
  // each in the order of its old time, so text posts are spaced too.
  async function moveMissed() {
    const t = now();
    const missed = [...posts.values()].filter((p) => p.state === 'waiting' && p.at !== null && p.at < t).sort((a, b) => a.at - b.at);
    for (const post of missed) {
      const old = post.at;
      post.at = nextFreeTime(taken(post), post.kind, t, post.platforms);
      post.moved = { from: old, at: t };
      await save(post);
      log.info(`${label(post)}: missed ${when(old)} while the laptop was off; moved to ${when(post.at)}`);
    }
  }

  async function cleanup() {
    const t = now();
    for (const post of [...posts.values()]) {
      if (post.state === 'receiving' && t - post.createdAt > KEEP_MS) {
        await forget(post);
        log.info(`${label(post)}: removed after a week (its files never all arrived)`);
      } else if (isHistory(post) && !post.filesRemoved) {
        // Posts finished before history was kept still have their files.
        await removeFiles(post);
      }
    }
  }

  async function forget(post) {
    posts.delete(post.id);
    await rm(folder(post.id), { recursive: true, force: true });
  }

  // History keeps post.json only; the files were for posting.
  async function removeFiles(post) {
    for (const n of post.files.keys()) await rm(fileUrl(post, n), { force: true }).catch(() => {});
    post.filesRemoved = true;
    await save(post);
  }

  // Sets a new post's time when it becomes ready: the next free time, or the picked one. A picked time that
  // passed before the post reached the laptop counts as missed.
  function schedule(post) {
    const t = now();
    if (post.when === 'now') { post.at = t; return; }
    if (post.when === 'picked' && post.at > t) return;
    if (post.when === 'picked') post.moved = { from: post.at, at: t };
    post.at = nextFreeTime(taken(post), post.kind, t, post.platforms);
  }

  // ---- The phone's hand-over ----

  // The phone makes the id, so sending the same post again returns it as it is instead of posting it twice.
  async function create(id, body) {
    if (!ID_RE.test(id)) throw httpError(400, 'Invalid request');
    if (posts.has(id)) return summary(posts.get(id));
    const checked = checkPost(body);
    if (checked.when === 'picked') refuseOutsideHours(checked.at);
    const post = {
      id, source: 'phone', ...checked, kind: postKind(checked.media.map((n) => checked.files[n])),
      state: 'receiving', received: [], results: null, createdAt: now(),
    };
    await mkdir(folder(id), { recursive: true });
    await save(post);
    posts.set(id, post);
    const size = post.files.reduce((n, f) => n + f.size, 0);
    log.info(`${label(post)}: received for ${post.platforms.join(', ')}${post.files.length ? `, waiting for ${post.files.length} file${post.files.length > 1 ? 's' : ''} (${mb(size)})` : ''}`);
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
    log.info(`${label(post)}: file ${post.received.length} of ${post.files.length} arrived (${file.name}, ${mb(file.size)})`);
    return summary(post);
  }

  async function ready(id) {
    const post = find(id);
    if (post.state !== 'receiving') return summary(post);
    if (missing(post).length) throw httpError(409, "Some of the post's files haven't arrived yet.");
    post.state = 'waiting';
    post.readyAt = now();
    schedule(post);
    if (youtubeAhead(post)) post.youtube = 'pending';
    await save(post);
    log.info(`${label(post)}: ${scheduledLine(post)}`);
    run();
    return summary(post);
  }

  const scheduledLine = (post) => (post.at <= now() ? 'going out now' : `scheduled for ${when(post.at)}`)
    + (post.moved ? ` (its time, ${when(post.moved.from)}, had passed)` : '')
    + (post.youtube ? '; YouTube gets it now and publishes it then' : '');

  const status = (ids) => ids.map((id) => (posts.has(id) ? summary(posts.get(id)) : { id, state: deleted.has(id) ? 'deleted' : 'missing' }));

  // The phone has the results of a finished post: it stays as history. Anything not finished is removed,
  // as the phone asked (it deletes a post it hasn't finished sending).
  async function remove(id) {
    const post = find(id);
    if (post.state === 'posting' || current === post) throw httpError(409, 'This post is being posted right now.');
    if (isHistory(post)) {
      if (!post.collected) {
        post.collected = true;
        await save(post);
        log.info(`${label(post)}: results collected by the phone`);
      }
      return;
    }
    if (post.state === 'waiting') return cancel(id);
    await forget(post);
    log.info(`${label(post)}: removed by the phone`);
  }

  // ---- The web page's scheduled posts ----

  // body: as for POST /api/post (upload ids), plus when and at. The uploads are copied into the post's folder,
  // so they outlive the uploads' 24-hour cleanup. Throws 400 with a message to show.
  async function createFromUploads(body) {
    const bad = (message) => httpError(400, message);
    if (!isPlainObject(body)) throw bad('Invalid request');
    const { text = '', platforms: ids, media: entries = [], options = {}, subtitles: given = null } = body;
    if (typeof text !== 'string' || text.length > MAX_TEXT || !Array.isArray(entries) || entries.length > MAX_FILES) throw bad('Invalid request');
    if (!Array.isArray(ids) || ids.length === 0) throw bad('Select at least one platform');
    if (ids.some((id) => !KNOWN.has(id)) || new Set(ids).size !== ids.length) throw bad('Invalid request');
    checkOptions(options);

    const uploads = []; // [{ meta, duration }] in file order
    const add = async (uploadId, duration = null) => {
      const existing = uploads.findIndex((u) => u.meta.id === uploadId);
      if (existing >= 0) return existing;
      const meta = typeof uploadId === 'string' ? await getMedia(uploadId) : null;
      if (!meta) throw bad('An attached file has expired. Remove it and add it again.');
      uploads.push({ meta, duration });
      return uploads.length - 1;
    };

    const media = [];
    for (const entry of entries) {
      const { id, duration } = typeof entry === 'string' ? { id: entry } : (entry ?? {});
      const n = await add(id, Number.isFinite(duration) && duration > 0 ? duration : null);
      if (!POST_TYPES.has(uploads[n].meta.type)) throw bad('Add subtitles under Subtitles, not as a photo or video.');
      media.push(n);
    }
    const ownOptions = {};
    for (const [id, own] of Object.entries(options)) {
      ownOptions[id] = {};
      for (const [key, value] of Object.entries(own)) {
        if (IMAGE_FIELDS[id]?.has(key) && typeof value === 'string' && value) {
          const n = await add(value);
          if (!uploads[n].meta.type.startsWith('image/')) throw bad('Invalid request');
          ownOptions[id][key] = { file: n };
        } else {
          ownOptions[id][key] = value;
        }
      }
    }
    // { videoUploadId: { lang: srtUploadId } } becomes { videoFile: { lang: srtFile } }.
    const subtitles = {};
    if (given !== null && given !== undefined) {
      if (!isPlainObject(given)) throw bad('Invalid request');
      for (const [videoId, tracks] of Object.entries(given)) {
        const video = uploads.findIndex((u) => u.meta.id === videoId);
        if (video < 0 || !media.includes(video) || !isVideo(uploads[video].meta)) throw bad('Subtitles need a video. Attach one, or remove the subtitles.');
        if (!isPlainObject(tracks)) throw bad('Invalid request');
        subtitles[video] = {};
        for (const [lang, srtId] of Object.entries(tracks)) {
          if (!isSubtitleLanguage(lang)) throw bad('Subtitles can only be in Hindi or English for now.');
          const n = await add(srtId);
          if (uploads[n].meta.type !== SRT) throw bad('The subtitles file has expired. Remove it and add it again.');
          subtitles[video][lang] = n;
        }
      }
    }
    const anyText = text.trim() || Object.values(options).some((o) => typeof o.text === 'string' && o.text.trim());
    if (!anyText && media.length === 0) throw bad('Add some text, an image or a video');

    const files = await Promise.all(uploads.map(async ({ meta, duration }) => ({
      name: meta.name, type: meta.type, size: meta.size,
      duration: isVideo(meta) ? (await probeDuration(meta)) ?? duration : null,
    })));
    const t = now();
    const post = {
      id: crypto.randomBytes(16).toString('hex'), source: 'web', text: text.trim(), platforms: ids, options: ownOptions,
      files, media, subtitles, ...checkWhen(body), kind: postKind(media.map((n) => files[n])),
      state: 'receiving', received: [], results: null, createdAt: t,
    };
    if (post.when === 'picked' && post.at <= t) throw bad('That time has passed. Pick a later time.');
    if (post.when === 'picked') refuseOutsideHours(post.at);
    const problems = problemsOf(post);
    if (problems.length) throw bad(problems.join('. '));

    await mkdir(folder(post.id), { recursive: true });
    try {
      for (const [n, { meta }] of uploads.entries()) await copyFile(meta.path, fileUrl(post, n));
    } catch (err) {
      await rm(folder(post.id), { recursive: true, force: true });
      throw err;
    }
    post.received = files.map((_, n) => n);
    post.state = 'waiting';
    post.readyAt = t;
    schedule(post);
    if (youtubeAhead(post)) post.youtube = 'pending';
    await save(post);
    posts.set(post.id, post);
    log.info(`${label(post)}: for ${ids.join(', ')}, ${scheduledLine(post)}`);
    run();
    return summary(post);
  }

  // A post that went out straight from the page (POST /api/post), kept for the Calendar and the slot rules.
  async function record({ text, platforms: ids, media, options, results, postedAt }) {
    const post = {
      id: crypto.randomBytes(16).toString('hex'), source: 'web', text, platforms: ids,
      options: Object.fromEntries(Object.entries(options ?? {}).map(([id, own]) => [id, Object.fromEntries(
        Object.entries(own ?? {}).filter(([key]) => !IMAGE_FIELDS[id]?.has(key) && key !== 'subtitles'),
      )])),
      files: media.map((m) => ({ name: m.name, type: m.type, size: m.size, duration: m.duration ?? null })),
      media: media.map((_, n) => n), subtitles: {}, when: 'now', at: postedAt, postedAt,
      kind: postKind(media), state: 'done', received: [], results, createdAt: postedAt, finishedAt: now(), filesRemoved: true,
    };
    await mkdir(folder(post.id), { recursive: true });
    await save(post);
    posts.set(post.id, post);
    log.info(timing(post));
    return summary(post);
  }

  // ---- Changing a waiting post (page and phone) ----

  function changeable(id) {
    const post = find(id);
    if (post.state === 'posting' || current === post) throw httpError(409, "This post is being posted right now, so it can't be changed.");
    if (post.state === 'cancelled') throw httpError(409, 'This post was cancelled.');
    if (post.state !== 'waiting') throw httpError(409, 'This post is already on the platforms. Change it there.');
    return post;
  }

  const youtubeNote = (post) => (post.youtube === 'done'
    ? 'YouTube already has this video and keeps its own time and details. Change them in YouTube Studio.'
    : null);

  async function move(id, at) {
    const post = changeable(id);
    checkTime(at);
    if (at <= now()) throw httpError(400, 'That time has passed. Pick a later time.');
    refuseOutsideHours(at);
    const old = post.at;
    post.at = at;
    post.when = 'picked';
    delete post.moved;
    if (!post.youtube && youtubeAhead(post)) post.youtube = 'pending';
    await save(post);
    log.info(`${label(post)}: moved from ${when(old)} to ${when(at)}`);
    reschedule();
    return { post: summary(post), note: youtubeNote(post) };
  }

  async function postNow(id) {
    const post = changeable(id);
    post.at = now();
    post.when = 'now';
    // Not uploaded yet: YouTube goes with the others, public as its settings say.
    if (post.youtube === 'pending') delete post.youtube;
    await save(post);
    log.info(`${label(post)}: posting now, as asked`);
    reschedule();
    return { post: summary(post), note: youtubeNote(post) };
  }

  // Text and settings only; the files stay as they are, so image fields keep their files.
  async function edit(id, body) {
    const post = changeable(id);
    if (!isPlainObject(body) || typeof (body.text ?? '') !== 'string' || (body.text ?? '').length > MAX_TEXT) throw httpError(400, 'Invalid request');
    const options = body.options ?? {};
    checkOptions(options);
    const merged = {};
    for (const id of post.platforms) {
      const own = Object.fromEntries(Object.entries(options[id] ?? {}).filter(([key, value]) => !IMAGE_FIELDS[id]?.has(key) && !isFileRef(value)));
      for (const [key, value] of Object.entries(post.options[id] ?? {})) if (isFileRef(value)) own[key] = value;
      merged[id] = own;
    }
    const changed = { ...post, text: (body.text ?? '').trim(), options: merged };
    const anyText = changed.text || Object.values(merged).some((o) => typeof o.text === 'string' && o.text.trim());
    if (!anyText && !post.media.length) throw httpError(400, 'Add some text, an image or a video');
    const problems = problemsOf(changed);
    if (problems.length) throw httpError(400, problems.join('. '));
    post.text = changed.text;
    post.options = merged;
    post.editedAt = now();
    await save(post);
    log.info(`${label(post)}: text and settings changed`);
    return { post: summary(post), note: youtubeNote(post) };
  }

  // Stops a waiting post; it stays as history, marked cancelled. If YouTube already has its video, the post
  // stays as YouTube's alone.
  async function cancel(id) {
    const post = changeable(id);
    if (post.youtube === 'done') {
      post.platforms = ['youtube'];
      post.state = 'done';
      post.postedAt = post.youtubeAt ?? now();
      post.finishedAt = now();
      post.cancelled = true;
      await removeFiles(post);
      log.info(`${label(post)}: cancelled; YouTube already had it`);
      reschedule();
      return { post: summary(post), note: 'Cancelled. YouTube already has this video and will still publish it at its time. Delete or change it in YouTube Studio.' };
    }
    post.state = 'cancelled';
    post.cancelledAt = now();
    await removeFiles(post);
    log.info(`${label(post)}: cancelled`);
    reschedule();
    return { post: summary(post), note: null };
  }

  // Removes a post for good, waiting or history, everywhere: its folder goes, and its id is kept in deleted.json
  // so the phone deletes its copy too. A waiting post is cancelled first, with the same note about YouTube.
  async function deleteForever(id) {
    const post = find(id);
    if (post.state === 'posting' || current === post) throw httpError(409, "This post is being posted right now, so it can't be deleted.");
    const note = post.state === 'waiting' && post.youtube === 'done'
      ? 'Deleted here. YouTube already has this video and will still publish it at its time. Delete or change it in YouTube Studio.'
      : post.youtube === 'done' || post.results?.some((r) => r.ok) ? 'Deleted here. Anything already on the platforms stays there.' : null;
    await forget(post);
    deleted.add(post.id);
    await writeFile(deletedFile(), JSON.stringify([...deleted]));
    log.info(`${label(post)}: deleted`);
    reschedule();
    return { post: null, note };
  }

  const list = () => [...posts.values()].filter((p) => p.state !== 'receiving').map(summary);
  const deletedIds = () => [...deleted];

  // ---- Posting ----

  // One job at a time: YouTube uploads for picked times first (they must reach YouTube before their time),
  // then posts whose time has come, earliest first. Then it waits for the next time.
  function nextJob() {
    const waiting = [...posts.values()].filter((p) => p.state === 'waiting');
    const ahead = waiting.filter((p) => p.youtube === 'pending').sort((a, b) => a.at - b.at)[0];
    if (ahead) return { post: ahead, youtubeOnly: true };
    const due = waiting.filter((p) => p.at <= now()).sort((a, b) => a.at - b.at)[0];
    return due ? { post: due, youtubeOnly: false } : null;
  }

  function reschedule() {
    if (running) return;
    run();
  }

  async function run() {
    if (running) return;
    running = true;
    clearTimeout(timer);
    try {
      for (let job = nextJob(); job; job = nextJob()) {
        current = job.post;
        await postOne(job.post, job.youtubeOnly);
      }
    } finally {
      current = null;
      running = false;
    }
    const next = [...posts.values()].filter((p) => p.state === 'waiting').map((p) => p.at).sort((a, b) => a - b)[0];
    if (next !== undefined) {
      timer = setTimeout(run, Math.min(Math.max(next - now(), 0), MAX_WAIT_MS));
      timer.unref?.();
    }
  }

  async function postOne(post, youtubeOnly) {
    const ids = youtubeOnly ? ['youtube'] : post.platforms.filter((id) => !(post.youtube === 'done' && id === 'youtube'));
    if (!youtubeOnly) post.state = 'posting';
    if (!youtubeOnly) post.postedAt = now();
    await save(post);
    const steps = {};
    live.set(post.id, steps);
    const imported = [];
    let results;
    try {
      const uploadIds = [];
      for (const [n, f] of post.files.entries()) {
        const meta = await importFile(fileURLToPath(fileUrl(post, n)), f.type, f.name);
        imported.push(meta.id);
        uploadIds[n] = meta.id;
      }
      // ffprobe's length wins, as for the page; the phone's is the fallback.
      const media = await Promise.all(post.media.map(async (n) => {
        const m = await getMedia(uploadIds[n]);
        if (isVideo(m)) m.duration = (await probeDuration(m)) ?? post.files[n].duration;
        return m;
      }));
      const subtitles = {};
      for (const [video, tracks] of Object.entries(post.subtitles ?? {})) {
        subtitles[uploadIds[video]] = {};
        for (const [lang, n] of Object.entries(tracks)) subtitles[uploadIds[video]][lang] = await getMedia(uploadIds[n]);
      }
      const options = withUploadIds(post.options, uploadIds);
      // YouTube makes a scheduled video public at publishAt (it stays private until then).
      if (youtubeOnly) options.youtube = { ...options.youtube, publishAt: new Date(post.at).toISOString() };
      results = await publish(post.text, ids, media, options, subtitles, (event) => {
        if (event.type === 'status') steps[event.id] = { step: event.step, progress: event.progress ?? null };
      }, { from: label(post).toLowerCase() });
    } catch (err) {
      log.error(`${label(post)} couldn't be prepared`, err?.stack ?? String(err));
      results = ids.map((id) => resultFor(id, "The laptop couldn't prepare this post's files. The details are in the terminal."));
    } finally {
      live.delete(post.id);
      // Posting is over, so the copies (and any compressed versions) can go; the post keeps its own files.
      for (const id of imported) await deleteMedia(id).catch(() => {});
    }
    post.results = [...(post.results ?? []).filter((r) => !ids.includes(r.id)), ...results];
    if (youtubeOnly) {
      post.youtube = 'done';
      post.youtubeAt = now();
      // Only YouTube: nothing is left to post at the time.
      if (post.platforms.length === 1) return finish(post, post.at);
      await save(post);
      log.info(`${label(post)}: YouTube ${results[0]?.ok ? `has it, public at ${when(post.at)}` : 'failed'}; the others go at that time`);
      return;
    }
    await finish(post, post.postedAt);
  }

  async function finish(post, postedAt) {
    post.state = 'done';
    post.postedAt = postedAt;
    post.finishedAt = now();
    await removeFiles(post);
    const outcome = post.results.map((r) => `${r.name} ${r.ok ? 'posted' : 'failed'}`).join(', ');
    log.info(`${label(post)}: done (${outcome})${post.source === 'phone' ? '; waiting for the phone to collect the results' : ''}`);
    log.info(timing(post));
  }

  // One line per finished post with every time that matters, to check the scheduling: when it was made, reached
  // the laptop, was due and went out (ISO 8601 with the zone, decided 2026-11-20).
  function timing(post) {
    const how = { picked: 'time you picked', now: 'immediately', auto: 'next free time' }[post.when] ?? post.when;
    const late = Math.round((post.postedAt - post.at) / 1000);
    const lateness = Math.abs(late) < 60 ? `${late} s after its time` : `${Math.round(Math.abs(late) / 60)} min ${late < 0 ? 'before' : 'after'} its time`;
    return [
      `${label(post)}: timing`,
      ...(post.source === 'phone' && post.madeAt ? [`made ${isoTime(post.madeAt)} on the phone`] : []),
      `reached the laptop ${isoTime(post.createdAt)}`,
      `scheduled for ${isoTime(post.at)} (${how}${post.moved ? `, moved from ${isoTime(post.moved.from)}` : ''})`,
      `posted ${isoTime(post.postedAt)}, ${lateness}`,
    ].join(' · ');
  }

  function stop() {
    clearTimeout(timer);
    clearInterval(ticker);
  }

  return {
    load, cleanup, create, receiveFile, ready, status, remove, createFromUploads, record, move, postNow, edit, cancel,
    deleteForever, list, deletedIds, taken: () => taken(), stop, idle: () => !running,
  };
}

// Posts kept in the project's queue/ folder before POSTS_DIR existed move there once, on the first start.
export async function moveOldPosts(from, to) {
  let names;
  try {
    names = (await readdir(from)).filter((name) => ID_RE.test(name));
  } catch {
    return 0;
  }
  await mkdir(to, { recursive: true });
  let moved = 0;
  for (const name of names) {
    const target = new URL(`${name}/`, to);
    if (await stat(target).then(() => true, () => false)) continue;
    const source = new URL(`${name}/`, from);
    try {
      await rename(source, target);
    } catch (err) {
      // Another drive (the project on A:, the home folder on C:): copy, then delete.
      if (err.code !== 'EXDEV') throw err;
      await cp(source, target, { recursive: true });
      await rm(source, { recursive: true, force: true });
    }
    moved++;
  }
  await rmdir(from).catch(() => {});
  return moved;
}

export const postsUrl = () => pathToFileURL(join(postsDir(), '/'));
