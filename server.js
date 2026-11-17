import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { platforms } from './platforms/index.js';
import { ApiError } from './platforms/http.js';
import { isVideo, isSubtitleLanguage, SUBTITLE_LANGUAGES_ONLY } from './public/rules.js';
import { log } from './log.js';
import {
  saveUpload, getMedia, deleteMedia, cleanupOldMedia, serveMedia, publicBaseUrl, httpError,
  probeDuration, burnSubtitles, deleteKept,
} from './media.js';
import { checkGenerator, NOT_SET, queueJob, getJob, stopJob, watch, finished, stopLeftover, cleanupTranscripts } from './subtitler.js';
import { canCompress, describe, publish, failureMessage } from './publish.js';
import { startPhoneServer } from './phone.js';

const PORT = Number(process.env.PORT) || 3000;
const SRT = 'application/x-subrip';
// Bound to loopback only: this server posts with your credentials and has no login.
const HOST = '127.0.0.1';
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
// A Whisper run left by a server that died mid-job would hold over 4 GB and make the next job fail.
await stopLeftover();

const STATIC_FILES = {
  '/': { file: 'public/index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'public/styles.css', type: 'text/css; charset=utf-8' },
  '/rules.js': { file: 'public/rules.js', type: 'text/javascript; charset=utf-8' },
  '/fields.js': { file: 'public/fields.js', type: 'text/javascript; charset=utf-8' },
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

// The page sends { videoId: { lang: srtId } }; every video must be in the post and every id an SRT upload.
async function resolveSubtitles(given, media) {
  if (given === null || given === undefined) return {};
  if (typeof given !== 'object' || Array.isArray(given)) throw httpError(400, 'Invalid request');
  const resolved = {};
  for (const [videoId, tracks] of Object.entries(given)) {
    if (!media.some((m) => m.id === videoId && isVideo(m))) throw httpError(400, 'Subtitles need a video. Attach one, or remove the subtitles.');
    if (!tracks || typeof tracks !== 'object' || Array.isArray(tracks)) throw httpError(400, 'Invalid request');
    resolved[videoId] = {};
    for (const [lang, id] of Object.entries(tracks)) {
      if (!isSubtitleLanguage(lang)) throw httpError(400, SUBTITLE_LANGUAGES_ONLY);
      const srt = typeof id === 'string' ? await getMedia(id) : null;
      if (!srt || srt.type !== SRT) throw httpError(400, 'The subtitles file has expired. Remove it and add it again.');
      resolved[videoId][lang] = srt;
    }
  }
  return resolved;
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
      const { tool, problem } = await checkGenerator();
      return sendJson(res, 200, {
        ffmpeg: canCompress,
        // subtitlesProblem: what to fix when LYRICS_VIDEO_DIR is set but unusable; null when it's fine or not set.
        subtitles: Boolean(tool),
        subtitlesProblem: problem ?? null,
        tunnel: { configured: Boolean(publicBaseUrl()), reachable: await tunnelReachable() },
      });
    }

    if (req.method === 'POST' && pathname === '/api/media') {
      // application/x-subrip is an SRT file. Like image/* and video/*, it can't be sent cross-site without a preflight.
      requireType(req, (t) => /^(image|video)\//.test(t) || t === 'application/x-subrip', 'Upload an image, a video or an SRT file');
      const name = decodeURIComponent(req.headers['x-filename'] || '');
      return sendJson(res, 201, await saveUpload(req, req.headers['content-type'], name));
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/media/')) {
      await deleteMedia(pathname.slice('/api/media/'.length));
      res.writeHead(204);
      return res.end();
    }

    // Done in the Substack reminder: the videos saved for it are no longer needed.
    if (req.method === 'POST' && pathname === '/api/kept/delete') {
      requireType(req, (t) => t.startsWith('application/json'), 'Content-Type must be application/json');
      const { files } = await readJsonBody(req);
      if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) throw httpError(400, 'Invalid request');
      for (const file of files) await deleteKept(file);
      res.writeHead(204);
      return res.end();
    }

    // Burns subtitles into a video ahead of posting, so the page can play the real result. The copy is
    // cached by video and subtitles, so posting to X or Instagram afterwards reuses it.
    if (req.method === 'POST' && pathname === '/api/subtitled') {
      requireType(req, (t) => t.startsWith('application/json'), 'Content-Type must be application/json');
      const { video: videoId, subtitles: subtitlesId, maxBytes = null } = await readJsonBody(req);
      const video = typeof videoId === 'string' ? await getMedia(videoId) : null;
      const subtitles = typeof subtitlesId === 'string' ? await getMedia(subtitlesId) : null;
      if (!video || !isVideo(video)) throw httpError(400, 'The video has expired. Remove it and add it again.');
      if (!subtitles || subtitles.type !== SRT) throw httpError(400, 'The subtitles file has expired. Remove it and add it again.');
      if (!canCompress) throw httpError(400, "Burning subtitles into the video needs ffmpeg, which isn't installed.");
      // The size limit the copy must fit, the same one the post will ask for (burnTarget), so it's reused.
      if (maxBytes !== null && !(Number.isSafeInteger(maxBytes) && maxBytes > 0)) throw httpError(400, 'Invalid request');

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      const send = (event) => { if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
      try {
        const burned = await burnSubtitles(video, subtitles, (progress) => send({ type: 'progress', progress }), maxBytes);
        send({ type: 'done', id: burned.id });
      } catch (err) {
        log.error(`Subtitle preview failed: ${err.message}`, err instanceof ApiError ? '' : err?.stack);
        send({ type: 'error', error: failureMessage(err) });
      }
      return res.end();
    }

    // Makes subtitles for an uploaded video with lyrics-video. Jobs run one at a time on the server, and keep
    // running if the page goes away. The response streams the job's state as NDJSON until it finishes.
    if (req.method === 'POST' && pathname === '/api/subtitles') {
      requireType(req, (t) => t.startsWith('application/json'), 'Content-Type must be application/json');
      const { video: videoId, language, subtitles: wanted } = await readJsonBody(req);
      const video = typeof videoId === 'string' ? await getMedia(videoId) : null;
      if (!video || !isVideo(video)) throw httpError(400, 'The video has expired. Remove it and add it again.');
      // Only the supported languages reach lyrics-video's command line, checked before any job starts.
      if (!isSubtitleLanguage(language)) throw httpError(400, SUBTITLE_LANGUAGES_ONLY);
      if (!Array.isArray(wanted) || !wanted.length || wanted.some((lang) => !isSubtitleLanguage(lang))) throw httpError(400, SUBTITLE_LANGUAGES_ONLY);
      if (wanted.some((lang) => lang !== language && lang !== 'en')) {
        throw httpError(400, 'Subtitles can be made in the language spoken in the video and in English.');
      }
      const { tool, problem } = await checkGenerator();
      if (!tool) throw httpError(400, problem ?? NOT_SET);

      const job = queueJob(video, language, [...new Set(wanted)]);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      await new Promise((resolve) => {
        let unwatch = null;
        const done = () => { unwatch?.(); resolve(); };
        unwatch = watch(job, (snapshot) => {
          if (!res.writableEnded) res.write(`${JSON.stringify({ type: 'job', job: snapshot })}\n`);
          if (finished(job)) done();
        });
        res.on('close', done);
      });
      return res.end();
    }

    const stopping = /^\/api\/subtitles\/([a-f0-9]{32})\/stop$/.exec(pathname);
    if (req.method === 'POST' && stopping) {
      requireType(req, (t) => t.startsWith('application/json'), 'Content-Type must be application/json');
      const job = getJob(stopping[1]);
      if (!job) throw httpError(404, 'Those subtitles are no longer being made.');
      stopJob(job);
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'POST' && pathname === '/api/post') {
      requireType(req, (t) => t.startsWith('application/json'), 'Content-Type must be application/json');
      const { text = '', platforms: ids, media: mediaIds = [], options = {}, subtitles: givenSubtitles = null } = await readJsonBody(req);
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
      if (media.some((m) => m.type === SRT)) throw httpError(400, 'Add subtitles under Subtitles, not as a photo or video.');
      const subtitles = await resolveSubtitles(givenSubtitles, media);
      const anyText = text.trim() || Object.values(options).some((o) => typeof o?.text === 'string' && o.text.trim());
      if (!anyText && media.length === 0) throw httpError(400, 'Add some text, an image or a video');

      // Streamed as one JSON event per line, so the page can show each platform's progress and result
      // as it happens instead of waiting for the slowest one.
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      const send = (event) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
      };
      const results = await publish(text.trim(), ids, media, options, subtitles, send, { keepVideos: true });
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

server.listen(PORT, HOST, async () => {
  const ready = platforms.filter((p) => p.isConfigured()).map((p) => p.name);
  console.log(`Social Post running at http://localhost:${PORT}`);
  console.log(ready.length ? `Configured: ${ready.join(', ')}` : 'No platforms configured yet. Copy .env.example to .env and fill in the platforms you use.');
  if (publicBaseUrl()) console.log(`Uploaded files are served publicly at ${publicBaseUrl()}/media/`);
  console.log(canCompress
    ? 'ffmpeg found: videos too big for a platform will be compressed to fit, and subtitles can be burned in.'
    : 'ffmpeg not found: videos too big for a platform will be rejected for it, and subtitles can\'t be burned in (see README).');
  // Outside Windows, burned-in text uses Noto Sans; without its Devanagari version, Hindi comes out as boxes.
  if (canCompress && process.platform !== 'win32') {
    console.log('Burned-in subtitles use Noto Sans: install Noto Sans and Noto Sans Devanagari, or Hindi shows as empty boxes.');
  }
  const { tool, problem } = await checkGenerator();
  console.log(tool ? `Generate subtitles: using lyrics-video in ${tool.dir}`
    : problem ? `Generate subtitles is off: ${problem}`
      : 'Generate subtitles is off: LYRICS_VIDEO_DIR isn\'t set (see "Generating subtitles" in the README). Uploading an SRT still works.');
  await startPhoneServer();
});

const cleanup = () => Promise.all([
  cleanupOldMedia().catch((err) => log.warn(`Couldn't clean up old uploads: ${err.message}`)),
  // Saved Whisper transcripts go a day after they were last used.
  cleanupTranscripts().catch((err) => log.warn(`Couldn't clean up old transcripts: ${err.message}`)),
]);
cleanup();
setInterval(cleanup, 60 * 60 * 1000).unref();
