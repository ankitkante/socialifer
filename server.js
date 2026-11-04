import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { platforms } from './platforms/index.js';
import { ApiError } from './platforms/http.js';
import { problemsFor, effectiveText, resolveTitle, isVideo } from './public/rules.js';
import { log, runWithContext, step, currentStep } from './log.js';
import {
  saveUpload, getMedia, deleteMedia, cleanupOldMedia, serveMedia, publicBaseUrl, httpError,
  videoTools, probeDuration, fitVideo,
} from './media.js';

const PORT = Number(process.env.PORT) || 3000;
// Bound to loopback only: this server posts with your credentials and has no login.
const HOST = '127.0.0.1';
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
// With ffmpeg installed, videos too big for a platform are compressed instead of rejected.
const canCompress = Boolean(await videoTools());

const STATIC_FILES = {
  '/': { file: 'public/index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'public/styles.css', type: 'text/css; charset=utf-8' },
  '/rules.js': { file: 'public/rules.js', type: 'text/javascript; charset=utf-8' },
};
// The page's own modules live in public/js/ and are served by name only, never by path.
const SCRIPT_RE = /^\/js\/([a-z-]+)\.js$/;

// Whether the tunnel actually reaches this server: fetch our own health file through it.
// Cached briefly, since the page asks every minute.
let tunnelCheck = { at: 0, reachable: false };
async function tunnelReachable() {
  const base = publicBaseUrl();
  if (!base) return false;
  if (Date.now() - tunnelCheck.at < 20_000) return tunnelCheck.reachable;
  let reachable = false;
  try {
    const res = await fetch(`${base}/media/health`, { signal: AbortSignal.timeout(5000) });
    reachable = res.status === 204;
  } catch {}
  tunnelCheck = { at: Date.now(), reachable };
  return reachable;
}

// A stray error must never take the server down mid-post; log it and carry on.
process.on('unhandledRejection', (err) => log.error('Unhandled error (the server kept running)', err?.stack ?? String(err)));
process.on('uncaughtException', (err) => {
  log.error('Unexpected crash', err?.stack ?? String(err));
  process.exit(1);
});

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, "The request wasn't valid JSON");
  }
}

function describe(p) {
  return {
    id: p.id,
    name: p.name,
    limit: p.limit,
    media: p.media,
    title: p.title ?? null,
    textForbids: p.textForbids ?? '',
    threads: Boolean(p.threads),
    envVars: p.envVars,
    configured: p.isConfigured(),
    publicUrlReady: Boolean(publicBaseUrl()),
    canCompress,
  };
}

const mb = (bytes) => `${Math.round(bytes / 1_000_000)} MB`;
const seconds = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

// Swaps in a compressed copy of any video that's over this platform's size limit.
async function mediaFor(p, media) {
  const maxBytes = p.media.videoMB && p.media.videoMB * 1_000_000;
  if (!canCompress || !maxBytes) return media;
  return Promise.all(media.map(async (m) => {
    if (!isVideo(m) || m.size <= maxBytes) return m;
    const message = `Compressing ${m.name} from ${mb(m.size)} to fit ${p.media.videoMB} MB`;
    step(message);
    const started = Date.now();
    const fitted = await fitVideo(m, maxBytes, (progress) => step(message, { quiet: true, progress }));
    log.info(`Compressed to ${mb(fitted.size)} in ${seconds(Date.now() - started)}`);
    return fitted;
  }));
}

// Image fields (YouTube's thumbnail, Instagram's cover) arrive as upload ids; swap in the files.
async function withFieldMedia(p, own) {
  const resolved = { ...own };
  for (const key of p.mediaOptions ?? []) {
    if (!own[key]) continue;
    const m = typeof own[key] === 'string' ? await getMedia(own[key]) : null;
    if (!m) throw new ApiError(`The ${key} image has expired. Remove it and add it again.`);
    resolved[key] = m;
  }
  return resolved;
}

