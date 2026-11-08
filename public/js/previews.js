// Live previews for each platform's tab: simple, generic cards (not copies of each platform's
// interface) built from the same rules the server uses, so a preview always matches what's sent.
import { el, truncate } from './dom.js';
import { countFor, effectiveText, resolveTitle, splitThread, formatDuration } from '/rules.js';
import { isVideoFile } from './uploads.js';

const SHORTS_MAX_SECONDS = 180;
const YOUTUBE_TITLE_SHOWN = 70; // search results cut titles off around here
const YOUTUBE_DESCRIPTION_SHOWN = 110;
const YOUTUBE_MIN_THUMBNAIL_WIDTH = 640; // YouTube's help asks for at least this
const INSTAGRAM_CAPTION_SHOWN = 125; // the feed shows about this much before "… more"
const REEL_RATIO = 9 / 16;
// Feed photos show at their own shape within this range (Meta's API rejects anything outside it).
const FEED_RATIO_MIN = 4 / 5;
const FEED_RATIO_MAX = 1.91;

const ratioOf = (m) => (m?.width && m?.height ? m.width / m.height : null);

// One labelled frame, for platforms that show the same picture in several places.
function previewView(label, hint, ...content) {
  return el('figure', { className: 'preview-view' },
    ...content,
    el('figcaption', {}, el('strong', { textContent: label }), hint ? el('span', { textContent: hint }) : ''));
}

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

// Notes on the custom thumbnail's shape and size, compared with the video.
function thumbnailNotes(thumbnail, short) {
  const notes = [];
  if (!thumbnail?.width) return notes;
  const wide = thumbnail.width > thumbnail.height;
  if (short && wide) notes.push('This thumbnail is horizontal, but the video is a Short. Shorts are shown in a 9:16 frame, so it may be cropped.');
  if (!short && !wide) notes.push("This thumbnail is vertical, but the video isn't a Short. YouTube shows it in a 16:9 frame.");
  if (thumbnail.width < YOUTUBE_MIN_THUMBNAIL_WIDTH) {
    notes.push(`This thumbnail is ${thumbnail.width} px wide. YouTube recommends at least ${YOUTUBE_MIN_THUMBNAIL_WIDTH} px.`);
  }
  return notes;
}

