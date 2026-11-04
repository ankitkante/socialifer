import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { compressionBitrate } from './public/rules.js';

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
  return process.env.TUNNEL_URL?.trim().replace(/\/+$/, '') || '';
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
    path: fileURLToPath(fileUrl(id)),
    url: base ? `${base}/media/${id}.${EXTENSIONS[meta.type]}` : null,
    blob: () => openAsBlob(fileUrl(id), { type: meta.type }),
    buffer: () => readFile(fileUrl(id)),
  };
}

export async function deleteMedia(id) {
  if (!ID_RE.test(id)) return;
  await rm(fileUrl(id), { force: true });
  await rm(metaUrl(id), { force: true });
  // Compressed copies go with the original.
  for (const derived of derivedIds.get(id) ?? []) await deleteMedia(derived);
  derivedIds.delete(id);
  for (const key of fitted.keys()) if (key.startsWith(`${id}:`)) fitted.delete(key);
}

// ---- Video tools (optional) ----
// ffmpeg/ffprobe let the server read real video lengths and compress videos that are too big for a
// platform. Without them, oversized videos are simply rejected for that platform.

function run(command, args, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim().split('\n').pop() || err.message));
      else resolve(stdout);
    });
  });
}

// A winget install updates PATH, but terminals (and VS Code) opened before it don't see the change,
// so also look where winget puts things: its Links folder, and the Gyan.FFmpeg package's bin folder.
async function toolCandidates(name) {
  const list = [];
  if (process.env.FFMPEG_DIR) list.push(join(process.env.FFMPEG_DIR, name));
  list.push(name);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const winget = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet');
    list.push(join(winget, 'Links', `${name}.exe`));
    try {
      for (const pkg of (await readdir(join(winget, 'Packages'))).filter((d) => d.startsWith('Gyan.FFmpeg'))) {
        for (const build of await readdir(join(winget, 'Packages', pkg))) {
          list.push(join(winget, 'Packages', pkg, build, 'bin', `${name}.exe`));
        }
      }
    } catch {}
  }
  return list;
}

async function findTool(name) {
  for (const candidate of await toolCandidates(name)) {
    try {
      await run(candidate, ['-version']);
      return candidate;
    } catch {}
  }
  return null;
}

let tools;
export function videoTools() {
  tools ??= Promise.all([findTool('ffmpeg'), findTool('ffprobe')])
    .then(([ffmpeg, ffprobe]) => (ffmpeg && ffprobe ? { ffmpeg, ffprobe } : null));
  return tools;
}

export async function probeDuration(m) {
  const t = await videoTools();
  if (!t) return null;
  try {
    const out = await run(t.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', m.path]);
    const seconds = parseFloat(out);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

// Keeps vertical videos at most 1080 wide and horizontal ones at most 1080 tall, which is what
// the platforms display anyway; fewer pixels means better quality at a capped bitrate.
const SCALE = "scale='if(gte(ih,iw),min(1080,iw),-2)':'if(gte(ih,iw),-2,min(1080,ih))'";
const fitted = new Map(); // `${id}:${maxBytes}` -> Promise of the compressed media
const derivedIds = new Map(); // original id -> Set of compressed copy ids

// Returns a copy of the video compressed to at most maxBytes. Concurrent requests for the same
// target (e.g. two platforms with the same limit) share one ffmpeg run.
export function fitVideo(m, maxBytes) {
  const key = `${m.id}:${maxBytes}`;
  if (!fitted.has(key)) {
    fitted.set(key, compress(m, maxBytes).catch((err) => {
      fitted.delete(key);
      throw err;
    }));
  }
  return fitted.get(key);
}

async function compress(m, maxBytes) {
  const t = await videoTools();
  const limit = `${maxBytes / 1_000_000} MB`;
  if (!t) throw new Error(`${m.name} is over ${limit} and ffmpeg isn't installed to compress it`);
  const duration = m.duration || (await probeDuration(m));
  if (!duration) throw new Error(`Couldn't read the length of ${m.name} to compress it`);

  await mkdir(DIR, { recursive: true });
  const id = crypto.randomBytes(16).toString('hex');
  const out = fileURLToPath(fileUrl(id));
  // If the first pass overshoots, retry once aiming lower.
  for (const aim of [1, 0.85]) {
    const kbps = compressionBitrate(maxBytes * aim, duration);
    if (!kbps) break;
    await run(t.ffmpeg, [
      '-y', '-v', 'error', '-i', m.path,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`,
      '-vf', SCALE, '-fpsmax', '60', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-f', 'mp4', out,
    ], 60 * 60_000);
    const { size } = await stat(out);
    if (size <= maxBytes) {
      const meta = {
        id,
        name: m.name.replace(/\.[^.]+$/, '') + '-compressed.mp4',
        type: 'video/mp4',
        size,
        createdAt: Date.now(),
        derivedFrom: m.id,
      };
      await writeFile(metaUrl(id), JSON.stringify(meta));
      if (!derivedIds.has(m.id)) derivedIds.set(m.id, new Set());
      derivedIds.get(m.id).add(id);
      return { ...(await getMedia(id)), duration };
    }
  }
  await rm(out, { force: true });
  throw new Error(`${m.name} is too long to compress under ${limit} without ruining the quality`);
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

// Serves /media/<id>.<ext> so Threads and Instagram can fetch files through TUNNEL_URL.
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
