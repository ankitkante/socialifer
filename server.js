import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { platforms } from './platforms/index.js';
import { problemsFor } from './public/rules.js';
import { saveUpload, getMedia, deleteMedia, cleanupOldMedia, serveMedia, publicBaseUrl, httpError } from './media.js';

const PORT = Number(process.env.PORT) || 3000;
// Bound to loopback only: this server posts with your credentials and has no login.
const HOST = '127.0.0.1';
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

const STATIC_FILES = {
  '/': { file: 'public/index.html', type: 'text/html; charset=utf-8' },
  '/rules.js': { file: 'public/rules.js', type: 'text/javascript; charset=utf-8' },
};

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
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function describe(p) {
  return {
    id: p.id,
    name: p.name,
    limit: p.limit,
    media: p.media,
    title: p.title ?? null,
    textForbids: p.textForbids ?? '',
    envVars: p.envVars,
    configured: p.isConfigured(),
    publicUrlReady: Boolean(publicBaseUrl()),
  };
}

// options holds per-platform extras keyed by platform id, e.g. { youtube: { title, privacy, madeForKids } }.
async function publish(text, ids, media, options) {
  const selected = platforms.filter((p) => ids.includes(p.id));
  const settled = await Promise.allSettled(
    selected.map(async (p) => {
      if (!p.isConfigured()) throw new Error(`Not configured. Set ${p.envVars.join(', ')} in .env`);
      const own = options[p.id] ?? {};
      const problems = problemsFor(describe(p), text, media, own);
      if (problems.length) throw new Error(problems.join('. '));
      return p.post(text, media, own);
    }),
  );
  return settled.map((r, i) => ({
    id: selected[i].id,
    name: selected[i].name,
    ok: r.status === 'fulfilled',
    url: r.status === 'fulfilled' ? (r.value?.url ?? null) : null,
    error: r.status === 'rejected' ? r.reason?.message || String(r.reason) : null,
  }));
}

// Anything other than application/json or a file upload would be a "simple" cross-site request.
function requireType(req, test, message) {
  if (!test(req.headers['content-type'] || '')) throw httpError(415, message);
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');

    // Uploaded files are the only thing served to the outside world (via PUBLIC_BASE_URL),
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

    if (req.method === 'GET' && pathname === '/api/platforms') {
      return sendJson(res, 200, platforms.map(describe));
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

      const media = await Promise.all(mediaIds.map(getMedia));
      if (media.some((m) => !m)) throw httpError(400, 'An attached file has expired. Remove it and add it again.');
      if (!text.trim() && media.length === 0) throw httpError(400, 'Add some text, an image or a video');

      return sendJson(res, 200, { results: await publish(text.trim(), ids, media, options) });
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    if (res.headersSent) return res.destroy();
    sendJson(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  const ready = platforms.filter((p) => p.isConfigured()).map((p) => p.name);
  console.log(`Social Post running at http://localhost:${PORT}`);
  console.log(ready.length ? `Configured: ${ready.join(', ')}` : 'No platforms configured yet. Copy .env.example to .env and fill in the platforms you use.');
  if (publicBaseUrl()) console.log(`Uploaded files are served publicly at ${publicBaseUrl()}/media/`);
});

cleanupOldMedia();
setInterval(cleanupOldMedia, 60 * 60 * 1000).unref();
