import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { videoTools, probeDuration, fitVideo, deleteMedia } from '../media.js';

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
