import { request, env, hasEnv, UPLOAD_TIMEOUT } from './http.js';
import { isVideo } from '../public/rules.js';

const ENV = ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'];

const byteOffset = (text, index) => Buffer.byteLength(text.slice(0, index), 'utf8');

const count = (s, ch) => s.split(ch).length - 1;

// Drop sentence punctuation after a link, but keep a ")" that closes one inside it (e.g. Wikipedia URLs).
export function trimUrl(url) {
  for (;;) {
    if (/[.,;:!?'"\]]$/.test(url)) url = url.slice(0, -1);
    else if (url.endsWith(')') && count(url, ')') > count(url, '(')) url = url.slice(0, -1);
    else return url;
  }
}

// Bluesky doesn't auto-detect links or hashtags; they must be sent as facets with UTF-8 byte ranges.
export function buildFacets(text) {
  const facets = [];
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const uri = trimUrl(m[0]);
    facets.push({
      index: { byteStart: byteOffset(text, m.index), byteEnd: byteOffset(text, m.index + uri.length) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    });
  }
  for (const m of text.matchAll(/(?<=^|\s)#([\p{L}\p{N}_]+)/gu)) {
    facets.push({
      index: { byteStart: byteOffset(text, m.index), byteEnd: byteOffset(text, m.index + m[0].length) },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[1] }],
    });
  }
  return facets;
}

async function uploadBlob(service, session, m) {
  const { data } = await request(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessJwt}`, 'Content-Type': m.type },
    body: await m.blob(),
    timeout: UPLOAD_TIMEOUT,
  });
  return data.blob;
}

// Videos are uploaded like images; Bluesky processes them after the post is created.
async function buildEmbed(service, session, media) {
  if (media.length === 0) return null;
  if (isVideo(media[0])) {
    return { $type: 'app.bsky.embed.video', video: await uploadBlob(service, session, media[0]) };
  }
  const images = [];
  for (const m of media) images.push({ alt: '', image: await uploadBlob(service, session, m) });
  return { $type: 'app.bsky.embed.images', images };
}

export default {
  id: 'bluesky',
  name: 'Bluesky',
  limit: 300,
  media: { maxImages: 4, maxVideos: 1, maxItems: 4, mix: false, imageMB: 1, videoMB: 100 },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    const service = env('BLUESKY_SERVICE') || 'https://bsky.social';
    const { data: session } = await request(`${service}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: env('BLUESKY_HANDLE'), password: env('BLUESKY_APP_PASSWORD') }),
    });

    const facets = buildFacets(text);
    const embed = await buildEmbed(service, session, media);
    const { data } = await request(`${service}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text,
          createdAt: new Date().toISOString(),
          ...(facets.length && { facets }),
          ...(embed && { embed }),
        },
      }),
    });

    const rkey = data.uri.split('/').pop();
    return { url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
  },
};
