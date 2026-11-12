import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { compressionBitrate, separateCues } from './public/rules.js';
import { ApiError } from './platforms/http.js';
import { enqueue, BURN } from './work.js';
import { log } from './log.js';

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
  // Subtitles for a video: a track on YouTube, burned into the video elsewhere.
  'application/x-subrip': 'srt',
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
  if (!EXTENSIONS[type]) throw httpError(415, `Unsupported file type "${type || 'unknown'}". Use JPEG, PNG, GIF, WebP, MP4, MOV or SRT.`);
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

// Saves a file made on the server (a generated SRT) as an upload, just like one sent by the page.
export async function saveFile(data, type, name) {
  await mkdir(DIR, { recursive: true });
  const id = crypto.randomBytes(16).toString('hex');
  await writeFile(fileUrl(id), data);
  const meta = { id, name, type, size: Buffer.byteLength(data), createdAt: Date.now() };
  await writeFile(metaUrl(id), JSON.stringify(meta));
  return meta;
}

// A path inside the uploads folder, for work files that belong to an upload (generated subtitles).
export const uploadsPath = (name) => fileURLToPath(new URL(name, DIR));

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
  for (const key of burned.keys()) if (key.split(':').includes(id)) burned.delete(key);
}

// ---- Video tools (optional) ----
// ffmpeg/ffprobe let the server read real video lengths and compress videos that are too big for a
// platform. Without them, oversized videos are simply rejected for that platform.

// Runs ffmpeg with `-progress pipe:1` and reports how far through the video it is (0–1).
function runWithProgress(command, args, timeout, duration, onProgress, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, cwd });
    let stderr = '';
    let buffer = '';
    let lastPercent = -1;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${Math.round(timeout / 60_000)} minutes`));
    }, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const match = /^out_time_us=(\d+)/.exec(line);
        if (!match || !duration || !onProgress) continue;
        const progress = Math.min(1, Number(match[1]) / 1e6 / duration);
        // One update per whole percent is plenty.
        if (Math.floor(progress * 100) > lastPercent) {
          lastPercent = Math.floor(progress * 100);
          onProgress(progress);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with code ${code}`));
    });
  });
}

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
const fitted = new Map(); // `${id}:${maxBytes}` -> { promise of the compressed media, progress listeners }
const derivedIds = new Map(); // original id -> Set of compressed copy ids

// Returns a copy of the video compressed to at most maxBytes. Concurrent requests for the same
// target (e.g. two platforms with the same limit) share one ffmpeg run, and each hears its progress.
export function fitVideo(m, maxBytes, onProgress) {
  const key = `${m.id}:${maxBytes}`;
  let job = fitted.get(key);
  if (!job) {
    job = { listeners: new Set() };
    job.promise = compress(m, maxBytes, (p) => job.listeners.forEach((listener) => listener(p))).catch((err) => {
      fitted.delete(key);
      throw err;
    });
    fitted.set(key, job);
  }
  if (onProgress) job.listeners.add(onProgress);
  return job.promise;
}

async function compress(m, maxBytes, onProgress) {
  const t = await videoTools();
  const limit = `${maxBytes / 1_000_000} MB`;
  if (!t) throw new ApiError(`${m.name} is over ${limit} and ffmpeg isn't installed to compress it`);
  const duration = m.duration || (await probeDuration(m));
  if (!duration) throw new ApiError(`Couldn't read the length of ${m.name} to compress it`);

  await mkdir(DIR, { recursive: true });
  const id = crypto.randomBytes(16).toString('hex');
  const out = fileURLToPath(fileUrl(id));
  // If the first pass overshoots, retry once aiming lower.
  for (const aim of [1, 0.85]) {
    const kbps = compressionBitrate(maxBytes * aim, duration);
    if (!kbps) break;
    await runWithProgress(t.ffmpeg, [
      '-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', m.path,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`,
      '-vf', SCALE, '-fpsmax', '60', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-f', 'mp4', out,
    ], 60 * 60_000, duration, onProgress).catch(async (err) => {
      await rm(out, { force: true });
      throw new ApiError(`ffmpeg couldn't compress ${m.name}: ${err.message}`);
    });
    const { size } = await stat(out);
    if (size <= maxBytes) return saveDerived(m, id, '-compressed', size, duration);
  }
  await rm(out, { force: true });
  throw new ApiError(`${m.name} is too long to compress under ${limit} without ruining the quality`);
}

