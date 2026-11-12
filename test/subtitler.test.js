import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadsPath } from '../media.js';

// A fake lyrics-video: Node itself stands in for the venv's Python, and subtitles.py is a short script
// that prints what FAKE_LYRICS tells it to. No Whisper, no model.
const FAKE = `
const fs = require('fs');
const path = require('path');
const say = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
const mode = process.env.FAKE_LYRICS;
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
if (mode === 'sleep') { setTimeout(() => {}, 60_000); return; }
if (mode === 'match') {
  say({ type: 'hello', protocol: 1 });
  // Leaves a trace in its --out-dir, to show which folder each video got.
  fs.appendFileSync(path.join(arg('--out-dir'), 'seen.txt'), arg('--video') + '\\n');
}
if (mode === 'wrong') say({ type: 'hello', protocol: 2 });
say({ type: 'stage', lang: 'hi', stage: 'loading' });
say({ type: 'done', files: [] });
// A refused run must be killed, not left to finish: stay alive long enough for the test to notice.
if (mode !== 'match') setTimeout(() => {}, 60_000);
`;
const CONTENT = 'the same video bytes';
const HASH = crypto.createHash('sha256').update(CONTENT).digest('hex');
const TRANSCRIPTS = uploadsPath('transcripts/');

let dir;
let python;
let script;
let subtitler;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'social-post-lyrics-'));
  const bin = process.platform === 'win32' ? join(dir, '.venv', 'Scripts') : join(dir, '.venv', 'bin');
  await mkdir(bin, { recursive: true });
  python = join(bin, process.platform === 'win32' ? 'python.exe' : 'python');
  await link(process.execPath, python).catch(() => copyFile(process.execPath, python));
  script = join(dir, 'subtitles.py');
  await writeFile(script, FAKE);
  await writeFile(join(dir, 'talk.mp4'), CONTENT);
  await writeFile(join(dir, 'talk-again.mp4'), CONTENT);
  process.env.LYRICS_VIDEO_DIR = dir;
  subtitler = await import('../subtitler.js');
});

after(async () => {
  delete process.env.LYRICS_VIDEO_DIR;
  await rm(join(TRANSCRIPTS, HASH), { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

// Runs one job with the fake in the given mode and resolves with its final state.
function runFake(mode, video = { id: 'a'.repeat(32), name: 'talk.mp4', path: join(dir, 'talk.mp4') }) {
  process.env.FAKE_LYRICS = mode;
  const job = subtitler.queueJob(video, 'hi', ['hi']);
  return new Promise((resolve) => {
    const unwatch = subtitler.watch(job, (snapshot) => {
      if (subtitler.finished(job)) { queueMicrotask(() => unwatch()); resolve(snapshot); }
    });
  });
}

test('finds the fake lyrics-video through LYRICS_VIDEO_DIR', async () => {
  assert.ok(await subtitler.generator());
});

test('says what to fix when LYRICS_VIDEO_DIR is wrong, not lyrics-video, or has no venv', async (t) => {
  t.after(() => { process.env.LYRICS_VIDEO_DIR = dir; });
  const problemFor = async (value) => {
    process.env.LYRICS_VIDEO_DIR = value;
    return (await subtitler.checkGenerator()).problem;
  };
  assert.match(await problemFor(join(dir, 'nowhere')), /there's no folder there\. Fix the path in \.env/);
  assert.match(await problemFor(join(dir, '.venv')), /isn't the lyrics-video folder: it has no subtitles\.py/);

  const noVenv = await mkdtemp(join(tmpdir(), 'social-post-lyrics-novenv-'));
  t.after(() => rm(noVenv, { recursive: true, force: true }));
  await writeFile(join(noVenv, 'subtitles.py'), '');
  assert.match(await problemFor(noVenv), /virtual environment isn't set up .*lyrics-video's README/);

  // Not set at all is not a problem, just off.
  delete process.env.LYRICS_VIDEO_DIR;
  assert.deepEqual(await subtitler.checkGenerator(), {});
});

test('a run that greets with the expected protocol goes ahead', async () => {
  const job = await runFake('match');
  assert.equal(job.status, 'done');
  assert.equal(job.error, null);
});

test('a different protocol number stops the run with a message naming both', async () => {
  const job = await runFake('wrong');
  assert.equal(job.status, 'error');
  assert.match(job.error, /lyrics-video and Social Post don't match/);
  assert.match(job.error, /protocol 2/);
  assert.match(job.error, new RegExp(`needs protocol ${subtitler.PROTOCOL}`));
  assert.match(job.error, /Update both/);
  // Nothing after the hello was read.
  assert.equal(job.stage, null);
});

test('a run that starts without a hello is refused too', async () => {
  const job = await runFake('missing');
  assert.equal(job.status, 'error');
  assert.match(job.error, /don't match: lyrics-video didn't say which protocol it speaks/);
  assert.equal(job.stage, null);
});

test('the same video added again uses the same transcript folder, named by its content', async () => {
  await rm(join(TRANSCRIPTS, HASH), { recursive: true, force: true });
  await runFake('match', { id: 'b'.repeat(32), name: 'talk.mp4', path: join(dir, 'talk.mp4') });
  await runFake('match', { id: 'c'.repeat(32), name: 'talk-again.mp4', path: join(dir, 'talk-again.mp4') });
  const seen = (await readFile(join(TRANSCRIPTS, HASH, 'seen.txt'), 'utf8')).trim().split(/\r?\n/);
  assert.deepEqual(seen, [join(dir, 'talk.mp4'), join(dir, 'talk-again.mp4')]);
});

test('transcript folders go a day after their last use; other folders are left alone', async (t) => {
  const old = join(TRANSCRIPTS, 'e'.repeat(64));
  const fresh = join(TRANSCRIPTS, 'f'.repeat(64));
  const other = join(TRANSCRIPTS, 'not-a-transcript');
  t.after(() => Promise.all([old, fresh, other].map((d) => rm(d, { recursive: true, force: true }))));
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  for (const d of [old, fresh, other]) await mkdir(d, { recursive: true });
  await utimes(old, twoDaysAgo, twoDaysAgo);
  await utimes(other, twoDaysAgo, twoDaysAgo);

  await subtitler.cleanupTranscripts();
  const there = async (d) => Boolean(await stat(d).catch(() => null));
  assert.equal(await there(old), false);
  assert.equal(await there(fresh), true);
  assert.equal(await there(other), true);
});

// A process to stand in for one left behind, recorded as a dead server would have recorded it.
async function leftover(command, args, record) {
  const child = spawn(command, args, { env: { ...process.env, FAKE_LYRICS: 'sleep' }, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve) => child.once('spawn', resolve));
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  await mkdir(TRANSCRIPTS, { recursive: true });
  await writeFile(join(TRANSCRIPTS, 'running.json'), JSON.stringify({ pid: child.pid, startedAt: Date.now(), ...record }));
  return { child, exited };
}

test('at startup, stops a subtitle run the last server left behind', async () => {
  const { child, exited } = await leftover(python, [script, '--json'], { python, script });
  assert.equal(await subtitler.stopLeftover(), child.pid);
  assert.equal(await Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 10_000))]), true);
});

test("never stops a process it can't confirm is that run, as when its PID was reused", async () => {
  // Same PID as recorded, but a different program: not lyrics-video's python running subtitles.py.
  const { child, exited } = await leftover(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { python, script });
  try {
    assert.equal(await subtitler.stopLeftover(), null);
    assert.equal(await Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 1500))]), false);
  } finally {
    child.kill();
  }
});
