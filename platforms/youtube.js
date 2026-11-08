import { request, poll, env, hasEnv, ApiError } from './http.js';
import { step } from '../log.js';
import { resolveTitle, listOf } from '../public/rules.js';

const ENV = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'];
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const THUMBNAIL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
const VIDEOS = 'https://www.googleapis.com/youtube/v3/videos';
// Long videos can take a while to process; after this the thumbnail is left for the user to set in Studio.
const PROCESSING_TIMEOUT = 30 * 60_000;
const PRIVACY = new Set(['public', 'unlisted', 'private']);
// Long videos on a slow connection can take a while to send.
const VIDEO_UPLOAD_TIMEOUT = 60 * 60_000;

// Uploads need OAuth; the refresh token comes from `npm run youtube-auth`.
async function accessToken() {
  try {
    const { data } = await request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env('YOUTUBE_CLIENT_ID'),
        client_secret: env('YOUTUBE_CLIENT_SECRET'),
        refresh_token: env('YOUTUBE_REFRESH_TOKEN'),
        grant_type: 'refresh_token',
      }),
      retries: 2,
    });
    return data.access_token;
  } catch (err) {
    // invalid_grant: the refresh token expired or was revoked (or the Google app is still in Testing mode).
    if (err.details?.data?.error === 'invalid_grant') {
      throw new ApiError('Your YouTube sign-in has expired or was revoked. Run `npm run youtube-auth`, then restart the server.', err.details);
    }
    throw err;
  }
}

// A thumbnail set while the video is still processing is accepted (HTTP 200) but then dropped,
// so the custom thumbnail waits until processing has finished (seen live on 2026-11-09).
async function waitForProcessing(id, auth) {
  await poll(async () => {
    const { data } = await request(`${VIDEOS}?part=processingDetails&id=${encodeURIComponent(id)}`, { headers: auth, retries: 2 });
    const status = data.items?.[0]?.processingDetails?.processingStatus;
    if (status === 'succeeded') return true;
    if (status === 'failed' || status === 'terminated') throw new ApiError(`YouTube couldn't process the video (${status})`);
    return undefined;
  }, { every: 5000, timeout: PROCESSING_TIMEOUT, what: 'YouTube to process the video' });
}

function thumbnailWarning(err, setting) {
  // Refresh tokens from before the readonly scope was added can upload but can't check processing.
  if (err.details?.data?.error?.errors?.[0]?.reason === 'insufficientPermissions') {
    return "The video was posted, but the custom thumbnail wasn't set: the YouTube sign-in can't check when the video has finished processing. Run `npm run youtube-auth`, restart the server, and set this video's thumbnail in YouTube Studio.";
  }
  return `The video was posted, but the custom thumbnail wasn't set (${err.message}). ${setting ? 'Custom thumbnails need a phone-verified channel.' : 'You can set it in YouTube Studio.'}`;
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
  // Option fields that hold an uploaded image; the server swaps the id for the file before post().
  mediaOptions: ['thumbnail'],
  isConfigured: () => hasEnv(...ENV),
  // options: { title, privacy, publishAt, category, tags, thumbnail, madeForKids, synthetic,
  //            language, audioLanguage, recordingDate }
  // There's no separate Shorts API: YouTube makes vertical or square videos of 3 minutes or less into Shorts.
  async post(text, media, options = {}) {
    const video = media[0];
    const o = options;
    step('Signing in to YouTube', { quiet: true });
    const auth = { Authorization: `Bearer ${await accessToken()}` };

    // A scheduled video must be private until publishAt; YouTube then makes it public.
    const scheduled = o.publishAt && Number.isFinite(Date.parse(o.publishAt));
    const tags = listOf(o.tags);
    const snippet = {
      title: resolveTitle(text, o.title),
      description: text,
      categoryId: o.category || env('YOUTUBE_CATEGORY_ID') || '22',
      ...(tags.length && { tags }),
      ...(o.language && { defaultLanguage: o.language }),
      ...(o.audioLanguage && { defaultAudioLanguage: o.audioLanguage }),
    };
    const status = {
      privacyStatus: scheduled ? 'private' : PRIVACY.has(o.privacy) ? o.privacy : 'private',
      ...(scheduled && { publishAt: new Date(o.publishAt).toISOString() }),
      selfDeclaredMadeForKids: Boolean(o.madeForKids),
      containsSyntheticMedia: Boolean(o.synthetic),
    };
    const recordingDetails = o.recordingDate ? { recordingDate: new Date(o.recordingDate).toISOString() } : null;
    const parts = ['snippet', 'status', ...(recordingDetails ? ['recordingDetails'] : [])].join(',');

    // Resumable upload: send the metadata first, then the file to the session URL it returns.
    step(`Uploading ${video.name} (${Math.round(video.size / 1_000_000)} MB)`);
    const { headers } = await request(`${UPLOAD}?uploadType=resumable&part=${parts}`, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': video.type,
        'X-Upload-Content-Length': String(video.size),
      },
      body: JSON.stringify({ snippet, status, ...(recordingDetails && { recordingDetails }) }),
    });

    const { data } = await request(headers.get('location'), {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': video.type },
      body: await video.blob(),
      timeout: VIDEO_UPLOAD_TIMEOUT,
    });

    // The video is already up; a thumbnail failure (e.g. the channel isn't allowed custom
    // thumbnails yet) is reported as a warning rather than failing the post.
    const warnings = [];
    if (o.thumbnail) {
      let setting = false;
      try {
        step('Waiting for YouTube to process the video');
        await waitForProcessing(data.id, auth);
        step('Setting the custom thumbnail');
        setting = true;
        await request(`${THUMBNAIL}?videoId=${encodeURIComponent(data.id)}`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': o.thumbnail.type },
          body: await o.thumbnail.blob(),
        });
      } catch (err) {
        warnings.push(thumbnailWarning(err, setting));
      }
    }
    return { url: `https://www.youtube.com/watch?v=${data.id}`, warnings };
  },
};
