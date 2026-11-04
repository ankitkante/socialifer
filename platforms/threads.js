import { request, poll, env, hasEnv, ApiError } from './http.js';
import { isVideo } from '../public/rules.js';

const ENV = ['THREADS_ACCESS_TOKEN'];
const BASE = 'https://graph.threads.net/v1.0';

// Threads can't receive file uploads; it downloads each file from a public URL.
const mediaParams = (m) => (isVideo(m) ? { media_type: 'VIDEO', video_url: m.url } : { media_type: 'IMAGE', image_url: m.url });

async function createContainer(userId, token, params) {
  const { data } = await request(`${BASE}/${userId}/threads`, {
    method: 'POST',
    body: new URLSearchParams({ ...params, access_token: token }),
  });
  return data.id;
}

function waitUntilReady(containerId, token) {
  return poll(async () => {
    const { data } = await request(`${BASE}/${containerId}?fields=status,error_message&access_token=${encodeURIComponent(token)}`, { retries: 2 });
    if (data.status === 'FINISHED') return true;
    if (data.status === 'ERROR' || data.status === 'EXPIRED') {
      throw new ApiError(`Threads could not process the media: ${data.error_message || data.status}`);
    }
  }, { what: 'Threads to process the media' });
}

export default {
  id: 'threads',
  name: 'Threads',
  limit: 500,
  media: { maxImages: 20, maxVideos: 20, maxItems: 20, mix: true, imageMB: 8, videoMB: 1000, videoMaxSeconds: 5 * 60, needsPublicUrl: true },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    const token = env('THREADS_ACCESS_TOKEN');
    const userId = env('THREADS_USER_ID') || 'me';
    const textParam = text ? { text } : {};

    // Threads publishes in two steps: create a container, then publish it.
    let containerId;
    if (media.length === 0) {
      containerId = await createContainer(userId, token, { media_type: 'TEXT', text });
    } else if (media.length === 1) {
      containerId = await createContainer(userId, token, { ...mediaParams(media[0]), ...textParam });
    } else {
      const children = [];
      for (const m of media) children.push(await createContainer(userId, token, { ...mediaParams(m), is_carousel_item: 'true' }));
      for (const child of children) await waitUntilReady(child, token);
      containerId = await createContainer(userId, token, { media_type: 'CAROUSEL', children: children.join(','), ...textParam });
    }
    if (media.length) await waitUntilReady(containerId, token);

    const { data: published } = await request(`${BASE}/${userId}/threads_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    });

    // The permalink is a nice-to-have; the post is already live if this fails.
    try {
      const { data } = await request(`${BASE}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`);
      return { url: data.permalink };
    } catch {
      return { url: null };
    }
  },
};
