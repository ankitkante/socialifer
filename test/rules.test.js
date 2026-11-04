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
  assert.ok(problemsFor(describe(instagram, false), 'hi', [image()]).some((m) => /PUBLIC_BASE_URL/.test(m)));
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
