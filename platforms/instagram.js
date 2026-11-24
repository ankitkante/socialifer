import { request, poll, env, hasEnv, ApiError } from './http.js';
import { isVideo } from '../public/rules.js';
import { step } from '../log.js';

// Meta downloads each file from TUNNEL_URL, so a stopped tunnel (or a stale address) shows up as a
// download or URL error.
const TUNNEL_HINT = "If Instagram couldn't download the file, check that the cloudflared tunnel is still running and TUNNEL_URL matches its address.";

const ENV = ['INSTAGRAM_ACCESS_TOKEN'];

function api() {
  // graph.instagram.com is for "Instagram API with Instagram Login" tokens;
  // set INSTAGRAM_GRAPH_HOST=https://graph.facebook.com for Facebook Login tokens.
  const host = (env('INSTAGRAM_GRAPH_HOST') || 'https://graph.instagram.com').replace(/\/+$/, '');
  return `${host}/${env('INSTAGRAM_API_VERSION') || 'v23.0'}`;
}

async function createContainer(params) {
  try {
    const { data } = await request(`${api()}/${env('INSTAGRAM_USER_ID') || 'me'}/media`, {
      method: 'POST',
      body: new URLSearchParams({ ...params, access_token: env('INSTAGRAM_ACCESS_TOKEN') }),
    });
    return data.id;
  } catch (err) {
    if (/download|fetch|uri|url/i.test(err.message)) throw new ApiError(`${err.message}. ${TUNNEL_HINT}`, err.details);
    throw err;
  }
}

function waitUntilReady(containerId) {
  const token = encodeURIComponent(env('INSTAGRAM_ACCESS_TOKEN'));
  return poll(async () => {
    const { data } = await request(`${api()}/${containerId}?fields=status_code,status&access_token=${token}`, { retries: 2 });
    if (data.status_code === 'FINISHED') return true;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new ApiError(`Instagram could not process the media: ${data.status || data.status_code}. ${TUNNEL_HINT}`);
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
    // Reels run up to 15 minutes; videos inside a carousel are capped at 60 seconds. Meta's docs
    // also say 3 seconds minimum, but a 2.2-second Reel posted fine on 2026-11-18, so it isn't checked.
    videoMaxSeconds: 15 * 60,
    carouselVideoMaxSeconds: 60,
    imageTypes: ['image/jpeg'],
    imageTypesLabel: 'Instagram only accepts JPEG images',
    requiresMedia: true,
    needsPublicUrl: true,
    // A text-only post becomes slides of its text (public/slides.js), drawn by the server before posting.
    textSlides: true,
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

    step(story ? 'Creating the Story' : media.length > 1 ? `Creating the carousel (${media.length} files)` : isVideo(media[0]) ? 'Creating the Reel' : 'Creating the post');
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
        ...(media[0].altText ? { alt_text: media[0].altText } : altText),
      });
    } else {
      const children = [];
      for (const m of media) {
        children.push(await createContainer(isVideo(m)
          ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: 'true' }
          : { image_url: m.url, is_carousel_item: 'true', ...(m.altText ? { alt_text: m.altText } : altText) }));
      }
      step('Waiting for Instagram to download and process the files');
      for (const child of children) await waitUntilReady(child);
      containerId = await createContainer({ media_type: 'CAROUSEL', children: children.join(','), ...common });
    }
    step('Waiting for Instagram to download and process the media');
    await waitUntilReady(containerId);

    step('Publishing');
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
