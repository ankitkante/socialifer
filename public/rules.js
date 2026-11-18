// Shared by the browser and the server so both agree on what each platform accepts.
// React Native's engine (Hermes) has no Intl.Segmenter, so the phone app gets a close count instead:
// code points, not counting combining marks (Hindi vowel signs) or emoji joiners. The server counts exactly.
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
export const exactCounting = Boolean(segmenter);
// Built from a string, so an engine without these Unicode properties falls back to plain code points
// instead of failing to load the file.
const JOINED = (() => {
  try {
    // Devanagari consonants joined by a virama (स्ते) are one character since Unicode 15.1.
    return new RegExp('\\u094D\\u200D?[\\u0915-\\u0939\\u0958-\\u095F\\u0978-\\u097F]|\\p{M}|\\p{Emoji_Modifier}|\\u200D\\p{Extended_Pictographic}|\\uFE0F', 'gu');
  } catch {
    return null;
  }
})();
const URL_RE = /https?:\/\/\S+/g;
const MB = 1_000_000;

// Platforms that count every link as a fixed 23 characters.
const FIXED_URL_LENGTH = new Set(['x', 'mastodon']);

// Compression targets: AAC audio at this bitrate, and below this video bitrate the result looks too poor to post.
const AUDIO_KBPS = 128;
const MIN_VIDEO_KBPS = 400;

function graphemes(text) {
  if (!segmenter) return [...(JOINED ? text.replace(JOINED, '') : text)].length;
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
// Each post ends with its number after an empty line, e.g. "\n\n(1/2)". A post cut mid-sentence also ends with
// "..." so readers know more follows; one that ends on a full stop doesn't need it.
const NUMBER_ROOM = 9; // "\n\n(25/25)"
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

// Splits text into posts that fit `limit` once their ending is added: "\n\n(i/n)", plus "..." when a post
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

  return parts.map((part, k) => `${part.text}${part.cut ? ELLIPSIS : ''}\n\n(${k + 1}/${parts.length})`);
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
      if (o.thumbnail.size > 2 * MB) {
        problems.push(`The thumbnail is ${(o.thumbnail.size / MB).toFixed(1)} MB; YouTube takes 2 MB at most. Save a smaller copy (1280×720 JPEG is plenty) and choose that.`);
      }
    }
    if (o.audioLanguage && !isSubtitleLanguage(o.audioLanguage)) problems.push('Choose Hindi, English or Not set as the Audio language');
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

// ---- Scheduling ----

// Posts keep a pace, so followers (and the platforms) aren't flooded, and only go out in the day's posting hours
// (laptop time). Image and video posts are a few hours apart whatever their kind, with a few of each kind a day.
// Text posts keep their own, shorter gap. A text post and an image or video post only keep apart when they share
// a platform (an X text post next to an X video), since followers see each platform separately.
export const SCHEDULE = { startHour: 9, endHour: 23, gapHours: 4, textGapHours: 1, mixedGapHours: 1, perDay: { image: 2, video: 2 } };
const HOUR = 60 * 60 * 1000;
const isMedia = (kind) => kind === 'image' || kind === 'video';

// How far apart a post (kind, platforms) must be from another post p: { at, kind, platforms }.
function gapFrom(kind, platforms, p) {
  if (isMedia(kind) && isMedia(p.kind)) return SCHEDULE.gapHours * HOUR;
  if (!isMedia(kind) && !isMedia(p.kind)) return SCHEDULE.textGapHours * HOUR;
  // Posts saved before platforms were known are treated as sharing one, to be safe.
  const shared = !p.platforms || platforms.some((id) => p.platforms.includes(id));
  return shared ? SCHEDULE.mixedGapHours * HOUR : 0;
}

const closeTo = (taken, kind, platforms, at) => taken
  .map((p) => ({ ...p, gap: gapFrom(kind, platforms, p) }))
  .filter((p) => p.gap > 0 && Math.abs(p.at - at) < p.gap);

// 'text', 'image' or 'video'. A post can't mix images and videos (see problemsFor), so the first file decides.
export function postKind(media) {
  if (!media.length) return 'text';
  return media.some(isVideo) ? 'video' : 'image';
}

