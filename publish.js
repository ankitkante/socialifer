// Posting to the selected platforms, shared by the page's /api/post and the phone app's queue,
// and what both are told about each platform.
import { platforms } from './platforms/index.js';
import { ApiError } from './platforms/http.js';
import { problemsFor, effectiveText, resolveTitle, isVideo, burnLanguage, burnTarget, languageName, textSlides } from './public/rules.js';
import { slideMedia } from './slides.js';
import { log, runWithContext, step, currentStep } from './log.js';
import { publicBaseUrl, videoTools, getMedia, fitVideo, burnSubtitles, keepVideo } from './media.js';

// With ffmpeg installed, videos too big for a platform are compressed instead of rejected.
export const canCompress = Boolean(await videoTools());

export function describe(p) {
  return {
    id: p.id,
    name: p.name,
    limit: p.limit,
    media: p.media,
    title: p.title ?? null,
    textForbids: p.textForbids ?? '',
    threads: Boolean(p.threads),
    subtitleTracks: Boolean(p.subtitleTracks),
    envVars: p.envVars,
    configured: p.isConfigured(),
    publicUrlReady: Boolean(publicBaseUrl()),
    canCompress,
  };
}

const mb = (bytes) => `${Math.round(bytes / 1_000_000)} MB`;
const seconds = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

// Swaps in a compressed copy of any video that's over this platform's size limit.
async function mediaFor(p, media) {
  const maxBytes = p.media.videoMB && p.media.videoMB * 1_000_000;
  if (!canCompress || !maxBytes) return media;
  return Promise.all(media.map(async (m) => {
    if (!isVideo(m) || m.size <= maxBytes) return m;
    const message = `Compressing ${m.name} from ${mb(m.size)} to fit ${p.media.videoMB} MB`;
    step(message);
    const started = Date.now();
    const fitted = await fitVideo(m, maxBytes, (progress) => step(message, { quiet: true, progress }));
    log.info(`Compressed to ${mb(fitted.size)} in ${seconds(Date.now() - started)}`);
    return fitted;
  }));
}

// subtitles: { videoId: { lang: SRT upload } }. Each video keeps its own subtitles.
const subtitleLanguages = (subtitles) => [...new Set(Object.values(subtitles).flatMap(Object.keys))];

// Platforms that can't take a subtitle file get one language drawn onto each video instead: the platform's
// choice (a language or 'none'), else English, else the first there is. A video without that language goes as it is.
async function withSubtitles(p, media, subtitles, choice) {
  const lang = burnLanguage(choice, subtitleLanguages(subtitles));
  if (!lang) return media;
  if (!canCompress) throw new ApiError("Burning subtitles into the video needs ffmpeg, which isn't installed. Choose None under Subtitles, or install ffmpeg");
  return Promise.all(media.map(async (m) => {
    const srt = isVideo(m) && subtitles[m.id]?.[lang];
    if (!srt) return m;
    const message = `Adding the ${languageName(lang)} subtitles to ${m.name}`;
    step(message);
    // A video over this platform's size limit is fitted in the same ffmpeg run.
    return burnSubtitles(m, srt, (progress) => step(message, { quiet: true, progress }), burnTarget(describe(p), m));
  }));
}

// Platforms that take subtitle files (YouTube) get one track per language: the ones the user left ticked,
// or every language there is when the page didn't say.
function subtitleTracks(media, subtitles, choice) {
  const available = subtitles[media.find(isVideo)?.id] ?? {};
  const langs = Array.isArray(choice) ? choice.filter((lang) => available[lang]) : Object.keys(available);
  return langs.map((lang) => ({ lang, file: available[lang] }));
}

// Image fields (YouTube's thumbnail, Instagram's cover) arrive as upload ids; swap in the files.
async function withFieldMedia(p, own) {
  const resolved = { ...own };
  for (const key of p.mediaOptions ?? []) {
    if (!own[key]) continue;
    const m = typeof own[key] === 'string' ? await getMedia(own[key]) : null;
    if (!m) throw new ApiError(`The ${key} image has expired. Remove it and add it again.`);
    resolved[key] = m;
  }
  return resolved;
}

// Expected failures (API and network errors, our own checks) keep their message, prefixed with the
// step they happened in. Anything else is a bug: the user gets a short note, the terminal the stack.
export function failureMessage(err, where) {
  if (err instanceof ApiError) return where ? `${where}: ${err.message}` : err.message;
  const during = where ? ` while ${where[0].toLowerCase()}${where.slice(1)}` : '';
  return `Something went wrong in the app${during}. The details are in the terminal.`;
}

let postCount = 0;

