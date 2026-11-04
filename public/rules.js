// Shared by the browser and the server so both agree on what each platform accepts.
const segmenter = new Intl.Segmenter();
const URL_RE = /https?:\/\/\S+/g;
const MB = 1_000_000;

// Platforms that count every link as a fixed 23 characters.
const FIXED_URL_LENGTH = new Set(['x', 'mastodon']);

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

// For platforms that need a title (YouTube): the typed title, else the post's first non-empty line.
export function resolveTitle(text, title) {
  return title?.trim() || text.split('\n').map((line) => line.trim()).find(Boolean) || '';
}

// platform: { id, limit, media: rules, title?, textForbids?, publicUrlReady }, media: [{ name, type, size }],
// options: per-platform extras such as { title }.
// Returns a list of human-readable reasons the post can't go to this platform.
export function problemsFor(platform, text, media, options = {}) {
  const problems = [];
  const r = platform.media;
  const length = countFor(platform.id, text);
  if (length > platform.limit) problems.push(`Text is too long (${length.toLocaleString()} / ${platform.limit.toLocaleString()})`);

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
  if (r.needsPublicUrl && media.length && !platform.publicUrlReady) problems.push('Media needs PUBLIC_BASE_URL (see README)');

  for (const m of images) {
    if (r.imageTypes && !r.imageTypes.includes(m.type)) problems.push(`${m.name}: ${r.imageTypesLabel}`);
    if (r.imageMB && m.size > r.imageMB * MB) problems.push(`${m.name} is over ${r.imageMB} MB`);
  }
  for (const m of videos) {
    if (r.videoMB && m.size > r.videoMB * MB) problems.push(`${m.name} is over ${r.videoMB} MB`);
  }
  return problems;
}