const atHour = (ms, hour) => new Date(ms).setHours(hour, 0, 0, 0);
const dayStart = (ms) => atHour(ms, SCHEDULE.startHour);
const dayEnd = (ms) => atHour(ms, SCHEDULE.endHour);
const nextDayStart = (ms) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + 1);
  return dayStart(d.getTime());
};
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const mediaPosts = (taken) => taken.filter((p) => p.kind === 'image' || p.kind === 'video');

// The first time on or after `from` that a post of this kind, going to these platforms, may go out.
// taken: [{ at, kind, platforms }], the other posts waiting or already posted (leave out the post being moved).
export function nextFreeTime(taken, kind, from = Date.now(), platforms = []) {
  let at = from;
  // Each pass moves `at` later; a year of passes is far more than any real schedule needs.
  for (let i = 0; i < 1000; i++) {
    if (at < dayStart(at)) at = dayStart(at);
    if (at > dayEnd(at)) { at = nextDayStart(at); continue; }
    if (isMedia(kind) && mediaPosts(taken).filter((p) => p.kind === kind && sameDay(p.at, at)).length >= SCHEDULE.perDay[kind]) {
      at = nextDayStart(at);
      continue;
    }
    const close = closeTo(taken, kind, platforms, at);
    if (!close.length) return at;
    at = Math.max(...close.map((p) => p.at + p.gap));
  }
  return null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Written out by hand: the phone's engine and Node format dates differently.
export function formatTime(ms) {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

export function formatDay(ms) {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function formatGap(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return plural(minutes, 'minute');
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 30) return `${h}½ hours`;
  return m ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour');
}

const KIND_NAMES = { text: 'text post', image: 'image post', video: 'video' };

// Why two kinds of post are kept apart, for the warning.
function gapRule(kind, other) {
  if (isMedia(kind) && isMedia(other)) return `Image and video posts are kept ${plural(SCHEDULE.gapHours, 'hour')} apart.`;
  if (!isMedia(kind) && !isMedia(other)) return `Text posts are kept ${plural(SCHEDULE.textGapHours, 'hour')} apart.`;
  return `Text and image or video posts on the same platform are kept ${plural(SCHEDULE.mixedGapHours, 'hour')} apart.`;
}

// What's wrong with posting at `at`: `past` blocks it; `warnings` don't (the user may post close together
// on purpose), and `nextFree` offers the next time without them. taken and platforms as for nextFreeTime.
export function slotProblems(taken, kind, at, now = Date.now(), platforms = []) {
  if (!Number.isFinite(at)) return { past: false, invalid: true, warnings: [], nextFree: null };
  if (at <= now) return { past: true, invalid: false, warnings: [], nextFree: null };
  const warnings = [];
  if (at < dayStart(at) || at > dayEnd(at)) {
    warnings.push(`${formatTime(at)} is outside posting hours (${formatTime(atHour(at, SCHEDULE.startHour))} to ${formatTime(atHour(at, SCHEDULE.endHour))}).`);
  }
  if (isMedia(kind)) {
    const sameKind = mediaPosts(taken).filter((p) => p.kind === kind && sameDay(p.at, at)).length;
    if (sameKind >= SCHEDULE.perDay[kind]) {
      warnings.push(`${formatDay(at)} already has ${plural(sameKind, KIND_NAMES[kind])}; the limit is ${SCHEDULE.perDay[kind]} a day.`);
    }
  }
  const close = closeTo(taken, kind, platforms, at).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at));
  for (const p of close) {
    const gap = Math.abs(p.at - at);
    const where = gap === 0 ? 'At the same time as' : `${formatGap(gap)} ${p.at < at ? 'after' : 'before'}`;
    warnings.push(`${where} the ${KIND_NAMES[p.kind] ?? 'post'} at ${formatTime(p.at)}${sameDay(p.at, at) ? '' : ` on ${formatDay(p.at)}`}.`);
  }
  for (const rule of new Set(close.map((p) => gapRule(kind, p.kind)))) warnings.push(rule);
  return { past: false, invalid: false, warnings, nextFree: warnings.length ? nextFreeTime(taken, kind, at, platforms) : null };
}

