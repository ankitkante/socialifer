// Previews in each platform's card, following public/js/previews.js: simple generic cards (not copies of each
// platform's interface) built from the same rules the laptop uses, so a preview matches what's sent.
// Videos have no frame thumbnail on the phone, so a video shows as a dark box unless a cover or thumbnail is set.
import { Image, StyleSheet, View } from 'react-native';
import { countFor, effectiveText, resolveTitle, splitThread, formatDuration, splitSlides } from '../../public/rules.js';
import { mediaFile } from './store';
import { Carousel, TextSlides } from './Slides';
import { colors, Text } from './ui';

const SHORTS_MAX_SECONDS = 180;
const YOUTUBE_TITLE_SHOWN = 70; // search results cut titles off around here
const YOUTUBE_DESCRIPTION_SHOWN = 110;
const YOUTUBE_MIN_THUMBNAIL_WIDTH = 640;
const INSTAGRAM_CAPTION_SHOWN = 125; // the feed shows about this much before "… more"
const REEL_RATIO = 9 / 16;
const FEED_RATIO_MIN = 4 / 5;
const FEED_RATIO_MAX = 1.91;

const isVideo = (item) => item?.type?.startsWith('video/');
const ratioOf = (m) => (m?.width && m?.height ? m.width / m.height : null);
const isShort = (m) => Boolean(m && m.height >= m.width && m.duration <= SHORTS_MAX_SECONDS);

// Cut by characters the way people see them, so a Hindi letter or an emoji isn't split.
function clip(text, n) {
  const chars = Array.from(text);
  return chars.length > n ? { text: chars.slice(0, n).join('').trimEnd(), cut: true } : { text, cut: false };
}

// An image to show: a field image (cover, thumbnail), else a photo; videos have none.
const uriOf = (post, item) => (item?.file && !isVideo(item) && !post.mediaRemoved ? mediaFile(post, item).uri : null);

function Media({ uri, ratio, placeholder, corner, children, blurred }) {
  return (
    <View style={[styles.media, ratio ? { aspectRatio: ratio } : null]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={blurred ? 12 : 0} />
        : <Text style={styles.placeholder}>{placeholder}</Text>}
      {children}
      {corner ? <Text style={styles.corner}>{corner}</Text> : null}
    </View>
  );
}

