// Generates subtitles for an uploaded video with the separate lyrics-video project (Whisper, run locally).
// How to call it is lyrics-video's to define: see "Calling it from another program" in its CLAUDE.md.
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { saveFile, uploadsPath } from './media.js';
import { languageName } from './public/rules.js';
import { enqueue, WHISPER } from './work.js';
import { log } from './log.js';

const SRT = 'application/x-subrip';
// The version of lyrics-video's --json contract this app understands, announced in its first `hello` event.
// lyrics-video raises it when it renames or removes anything, so a run with another number is refused
// rather than misread.
export const PROTOCOL = 1;
const ID_RE = /^[a-f0-9]{32}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
// Finished jobs are kept a while, so a page that lost its stream can still be told how one ended.
const KEEP_FINISHED_MS = 60 * 60_000;
// Whisper's saved transcripts are kept this long after they were last used, so adding the same video
// again (or posting it again tomorrow) skips Whisper.
export const TRANSCRIPT_MAX_AGE_MS = 24 * 60 * 60_000;
// One folder per video content (its sha256) for lyrics-video's --out-dir, plus the running job's record.
const TRANSCRIPTS = uploadsPath('transcripts/');
const RUNNING = join(TRANSCRIPTS, 'running.json');

const exists = (path) => access(path).then(() => true, () => false);
export const NOT_SET = 'Generating subtitles needs the lyrics-video project. Set LYRICS_VIDEO_DIR in .env to its folder (see "Generating subtitles" in the README), then restart the server.';

// lyrics-video runs with its own virtual environment's Python, which has Whisper installed.
// Optional, like ffmpeg: without LYRICS_VIDEO_DIR the page only offers uploading an SRT.
// Returns { tool } when it's usable, { problem } saying what to fix when LYRICS_VIDEO_DIR is set but
// something's wrong, and {} when it isn't set at all. Checked on every call, so a venv created after the
// server started is found without a restart (the page asks every minute).
export async function checkGenerator() {
  const dir = process.env.LYRICS_VIDEO_DIR?.trim().replace(/^["']|["']$/g, '');
  if (!dir) return {};
  const isFolder = await stat(dir).then((s) => s.isDirectory(), () => false);
  if (!isFolder) {
    return { problem: `LYRICS_VIDEO_DIR is set to ${dir}, but there's no folder there. Fix the path in .env, then restart the server.` };
  }
  const script = join(dir, 'subtitles.py');
  if (!(await exists(script))) {
    return { problem: `${dir} isn't the lyrics-video folder: it has no subtitles.py. Point LYRICS_VIDEO_DIR at lyrics-video in .env, then restart the server.` };
  }
  const python = process.platform === 'win32' ? join(dir, '.venv', 'Scripts', 'python.exe') : join(dir, '.venv', 'bin', 'python');
  if (!(await exists(python))) {
    return { problem: `lyrics-video's virtual environment isn't set up (${python} is missing). Follow lyrics-video's README to create it; Generate appears within a minute, no restart needed.` };
  }
  return { tool: { dir, python, script } };
}

export async function generator() {
  return (await checkGenerator()).tool ?? null;
}

// ---- Processes: stopping a run, and one left behind by a server that died mid-job ----

function run(command, args, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// On Windows the venv's python.exe is a launcher that starts the real interpreter as its child, so the
// whole tree is stopped; elsewhere the venv's python is the interpreter itself.
async function killProcess(pid) {
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F']).catch(() => {});
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
}

// "[[dd-]hh:]mm:ss", as ps prints elapsed time on Linux and macOS.
function elapsedSeconds(etime) {
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return ((Number(days) * 24 + h) * 60 + m) * 60 + s;
}

// What's running under this PID now: its command line and when it started, or null.
async function processInfo(pid) {
  try {
    if (process.platform === 'win32') {
      const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}'; if ($p) { @{ command = [string]$p.CommandLine; exe = [string]$p.ExecutablePath; started = $p.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }`;
      const out = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])).trim();
      if (!out) return null;
      const p = JSON.parse(out);
      return { command: `${p.exe} ${p.command}`, startedAt: Date.parse(p.started) };
    }
    const out = (await run('ps', ['-o', 'etime=,args=', '-p', String(Number(pid))])).trim();
    if (!out) return null;
    const [etime, ...args] = out.split(/\s+/);
    return { command: args.join(' '), startedAt: Date.now() - elapsedSeconds(etime) * 1000 };
  } catch {
    return null; // not running (ps exits 1), or the system couldn't say
  }
}

// PIDs are reused, so a process is only taken for the recorded job when its command line runs that job's
// python with its subtitles.py and --json, and it started within a minute of when the job was recorded.
function isRecordedJob(info, record) {
  const command = info.command.toLowerCase();
  return Math.abs(info.startedAt - record.startedAt) < 60_000
    && command.includes(record.python.toLowerCase())
    && command.includes(record.script.toLowerCase())
    && command.includes('--json');
}

