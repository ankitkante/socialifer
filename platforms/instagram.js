import { request, poll, env, hasEnv } from './http.js';
import { isVideo } from '../public/rules.js';

const ENV = ['INSTAGRAM_ACCESS_TOKEN'];

function api() {
  // graph.instagram.com is for "Instagram API with Instagram Login" tokens;
  // set INSTAGRAM_GRAPH_HOST=https://graph.facebook.com for Facebook Login tokens.
  const host = (env('INSTAGRAM_GRAPH_HOST') || 'https://graph.instagram.com').replace(/\/+$/, '');
  return `${host}/${env('INSTAGRAM_API_VERSION') || 'v23.0'}`;
}

async function createContainer(params) {
  const { data } = await request(`${api()}/${env('INSTAGRAM_USER_ID') || 'me'}/media`, {
    method: 'POST',
    body: new URLSearchParams({ ...params, access_token: env('INSTAGRAM_ACCESS_TOKEN') }),
  });
  return data.id;
}

function waitUntilReady(containerId) {
  const token = encodeURIComponent(env('INSTAGRAM_ACCESS_TOKEN'));
  return poll(async () => {
    const { data } = await request(`${api()}/${containerId}?fields=status_code,status&access_token=${token}`);
    if (data.status_code === 'FINISHED') return true;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new Error(`Instagram could not process the media: ${data.status || data.status_code}`);
    }
  }, { what: 'Instagram to process the media' });
}

export default {
  id: 'instagram',
  name: 'Instagram',
  limit: 2200,
  media: {
    maxImages: 10,
    maxVideos: 10,
    maxItems: 10,
    mix: true,
    imageMB: 8,
    videoMB: 300,
    imageTypes: ['image/jpeg'],
    imageTypesLabel: 'Instagram only accepts JPEG images',
    requiresMedia: true,
    needsPublicUrl: true,
  },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    // Instagram downloads each file from a public URL. A single video is posted as a Reel.
    const caption = text ? { caption: text } : {};
    let containerId;
    if (media.length === 1) {
      const m = media[0];
      containerId = await createContainer(isVideo(m) ? { media_type: 'REELS', video_url: m.url, ...caption } : { image_url: m.url, ...caption });
    } else {
      const children = [];
      for (const m of media) {
        children.push(await createContainer(isVideo(m)
          ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: 'true' }
          : { image_url: m.url, is_carousel_item: 'true' }));
      }
      for (const child of children) await waitUntilReady(child);
      containerId = await createContainer({ media_type: 'CAROUSEL', children: children.join(','), ...caption });
    }
    await waitUntilReady(containerId);

    const { data: published } = await request(`${api()}/${env('INSTAGRAM_USER_ID') || 'me'}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: containerId, access_token: env('INSTAGRAM_ACCESS_TOKEN') }),
    });

    try {
      const token = encodeURIComponent(env('INSTAGRAM_ACCESS_TOKEN'));
      const { data } = await request(`${api()}/${published.id}?fields=permalink&access_token=${token}`);
      return { url: data.permalink };
    } catch {
      return { url: null };
    }
  },
};
