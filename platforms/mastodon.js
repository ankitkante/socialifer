import crypto from 'node:crypto';
import { request, poll, env, hasEnv, UPLOAD_TIMEOUT } from './http.js';

const ENV = ['MASTODON_INSTANCE', 'MASTODON_ACCESS_TOKEN'];

async function upload(instance, headers, m) {
  const form = new FormData();
  form.append('file', await m.blob(), m.name);
  const { data } = await request(`${instance}/api/v2/media`, { method: 'POST', headers, body: form, timeout: UPLOAD_TIMEOUT });
  if (data.url) return data.id;
  // Large files are processed in the background; the url appears once they're ready.
  return poll(async () => {
    const { data: status } = await request(`${instance}/api/v1/media/${data.id}`, { headers });
    return status.url ? status.id : undefined;
  }, { what: `Mastodon to process ${m.name}` });
}

export default {
  id: 'mastodon',
  name: 'Mastodon',
  // Most instances allow 500; some raise it.
  limit: Number(process.env.MASTODON_CHAR_LIMIT) || 500,
  media: { maxImages: 4, maxVideos: 1, maxItems: 4, mix: false, imageMB: 16, videoMB: 99 },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    const instance = env('MASTODON_INSTANCE').replace(/\/+$/, '');
    const auth = { Authorization: `Bearer ${env('MASTODON_ACCESS_TOKEN')}` };
    const mediaIds = [];
    for (const m of media) mediaIds.push(await upload(instance, auth, m));

    const { data } = await request(`${instance}/api/v1/statuses`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ status: text, ...(mediaIds.length && { media_ids: mediaIds }) }),
    });
    return { url: data.url };
  },
};
