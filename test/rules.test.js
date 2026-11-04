import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countFor, problemsFor } from '../public/rules.js';
import x from '../platforms/x.js';
import mastodon from '../platforms/mastodon.js';
import instagram from '../platforms/instagram.js';
import telegram from '../platforms/telegram.js';

const describe = (p, publicUrlReady = false) => ({ id: p.id, limit: p.limit, media: p.media, title: p.title, textForbids: p.textForbids, publicUrlReady });
const image = (name = 'a.jpg', size = 1000, type = 'image/jpeg') => ({ name, type, size });
const video = (name = 'v.mp4', size = 1000) => ({ name, type: 'video/mp4', size });

test('counts emoji and accented characters as one character', () => {
  assert.equal(countFor('bluesky', 'Café 🎉👍🏽'), 7);
});

test('counts links as 23 characters on X and Mastodon only', () => {
  const text = 'see https://example.com/a/very/long/path/that/goes/on';
  assert.equal(countFor('x', text), 4 + 23);
  assert.equal(countFor('mastodon', text), 4 + 23);
  assert.equal(countFor('bluesky', text), text.length);
});

test('flags text over the limit', () => {
  assert.deepEqual(problemsFor(describe(x), 'a'.repeat(280), []), []);
  assert.match(problemsFor(describe(x), 'a'.repeat(281), [])[0], /too long/);
});

test('enforces media counts and mixing', () => {
  const p = describe(x);
  assert.deepEqual(problemsFor(p, 'hi', [image(), image(), image(), image()]), []);
  assert.ok(problemsFor(p, 'hi', Array(5).fill(image())).some((m) => /Up to 4 images/.test(m)));
  assert.ok(problemsFor(p, 'hi', [video(), video()]).some((m) => /Up to 1 video/.test(m)));
  assert.ok(problemsFor(p, 'hi', [image(), video()]).some((m) => /mix/.test(m)));
  assert.deepEqual(problemsFor(describe(telegram), 'hi', [image(), video()]), []);
});

test('enforces file sizes in decimal MB', () => {
  const p = describe(x);
  assert.deepEqual(problemsFor(p, 'hi', [image('a.jpg', 5_000_000)]), []);
  assert.match(problemsFor(p, 'hi', [image('a.jpg', 5_000_001)])[0], /over 5 MB/);
  assert.match(problemsFor(describe(mastodon), 'hi', [video('v.mp4', 100_000_000)])[0], /over 99 MB/);
});

test('Instagram needs media, JPEG images and a public URL', () => {
  assert.ok(problemsFor(describe(instagram, true), 'hi', []).some((m) => /Needs an image or video/.test(m)));
  assert.ok(problemsFor(describe(instagram, false), 'hi', [image()]).some((m) => /TUNNEL_URL/.test(m)));
  assert.ok(problemsFor(describe(instagram, true), 'hi', [image('a.png', 10, 'image/png')]).some((m) => /JPEG/.test(m)));
  assert.deepEqual(problemsFor(describe(instagram, true), 'hi', [image(), video()]), []);
});

test('YouTube needs one video and a title, falling back to the first line', async () => {
  const youtube = describe((await import('../platforms/youtube.js')).default);
  assert.ok(problemsFor(youtube, 'hi', []).some((m) => m === 'Needs a video'));
  assert.ok(problemsFor(youtube, 'hi', [image()]).some((m) => /Images not supported/.test(m)));
  assert.deepEqual(problemsFor(youtube, '\n  My video  \nmore', [video()]), []);
  assert.ok(problemsFor(youtube, '', [video()]).includes('Needs a title'));
  assert.deepEqual(problemsFor(youtube, '', [video()], { title: 'Typed title' }), []);
  assert.ok(problemsFor(youtube, 'x', [video()], { title: 'a'.repeat(101) }).some((m) => /Title is too long/.test(m)));
  assert.ok(problemsFor(youtube, 'a <b>', [video()]).some((m) => /< or >/.test(m)));
});

test('checks video length, including stricter limits for multi-file posts', () => {
  const ig = describe(instagram, true);
  const long = { ...video('long.mp4'), duration: 16 * 60 };
  assert.ok(problemsFor(ig, 'hi', [long]).some((m) => /16:00 long; the limit is 15:00/.test(m)));
  assert.ok(problemsFor(ig, 'hi', [{ ...video('short.mp4'), duration: 2 }]).some((m) => /shorter than 3 seconds/.test(m)));
  assert.deepEqual(problemsFor(ig, 'hi', [{ ...video(), duration: 120 }]), []);
  assert.ok(problemsFor(ig, 'hi', [image(), { ...video(), duration: 120 }]).some((m) => /limit in a multi-file post is 1:00/.test(m)));
  // Unknown length (browser couldn't read it) isn't treated as a problem.
  assert.deepEqual(problemsFor(ig, 'hi', [video()]), []);
});

test('formats durations', async () => {
  const { formatDuration } = await import('../public/rules.js');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
});

test('oversized videos become compression notes when ffmpeg is available', async () => {
  const { adjustmentsFor, compressionBitrate } = await import('../public/rules.js');
  const big = { ...video('big.mp4', 446_000_000), duration: 180 };
  const without = describe(instagram, true);
  const withFfmpeg = { ...without, canCompress: true };

  assert.ok(problemsFor(without, 'hi', [big]).some((m) => /over 300 MB/.test(m)));
  assert.deepEqual(problemsFor(withFfmpeg, 'hi', [big]), []);
  assert.deepEqual(adjustmentsFor(withFfmpeg, [big]), ['big.mp4 will be compressed to fit 300 MB']);

  // Too long to fit at a watchable bitrate: still a problem, and no note.
  const huge = { ...video('huge.mp4', 2_000_000_000), duration: 14 * 60 };
  const discord = { ...describe((await import('../platforms/discord.js')).default), canCompress: true };
  assert.ok(problemsFor(discord, 'hi', [huge]).some((m) => /too long to compress under 10 MB/.test(m)));
  assert.deepEqual(adjustmentsFor(discord, [huge]), []);

  // 300 MB over 3 minutes leaves plenty of bitrate; 10 MB over 14 minutes doesn't.
  assert.ok(compressionBitrate(300_000_000, 180) > 10_000);
  assert.equal(compressionBitrate(10_000_000, 14 * 60), null);
});

test('per-platform text replaces the main post for that platform only', async () => {
  const { effectiveText } = await import('../public/rules.js');
  assert.equal(effectiveText('main', { text: '  own  ' }), 'own');
  assert.equal(effectiveText('main', { text: '   ' }), 'main');
  assert.equal(effectiveText('main', {}), 'main');
  const p = describe(x);
  assert.ok(problemsFor(p, 'short', [], { text: 'a'.repeat(281) }).some((m) => /too long/.test(m)));
  assert.deepEqual(problemsFor(p, 'a'.repeat(281), [], { text: 'short' }), []);
  assert.ok(problemsFor(p, '', []).some((m) => /Add some text/.test(m)));
});
