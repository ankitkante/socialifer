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
    // Reels run 3 seconds to 15 minutes; videos inside a carousel are capped at 60 seconds.
    videoMinSeconds: 3,
    videoMaxSeconds: 15 * 60,
    carouselVideoMaxSeconds: 60,
    imageTypes: ['image/jpeg'],
    imageTypesLabel: 'Instagram only accepts JPEG images',
    requiresMedia: true,
    needsPublicUrl: true,
  },
  envVars: ENV,
  // Option fields that hold an uploaded image; the server swaps the id for the file before post().
  mediaOptions: ['cover'],
  isConfigured: () => hasEnv(...ENV),
  // options: { postAs: 'feed' | 'story', shareToFeed, coverSeconds, cover, altText, aiGenerated,
  //            audioName, trial: 'off' | 'manual' | 'auto' }
  async post(text, media, options = {}) {
    // Instagram downloads each file from a public URL. A single video is posted as a Reel.
    const o = options;
    const story = o.postAs === 'story';
    // Fields shared by single posts, Reels and the carousel parent (not carousel children or Stories).
    const common = {
      ...(text && { caption: text }),
      ...(o.aiGenerated && { is_ai_generated: 'true' }),
    };
    const altText = o.altText?.trim() ? { alt_text: o.altText.trim() } : {};

    let containerId;
    if (story) {
      const m = media[0];
      containerId = await createContainer({
        media_type: 'STORIES',
        ...(isVideo(m) ? { video_url: m.url } : { image_url: m.url }),
      });
    } else if (media.length === 1 && isVideo(media[0])) {
      containerId = await createContainer({
        media_type: 'REELS',
        video_url: media[0].url,
        ...common,
        share_to_feed: String(o.shareToFeed !== false),
        // An uploaded cover wins over a frame from the video.
        ...(o.cover ? { cover_url: o.cover.url } : o.coverSeconds ? { thumb_offset: String(Math.round(Number(o.coverSeconds) * 1000)) } : {}),
        ...(o.audioName?.trim() && { audio_name: o.audioName.trim() }),
        ...(o.trial && o.trial !== 'off' && {
          trial_params: JSON.stringify({ graduation_strategy: o.trial === 'auto' ? 'SS_PERFORMANCE' : 'MANUAL' }),
        }),
      });
    } else if (media.length === 1) {
      containerId = await createContainer({
        image_url: media[0].url,
        ...common,
        ...altText,
      });
    } else {
      const children = [];
      for (const m of media) {
        children.push(await createContainer(isVideo(m)
          ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: 'true' }
          : { image_url: m.url, is_carousel_item: 'true', ...altText }));
      }
      for (const child of children) await waitUntilReady(child);
      containerId = await createContainer({ media_type: 'CAROUSEL', children: children.join(','), ...common });
    }
    await waitUntilReady(containerId);

    const token = env('INSTAGRAM_ACCESS_TOKEN');
    const { data: published } = await request(`${api()}/${env('INSTAGRAM_USER_ID') || 'me'}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    });

    try {
      const { data } = await request(`${api()}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`);
      return { url: data.permalink };
    } catch {
      return { url: null };
    }
  },
};
