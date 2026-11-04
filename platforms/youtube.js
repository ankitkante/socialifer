import { request, env, hasEnv } from './http.js';
import { resolveTitle } from '../public/rules.js';

const ENV = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'];
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const PRIVACY = new Set(['public', 'unlisted', 'private']);
// Long videos on a slow connection can take a while to send.
const VIDEO_UPLOAD_TIMEOUT = 60 * 60_000;

// Uploads need OAuth; the refresh token comes from `npm run youtube-auth`.
async function accessToken() {
  const { data } = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env('YOUTUBE_CLIENT_ID'),
      client_secret: env('YOUTUBE_CLIENT_SECRET'),
      refresh_token: env('YOUTUBE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  return data.access_token;
}

export default {
  id: 'youtube',
  name: 'YouTube',
  // The post text becomes the description.
  limit: 5000,
  title: { max: 100 },
  textForbids: '<>',
  media: {
    maxImages: 0,
    maxVideos: 1,
    maxItems: 1,
    mix: false,
    imageMB: null,
    videoMB: null,
    requiresMedia: true,
    // Unverified channels can upload up to 15 minutes; verified ones up to 12 hours.
    videoMaxSeconds: (Number(process.env.YOUTUBE_MAX_MINUTES) || 15) * 60,
    videoMaxSecondsHint: 'Verify your channel with a phone number for longer uploads, then set YOUTUBE_MAX_MINUTES in .env',
  },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  // options: { title, privacy: 'public' | 'unlisted' | 'private', madeForKids }
  // There's no separate Shorts API: YouTube makes vertical or square videos of 3 minutes or less into Shorts.
  async post(text, media, options = {}) {
    const video = media[0];
    const auth = { Authorization: `Bearer ${await accessToken()}` };

    // Resumable upload: send the metadata first, then the file to the session URL it returns.
    const { headers } = await request(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': video.type,
        'X-Upload-Content-Length': String(video.size),
      },
      body: JSON.stringify({
        snippet: {
          title: resolveTitle(text, options.title),
          description: text,
          categoryId: env('YOUTUBE_CATEGORY_ID') || '22',
        },
        status: {
          privacyStatus: PRIVACY.has(options.privacy) ? options.privacy : 'private',
          selfDeclaredMadeForKids: Boolean(options.madeForKids),
        },
      }),
    });

    const { data } = await request(headers.get('location'), {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': video.type },
      body: await video.blob(),
      timeout: VIDEO_UPLOAD_TIMEOUT,
    });
    return { url: `https://www.youtube.com/watch?v=${data.id}` };
  },
};