// At startup: a Whisper run left by a server that stopped mid-job still holds over 4 GB of memory, and the
// next job would fail for lack of it. Stops it, but only when it's provably that run.
export async function stopLeftover() {
  let record;
  try {
    record = JSON.parse(await readFile(RUNNING, 'utf8'));
  } catch {
    return null;
  }
  await rm(RUNNING, { force: true });
  if (!Number.isInteger(record?.pid) || typeof record.python !== 'string' || typeof record.script !== 'string') return null;
  const info = await processInfo(record.pid);
  if (!info) return null;
  if (!isRecordedJob(info, record)) {
    log.warn(`Process ${record.pid} isn't the subtitle job this app left running, so it was left alone.`);
    return null;
  }
  await killProcess(record.pid);
  log.info(`Stopped a subtitle job left running by the last server (process ${record.pid}), to free its memory.`);
  return record.pid;
}

// ---- Saved transcripts: one folder per video content, removed after a day unused ----

const hashes = new Map(); // upload id -> sha256 of its file (an upload never changes)

async function contentHash(video) {
  if (!hashes.has(video.id)) {
    const hash = crypto.createHash('sha256');
    await pipeline(createReadStream(video.path), hash);
    hashes.set(video.id, hash.digest('hex'));
  }
  return hashes.get(video.id);
}

const touch = (dir) => { const now = new Date(); return utimes(dir, now, now).catch(() => {}); };

