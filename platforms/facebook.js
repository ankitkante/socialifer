import { request, env, hasEnv, UPLOAD_TIMEOUT } from './http.js';
import { isVideo } from '../public/rules.js';

const ENV = ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN'];

const version = () => env('FACEBOOK_GRAPH_VERSION') || 'v23.0';

function form(fields, file) {
  const body = new FormData();
  for (const [k, v] of Object.entries({ ...fields, access_token: env('FACEBOOK_PAGE_ACCESS_TOKEN') })) body.append(k, v);
  if (file) body.append('source', file.blob, file.name);
  return body;
}

export default {
  id: 'facebook',
  name: 'Facebook',
  limit: 63206,
  // The simple (non-resumable) video upload used here is capped at about 1 GB and 20 minutes.
  media: { maxImages: 10, maxVideos: 1, maxItems: 10, mix: false, imageMB: 10, videoMB: 1000, videoMaxSeconds: 20 * 60 },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    const page = env('FACEBOOK_PAGE_ID');

    if (media.length && isVideo(media[0])) {
      const m = media[0];
      const { data } = await request(`https://graph-video.facebook.com/${version()}/${page}/videos`, {
        method: 'POST',
        body: form({ description: text }, { blob: await m.blob(), name: m.name }),
        timeout: UPLOAD_TIMEOUT,
      });
      return { url: `https://www.facebook.com/${page}/videos/${data.id}` };
    }

    // Photos are uploaded unpublished, then attached together to a single feed post.
    const attached = {};
    for (const [i, m] of media.entries()) {
      const { data } = await request(`https://graph.facebook.com/${version()}/${page}/photos`, {
        method: 'POST',
        body: form({ published: 'false' }, { blob: await m.blob(), name: m.name }),
        timeout: UPLOAD_TIMEOUT,
      });
      attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: data.id });
    }
    const { data } = await request(`https://graph.facebook.com/${version()}/${page}/feed`, {
      method: 'POST',
      body: new URLSearchParams({ message: text, ...attached, access_token: env('FACEBOOK_PAGE_ACCESS_TOKEN') }),
    });
    return { url: `https://www.facebook.com/${data.id}` };
  },
};