// Expected failures (API and network errors, our own checks) keep their message, prefixed with the
// step they happened in. Anything else is a bug: the user gets a short note, the terminal the stack.
function failureMessage(err, where) {
  if (err instanceof ApiError) return where ? `${where}: ${err.message}` : err.message;
  const during = where ? ` while ${where[0].toLowerCase()}${where.slice(1)}` : '';
  return `Something went wrong in the app${during}. The details are in the terminal.`;
}

let postCount = 0;

// Posts to each selected platform in parallel. onEvent gets { type: 'status', id, step } as each
// platform moves along and { type: 'result', ... } as each one finishes.
// options holds per-platform fields keyed by platform id, e.g.
// { instagram: { text, postAs, cover }, youtube: { text, title, privacy, tags, thumbnail } }.
async function publish(text, ids, media, options, onEvent = () => {}) {
  const postId = ++postCount;
  const selected = platforms.filter((p) => ids.includes(p.id));
  const files = media.map((m) => `${m.name} (${mb(m.size)})`).join(', ');
  log.info(`[post ${postId}] Posting to ${selected.map((p) => p.name).join(', ')}${files ? ` with ${files}` : ''}`);

  return Promise.all(selected.map((p) => runWithContext(
    { postId, platform: p.name, onStep: (s, progress) => onEvent({ type: 'status', id: p.id, step: s, ...(progress !== undefined && { progress }) }) },
    async () => {
      const started = Date.now();
      let result;
      try {
        if (!p.isConfigured()) throw new ApiError(`Not configured. Set ${p.envVars.join(', ')} in .env`);
        const given = options[p.id];
        const own = await withFieldMedia(p, given && typeof given === 'object' ? given : {});
        // Validate before compressing, so a post that can't go anyway doesn't wait on ffmpeg.
        const problems = problemsFor(describe(p), text, media, own);
        if (problems.length) throw new ApiError(problems.join('. '));
        // Platforms with a title get it resolved here, since it can come from the main post's first line.
        const postOptions = p.title ? { ...own, title: resolveTitle(text, own.title) } : own;
        const ownMedia = await mediaFor(p, media);
        step('Posting', { quiet: true });
        const value = await p.post(effectiveText(text, own, p.id), ownMedia, postOptions);
        result = { id: p.id, name: p.name, ok: true, url: value?.url ?? null, warnings: value?.warnings ?? [], error: null };
        log.info(`Posted in ${seconds(Date.now() - started)}${result.url ? `: ${result.url}` : ''}`);
        for (const w of result.warnings) log.warn(w);
      } catch (err) {
        const where = currentStep();
        const error = failureMessage(err, where);
        // API errors were already logged in full by request(); bugs get their stack trace here.
        log.error(`Failed after ${seconds(Date.now() - started)}: ${err.message}`, err instanceof ApiError ? '' : err?.stack);
        result = { id: p.id, name: p.name, ok: false, url: null, warnings: [], error };
      }
      onEvent({ type: 'result', ...result });
      return result;
    },
  )));
}