// Records an ffmpeg output as a new upload that's deleted along with its original.
async function saveDerived(m, id, suffix, size, duration) {
  const meta = {
    id,
    name: m.name.replace(/\.[^.]+$/, '') + `${suffix}.mp4`,
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

// Display size, swapping width and height for phone videos stored sideways with a rotation flag.
async function probeSize(t, m) {
  const out = await run(t.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', m.path]);
  const stream = JSON.parse(out).streams?.[0] ?? {};
  const rotation = Math.abs(Number(stream.side_data_list?.find((d) => 'rotation' in d)?.rotation) || 0);
  return rotation === 90 || rotation === 270 ? { width: stream.height, height: stream.width } : { width: stream.width, height: stream.height };
}

// Nirmala UI ships with Windows and covers Devanagari as well as Latin, so Hindi and English both
// render; elsewhere, Noto Sans (with Noto Sans Devanagari) is the usual equivalent.
const SUBTITLE_FONT = process.platform === 'win32' ? 'Nirmala UI' : 'Noto Sans';

const burned = new Map(); // `${videoId}:${subtitlesId}:${maxBytes}` -> { promise of the subtitled copy, progress listeners }

// Returns a copy of the video with the subtitles drawn onto the picture, for platforms that can't take a
// subtitle file. maxBytes (or null): the platform's size limit when the original is over it, so the copy
// is burned and fitted in one ffmpeg run instead of two lossy ones (see burnTarget in public/rules.js).
// Platforms needing the same copy share one run. Burn-ins wait their turn behind Whisper (work.js).
export function burnSubtitles(m, subtitles, onProgress, maxBytes = null) {
  const key = `${m.id}:${subtitles.id}:${maxBytes ?? ''}`;
  let job = burned.get(key);
  if (!job) {
    job = { listeners: new Set() };
    const report = (p) => job.listeners.forEach((listener) => listener(p));
    job.promise = enqueue(BURN, () => burn(m, subtitles, report, maxBytes)).promise.catch((err) => {
      burned.delete(key);
      throw err;
    });
    burned.set(key, job);
  }
  if (onProgress) job.listeners.add(onProgress);
  return job.promise;
}

async function burn(m, subtitles, onProgress, maxBytes) {
  const t = await videoTools();
  if (!t) throw new ApiError("Burning subtitles into the video needs ffmpeg, which isn't installed");
  const duration = m.duration || (await probeDuration(m));
  // With a size limit, the quality setting stays (CRF 20), but the bitrate is capped at what fits the
  // limit, so a video that compresses well isn't made bigger than it needs to be.
  const limit = maxBytes ? `${maxBytes / 1_000_000} MB` : '';
  const caps = maxBytes ? [1, 0.85].map((aim) => compressionBitrate(maxBytes * aim, duration || 0)) : [null];
  if (maxBytes && (!duration || !caps[0])) {
    throw new ApiError(duration ? `${m.name} is too long to fit under ${limit} with subtitles without ruining the quality` : `Couldn't read the length of ${m.name} to fit it under ${limit}`);
  }
  const { width, height } = await probeSize(t, m);
  // Sizes are in libass's 288-line script units, so they scale with the video. Vertical videos get
  // smaller text, raised above the caption and buttons Reels and Shorts draw over the bottom.
  const style = height > width
    ? `FontName=${SUBTITLE_FONT},FontSize=10,Bold=1,Outline=1.5,Shadow=0,MarginV=72`
    : `FontName=${SUBTITLE_FONT},FontSize=16,Bold=1,Outline=1.5,Shadow=0,MarginV=20`;

  const id = crypto.randomBytes(16).toString('hex');
  const out = fileURLToPath(fileUrl(id));
  // The subtitles filter can't take a Windows path (its drive colon is a separator), so the cleaned
  // SRT goes in a temporary folder and ffmpeg runs there, given just the file name.
  const work = await mkdtemp(join(tmpdir(), 'social-post-subtitles-'));
  try {
    await writeFile(join(work, 'subtitles.srt'), separateCues(await readFile(fileUrl(subtitles.id), 'utf8')));
    // If a capped run still overshoots the limit, it's retried once aiming lower, as compression is.
    for (const kbps of caps) {
      if (maxBytes && !kbps) break;
      await runWithProgress(t.ffmpeg, [
        '-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', m.path,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', `${SCALE},subtitles=filename=subtitles.srt:charenc=UTF-8:force_style='${style}'`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        ...(kbps ? ['-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`] : []),
        '-fpsmax', '60', '-pix_fmt', 'yuv420p',
        // compressionBitrate leaves room for 128 kbps audio.
        '-c:a', 'aac', '-b:a', kbps ? '128k' : '160k',
        '-movflags', '+faststart', '-f', 'mp4', out,
      ], 60 * 60_000, duration, onProgress, work);
      const { size } = await stat(out);
      if (!maxBytes || size <= maxBytes) return saveDerived(m, id, '-subtitled', size, duration);
    }
  } catch (err) {
    await rm(out, { force: true });
    throw new ApiError(`ffmpeg couldn't add the subtitles to ${m.name}: ${err.message}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  await rm(out, { force: true });
  throw new ApiError(`${m.name} is too long to fit under ${limit} with subtitles without ruining the quality`);
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
    if (meta && Date.now() - meta.createdAt <= MAX_AGE_MS) continue;
    // A file that's being read (e.g. Instagram is downloading it) can't be deleted on Windows;
    // skip it and try again on the next run.
    try {
      await deleteMedia(id);
    } catch (err) {
      log.warn(`Couldn't delete old upload ${id} (${err.code || err.message}); will retry later`);
    }
  }
}

// Serves /media/<id>.<ext> so Threads and Instagram can fetch files through TUNNEL_URL.
export async function serveMedia(req, res, filename) {
  // A fixed, empty response the server fetches through the tunnel to check it's reachable.
  if (filename === 'health') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }
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
  try {
    await pipeline(createReadStream(fileUrl(meta.id), { start, end }), res);
  } catch (err) {
    // Video players drop a download when they seek or have buffered enough. That's the viewer
    // hanging up, not a failure; pipeline has already closed the file.
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err;
  }
}
