import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countFor, problemsFor, burnLanguage, burnTarget, parseSrt, formatSrt, isSubtitleLanguage, SUBTITLE_LANGUAGES } from '../public/rules.js';
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
  // An edited box is used exactly, even when it's been emptied on purpose.
  assert.equal(effectiveText('main', { text: '   ' }), '');
  assert.equal(effectiveText('main', {}), 'main');
  const p = describe(x);
  assert.ok(problemsFor(p, 'short', [], { text: 'a'.repeat(281) }).some((m) => /too long/.test(m)));
  assert.deepEqual(problemsFor(p, 'a'.repeat(281), [], { text: 'short' }), []);
  assert.ok(problemsFor(p, '', []).some((m) => /Add some text/.test(m)));
});

test('YouTube takes the title from the first line and the description from the rest', async () => {
  const { effectiveText, resolveTitle } = await import('../public/rules.js');
  const post = 'Main Tera Boyfriend | Lyric video\n\nMade with Claude and DaVinci Resolve.\n#lyrics';
  assert.equal(resolveTitle(post, ''), 'Main Tera Boyfriend | Lyric video');
  assert.equal(effectiveText(post, {}, 'youtube'), 'Made with Claude and DaVinci Resolve.\n#lyrics');
  // A typed title means the whole post is the description.
  assert.equal(effectiveText(post, { title: 'Custom' }, 'youtube'), post);
  // An edited description box is used exactly.
  assert.equal(effectiveText(post, { text: 'Own description' }, 'youtube'), 'Own description');
  // Other platforms get the whole post.
  assert.equal(effectiveText(post, {}, 'instagram'), post);
  // A one-line post is all title, with no description.
  assert.equal(effectiveText('Just a title', {}, 'youtube'), '');
});

test('splits long text into a numbered thread that fits X', async () => {
  const { splitThread } = await import('../public/rules.js');
  assert.deepEqual(splitThread('x', 'short', 280), ['short']);
  const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
  const parts = splitThread('x', text, 280);
  assert.ok(parts.length > 1);
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    assert.ok([...part].length <= 280, `part ${i + 1} is ${[...part].length} long`);
    // No sentences here, so every post but the last is cut mid-sentence and ends with "...".
    assert.ok(part.endsWith(`${last ? '' : '...'}\n\n(${i + 1}/${parts.length})`), JSON.stringify(part.slice(-14)));
  });
  // Nothing is lost: rejoining the parts gives back every word.
  assert.equal(parts.map((part) => part.replace(/(\.\.\.)?\n\n\(\d+\/\d+\)$/, '')).join(' '), text);

  const p = { ...describe(x), name: 'X', threads: true };
  assert.deepEqual(problemsFor(p, text, [], { thread: true }), []);
  assert.ok(problemsFor(p, text, [], { thread: false }).some((m) => /^Too long for one post.*untick X$/.test(m)));
});

test('breaks a thread at the end of a sentence when one is close', async () => {
  const { splitThread } = await import('../public/rules.js');
  // The user's own post, from the mockup review.
  const post = 'Main Tera Boyfriend | Lyric video made with Claude + DaVinci Resolve I wanted to see if we can generate a lyric video using scripting in DaVinci Resolve. This video is a product of that. I gave it an MP3 file. It then used Whisper to get the lyrics, and the scripting feature in Resolve generated the Fusion nodes.';
  assert.deepEqual(splitThread('x', post, 280), [
    'Main Tera Boyfriend | Lyric video made with Claude + DaVinci Resolve I wanted to see if we can generate a lyric video using scripting in DaVinci Resolve. This video is a product of that. I gave it an MP3 file.\n\n(1/2)',
    'It then used Whisper to get the lyrics, and the scripting feature in Resolve generated the Fusion nodes.\n\n(2/2)',
  ]);
  // A sentence end early in the post isn't "close", so the post fills up and gets "...".
  const early = `Short start. ${Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')}`;
  assert.match(splitThread('x', early, 280)[0], /\.\.\.\n\n\(1\/\d\)$/);
  // A single word longer than a post is cut.
  assert.deepEqual(splitThread('x', 'a'.repeat(600), 280).map((p) => [...p].length), [278, 278, 71]);
});

