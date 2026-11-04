// Live previews for each platform's tab: simple, generic cards (not copies of each platform's
// interface) built from the same rules the server uses, so a preview always matches what's sent.
import { el, truncate } from './dom.js';
import { countFor, effectiveText, resolveTitle, splitThread, formatDuration } from '/rules.js';
import { isVideoFile } from './uploads.js';

const SHORTS_MAX_SECONDS = 180;
const YOUTUBE_TITLE_SHOWN = 70; // search results cut titles off around here
const YOUTUBE_DESCRIPTION_SHOWN = 110;
const INSTAGRAM_CAPTION_SHOWN = 125; // the feed shows about this much before "… more"

function mediaBox(item, { ratio, placeholder, corner }) {
  const box = el('div', { className: 'preview-media' });
  if (ratio) box.style.aspectRatio = ratio;
  box.append(item?.thumb || item?.preview ? el('img', { src: item.thumb || item.preview, alt: '' }) : placeholder);
  if (corner) box.append(el('span', { className: 'corner', textContent: corner }));
  return box;
}

// "Some text… more", cut where the platform cuts it.
function clipped(text, n) {
  const { text: shown, cut } = truncate(text, n);
  return cut ? [shown, '… ', el('span', { className: 'more', textContent: 'more' })] : [shown];
}

// Highlights #hashtags and @mentions the way Instagram links them.
function withTags(nodes) {
  return nodes.flatMap((node) => typeof node !== 'string' ? [node]
    : node.split(/([#@][\p{L}\p{N}._]+)/u).map((part, i) => (i % 2 ? el('span', { className: 'tag', textContent: part }) : part)));
}

export function isShort(meta) {
  return Boolean(meta && meta.height >= meta.width && meta.duration <= SHORTS_MAX_SECONDS);
}

function youtube({ text, options, items }) {
  const o = options.youtube ?? {};
  const video = items.find((i) => isVideoFile(i.file));
  const title = resolveTitle(text, o.title);
  const description = effectiveText(text, o, 'youtube');
  const scheduled = o.publishAt && Number.isFinite(Date.parse(o.publishAt));
  const visibility = scheduled ? `Scheduled for ${new Date(o.publishAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
    : { public: 'Public', unlisted: 'Unlisted', private: 'Private' }[o.privacy] ?? 'Public';
  const thumb = o.thumbnail?.preview ? { thumb: o.thumbnail.preview } : video;
  const shape = video?.meta && (isShort(video.meta) ? 'Short' : `Regular video${video.meta.width > video.meta.height ? ' (horizontal)' : ''}`);
  const titleCut = truncate(title, YOUTUBE_TITLE_SHOWN);

  return el('div', { className: 'preview' },
    el('span', { className: 'preview-label', textContent: 'Preview' }),
    el('div', { className: 'preview-card' },
      mediaBox(thumb, {
        ratio: '16 / 9',
        placeholder: 'Attach a video',
        corner: video?.meta ? formatDuration(video.meta.duration) : '',
      }),
      el('div', { className: 'preview-body' },
        el('div', { className: 'preview-title', title, textContent: title ? `${titleCut.text}${titleCut.cut ? '…' : ''}` : 'Your title' }),
        el('div', { className: 'preview-meta', textContent: `Your channel · ${visibility}` }),
        description ? el('div', { className: 'preview-text' }, ...clipped(description, YOUTUBE_DESCRIPTION_SHOWN)) : '',
        el('div', { className: 'chips' },
          shape ? el('span', { className: 'chip-tag', textContent: shape }) : '',
          o.synthetic ? el('span', { className: 'chip-tag', textContent: 'Altered or synthetic content' }) : '',
          el('span', { className: 'chip-tag warn', textContent: 'Private until your API project is audited' }),
        ),
      ),
    ),
    titleCut.cut ? el('p', { className: 'hint', textContent: `Search results show about ${YOUTUBE_TITLE_SHOWN} characters of the title.` }) : '',
  );
}

function instagram({ text, options, items }) {
  const o = options.instagram ?? {};
  const story = o.postAs === 'story';
  const first = items[0];
  const vertical = story || (items.length === 1 && first && isVideoFile(first.file));
  const caption = effectiveText(text, o, 'instagram');
  const kind = story ? 'Story' : items.length > 1 ? `Carousel of ${items.length}` : first && isVideoFile(first.file) ? 'Reel' : 'Post';
  const cover = o.cover?.preview ? { thumb: o.cover.preview } : first;
  const corner = items.length > 1 && !story ? `1/${items.length}` : '';
  const captionNodes = withTags(clipped(caption, INSTAGRAM_CAPTION_SHOWN));

  const notes = [];
  if (story && caption) notes.push("Stories don't show captions.");
  if (vertical && !story && o.coverSeconds) notes.push(`Cover from ${o.coverSeconds}s into the video.`);

  if (vertical) {
    const media = mediaBox(cover, { placeholder: 'Attach a photo or video', corner });
    if (!story && caption) media.append(el('div', { className: 'overlay' }, el('strong', { textContent: 'Your account ' }), ...captionNodes));
    return el('div', { className: 'preview' },
      el('span', { className: 'preview-label', textContent: `Preview: ${kind}` }),
      el('div', { className: 'preview-card reel' }, media),
      ...notes.map((n) => el('p', { className: 'hint', textContent: n })),
    );
  }
  return el('div', { className: 'preview' },
    el('span', { className: 'preview-label', textContent: `Preview: ${kind}` }),
    el('div', { className: 'preview-card' },
      mediaBox(cover, { ratio: '4 / 5', placeholder: 'Instagram needs a photo or video', corner }),
      caption ? el('div', { className: 'preview-body' }, el('div', { className: 'preview-text' }, el('strong', { textContent: 'Your account ' }), ...captionNodes)) : '',
    ),
    ...notes.map((n) => el('p', { className: 'hint', textContent: n })),
  );
}

function x({ text, options, items, platform }) {
  const o = options.x ?? {};
  const body = effectiveText(text, o, 'x');
  const length = countFor('x', body);
  const parts = o.thread ? splitThread('x', body, platform.limit) : [body];
  const posts = parts.map((part, i) => el('div', { className: 'post' },
    el('div', { className: 'preview-meta' }, el('strong', { textContent: 'Your account' }), i ? ' · reply' : ''),
    el('div', { className: 'preview-text', textContent: part || 'Your post' }),
    i === 0 && items[0] ? mediaBox(items[0], { placeholder: '' }) : '',
    el('span', {
      className: 'count' + (countFor('x', part) > platform.limit ? ' over' : ''),
      textContent: `${countFor('x', part)} / ${platform.limit}`,
    }),
  ));
  const label = parts.length > 1 ? `Preview: thread of ${parts.length}` : 'Preview';
  return el('div', { className: 'preview' },
    el('span', { className: 'preview-label', textContent: label }),
    el('div', { className: 'thread' }, ...posts),
    parts.length > 1 ? el('p', { className: 'hint', textContent: 'Posts break at the end of a sentence when one is close to the limit. A post cut mid-sentence ends with "...".' })
      : !o.thread && length > platform.limit ? el('p', { className: 'hint', textContent: 'Too long for one post: turn on the thread option, or shorten it.' }) : '',
  );
}

const BUILDERS = { youtube, instagram, x };

export const hasPreview = (id) => id in BUILDERS;

// ctx: { text, options, items, platform }
export function renderPreview(id, ctx) {
  return BUILDERS[id]?.(ctx) ?? null;
}
