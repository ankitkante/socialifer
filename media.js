import crypto from 'node:crypto';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Uploaded files live here until they're posted, removed, or older than a day.
const DIR = new URL('./uploads/', import.meta.url);
const MAX_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 1024) * 1_000_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^[a-f0-9]{32}$/;

export const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const fileUrl = (id) => new URL(id, DIR);
const metaUrl = (id) => new URL(`${id}.json`, DIR);

export function publicBaseUrl() {
  return process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || '';
}

export async function saveUpload(req, type, name) {
  if (!EXTENSIONS[type]) throw httpError(415, `Unsupported file type "${type || 'unknown'}". Use JPEG, PNG, GIF, WebP, MP4 or MOV.`);
  const tooBig = () => httpError(413, `File is larger than ${MAX_BYTES / 1_000_000} MB`);
  if (Number(req.headers['content-length']) > MAX_BYTES) throw tooBig();

  await mkdir(DIR, { recursive: true });
  const id = crypto.randomBytes(16).toString('hex');
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(size > MAX_BYTES ? tooBig() : null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, createWriteStream(fileUrl(id)));
  } catch (err) {
    await rm(fileUrl(id), { force: true });
    throw err;
  }
  if (size === 0) {
    await rm(fileUrl(id), { force: true });
    throw httpError(400, 'File is empty');
  }

  const meta = { id, name: name || `upload.${EXTENSIONS[type]}`, type, size, createdAt: Date.now() };
  await writeFile(metaUrl(id), JSON.stringify(meta));
  return meta;
}

async function readMeta(id) {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await readFile(metaUrl(id), 'utf8'));
  } catch {
    return null;
  }
}

// What platform modules receive for each attached file.
export async function getMedia(id) {
  const meta = await readMeta(id);
  if (!meta) return null;
  const base = publicBaseUrl();
  return {
    ...meta,
    url: base ? `${base}/media/${id}.${EXTENSIONS[meta.type]}` : null,
    blob: () => openAsBlob(fileUrl(id), { type: meta.type }),
    buffer: () => readFile(fileUrl(id)),
  };
}

export async function deleteMedia(id) {
  if (!ID_RE.test(id)) return;
  await rm(fileUrl(id), { force: true });
  await rm(metaUrl(id), { force: true });
}

export async function cleanupOldMedia() {
  let names;
  try {
    names = await readdir(DIR);
  } catch {
    return;
  }
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const id = name.slice(0, -5);
    const meta = await readMeta(id);
    if (!meta || Date.now() - meta.createdAt > MAX_AGE_MS) await deleteMedia(id);
  }
}

// Serves /media/<id>.<ext> so Threads and Instagram can fetch files through PUBLIC_BASE_URL.
export async function serveMedia(req, res, filename) {
  const meta = await readMeta(filename.split('.')[0]);
  if (!meta) {
    res.writeHead(404);
    return res.end();
  }
  const headers = { 'Content-Type': meta.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0;
  let end = meta.size - 1;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : meta.size - Number(range[2]);
    end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
    if (start > end || start < 0) {
      res.writeHead(416, { 'Content-Range': `bytes */${meta.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${meta.size}`, 'Content-Length': end - start + 1 });
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': meta.size });
  }
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(fileUrl(meta.id), { start, end }), res);
}