// Posts to each selected platform in parallel. onEvent gets { type: 'status', id, step } as each
// platform moves along and { type: 'result', ... } as each one finishes.
// options holds per-platform fields keyed by platform id, e.g.
// { instagram: { text, postAs, cover }, youtube: { text, title, privacy, tags, thumbnail } }.
// subtitles: { videoId: { lang: SRT upload } }. Platforms with subtitleTracks get them as files; the rest get
// one language burned in. options[id].subtitles is the platform's choice: languages for tracks, else a language or 'none'.
// from: where the post came from, added to the log line (e.g. "phone post 1a2b3c4d").
// keepVideos: save a copy of each video for posting on Substack by hand (the web page's posts), sent as
// { type: 'substack', files } once every platform has finished. See keptVideos.
export async function publish(text, ids, media, options, subtitles = {}, onEvent = () => {}, { from, keepVideos = false } = {}) {
  const postId = ++postCount;
  const selected = platforms.filter((p) => ids.includes(p.id));
  const files = [...media, ...Object.values(subtitles).flatMap(Object.values)].map((m) => `${m.name} (${mb(m.size)})`).join(', ');
  log.info(`[post ${postId}] Posting to ${selected.map((p) => p.name).join(', ')}${files ? ` with ${files}` : ''}${from ? ` (${from})` : ''}`);

  const sent = {}; // platform id -> the media it was given, for keptVideos
  const results = await Promise.all(selected.map((p) => runWithContext(
    { postId, platform: p.name, onStep: (s, progress) => onEvent({ type: 'status', id: p.id, step: s, ...(progress !== undefined && { progress }) }) },
    async () => {
      const started = Date.now();
      let result;
      try {
        if (!p.isConfigured()) throw new ApiError(`Not configured. Set ${p.envVars.join(', ')} in .env`);
        const given = options[p.id];
        const { subtitles: choice, ...own } = await withFieldMedia(p, given && typeof given === 'object' ? given : {});
        // Validate before compressing, so a post that can't go anyway doesn't wait on ffmpeg.
        const problems = problemsFor(describe(p), text, media, own);
        if (problems.length) throw new ApiError(problems.join('. '));
        // Platforms with a title get it resolved here, since it can come from the main post's first line.
        const postOptions = p.title ? { ...own, title: resolveTitle(text, own.title) } : own;
        if (p.subtitleTracks) postOptions.subtitles = subtitleTracks(media, subtitles, choice);
        // A text-only post goes to Instagram as slides of its text.
        const slides = textSlides(describe(p), text, media, own);
        if (slides) step(slides.length > 1 ? `Making ${slides.length} slides from the text` : 'Making an image from the text');
        const ownMedia = slides
          ? await slideMedia(effectiveText(text, own, p.id), own.slideStyle, own.slideBackground)
          : await mediaFor(p, p.subtitleTracks ? media : await withSubtitles(p, media, subtitles, choice));
        sent[p.id] = ownMedia;
        step('Posting', { quiet: true });
        const value = await p.post(effectiveText(text, own, p.id), ownMedia, postOptions);
        result = { id: p.id, name: p.name, ok: true, url: value?.url ?? null, warnings: value?.warnings ?? [], todo: value?.todo ?? null, error: null };
        log.info(`Posted in ${seconds(Date.now() - started)}${result.url ? `: ${result.url}` : ''}`);
        for (const w of result.warnings) log.warn(w);
      } catch (err) {
        const where = currentStep();
        const error = failureMessage(err, where);
        // API errors were already logged in full by request(); bugs get their stack trace here.
        log.error(`Failed after ${seconds(Date.now() - started)}: ${err.message}`, err instanceof ApiError ? '' : err?.stack);
        result = { id: p.id, name: p.name, ok: false, url: null, warnings: [], error };
      }
      onEvent({ type: 'result', ...result });
      return result;
    },
  )));
  if (keepVideos && results.some((r) => r.ok) && media.some(isVideo)) {
    const files = await keptVideos(media, sent, postId);
    if (files.length) onEvent({ type: 'substack', files });
  }
  return results;
}

// Substack takes video, but only by hand, so each video is saved where the user can pick it in Substack's
// upload box. It's the copy X got (subtitles burned in, fitted to size), else Instagram's, else another
// platform's that burns subtitles in, else the video as it was added (YouTube alone gets the original).
const KEEP_FROM = ['x', 'instagram'];

async function keptVideos(media, sent, postId) {
  const order = [...KEEP_FROM, ...platforms.filter((p) => !p.subtitleTracks && !KEEP_FROM.includes(p.id)).map((p) => p.id)];
  const files = [];
  for (const [i, m] of media.entries()) {
    if (!isVideo(m)) continue;
    const copy = order.map((id) => sent[id]?.[i]).find(Boolean) ?? m;
    try {
      files.push(await keepVideo(copy));
    } catch (err) {
      log.warn(`[post ${postId}] Couldn't save ${copy.name} for Substack: ${err.message}`);
    }
  }
  if (files.length) log.info(`[post ${postId}] Saved for Substack: ${files.join(', ')}`);
  return files;
}