// Anything other than application/json or a file upload would be a "simple" cross-site request.
function requireType(req, test, message) {
  if (!test(req.headers['content-type'] || '')) throw httpError(415, message);
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');

    // Uploaded files are the only thing served to the outside world (via TUNNEL_URL),
    // so Threads and Instagram can download them. Ids are random and unguessable.
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/media/')) {
      return await serveMedia(req, res, pathname.slice('/media/'.length));
    }

    // Everything else is local-only. Rejecting foreign hostnames blocks DNS rebinding, and
    // rejecting forwarded requests keeps a tunnel from exposing the app itself.
    if (!ALLOWED_HOSTS.has(req.headers.host) || req.headers['x-forwarded-for'] || req.headers.forwarded) {
      return sendJson(res, 403, { error: 'Forbidden' });
    }

    if (req.method === 'GET' && STATIC_FILES[pathname]) {
      const { file, type } = STATIC_FILES[pathname];
      const body = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return res.end(body);
    }

    // Platform logos from Simple Icons (CC0), one per platform id.
    const icon = /^\/icons\/([a-z]+)\.svg$/.exec(pathname);
    if (req.method === 'GET' && icon && platforms.some((p) => p.id === icon[1])) {
      const body = await readFile(new URL(`public/icons/${icon[1]}.svg`, import.meta.url));
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=86400' });
      return res.end(body);
    }

    const script = SCRIPT_RE.exec(pathname);
    if (req.method === 'GET' && script) {
      try {
        const body = await readFile(new URL(`public/js/${script[1]}.js`, import.meta.url));
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(body);
      } catch {
        return sendJson(res, 404, { error: 'Not found' });
      }
    }

    if (req.method === 'GET' && pathname === '/api/platforms') {
      return sendJson(res, 200, platforms.map(describe));
    }

    if (req.method === 'GET' && pathname === '/api/status') {
      return sendJson(res, 200, {
        ffmpeg: canCompress,
        tunnel: { configured: Boolean(publicBaseUrl()), reachable: await tunnelReachable() },
      });
    }

    if (req.method === 'POST' && pathname === '/api/media') {
      requireType(req, (t) => /^(image|video)\//.test(t), 'Upload an image or video');
      const name = decodeURIComponent(req.headers['x-filename'] || '');
      return sendJson(res, 201, await saveUpload(req, req.headers['content-type'], name));
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/media/')) {
      await deleteMedia(pathname.slice('/api/media/'.length));
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'POST' && pathname === '/api/post') {
      requireType(req, (t) => t.startsWith('application/json'), 'Content-Type must be application/json');
      const { text = '', platforms: ids, media: mediaIds = [], options = {} } = await readJsonBody(req);
      if (typeof text !== 'string' || !Array.isArray(mediaIds) || typeof options !== 'object' || !options) {
        throw httpError(400, 'Invalid request');
      }
      if (!Array.isArray(ids) || ids.length === 0) throw httpError(400, 'Select at least one platform');

      // Each entry is a media id, or { id, duration } with the length the browser read from the file.
      // ffprobe's reading wins when available; the browser's is the fallback.
      const media = await Promise.all(mediaIds.map(async (entry) => {
        const { id, duration } = typeof entry === 'string' ? { id: entry } : (entry ?? {});
        const m = typeof id === 'string' ? await getMedia(id) : null;
        if (m && isVideo(m)) {
          m.duration = (await probeDuration(m)) ?? (Number.isFinite(duration) && duration > 0 ? duration : null);
        }
        return m;
      }));
      if (media.some((m) => !m)) throw httpError(400, 'An attached file has expired. Remove it and add it again.');
      const anyText = text.trim() || Object.values(options).some((o) => typeof o?.text === 'string' && o.text.trim());
      if (!anyText && media.length === 0) throw httpError(400, 'Add some text, an image or a video');

      // Streamed as one JSON event per line, so the page can show each platform's progress and result
      // as it happens instead of waiting for the slowest one.
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      const send = (event) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
      };
      const results = await publish(text.trim(), ids, media, options, send);
      send({ type: 'done', results });
      return res.end();
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    if (!err.status) log.error(`${req.method} ${req.url} failed`, err?.stack ?? String(err));
    if (res.headersSent) return res.destroy();
    sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong in the app. The details are in the terminal.' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is another Social Post server running? Stop it, or set a different PORT in .env.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const ready = platforms.filter((p) => p.isConfigured()).map((p) => p.name);
  console.log(`Social Post running at http://localhost:${PORT}`);
  console.log(ready.length ? `Configured: ${ready.join(', ')}` : 'No platforms configured yet. Copy .env.example to .env and fill in the platforms you use.');
  if (publicBaseUrl()) console.log(`Uploaded files are served publicly at ${publicBaseUrl()}/media/`);
  console.log(canCompress
    ? 'ffmpeg found: videos too big for a platform will be compressed to fit.'
    : 'ffmpeg not found: videos too big for a platform will be rejected for it (see README).');
});

const cleanup = () => cleanupOldMedia().catch((err) => log.warn(`Couldn't clean up old uploads: ${err.message}`));
cleanup();
setInterval(cleanup, 60 * 60 * 1000).unref();
