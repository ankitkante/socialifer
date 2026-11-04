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

// Platforms whose title comes from the post's first line when none is typed; the rest becomes the body.
const TITLE_FROM_FIRST_LINE = new Set(['youtube']);

function afterFirstLine(text) {
  const lines = text.split('\n');
  const first = lines.findIndex((line) => line.trim());
  return first < 0 ? '' : lines.slice(first + 1).join('\n').trim();
}

// The text a platform receives: its own text if the user edited that platform's box (even to empty),
// otherwise the main post. On YouTube, with no typed title, the first line is the title, so the
// description is everything after it.
export function effectiveText(text, options = {}, platformId) {
  if (typeof options.text === 'string') return options.text.trim();
  if (TITLE_FROM_FIRST_LINE.has(platformId) && !options.title?.trim()) return afterFirstLine(text);
  return text;
}

// For platforms that need a title (YouTube): the typed title, else the main post's first non-empty line.
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

// ---- Threads: long posts split into numbered replies (X) ----

const THREAD_MAX_POSTS = 25;
// Each post ends with its number on a new line, e.g. "\n(1/2)". A post cut mid-sentence also ends with
// "..." so readers know more follows; one that ends on a full stop doesn't need it.
const NUMBER_ROOM = 8; // "\n(25/25)"
const ELLIPSIS = '...';
// A sentence end in roughly the last 40% of a post is "close": break there instead of mid-sentence.
const SENTENCE_BREAK_FROM = 0.6;
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

function sliceGraphemes(text, n) {
  let out = '';
  let i = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (i++ >= n) break;
    out += segment;
  }
  return out;
}

// Splits text into posts that fit `limit` once their ending is added: "\n(i/n)", plus "..." when a post
// is cut mid-sentence. Prefers to break at the end of a sentence when one is close to the limit;
// otherwise fills the post to the limit at a word boundary.
export function splitThread(platformId, text, limit) {
  if (countFor(platformId, text) <= limit) return [text];
  const roomWhole = limit - NUMBER_ROOM; // a post that ends on a sentence
  const roomCut = roomWhole - ELLIPSIS.length; // a post cut mid-sentence
  const len = (s) => countFor(platformId, s.trim());
  const tokens = text.split(/(\s+)/).filter((t) => t !== '');
  const parts = [];

  let i = 0;
  while (i < tokens.length) {
    while (i < tokens.length && !/\S/.test(tokens[i])) i++; // no leading whitespace
    if (i >= tokens.length) break;

    // A single word longer than a whole post gets cut.
    if (len(tokens[i]) > roomCut) {
      const head = sliceGraphemes(tokens[i], roomCut);
      parts.push({ text: head, cut: true });
      tokens[i] = tokens[i].slice(head.length);
      continue;
    }

    // Grow the post a word at a time, remembering the last sentence end and the last point that
    // still leaves room for "...".
    let current = '';
    let sentence = null;
    let cutAt = null;
    let j = i;
    for (; j < tokens.length; j++) {
      const next = current + tokens[j];
      if (len(next) > roomWhole) break;
      current = next;
      if (!/\S/.test(tokens[j])) continue;
      if (len(current) <= roomCut) cutAt = { end: j, text: current };
      if (SENTENCE_END.test(tokens[j])) sentence = { end: j, text: current };
    }

    if (j >= tokens.length) {
      parts.push({ text: current.trim(), cut: false }); // the rest fits
      break;
    }
    if (sentence && len(sentence.text) >= roomWhole * SENTENCE_BREAK_FROM) {
      parts.push({ text: sentence.text.trim(), cut: false });
      i = sentence.end + 1;
    } else {
      parts.push({ text: cutAt.text.trim(), cut: true });
      i = cutAt.end + 1;
    }
  }

  return parts.map((part, k) => `${part.text}${part.cut ? ELLIPSIS : ''}\n(${k + 1}/${parts.length})`);
}

function threadFor(platform, text, options) {
  return platform.threads && options.thread ? splitThread(platform.id, text, platform.limit) : null;
}

// ---- Per-platform fields ----