test('checks per-platform fields', async () => {
  const { adjustmentsFor } = await import('../public/rules.js');
  const youtube = describe((await import('../platforms/youtube.js')).default);
  const v = [{ ...video(), duration: 30 }];
  assert.ok(problemsFor(youtube, 'hi', v, { tags: 'a'.repeat(501) }).some((m) => /Tags are too long/.test(m)));
  assert.ok(problemsFor(youtube, 'hi', v, { publishAt: '2000-01-01T00:00' }).some((m) => /future/.test(m)));
  assert.ok(problemsFor(youtube, 'hi', v, { thumbnail: { type: 'image/jpeg', size: 3_000_000 } }).some((m) => /2 MB/.test(m)));
  const later = new Date(Date.now() + 3_600_000).toISOString();
  assert.ok(adjustmentsFor(youtube, v, { publishAt: later }).some((n) => /Stays private until/.test(n)));

  const ig = describe(instagram, true);
  assert.ok(problemsFor(ig, 'hi', [image(), image()], { postAs: 'story' }).some((m) => /exactly one/.test(m)));
  assert.ok(problemsFor(ig, 'hi', [image()], { trial: 'auto' }).some((m) => /Trial reels/.test(m)));
  assert.deepEqual(problemsFor(ig, 'hi', v, { trial: 'manual', coverSeconds: '3' }), []);
  assert.ok(problemsFor(ig, 'hi', v, { coverSeconds: '45' }).some((m) => /past the end/.test(m)));

  const px = describe(x);
  assert.ok(problemsFor(px, 'hi', [image()], { altText: 'a'.repeat(1001) }).some((m) => /Alt text is too long/.test(m)));
});

test('picks the language each platform gets burned in', () => {
  // The platform's own choice when that language exists; None means none.
  assert.equal(burnLanguage('hi', ['hi', 'en']), 'hi');
  assert.equal(burnLanguage('none', ['hi', 'en']), null);
  // Otherwise English, else the first language there is.
  assert.equal(burnLanguage(undefined, ['hi', 'en']), 'en');
  assert.equal(burnLanguage('en', ['hi']), 'hi');
  assert.equal(burnLanguage(undefined, []), null);
});

test('reads and writes SRT files, keeping the timing as it was', () => {
  const srt = '1\n00:00:00,400 --> 00:00:02,900\nनमस्ते\n\n2\n00:00:02,900 --> 00:00:05,100\nSecond line\n';
  const cues = parseSrt(`﻿${srt.replace(/\n/g, '\r\n')}`);
  assert.deepEqual(cues.map((c) => [c.start, c.end, c.text]), [[400, 2900, 'नमस्ते'], [2900, 5100, 'Second line']]);
  assert.equal(formatSrt(cues), srt);
});

test('a burned-in copy only has to fit a size limit the original is over', () => {
  const instagram = { canCompress: true, media: { videoMB: 300 } };
  assert.equal(burnTarget(instagram, { size: 200_000_000 }), null);
  assert.equal(burnTarget(instagram, { size: 400_000_000 }), 300_000_000);
  // Without ffmpeg there's nothing to fit with; with no limit there's nothing to fit.
  assert.equal(burnTarget({ ...instagram, canCompress: false }, { size: 400_000_000 }), null);
  assert.equal(burnTarget({ canCompress: true, media: { videoMB: null } }, { size: 400_000_000 }), null);
});

test('subtitles support Hindi and English only', () => {
  assert.deepEqual(SUBTITLE_LANGUAGES.map(([code]) => code), ['hi', 'en']);
  assert.ok(isSubtitleLanguage('hi') && isSubtitleLanguage('en'));
  for (const code of ['fr', 'pa', 'HI', '', '--fresh', undefined]) assert.equal(isSubtitleLanguage(code), false, String(code));
});
