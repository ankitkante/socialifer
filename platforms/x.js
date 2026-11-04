import crypto from 'node:crypto';
import { request, poll, env, hasEnv, UPLOAD_TIMEOUT } from './http.js';
import { isVideo, splitThread } from '../public/rules.js';

const ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const TWEETS = 'https://api.x.com/2/tweets';
const UPLOAD = 'https://api.x.com/2/media/upload';
const METADATA = 'https://api.x.com/2/media/metadata';
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

const LIMIT = Number(process.env.X_CHAR_LIMIT) || 280;

// Alt text is set on the uploaded media before it's attached to a post.
async function setAltText(mediaId, text) {
  await api('POST', METADATA, {
    json: { id: mediaId, metadata: { alt_text: { text } } },
  });
}

export default {
  id: 'x',
  name: 'X',
  // X Premium accounts can post up to 25,000 characters.
  limit: LIMIT,
  // Long text can be split into a numbered thread (see splitThread in public/rules.js).
  threads: true,
  // X's upload docs give a 20-minute video cap by default (125 minutes for Premium).
  media: {
    maxImages: 4, maxVideos: 1, maxItems: 4, mix: false, imageMB: 5, videoMB: 512,
    videoMaxSeconds: (Number(process.env.X_VIDEO_MAX_MINUTES) || 20) * 60,
    videoMaxSecondsHint: 'X Premium allows longer videos; set X_VIDEO_MAX_MINUTES in .env',
  },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  // options: { thread, altText, madeWithAi }
  async post(text, media, options = {}) {
    const o = options;
    const warnings = [];
    const mediaIds = [];
    for (const m of media) {
      const id = await upload(m);
      mediaIds.push(id);
      if (o.altText?.trim() && !isVideo(m)) {
        try {
          await setAltText(id, o.altText.trim());
        } catch (err) {
          warnings.push(`Alt text wasn't added to ${m.name} (${err.message}).`);
        }
      }
    }

    const parts = o.thread ? splitThread('x', text, LIMIT) : [text];

    // Media and labels go on the first post; the rest of a thread are replies to it.
    const { data: first } = await api('POST', TWEETS, {
      json: {
        ...(parts[0] && { text: parts[0] }),
        ...(mediaIds.length && { media: { media_ids: mediaIds } }),
        ...(o.madeWithAi && { made_with_ai: true }),
      },
    });

    let previous = first.id;
    for (const [i, part] of parts.slice(1).entries()) {
      try {
        const { data } = await api('POST', TWEETS, {
          json: { text: part, reply: { in_reply_to_tweet_id: previous } },
        });
        previous = data.id;
      } catch (err) {
        warnings.push(`Only ${i + 1} of ${parts.length} posts in the thread were published (${err.message}).`);
        break;
      }
    }
    return { url: `https://x.com/i/web/status/${first.id}`, warnings };
  },
};