// "a, b\nc" -> ['a', 'b', 'c']; used for YouTube tags.
export const listOf = (value) => String(value ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

// YouTube counts tag length with the commas between tags, plus quotes around tags that contain spaces.
function youtubeTagsLength(tags) {
  return tags.reduce((n, t) => n + graphemes(t) + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

// Image fields (thumbnail, cover) arrive as { type, size } metadata in both the browser and the server.
const FIELD_CHECKS = {
  youtube(o) {
    const problems = [];
    const tags = listOf(o.tags);
    if (youtubeTagsLength(tags) > 500) problems.push(`Tags are too long (${youtubeTagsLength(tags)} / 500 characters)`);
    if (tags.some((t) => /[<>]/.test(t))) problems.push("Tags can't contain < or >");
    if (o.publishAt) {
      const at = Date.parse(o.publishAt);
      if (!Number.isFinite(at)) problems.push("The schedule time isn't valid");
      else if (at <= Date.now()) problems.push('The schedule time must be in the future');
    }
    if (o.thumbnail) {
      if (!['image/jpeg', 'image/png'].includes(o.thumbnail.type)) problems.push('The thumbnail must be a JPEG or PNG');
      if (o.thumbnail.size > 2 * MB) problems.push('The thumbnail must be 2 MB or smaller');
    }
    return problems;
  },

  instagram(o, media) {
    const problems = [];
    const story = o.postAs === 'story';
    const reel = media.length === 1 && isVideo(media[0]) && !story;
    if (story && media.length !== 1) problems.push('A Story takes exactly one image or video');
    if (o.cover && !reel) problems.push('A cover image only applies to a single video posted as a Reel');
    if (o.cover && o.cover.type !== 'image/jpeg') problems.push('The cover image must be a JPEG');
    if (o.coverSeconds !== undefined && o.coverSeconds !== '') {
      const seconds = Number(o.coverSeconds);
      if (!(seconds >= 0)) problems.push("The cover frame time isn't valid");
      else if (media[0]?.duration && seconds > media[0].duration) problems.push('The cover frame time is past the end of the video');
    }
    if (o.trial && o.trial !== 'off' && !reel) problems.push('Trial reels need a single video posted as a Reel');
    if (o.altText && graphemes(o.altText) > 1000) problems.push('Alt text is too long (max 1,000 characters)');
    return problems;
  },

  x(o) {
    const problems = [];
    if (o.altText && graphemes(o.altText) > 1000) problems.push('Alt text is too long (max 1,000 characters)');
    return problems;
  },
};

// Changes the server will make so the post fits, or effects of the chosen fields. Shown as notes, not problems.
export function adjustmentsFor(platform, media, options = {}, text = '') {
  const notes = media.filter((m) => isVideo(m) && compressible(platform, m))
    .map((m) => `${m.name} will be compressed to fit ${platform.media.videoMB} MB`);
  const thread = threadFor(platform, effectiveText(text, options, platform.id), options);
  if (thread && thread.length > 1) notes.push(`Will be posted as a thread of ${thread.length} posts`);
  if (platform.id === 'youtube' && options.publishAt && Number.isFinite(Date.parse(options.publishAt))) {
    notes.push(`Stays private until ${new Date(options.publishAt).toLocaleString()}, then goes public`);
  }
  if (platform.id === 'instagram' && options.postAs === 'story' && effectiveText(text, options, platform.id).trim()) {
    notes.push("Stories don't show captions, so the text won't appear");
  }
  return notes;
}

// platform: { id, limit, media: rules, title?, textForbids?, threads?, publicUrlReady, canCompress },
// media: [{ name, type, size, duration? }], options: per-platform fields such as { text, title, tags }.
// Returns a list of human-readable reasons the post can't go to this platform.
export function problemsFor(platform, text, media, options = {}) {
  const problems = [];
  const r = platform.media;
  const mainText = text;
  text = effectiveText(text, options, platform.id);
  const thread = threadFor(platform, text, options);
  const length = countFor(platform.id, text);
  if (thread) {
    if (thread.length > THREAD_MAX_POSTS) problems.push(`Too long even for a thread (${thread.length} posts; the limit is ${THREAD_MAX_POSTS})`);
  } else if (length > platform.limit && platform.threads) {
    problems.push(`Too long for one post (${length.toLocaleString()} / ${platform.limit.toLocaleString()}). Turn on "Split long posts into a numbered thread", shorten it, or untick ${platform.name ?? 'it'}`);
  } else if (length > platform.limit) {
    problems.push(`Text is too long (${length.toLocaleString()} / ${platform.limit.toLocaleString()})`);
  }
  if (!text.trim() && media.length === 0) problems.push('Add some text, an image or a video');
  problems.push(...(FIELD_CHECKS[platform.id]?.(options, media) ?? []));

  // The title defaults to the main post's first line, even when the platform's own text was edited.
  const title = platform.title ? resolveTitle(mainText, options.title) : '';
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