// What the day strip draws for `day` (any time that day): the posting hours, the posts in them, and the
// too-close ranges around the posts this one must keep apart from, clipped to the hours and merged where they
// overlap. `full` says this kind has reached its daily limit. kind and platforms: the post being placed.
export function dayStrip(taken, kind, day, platforms = []) {
  const start = dayStart(day);
  const end = dayEnd(day);
  const posts = taken.filter((p) => p.at >= start && p.at <= end).sort((a, b) => a.at - b.at);
  const ranges = [];
  const around = taken.map((p) => ({ p, gap: gapFrom(kind, platforms, p) })).filter(({ gap }) => gap > 0)
    .map(({ p, gap }) => ({ from: Math.max(start, p.at - gap), to: Math.min(end, p.at + gap) }))
    .filter((r) => r.from < r.to)
    .sort((a, b) => a.from - b.from);
  for (const { from, to } of around) {
    const last = ranges[ranges.length - 1];
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  }
  const full = isMedia(kind) && mediaPosts(taken).filter((p) => p.kind === kind && sameDay(p.at, day)).length >= SCHEDULE.perDay[kind];
  return { start, end, posts, tooClose: ranges, full };
}

// ---- Subtitles ----

// Languages offered for a video's speech, its subtitles and YouTube's language fields. The codes are
// Whisper's (what transcribe takes), which are also the codes YouTube uses for these languages.
export const LANGUAGES = [
  ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['mr', 'Marathi'], ['ta', 'Tamil'], ['te', 'Telugu'],
  ['ur', 'Urdu'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['ar', 'Arabic'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
];
export const languageName = (code) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code;

// The languages subtitles can be in (spoken, generated, uploaded) and YouTube's audio language. The codes
// are the same in Whisper (transcribe's --language) and YouTube's API; adding a language means checking
// both accept its code.
export const SUBTITLE_LANGUAGES = [['hi', 'Hindi'], ['en', 'English']];
export const isSubtitleLanguage = (code) => SUBTITLE_LANGUAGES.some(([c]) => c === code);
export const SUBTITLE_LANGUAGES_ONLY = 'Subtitles can only be in Hindi or English for now.';

// Which subtitles a platform that can't take a subtitle file gets burned in: its own choice when that
// language exists, nothing for 'none', otherwise English, otherwise the first language there is.
export function burnLanguage(choice, langs) {
  if (choice === 'none' || !langs.length) return null;
  if (langs.includes(choice)) return choice;
  return langs.includes('en') ? 'en' : langs[0];
}

// The size a burned-in copy must fit for this platform: its video limit when the original is over it (and
// ffmpeg can fit it), otherwise none. So platforms whose limit the video already meets share one copy, and
// a copy that must shrink is burned and fitted in one ffmpeg run. m: { size }.
export function burnTarget(platform, m) {
  const max = platform.canCompress && platform.media?.videoMB ? platform.media.videoMB * MB : null;
  return max && m.size > max ? max : null;
}

const SRT_TIME = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/;
const toMs = (t) => { const [, h, m, s, ms] = SRT_TIME.exec(t.trim()); return ((+h * 60 + +m) * 60 + +s) * 1000 + +ms; };
const toTime = (ms) => [3600000, 60000, 1000].map((unit, i) => String(Math.floor(ms / unit) % (i ? 60 : 100)).padStart(2, '0')).join(':')
  + `,${String(ms % 1000).padStart(3, '0')}`;

// An SRT file as [{ start, end, text }] in milliseconds, in time order; blocks it can't read are skipped.
export function parseSrt(srt) {
  return srt.replace(/^﻿/, '').split(/\r?\n\s*\r?\n/).map((block) => {
    const lines = block.trim().split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) return null;
    const [start, end] = lines[at].split('-->').map((t) => t.trim().split(/\s/)[0]);
    if (!SRT_TIME.test(start) || !SRT_TIME.test(end)) return null;
    return { start: toMs(start), end: toMs(end), text: lines.slice(at + 1).join('\n') };
  }).filter((c) => c && c.text.trim()).sort((a, b) => a.start - b.start);
}

export const formatSrt = (cues) => cues.map((c, i) => `${i + 1}\n${toTime(c.start)} --> ${toTime(c.end)}\n${c.text}\n`).join('\n');

// Auto-generated captions (e.g. downloaded from YouTube) keep each line up while the next starts.
// Shown or burned in, that stacks two lines with the newer one on top, and the text jumps around. So each
// line ends when the next begins, leaving one line on screen at a time, in order.
export function separateCues(srt) {
  const cues = parseSrt(srt);
  cues.forEach((c, i) => { if (cues[i + 1]) c.end = Math.min(c.end, cues[i + 1].start); });
  return formatSrt(cues.filter((c) => c.end > c.start));
}
