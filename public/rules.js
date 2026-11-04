// Shared by the browser and the server so both agree on what each platform accepts.
const segmenter = new Intl.Segmenter();
const URL_RE = /https?:\/\/\S+/g;
const MB = 1_000_000;

// Platforms that count every link as a fixed 23 characters.
const FIXED_URL_LENGTH = new Set(['x', 'mastodon']);

// Compression targets: AAC audio at this bitrate, and below this video bitrate the result looks too poor to post.
const AUDIO_KBPS = 128;
const MIN_VIDEO_KBPS = 400;

function graphemes(text) {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

export function countFor(platformId, text) {
  if (FIXED_URL_LENGTH.has(platformId)) return graphemes(text.replace(URL_RE, 'x'.repeat(23)));
  return graphemes(text);
}

export const isVideo = (m) => m.type.startsWith('video/');

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatDuration(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// The text a platform receives: its own override if the user wrote one, otherwise the main post.
export function effectiveText(text, options = {}) {
  return typeof options.text === 'string' && options.text.trim() ? options.text.trim() : text;
}

// For platforms that need a title (YouTube): the typed title, else the post's first non-empty line.
export function resolveTitle(text, title) {
  return title?.trim() || text.split('\n').map((line) => line.trim()).find(Boolean) || '';
}

// Video bitrate (kbps) that brings a video of this length under maxBytes, or null when that
// would look too poor. 8% headroom covers container overhead and bitrate overshoot.
export function compressionBitrate(maxBytes, durationSeconds) {
  const videoKbps = Math.floor((maxBytes * 8 * 0.92) / 1000 / durationSeconds - AUDIO_KBPS);
  return videoKbps >= MIN_VIDEO_KBPS ? videoKbps : null;
}

// A video over the platform's size limit that the server will compress instead of rejecting.
function compressible(platform, m) {
  const r = platform.media;
  return platform.canCompress && r.videoMB && m.size > r.videoMB * MB
    && (!m.duration || compressionBitrate(r.videoMB * MB, m.duration) !== null);
}

// Changes the server will make so the post fits. Shown as notes, not problems.
export function adjustmentsFor(platform, media) {
  return media.filter((m) => isVideo(m) && compressible(platform, m))
    .map((m) => `${m.name} will be compressed to fit ${platform.media.videoMB} MB`);
}

// platform: { id, limit, media: rules, title?, textForbids?, publicUrlReady, canCompress },
// media: [{ name, type, size, duration? }], options: per-platform extras such as { text, title }.
// Returns a list of human-readable reasons the post can't go to this platform.
export function problemsFor(platform, text, media, options = {}) {
  const problems = [];
  const r = platform.media;
  text = effectiveText(text, options);
  const length = countFor(platform.id, text);
  if (length > platform.limit) problems.push(`Text is too long (${length.toLocaleString()} / ${platform.limit.toLocaleString()})`);
  if (!text.trim() && media.length === 0) problems.push('Add some text, an image or a video');

  const title = platform.title ? resolveTitle(text, options.title) : '';
  if (platform.title) {
    const titleLength = graphemes(title);
    if (!title) problems.push('Needs a title');
    else if (titleLength > platform.title.max) problems.push(`Title is too long (${titleLength} / ${platform.title.max})`);
  }
  const forbidden = [...(platform.textForbids || '')];
  if (forbidden.some((ch) => text.includes(ch) || title.includes(ch))) problems.push(`Can't contain ${forbidden.join(' or ')}`);

  const videos = media.filter(isVideo);
  const images = media.filter((m) => !isVideo(m));
  if (r.requiresMedia && media.length === 0) problems.push(r.maxImages ? 'Needs an image or video' : 'Needs a video');
  if (images.length > r.maxImages) problems.push(r.maxImages ? `Up to ${plural(r.maxImages, 'image')}` : 'Images not supported');
  if (videos.length > r.maxVideos) problems.push(r.maxVideos ? `Up to ${plural(r.maxVideos, 'video')}` : 'Videos not supported');
  if (!r.mix && images.length && videos.length) problems.push("Can't mix images and videos");
  if (media.length > r.maxItems) problems.push(`Up to ${r.maxItems} files per post`);
  if (r.needsPublicUrl && media.length && !platform.publicUrlReady) problems.push('Media needs TUNNEL_URL (see README)');

  for (const m of images) {
    if (r.imageTypes && !r.imageTypes.includes(m.type)) problems.push(`${m.name}: ${r.imageTypesLabel}`);
    if (r.imageMB && m.size > r.imageMB * MB) problems.push(`${m.name} is over ${r.imageMB} MB`);
  }

  // Carousels can have a stricter length limit than single videos (Instagram).
  const maxSeconds = media.length > 1 && r.carouselVideoMaxSeconds ? r.carouselVideoMaxSeconds : r.videoMaxSeconds;
  for (const m of videos) {
    if (r.videoMB && m.size > r.videoMB * MB && !compressible(platform, m)) {
      problems.push(platform.canCompress && m.duration
        ? `${m.name} is too long to compress under ${r.videoMB} MB`
        : `${m.name} is over ${r.videoMB} MB`);
    }
    // Length is only known once the browser (or ffprobe on the server) has read the file.
    if (!m.duration) continue;
    if (r.videoMinSeconds && m.duration < r.videoMinSeconds) {
      problems.push(`${m.name} is shorter than ${r.videoMinSeconds} seconds`);
    }
    if (maxSeconds && m.duration > maxSeconds) {
      const where = media.length > 1 && r.carouselVideoMaxSeconds ? ' in a multi-file post' : '';
      problems.push(`${m.name} is ${formatDuration(m.duration)} long; the limit${where} is ${formatDuration(maxSeconds)}${r.videoMaxSecondsHint ? `. ${r.videoMaxSecondsHint}` : ''}`);
    }
  }
  return problems;
}