function View2({ label, hint, children, width }) {
  return (
    <View style={[styles.view, width ? { width } : null]}>
      {/* The label on top, like the card's other headings, so it's clear where each view starts. */}
      <Text style={styles.viewLabel}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

// #hashtags and @mentions in Instagram's link colour.
function Tagged({ text }) {
  return text.split(/([#@][\p{L}\p{N}._]+)/u).map((part, i) => (i % 2 ? <Text key={i} style={styles.tag}>{part}</Text> : part));
}

function Clipped({ text, n, tags }) {
  const { text: shown, cut } = clip(text, n);
  return <>{tags ? <Tagged text={shown} /> : shown}{cut ? <Text style={styles.more}>… more</Text> : null}</>;
}

function youtube(post) {
  const o = post.options?.youtube ?? {};
  const video = post.media.find(isVideo);
  const title = resolveTitle(post.text, o.title);
  const description = effectiveText(post.text, o, 'youtube');
  const scheduled = o.publishAt && Number.isFinite(Date.parse(o.publishAt));
  const visibility = scheduled ? `Scheduled for ${new Date(o.publishAt).toLocaleString()}`
    : { public: 'Public', unlisted: 'Unlisted', private: 'Private' }[o.privacy] ?? 'Public';
  const thumbUri = uriOf(post, o.thumbnail);
  const short = isShort(video);
  const shape = video && (short ? 'Short' : `Regular video${video.width > video.height ? ' (horizontal)' : ''}`);
  const titleCut = clip(title, YOUTUBE_TITLE_SHOWN);
  const shownTitle = title ? `${titleCut.text}${titleCut.cut ? '…' : ''}` : 'Your title';
  const duration = video?.duration ? formatDuration(video.duration) : '';
  const placeholder = video ? '▶ Video' : 'Attach a video';

  const notes = [];
  if (o.thumbnail?.width) {
    const wide = o.thumbnail.width > o.thumbnail.height;
    if (short && wide) notes.push('This thumbnail is horizontal, but the video is a Short. Shorts are shown in a 9:16 frame, so it may be cropped.');
    if (video && !short && !wide) notes.push("This thumbnail is vertical, but the video isn't a Short. YouTube shows it in a 16:9 frame.");
    if (o.thumbnail.width < YOUTUBE_MIN_THUMBNAIL_WIDTH) notes.push(`This thumbnail is ${o.thumbnail.width} px wide. YouTube recommends at least ${YOUTUBE_MIN_THUMBNAIL_WIDTH} px.`);
  }
  if (titleCut.cut) notes.push(`Search results show about ${YOUTUBE_TITLE_SHOWN} characters of the title.`);

  const details = (
    <View style={styles.body}>
      <Text style={styles.title}>{shownTitle}</Text>
      <Text style={styles.meta}>Your channel · {visibility}</Text>
      {description ? <Text style={styles.text}><Clipped text={description} n={YOUTUBE_DESCRIPTION_SHOWN} /></Text> : null}
      <View style={styles.chips}>
        {shape ? <Text style={styles.chip}>{shape}</Text> : null}
        {o.synthetic ? <Text style={styles.chip}>Altered or synthetic content</Text> : null}
        <Text style={[styles.chip, styles.chipWarn]}>Private until your API project is audited</Text>
      </View>
    </View>
  );

  if (!short) {
    return { label: 'Preview', content: <View style={styles.card}><Media uri={thumbUri} ratio={16 / 9} placeholder={placeholder} corner={duration} />{details}</View>, notes };
  }
  return {
    label: 'Preview: Short',
    content: (
      <>
        <View style={styles.views}>
          <View2 label="Shorts player" hint="The title and buttons cover the bottom quarter." width={150}>
            <Media uri={thumbUri} ratio={9 / 16} placeholder={placeholder}>
              <View style={styles.shortOverlay}><Text style={styles.overlayStrong}>Your channel</Text><Text style={styles.overlayText} numberOfLines={2}>{shownTitle}</Text></View>
            </Media>
          </View2>
          <View2 label="Shelf and channel tab" width={110}>
            <Media uri={thumbUri} ratio={9 / 16} placeholder="" />
            <Text style={styles.tileTitle} numberOfLines={2}>{shownTitle}</Text>
          </View2>
          <View2 label="16:9 frame" hint="YouTube also keeps a 16:9 version with blurred sides." width={240}>
            <Media uri={thumbUri} ratio={16 / 9} placeholder={placeholder} corner={duration} blurred>
              {thumbUri ? <Image source={{ uri: thumbUri }} style={styles.wideMiddle} resizeMode="cover" /> : null}
            </Media>
          </View2>
        </View>
        <View style={styles.card}>{details}</View>
      </>
    ),
    notes,
  };
}

function instagram(post, platform, drawSlides) {
  const o = post.options?.instagram ?? {};
  const story = o.postAs === 'story';
  const first = post.media[0];
  const vertical = story || (post.media.length === 1 && isVideo(first));
  const caption = effectiveText(post.text, o, 'instagram');
  // A text-only post: its text as slides, and the caption, which keeps the whole text.
  if (!post.media.length && !story && caption.trim()) {
    const count = Math.min(10, splitSlides(caption, o.slideStyle).length);
    return {
      label: `Preview: ${count > 1 ? `Carousel of ${count}` : 'Post'}`,
      content: (
        <View style={styles.views}>
          <View2 label="Feed" hint="Your text as slides; the caption keeps the whole text." width={240}>
            <TextSlides text={caption} styleId={o.slideStyle} backgroundId={o.slideBackground} drawSlides={drawSlides} width={238}
              caption={<Text style={[styles.text, styles.body]}><Text style={styles.overlayStrongDark}>yourusername </Text><Clipped text={caption} n={INSTAGRAM_CAPTION_SHOWN} tags /></Text>} />
          </View2>
          <View2 label="Profile grid" hint="The first slide, 3:4. Approximate." width={110}>
            <TextSlides text={caption} styleId={o.slideStyle} backgroundId={o.slideBackground} drawSlides={drawSlides} width={110} tile />
          </View2>
        </View>
      ),
      notes: [],
    };
  }
  const kind = story ? 'Story' : post.media.length > 1 ? `Carousel of ${post.media.length}` : isVideo(first) ? 'Reel' : 'Post';
  const coverUri = uriOf(post, o.cover) ?? uriOf(post, first);
  const placeholder = isVideo(first) ? '▶ Video' : 'Attach a photo or video';
  const corner = post.media.length > 1 && !story ? `1/${post.media.length}` : '';

  const notes = [];
  if (story && caption) notes.push("Stories don't show captions.");
  if (vertical && !story && o.coverSeconds && !o.cover?.file) notes.push(`Cover from ${o.coverSeconds}s into the video.`);
  const coverRatio = ratioOf(o.cover);
  if (!story && o.cover?.file && coverRatio && Math.abs(coverRatio - REEL_RATIO) > 0.02) {
    notes.push(`This cover is ${o.cover.width}×${o.cover.height}, not 9:16. Instagram uses its middle 9:16 strip.`);
  }

  if (story) return { label: `Preview: ${kind}`, content: <View style={{ width: 180 }}><Media uri={coverUri} ratio={9 / 16} placeholder={placeholder} /></View>, notes };

  // Grid crops aren't documented; the web page's are measured from a real profile, these are centred.
  const grid = <View2 label="Profile grid" hint="3:4. Approximate." width={110}><Media uri={coverUri} ratio={3 / 4} placeholder="" /></View2>;

  if (vertical) {
    return {
      label: `Preview: ${kind}`,
      content: (
        <View style={styles.views}>
          <View2 label="Reel, full screen" hint="Dashed bands: covered by Instagram. Green box: the middle square every view keeps; put the title there." width={180}>
            <Media uri={coverUri} ratio={9 / 16} placeholder={placeholder}>
              <View style={[styles.band, { top: 0 }]}><Text style={styles.bandText}>Reels</Text></View>
              <View style={[styles.band, styles.bandBottom]}>
                <Text style={styles.overlayStrong}>yourusername</Text>
                {caption ? <Text style={styles.overlayText} numberOfLines={2}><Clipped text={caption} n={INSTAGRAM_CAPTION_SHOWN} tags /></Text> : null}
              </View>
              <View style={styles.safeBox} />
            </Media>
          </View2>
          {grid}
          <View2 label="Reels tab" hint="About 2:3. Approximate." width={110}><Media uri={coverUri} ratio={2 / 3} placeholder="" /></View2>
          {o.shareToFeed !== false ? <View2 label="Feed cover" hint="The middle square, per Meta." width={140}><Media uri={coverUri} ratio={1} placeholder="" /></View2> : null}
        </View>
      ),
      notes,
    };
  }

  const ratio = ratioOf(first);
  const feedRatio = ratio ? Math.min(FEED_RATIO_MAX, Math.max(FEED_RATIO_MIN, ratio)) : FEED_RATIO_MIN;
  return {
    label: `Preview: ${kind}`,
    content: (
      <View style={styles.views}>
        <View2 label="Feed" hint="At the photo's own shape, from 4:5 to 1.91:1." width={240}>
          {post.media.length > 1 ? (
            // A carousel: tap a file to open it full width and swipe through.
            <Carousel count={post.media.length} width={238} renderSlide={(i, w) => (
              <View style={{ width: w }}><Media uri={uriOf(post, post.media[i])} ratio={feedRatio} placeholder={isVideo(post.media[i]) ? '▶ Video' : ''} /></View>
            )}>
              {caption ? <Text style={[styles.text, styles.body]}><Text style={styles.overlayStrongDark}>yourusername </Text><Clipped text={caption} n={INSTAGRAM_CAPTION_SHOWN} tags /></Text> : null}
            </Carousel>
          ) : (
            <View style={styles.card}>
              <Media uri={coverUri} ratio={feedRatio} placeholder="Instagram needs a photo or video" corner={corner} />
              {caption ? <Text style={[styles.text, styles.body]}><Text style={styles.overlayStrongDark}>yourusername </Text><Clipped text={caption} n={INSTAGRAM_CAPTION_SHOWN} tags /></Text> : null}
            </View>
          )}
        </View2>
        {grid}
      </View>
    ),
    notes,
  };
}

function x(post, platform) {
  const o = post.options?.x ?? {};
  const body = effectiveText(post.text, o, 'x');
  const parts = o.thread ? splitThread('x', body, platform.limit) : [body];
  const firstUri = uriOf(post, post.media[0]);
  const notes = [];
  if (parts.length > 1) notes.push('Posts break at the end of a sentence when one is close to the limit. A post cut mid-sentence ends with "...".');
  else if (!o.thread && countFor('x', body) > platform.limit) notes.push('Too long for one post: turn on the thread option, or shorten it.');
  return {
    label: parts.length > 1 ? `Preview: thread of ${parts.length}` : 'Preview',
    content: (
      <View style={styles.thread}>
        {parts.map((part, i) => (
          <View key={i} style={styles.post}>
            <Text style={styles.meta}><Text style={styles.overlayStrongDark}>yourusername</Text>{i ? ' · reply' : ''}</Text>
            <Text style={styles.text}>{part || 'Your post'}</Text>
            {i === 0 && post.media[0] ? <Media uri={firstUri} ratio={ratioOf(post.media[0]) ?? 16 / 9} placeholder={isVideo(post.media[0]) ? '▶ Video' : ''} /> : null}
            <Text style={[styles.count, countFor('x', part) > platform.limit && { color: colors.danger }]}>{countFor('x', part)} / {platform.limit}</Text>
          </View>
        ))}
      </View>
    ),
    notes,
  };
}

const BUILDERS = { youtube, instagram, x };
export const hasPreview = (id) => id in BUILDERS;

// drawSlides: asks the laptop for a text-only post's slides (null while it isn't connected).
export default function Preview({ p, post, drawSlides }) {
  const built = BUILDERS[p.id]?.(post, p, drawSlides);
  if (!built) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{built.label}</Text>
      {built.content}
      {built.notes.map((n) => <Text key={n} style={styles.hint}>{n}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  card: { backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  media: { width: '100%', backgroundColor: '#222', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  placeholder: { color: '#bbb', fontSize: 13, textAlign: 'center', padding: 8 },
  corner: { position: 'absolute', right: 6, bottom: 6, backgroundColor: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 11, paddingHorizontal: 4, borderRadius: 3 },
  body: { padding: 10, gap: 4 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
  text: { fontSize: 14, color: colors.text },
  more: { color: colors.muted },
  tag: { color: '#00376b' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { fontSize: 11, backgroundColor: colors.soft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, color: colors.text },
  chipWarn: { backgroundColor: '#fff4ce', color: colors.warn },
  views: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' },
  view: { gap: 4 },
  viewLabel: { fontSize: 12, fontWeight: '600', color: colors.text },
  hint: { fontSize: 12, color: colors.muted },
  shortOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '25%', backgroundColor: 'rgba(0,0,0,0.45)', padding: 6, justifyContent: 'flex-end' },
  overlayStrong: { color: '#fff', fontWeight: '600', fontSize: 12 },
  overlayStrongDark: { fontWeight: '600', color: colors.text },
  overlayText: { color: '#fff', fontSize: 11 },
  tileTitle: { fontSize: 12, color: colors.text },
  wideMiddle: { position: 'absolute', top: 0, bottom: 0, left: '34.2%', width: '31.6%' },
  band: { position: 'absolute', left: 0, right: 0, height: '21.875%', borderColor: 'rgba(255,255,255,0.7)', borderStyle: 'dashed', borderBottomWidth: 1, backgroundColor: 'rgba(0,0,0,0.35)', padding: 6 },
  bandBottom: { top: undefined, bottom: 0, borderBottomWidth: 0, borderTopWidth: 1, justifyContent: 'flex-end' },
  bandText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  // Instagram's cover keeps 7.5–92.5% of the width and 21.875–78.125% of the height (.safe-box in styles.css).
  safeBox: { position: 'absolute', left: '7.5%', right: '7.5%', top: '21.875%', bottom: '21.875%', borderWidth: 2, borderColor: '#34c759' },
  thread: { gap: 8 },
  post: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: colors.line, padding: 10, gap: 6 },
  count: { fontSize: 12, color: colors.muted, alignSelf: 'flex-end' },
});
