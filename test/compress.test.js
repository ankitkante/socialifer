import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { videoTools, probeDuration, fitVideo, burnSubtitles, deleteMedia } from '../media.js';
import { separateCues } from '../public/rules.js';

const tools = await videoTools();

// Runs only where ffmpeg and ffprobe are installed; otherwise it's reported as skipped.
test('compresses a video under a size limit with ffmpeg', { skip: !tools && 'ffmpeg is not installed' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'social-post-test-'));
  try {
    // 10 seconds of noisy 1080x1920 test video with a tone, encoded at a high bitrate (~15 MB).
    const source = join(dir, 'source.mp4');
    await promisify(execFile)(tools.ffmpeg, [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
      '-c:v', 'libx264', '-b:v', '12M', '-c:a', 'aac', '-shortest', source,
    ]);
    const { size } = await stat(source);
    const original = { id: 'f'.repeat(32), name: 'source.mp4', type: 'video/mp4', size, path: source };
    original.duration = await probeDuration(original);
    assert.ok(Math.abs(original.duration - 10) < 0.5, `duration ${original.duration}`);

    const limit = 4_000_000;
    assert.ok(size > limit, `test video should start over the limit (${size} bytes)`);
    const fitted = await fitVideo(original, limit);
    assert.ok(fitted.size <= limit, `compressed to ${fitted.size} bytes`);
    assert.equal(fitted.type, 'video/mp4');
    assert.equal(fitted.name, 'source-compressed.mp4');
    assert.equal((await stat(fitted.path)).size, fitted.size);

    // Same target again reuses the same copy instead of re-encoding.
    assert.equal((await fitVideo(original, limit)).id, fitted.id);
    await deleteMedia(fitted.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ends each subtitle line when the next one starts, so lines never stack', () => {
  // The shape of YouTube's auto captions: each line runs on into the next.
  const youtube = '﻿1\r\n00:00:00,719 --> 00:00:07,759\r\nहम सबके अंदर आर्ट होता है।\r\n\r\n'
    + '2\r\n00:00:04,160 --> 00:00:10,800\r\nफॉर्म्स में होता है\r\n\r\n3\r\n00:00:07,759 --> 00:00:14,000\r\nLast line\r\n';
  assert.equal(separateCues(youtube), '1\n00:00:00,719 --> 00:00:04,160\nहम सबके अंदर आर्ट होता है।\n\n'
    + '2\n00:00:04,160 --> 00:00:07,759\nफॉर्म्स में होता है\n\n3\n00:00:07,759 --> 00:00:14,000\nLast line\n');
  // Lines that already take turns are left alone; times past an hour keep their format.
  const tidy = '1\n01:02:03,004 --> 01:02:04,000\nA\n\n2\n01:02:05,000 --> 01:02:06,500\nB\n';
  assert.equal(separateCues(tidy), `${tidy}`);
});

test('burns SRT subtitles into a copy of a video with ffmpeg', { skip: !tools && 'ffmpeg is not installed' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'social-post-test-'));
  // The subtitles filter reads the SRT from the uploads folder by its id, as a real upload would be.
  const uploads = fileURLToPath(new URL('../uploads/', import.meta.url));
  const subtitlesId = 'e'.repeat(32);
  try {
    const source = join(dir, 'source.mp4');
    await promisify(execFile)(tools.ffmpeg, [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', source,
    ]);
    await mkdir(uploads, { recursive: true });
    await writeFile(join(uploads, subtitlesId), '1\n00:00:00,500 --> 00:00:02,500\nनमस्ते, hello\n');

    const original = { id: 'd'.repeat(32), name: 'source.mp4', type: 'video/mp4', size: (await stat(source)).size, path: source };
    let progressed = false;
    const subtitled = await burnSubtitles(original, { id: subtitlesId }, () => { progressed = true; });
    assert.equal(subtitled.name, 'source-subtitled.mp4');
    assert.equal(subtitled.type, 'video/mp4');
    assert.ok((await stat(subtitled.path)).size > 0);
    assert.ok(Math.abs((await probeDuration(subtitled)) - 3) < 0.5);
    assert.ok(progressed, 'reports progress');
    // Same video and subtitles again reuses the copy.
    assert.equal((await burnSubtitles(original, { id: subtitlesId })).id, subtitled.id);
    await deleteMedia(subtitled.id);
  } finally {
    await rm(join(uploads, subtitlesId), { force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('burns subtitles and fits a size limit in one ffmpeg run', { skip: !tools && 'ffmpeg is not installed' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'social-post-test-'));
  const uploads = fileURLToPath(new URL('../uploads/', import.meta.url));
  const subtitlesId = 'c'.repeat(32);
  try {
    // 10 seconds of noisy 1080x1920 video at a high bitrate (~15 MB), as in the compression test.
    const source = join(dir, 'source.mp4');
    await promisify(execFile)(tools.ffmpeg, [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
      '-c:v', 'libx264', '-b:v', '12M', '-c:a', 'aac', '-shortest', source,
    ]);
    await mkdir(uploads, { recursive: true });
    await writeFile(join(uploads, subtitlesId), '1\n00:00:01,000 --> 00:00:04,000\nनमस्ते, hello\n');
    const { size } = await stat(source);
    const original = { id: 'b'.repeat(32), name: 'source.mp4', type: 'video/mp4', size, path: source, duration: 10 };
    const limit = 4_000_000;
    assert.ok(size > limit, `test video should start over the limit (${size} bytes)`);

    const fitted = await burnSubtitles(original, { id: subtitlesId }, null, limit);
    assert.ok(fitted.size <= limit, `burned and fitted to ${fitted.size} bytes`);
    assert.equal(fitted.name, 'source-subtitled.mp4');
    // Same video, subtitles and limit share the copy; no limit is a different copy.
    assert.equal((await burnSubtitles(original, { id: subtitlesId }, null, limit)).id, fitted.id);
    await deleteMedia(original.id);
  } finally {
    await rm(join(uploads, subtitlesId), { force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