// Removes transcript folders unused for TRANSCRIPT_MAX_AGE_MS, except ones a job is using now.
export async function cleanupTranscripts(maxAge = TRANSCRIPT_MAX_AGE_MS) {
  let names;
  try {
    names = await readdir(TRANSCRIPTS);
  } catch {
    return;
  }
  const inUse = new Set([...jobs.values()].filter((j) => !finished(j)).map((j) => j.hash));
  for (const name of names) {
    if (!HASH_RE.test(name) || inUse.has(name)) continue;
    const dir = join(TRANSCRIPTS, name);
    const { mtimeMs } = await stat(dir).catch(() => ({ mtimeMs: Date.now() }));
    if (Date.now() - mtimeMs > maxAge) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- Jobs ----

const jobs = new Map(); // id -> job
// Waiting and running jobs, in the order they'll run; they wait their turn in work.js.
const queue = [];

export const finished = (job) => ['done', 'error', 'stopped'].includes(job.status);
export const getJob = (id) => (ID_RE.test(id) ? jobs.get(id) : undefined);

// What the page sees. `after` is the video whose job runs before this one, for "starts after video 2".
function snapshot(job) {
  const at = queue.indexOf(job);
  return {
    id: job.id,
    video: job.video.id,
    language: job.language,
    subtitles: job.subtitles,
    status: job.status,
    stage: job.stage,
    lang: job.lang,
    progress: job.progress,
    files: job.files,
    error: job.error,
    after: at > 0 ? queue[at - 1].video.id : null,
  };
}

function notify(job) {
  const s = snapshot(job);
  for (const listener of job.listeners) listener(s);
}

// Calls listener with the job's state now and after every change, until it finishes. Returns a stop function.
export function watch(job, listener) {
  job.listeners.add(listener);
  listener(snapshot(job));
  return () => job.listeners.delete(listener);
}

// video: an upload (getMedia); language: the language spoken; subtitles: the files to make, in order.
export function queueJob(video, language, subtitles) {
  const job = {
    id: crypto.randomBytes(16).toString('hex'),
    video, language, subtitles,
    status: 'queued', stage: null, lang: null, progress: null, files: [], error: null,
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  // Runs when nothing else heavy is running; Whisper goes before waiting burn-ins.
  job.turn = enqueue(WHISPER, () => start(job));
  return job;
}

// Stopping keeps the languages already written: lyrics-video renames each SRT into place only when it's complete.
export function stopJob(job) {
  if (finished(job)) return;
  if (job.child) {
    job.stopping = true;
    killProcess(job.child.pid);
  } else {
    job.turn?.cancel();
    finish(job, { status: 'stopped' });
  }
}

function finish(job, fields) {
  Object.assign(job, fields, { child: null });
  const at = queue.indexOf(job);
  if (at >= 0) queue.splice(at, 1);
  notify(job);
  job.listeners.clear();
  job.done?.();
  setTimeout(() => jobs.delete(job.id), KEEP_FINISHED_MS).unref();
  // Everyone behind it moved up a place.
  for (const waiting of queue) notify(waiting);
}

const lastLine = (text) => text.trim().split(/\r?\n/).pop() || '';

// Runs the job and resolves when it has finished, so the next heavy job waits for it.
function start(job) {
  return new Promise((resolve) => {
    if (finished(job)) return resolve();
    job.done = resolve;
    launch(job).catch((err) => {
      log.error(`Making subtitles failed: ${err.message}`, err.stack);
      if (!finished(job)) finish(job, { status: 'error', error: 'Making the subtitles failed. The details are in the terminal.' });
    });
  });
}

async function launch(job) {
  const { tool, problem } = await checkGenerator();
  if (finished(job)) return;
  if (!tool) return finish(job, { status: 'error', error: problem ?? NOT_SET });
  job.status = 'running';
  notify(job);
  // Folders are keyed by the video's content, so the same video added again reuses Whisper's transcripts.
  job.hash = await contentHash(job.video);
  if (finished(job)) return;
  const outDir = join(TRANSCRIPTS, job.hash);
  await mkdir(outDir, { recursive: true });
  await touch(outDir);
  log.info(`Making ${job.subtitles.map(languageName).join(' and ')} subtitles for ${job.video.name}`);
  const started = Date.now();

  const child = spawn(tool.python, [
    tool.script, '--video', job.video.path, '--language', job.language,
    '--subtitles', ...job.subtitles, '--out-dir', outDir, '--json',
  ], { cwd: tool.dir, windowsHide: true });
  job.child = child;
  // Kept on disk, so a server that dies mid-job can stop this run when it starts again (stopLeftover).
  if (child.pid) {
    writeFile(RUNNING, JSON.stringify({ pid: child.pid, python: tool.python, script: tool.script, startedAt: Date.now() })).catch(() => {});
  }

  let stderr = '';
  let buffer = '';
  let reported = null; // the message of an `error` event
  let completed = false; // a `done` event arrived
  let failure = null; // our own failure while handling an event
  let handling = Promise.resolve(); // file events save uploads one after another, in order
  let greeted = false; // the first event was a matching `hello`
  let mismatch = null; // why this lyrics-video was refused

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (mismatch) return;
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      // The first event must say which contract version it speaks. Anything else stops the run unread.
      if (!greeted) {
        if (event.type === 'hello' && event.protocol === PROTOCOL) {
          greeted = true;
          continue;
        }
        const theirs = event.type === 'hello' && typeof event.protocol === 'number'
          ? `lyrics-video speaks protocol ${event.protocol}` : "lyrics-video didn't say which protocol it speaks";
        mismatch = `lyrics-video and Social Post don't match: ${theirs}, and this app needs protocol ${PROTOCOL}. Update both projects.`;
        killProcess(child.pid);
        return;
      }
      if (event.type === 'error') reported = String(event.message || '');
      if (event.type === 'done') completed = true;
      handling = handling.then(() => handle(job, event, outDir)).catch((err) => { failure ??= err; });
    }
  });
  child.stderr.setEncoding('utf8');
  // Readable progress messages; kept only for the terminal when something fails.
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });

  let ended = false;
  const end = async (code, spawnError) => {
    if (ended) return;
    ended = true;
    await handling;
    await rm(RUNNING, { force: true });
    await touch(outDir);
    const took = `${Math.round((Date.now() - started) / 1000)}s`;
    if (mismatch) {
      log.error(mismatch);
      return finish(job, { status: 'error', error: mismatch });
    }
    if (job.stopping) {
      log.info(`Stopped making subtitles for ${job.video.name} after ${took}`);
      return finish(job, { status: 'stopped' });
    }
    if (spawnError || failure) {
      log.error(`Making subtitles failed: ${(spawnError || failure).message}`, (spawnError || failure).stack);
      return finish(job, { status: 'error', error: 'Making the subtitles failed. The details are in the terminal.' });
    }
    if (code === 0 && completed) {
      log.info(`Made subtitles for ${job.video.name} in ${took}`);
      return finish(job, { status: 'done' });
    }
    log.error(`lyrics-video exited with code ${code}`, stderr.trim());
    // Exit code 2 is a refused request (argparse), which prints no JSON.
    const error = reported || (code === 2 ? `lyrics-video didn't accept the request: ${lastLine(stderr)}` : 'Making the subtitles failed. The details are in the terminal.');
    return finish(job, { status: 'error', error });
  };
  child.on('error', (err) => end(null, err));
  child.on('close', (code) => end(code));
}

async function handle(job, event, outDir) {
  if (event.type === 'stage') {
    Object.assign(job, { stage: event.stage, lang: event.lang, progress: event.stage === 'cached' ? 1 : null });
  } else if (event.type === 'progress') {
    Object.assign(job, { lang: event.lang, progress: event.duration > 0 ? Math.min(1, event.heard / event.duration) : null });
  } else if (event.type === 'file') {
    // Only read files from the folder this job was given.
    const path = resolve(String(event.path));
    if (!path.startsWith(resolve(outDir) + sep) || basename(path) === 'running.json') throw new Error(`lyrics-video reported a file outside its folder: ${path}`);
    const stem = job.video.name.replace(/\.[^.]+$/, '');
    const saved = await saveFile(await readFile(path), SRT, `${stem}.${event.lang}.srt`);
    // The SRT now lives on as an upload (deleted with the others); only the transcripts stay as a cache.
    await rm(path, { force: true });
    job.files = [...job.files, { lang: event.lang, id: saved.id, name: saved.name, lines: event.lines }];
    job.progress = 1;
  } else {
    return;
  }
  notify(job);
}