// A Short's thumbnail in a 16:9 frame: the image in the middle, blurred copies at the sides,
// as in the 16:9 version YouTube stored for a test Short (2026-11-09).
function wideShortBox(src, corner) {
  const box = el('div', { className: 'preview-media wide-short' });
  box.style.aspectRatio = '16 / 9';
  if (src) box.append(el('img', { className: 'blurred', src, alt: '' }), el('img', { className: 'middle', src, alt: '' }));
  else box.append('Attach a video');
  if (corner) box.append(el('span', { className: 'corner', textContent: corner }));
  return box;
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
  const short = isShort(video?.meta);
  const shape = video?.meta && (short ? 'Short' : `Regular video${video.meta.width > video.meta.height ? ' (horizontal)' : ''}`);
  const titleCut = truncate(title, YOUTUBE_TITLE_SHOWN);
  const duration = video?.meta ? formatDuration(video.meta.duration) : '';
  const shownTitle = title ? `${titleCut.text}${titleCut.cut ? '…' : ''}` : 'Your title';

  const details = el('div', { className: 'preview-body' },
    el('div', { className: 'preview-title', title, textContent: shownTitle }),
    el('div', { className: 'preview-meta', textContent: `Your channel · ${visibility}` }),
    description ? el('div', { className: 'preview-text' }, ...clipped(description, YOUTUBE_DESCRIPTION_SHOWN)) : '',
    el('div', { className: 'chips' },
      shape ? el('span', { className: 'chip-tag', textContent: shape }) : '',
      o.synthetic ? el('span', { className: 'chip-tag', textContent: 'Altered or synthetic content' }) : '',
      el('span', { className: 'chip-tag warn', textContent: 'Private until your API project is audited' }),
    ),
  );
  const notes = [
    ...thumbnailNotes(o.thumbnail, short),
    titleCut.cut ? `Search results show about ${YOUTUBE_TITLE_SHOWN} characters of the title.` : '',
  ].filter(Boolean).map((n) => el('p', { className: 'hint', textContent: n }));

  if (!short) {
    return el('div', { className: 'preview' },
      el('span', { className: 'preview-label', textContent: 'Preview' }),
      el('div', { className: 'preview-card' }, mediaBox(thumb, { ratio: '16 / 9', placeholder: 'Attach a video', corner: duration }), details),
      ...notes,
    );
  }

  // A Short appears in several frames; show the thumbnail in each.
  const src = thumb?.thumb || thumb?.preview;
  const player = mediaBox(thumb, { placeholder: 'Attach a video' });
  player.append(el('div', { className: 'short-overlay' }, el('strong', { textContent: 'Your channel' }), el('div', { textContent: shownTitle })));

  return el('div', { className: 'preview' },
    el('span', { className: 'preview-label', textContent: 'Preview: Short' }),
    el('div', { className: 'preview-views' },
      previewView('Shorts player', 'The title and buttons cover the bottom quarter.', el('div', { className: 'short-player' }, player)),
      previewView('Shelf and channel tab', '', el('div', { className: 'short-tile' }, mediaBox(thumb, { placeholder: '' })),
        el('div', { className: 'short-tile-title', textContent: shownTitle })),
      previewView('16:9 frame', 'YouTube also keeps a 16:9 version with blurred sides.', el('div', { className: 'short-wide' }, wideShortBox(src, duration))),
    ),
    el('div', { className: 'preview-card' }, details),
    ...notes,
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

  const customCover = Boolean(o.cover?.preview);
  const notes = [];
  if (story && caption) notes.push("Stories don't show captions.");
  if (vertical && !story && o.coverSeconds && !customCover) notes.push(`Cover from ${o.coverSeconds}s into the video.`);
  const coverRatio = ratioOf(o.cover);
  if (!story && customCover && coverRatio && Math.abs(coverRatio - REEL_RATIO) > 0.02) {
    notes.push(`This cover is ${o.cover.width}×${o.cover.height}, not 9:16. Instagram uses its middle 9:16 strip.`);
  }
  const hints = notes.map((n) => el('p', { className: 'hint', textContent: n }));

  if (story) {
    return el('div', { className: 'preview' },
      el('span', { className: 'preview-label', textContent: `Preview: ${kind}` }),
      el('div', { className: 'preview-card reel' }, mediaBox(cover, { placeholder: 'Attach a photo or video' })),
      ...hints,
    );
  }

  // Grid crops aren't documented. These follow a Reel measured on the user's profile (2026-11-09):
  // tiles keep the lower part of the cover, not the middle (styles.css, .ig-tile.grid / .reels-tab).
  const gridTile = previewView('Profile grid', '3:4, cut more at the top. Approximate.',
    el('div', { className: 'ig-tile grid' }, mediaBox(cover, { ratio: '3 / 4', placeholder: '' })));

  if (vertical) {
    // A landscape video with no cover plays whole, with bars (checked live); a cover fills the frame.
    const full = mediaBox(cover, { placeholder: 'Attach a video' });
    if (!customCover && ratioOf(first?.meta) > 1) full.classList.add('fit');
    full.append(
      el('div', { className: 'ig-band top', textContent: 'Reels' }),
      el('div', { className: 'ig-band bottom' }, el('strong', { textContent: 'Your account' }), caption ? el('div', {}, ...captionNodes) : ''),
      el('div', { className: 'safe-box' }),
    );
    return el('div', { className: 'preview' },
      el('span', { className: 'preview-label', textContent: `Preview: ${kind}` }),
      el('div', { className: 'preview-views' },
        previewView('Reel, full screen', 'Dashed bands: covered by Instagram. Green box: the middle square every view keeps; put the title there.',
          el('div', { className: 'ig-reel' }, full)),
        gridTile,
        previewView('Reels tab', 'About 2:3, cut more at the top and a little at the sides. Approximate.',
          el('div', { className: 'ig-tile reels-tab' }, mediaBox(cover, { ratio: '2 / 3', placeholder: '' }))),
        o.shareToFeed !== false
          ? previewView('Feed cover', 'The middle square, per Meta.', el('div', { className: 'ig-square' }, mediaBox(cover, { ratio: '1 / 1', placeholder: '' })))
          : '',
      ),
      ...hints,
    );
  }

  const ratio = ratioOf(first?.meta);
  const feedRatio = ratio ? Math.min(FEED_RATIO_MAX, Math.max(FEED_RATIO_MIN, ratio)) : FEED_RATIO_MIN;
  return el('div', { className: 'preview' },
    el('span', { className: 'preview-label', textContent: `Preview: ${kind}` }),
    el('div', { className: 'preview-views' },
      previewView('Feed', 'At the photo\'s own shape, from 4:5 to 1.91:1.', el('div', { className: 'preview-card ig-feed' },
        mediaBox(cover, { ratio: String(feedRatio), placeholder: 'Instagram needs a photo or video', corner }),
        caption ? el('div', { className: 'preview-body' }, el('div', { className: 'preview-text' }, el('strong', { textContent: 'Your account ' }), ...captionNodes)) : '',
      )),
      gridTile,
    ),
    ...hints,
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
