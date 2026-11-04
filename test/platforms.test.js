import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { oauthHeader } from '../platforms/x.js';
import { buildFacets } from '../platforms/bluesky.js';
import { toLittleText } from '../platforms/linkedin.js';

test('X OAuth 1.0a signature matches the example in X\'s documentation', (t) => {
  // Values from the worked example in X's "Creating a signature" OAuth 1.0a guide.
  Object.assign(process.env, {
    X_API_KEY: 'xvz1evFS4wEEPTGEFPHBog',
    X_API_SECRET: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    X_ACCESS_TOKEN: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    X_ACCESS_SECRET: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  });
  t.mock.method(crypto, 'randomBytes', () => ({ toString: () => 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg' }));
  t.mock.method(Date, 'now', () => 1318622958000);

  const status = encodeURIComponent('Hello Ladies + Gentlemen, a signed OAuth request!');
  const header = oauthHeader('POST', `https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=${status}`);
  const signature = decodeURIComponent(/oauth_signature="([^"]+)"/.exec(header)[1]);
  assert.equal(signature, 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=');
});

test('Bluesky facets use UTF-8 byte offsets and keep balanced parentheses in links', () => {
  const text = 'Café 🎉 see https://en.wikipedia.org/wiki/Foo_(bar). and (https://ex.com/x) #news_today';
  const bytes = Buffer.from(text);
  const spans = buildFacets(text).map((f) => ({
    text: bytes.subarray(f.index.byteStart, f.index.byteEnd).toString(),
    value: f.features[0].uri ?? f.features[0].tag,
  }));
  assert.deepEqual(spans, [
    { text: 'https://en.wikipedia.org/wiki/Foo_(bar)', value: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
    { text: 'https://ex.com/x', value: 'https://ex.com/x' },
    { text: '#news_today', value: 'news_today' },
  ]);
});

test('LinkedIn escapes reserved characters and converts simple hashtags', () => {
  assert.equal(toLittleText('Hi (all) @team #AI2026!'), 'Hi \\(all\\) \\@team {hashtag|\\#|AI2026}!');
  assert.equal(toLittleText('#news_today'), '\\#news\\_today');
  assert.equal(toLittleText('https://x.com/page#section'), 'https://x.com/page\\#section');
});

test('YouTube refreshes the token, opens a resumable session and uploads the file', async (t) => {
  Object.assign(process.env, { YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret', YOUTUBE_REFRESH_TOKEN: 'refresh' });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes('oauth2')) return Response.json({ access_token: 'AT' });
    if (opts.method === 'POST') return new Response('', { status: 200, headers: { location: 'https://upload.example/session' } });
    return Response.json({ id: 'VID' });
  });
  const youtube = (await import('../platforms/youtube.js')).default;
  const media = [{ name: 'v.mp4', type: 'video/mp4', size: 3, blob: async () => new Blob([new Uint8Array(3)]) }];
  const result = await youtube.post('First line\nDescription', media, { privacy: 'unlisted', madeForKids: false });

  assert.equal(result.url, 'https://www.youtube.com/watch?v=VID');
  assert.equal(calls[0].opts.body.get('grant_type'), 'refresh_token');
  assert.match(calls[1].url, /uploadType=resumable&part=snippet,status/);
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer AT');
  assert.equal(calls[1].opts.headers['X-Upload-Content-Length'], '3');
  const metadata = JSON.parse(calls[1].opts.body);
  assert.equal(metadata.snippet.title, 'First line');
  assert.equal(metadata.snippet.description, 'First line\nDescription');
  assert.deepEqual(metadata.status, {
    privacyStatus: 'unlisted', selfDeclaredMadeForKids: false, containsSyntheticMedia: false,
  });
  assert.equal(calls[2].url, 'https://upload.example/session');
  assert.equal(calls[2].opts.method, 'PUT');
});

// Replaces fetch with a stub that records each call and answers from `respond(url, opts)`.
function stubFetch(t, respond) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return respond(String(url), opts) ?? Response.json({});
  });
  return calls;
}

test('YouTube sends scheduling, tags and extras, and sets the thumbnail', async (t) => {
  Object.assign(process.env, { YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret', YOUTUBE_REFRESH_TOKEN: 'refresh' });
  const calls = stubFetch(t, (url) => {
    if (url.includes('oauth2')) return Response.json({ access_token: 'AT' });
    if (url.includes('uploadType=resumable')) return new Response('', { headers: { location: 'https://upload.example/session' } });
    if (url.includes('thumbnails/set')) return new Response('{"error":{"message":"forbidden"}}', { status: 403 });
    return Response.json({ id: 'VID' });
  });
  const youtube = (await import('../platforms/youtube.js')).default;
  const blob = async () => new Blob([new Uint8Array(3)]);
  const at = new Date(Date.now() + 86_400_000).toISOString();
  const result = await youtube.post('Title line\nBody', [{ name: 'v.mp4', type: 'video/mp4', size: 3, blob }], {
    privacy: 'public', publishAt: at, tags: 'lyric video, hindi', category: '10', synthetic: true,
    thumbnail: { type: 'image/jpeg', blob },
  });

  const session = calls.find((c) => c.url.includes('uploadType=resumable'));
  assert.doesNotMatch(session.url, /notifySubscribers/);
  const { snippet, status } = JSON.parse(session.opts.body);
  assert.deepEqual(snippet.tags, ['lyric video', 'hindi']);
  assert.equal(snippet.categoryId, '10');
  assert.equal(status.privacyStatus, 'private', 'scheduled videos stay private until publishAt');
  assert.equal(status.publishAt, at);
  assert.equal(status.containsSyntheticMedia, true);
  // A rejected thumbnail doesn't fail the post.
  assert.equal(result.url, 'https://www.youtube.com/watch?v=VID');
  assert.match(result.warnings[0], /thumbnail wasn't set/);
});

test('X posts a numbered thread with the settings on the first post', async (t) => {
  Object.assign(process.env, { X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't', X_ACCESS_SECRET: 'ts' });
  let n = 0;
  const calls = stubFetch(t, () => Response.json({ data: { id: `P${++n}` } }));
  const x = (await import('../platforms/x.js')).default;
  const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const result = await x.post(text, [], {
    thread: true, madeWithAi: true,
  });

  const bodies = calls.map((c) => JSON.parse(c.opts.body));
  assert.ok(bodies.length >= 2);
  assert.equal(bodies[0].made_with_ai, true);
  assert.equal(bodies[0].reply_settings, undefined);
  assert.match(bodies[0].text, /\.\.\.\n\(1\/\d+\)$/);
  assert.equal(bodies[1].reply.in_reply_to_tweet_id, 'P1');
  assert.equal(bodies[1].made_with_ai, undefined);
  for (const b of bodies) assert.ok([...b.text].length <= 280);
  assert.equal(result.url, 'https://x.com/i/web/status/P1');
});

test('Instagram builds Reel fields', async (t) => {
  Object.assign(process.env, { INSTAGRAM_ACCESS_TOKEN: 'it', INSTAGRAM_USER_ID: '123', INSTAGRAM_GRAPH_HOST: 'https://graph.facebook.com' });
  const calls = stubFetch(t, (url) => {
    if (url.includes('fields=status_code')) return Response.json({ status_code: 'FINISHED' });
    if (url.includes('fields=permalink')) return Response.json({ permalink: 'https://instagram.com/p/1' });
    return Response.json({ id: 'C1' });
  });
  const instagram = (await import('../platforms/instagram.js')).default;
  const result = await instagram.post('Caption', [{ type: 'video/mp4', url: 'https://pub/v.mp4' }], {
    postAs: 'feed', shareToFeed: false, coverSeconds: '2.5', aiGenerated: true, trial: 'auto',
  });

  const container = new URLSearchParams(calls.find((c) => c.url.endsWith('/123/media')).opts.body);
  assert.equal(container.get('media_type'), 'REELS');
  assert.equal(container.get('share_to_feed'), 'false');
  assert.equal(container.get('thumb_offset'), '2500');
  assert.equal(container.get('is_ai_generated'), 'true');
  assert.equal(container.get('trial_params'), '{"graduation_strategy":"SS_PERFORMANCE"}');
  assert.ok(!calls.some((c) => c.url.endsWith('/comments')));
  assert.equal(result.url, 'https://instagram.com/p/1');
});
