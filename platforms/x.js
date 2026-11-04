import crypto from 'node:crypto';
import { request, poll, env, hasEnv, UPLOAD_TIMEOUT } from './http.js';
import { isVideo } from '../public/rules.js';

const ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const TWEETS = 'https://api.x.com/2/tweets';
const UPLOAD = 'https://api.x.com/2/media/upload';
const CHUNK_BYTES = 4 * 1024 * 1024;

// RFC 3986 percent-encoding, as OAuth 1.0a requires.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function oauthHeader(method, url) {
  const { origin, pathname, searchParams } = new URL(url);
  const oauth = {
    oauth_consumer_key: env('X_API_KEY'),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env('X_ACCESS_TOKEN'),
    oauth_version: '1.0',
  };
  // Query parameters are signed; JSON and multipart bodies are not.
  const paramString = [...Object.entries(oauth), ...searchParams]
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .sort()
    .join('&');
  const baseString = [method, enc(origin + pathname), enc(paramString)].join('&');
  const signingKey = `${enc(env('X_API_SECRET'))}&${enc(env('X_ACCESS_SECRET'))}`;
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  return 'OAuth ' + Object.entries(oauth).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ');
}

async function api(method, url, { json, form, timeout } = {}) {
  const headers = { Authorization: oauthHeader(method, url) };
  let body = form;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  return (await request(url, { method, headers, body, timeout })).data;
}

async function upload(m) {
  const category = m.type === 'image/gif' ? 'tweet_gif' : isVideo(m) ? 'tweet_video' : 'tweet_image';
  const { data: init } = await api('POST', `${UPLOAD}/initialize`, {
    json: { media_type: m.type, total_bytes: m.size, media_category: category },
  });
  const id = init.id;

  const blob = await m.blob();
  for (let index = 0, offset = 0; offset < m.size; index++, offset += CHUNK_BYTES) {
    const form = new FormData();
    form.append('segment_index', String(index));
    form.append('media', blob.slice(offset, offset + CHUNK_BYTES), m.name);
    await api('POST', `${UPLOAD}/${id}/append`, { form, timeout: UPLOAD_TIMEOUT });
  }

  let info = (await api('POST', `${UPLOAD}/${id}/finalize`)).data?.processing_info;
  await poll(async () => {
    if (!info || info.state === 'succeeded') return true;
    if (info.state === 'failed') throw new Error(`X could not process ${m.name}: ${info.error?.message || 'unknown error'}`);
    info = (await api('GET', `${UPLOAD}?command=STATUS&media_id=${id}`)).data?.processing_info;
  }, { what: `X to process ${m.name}` });
  return id;
}

export default {
  id: 'x',
  name: 'X',
  // X Premium accounts can post up to 25,000 characters.
  limit: Number(process.env.X_CHAR_LIMIT) || 280,
  media: { maxImages: 4, maxVideos: 1, maxItems: 4, mix: false, imageMB: 5, videoMB: 512 },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    const mediaIds = [];
    for (const m of media) mediaIds.push(await upload(m));
    const { data } = await api('POST', TWEETS, {
      json: { ...(text && { text }), ...(mediaIds.length && { media: { media_ids: mediaIds } }) },
    });
    return { url: `https://x.com/i/web/status/${data.id}` };
  },
};
