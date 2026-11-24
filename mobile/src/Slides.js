// Text carousels on the phone (public/slides.js has the styles and backgrounds): Instagram's two pickers, the
// slides' preview, and the full-screen view that swipes through a carousel.
// The laptop draws the real slides (/app/slides). Offline, the phone draws its own: the same text on each slide
// (the split is shared), the same backgrounds, but its own line breaks, so it can differ a little.
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { SLIDE_BACKGROUNDS, SLIDE_HEIGHT, SLIDE_PADDING, SLIDE_STYLES, SLIDE_WIDTH, slideBackground, slideStyle } from '../../public/slides.js';
import { splitSlides } from '../../public/rules.js';
import { colors, Text } from './ui';

const RATIO = SLIDE_HEIGHT / SLIDE_WIDTH;

// "rgba(r, g, b, a)" as a colour and an opacity, which is how react-native-svg takes them.
function paint(color) {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(color);
  return m ? { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, opacity: Number(m[4]) } : { color, opacity: 1 };
}
const stops = (list) => list.map(([at, c], i) => {
  const { color, opacity } = paint(c);
  return <Stop key={i} offset={at} stopColor={color} stopOpacity={opacity} />;
});

// A CSS gradient angle as a line across a w × h box, as the laptop draws it (slides.js).
function linearPoints(angle, w, h) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return { x1: w / 2 - dx * half, y1: h / 2 - dy * half, x2: w / 2 + dx * half, y2: h / 2 + dy * half };
}

let nextId = 0;

export function SlideBackground({ id, width, height = width * RATIO }) {
  const [prefix] = useState(() => `bg${++nextId}`);
  const scale = width / SLIDE_WIDTH;
  const defs = [];
  const shapes = [];
  slideBackground(id).layers.forEach((l, i) => {
    const ref = `${prefix}-${i}`;
    if (l.type === 'color') shapes.push(<Rect key={i} width={width} height={height} fill={l.color} />);
    else if (l.type === 'linear') {
      defs.push(<LinearGradient key={i} id={ref} gradientUnits="userSpaceOnUse" {...linearPoints(l.angle, width, height)}>{stops(l.stops)}</LinearGradient>);
      shapes.push(<Rect key={i} width={width} height={height} fill={`url(#${ref})`} />);
    } else if (l.type === 'radial') {
      defs.push(
        <RadialGradient key={i} id={ref} gradientUnits="userSpaceOnUse" cx={l.x * width} cy={l.y * height} fx={l.x * width} fy={l.y * height}
          rx={l.rx * width} ry={l.ry * height}>{stops(l.stops)}</RadialGradient>,
      );
      shapes.push(<Rect key={i} width={width} height={height} fill={`url(#${ref})`} />);
    } else if (l.type === 'dots') {
      const step = l.spacing * scale;
      const { color, opacity } = paint(l.color);
      defs.push(
        <Pattern key={i} id={ref} patternUnits="userSpaceOnUse" width={step} height={step}>
          <Circle cx={step / 2} cy={step / 2} r={Math.max(0.5, l.radius * scale * 1.2)} fill={color} fillOpacity={opacity} />
        </Pattern>,
      );
      shapes.push(<Rect key={i} width={width} height={height} fill={`url(#${ref})`} />);
    } else if (l.type === 'rings') {
      const { color, opacity } = paint(l.color);
      const step = l.spacing * scale;
      for (let r = step, k = 0; r < Math.hypot(width, height); r += step, k++) {
        shapes.push(<Circle key={`${i}-${k}`} cx={l.x * width} cy={l.y * height} r={r} fill="none" stroke={color} strokeOpacity={opacity} strokeWidth={l.width * scale} />);
      }
    } else if (l.type === 'stars') {
      l.stars.forEach(([x, y, r, a], k) => shapes.push(<Circle key={`${i}-${k}`} cx={x * width} cy={y * height} r={Math.max(0.4, r * scale * 0.6)} fill="#fff" fillOpacity={a} />));
    }
  });
  return (
    <Svg width={width} height={height}>
      <Defs>{defs}</Defs>
      {shapes}
    </Svg>
  );
}

function Arrow({ size, color }) {
  return (
    <Svg width={size} height={size * 0.9} viewBox="0 0 22 20">
      <Path d="M2 10h17M13 4l6 6-6 6" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

// One slide drawn on the phone, for when the laptop isn't connected.
function DraftSlide({ text, index, count, styleId, backgroundId, width }) {
  const scale = width / SLIDE_WIDTH;
  const style = slideStyle(styleId);
  const isCover = Boolean(style.cover) && index === 0;
  const type = isCover ? { ...style, ...style.cover } : style;
  const color = slideBackground(backgroundId).text;
  const size = type.size * scale;
  return (
    <View style={{ width, height: width * RATIO, overflow: 'hidden' }}>
      <View style={StyleSheet.absoluteFill}><SlideBackground id={backgroundId} width={width} /></View>
      <View style={[StyleSheet.absoluteFill, { padding: SLIDE_PADDING * scale, justifyContent: 'center' }]}>
        <Text style={{ color, fontSize: size, lineHeight: size * type.lineHeight, fontWeight: String(Math.min(type.weight, 700)), textAlign: type.align }}>{text}</Text>
        {isCover && count > 1 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 * scale * 3, marginTop: 30 * scale, opacity: 0.75 }}>
            <Text style={{ color, fontSize: 40 * scale, fontWeight: '500' }}>Swipe</Text>
            <Arrow size={54 * scale} color={color} />
          </View>
        ) : null}
      </View>
      {style.arrow && index < count - 1 ? (
        <View style={{ position: 'absolute', right: SLIDE_PADDING * scale, bottom: (SLIDE_PADDING - 40) * scale, opacity: 0.75 }}>
          <Arrow size={74 * scale} color={color} />
        </View>
      ) : null}
    </View>
  );
}

// The laptop's drawing of the slides, asked for a moment after the text or choices stop changing. The last
// answer stays while a new one is drawn. drawSlides is null while the laptop isn't connected.
// The feed and the grid tile both show them, so one request per text and choices is shared (the latest only).
const asked = { key: '', promise: null };
function askLaptop(draw, key, body) {
  if (asked.key !== key) Object.assign(asked, { key, promise: draw(body) });
  return asked.promise;
}

function useLaptopSlides(drawSlides, text, styleId, backgroundId) {
  const [answer, setAnswer] = useState({ key: '', slides: null });
  const draw = useRef(drawSlides);
  draw.current = drawSlides;
  const key = JSON.stringify([text, styleId, backgroundId]);
  const online = Boolean(drawSlides);
  useEffect(() => {
    if (!online || !text.trim() || answer.key === key) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const { slides } = await askLaptop(draw.current, key, { text, style: styleId, background: backgroundId });
        if (live) setAnswer({ key, slides });
      } catch {
        // Unreachable or refused: the phone's own drawing stays on screen.
      }
    }, 600);
    return () => { live = false; clearTimeout(timer); };
  }, [online, key]);
  return online && answer.slides ? answer : null;
}

// A carousel you can open: the current slide big (tap it to open full width), and every slide small underneath.
// renderSlide(i, width) draws one slide. startOver: when it changes (a new slide style), back to the first slide.
export function Carousel({ count, renderSlide, width, children, startOver }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => { setIndex(0); }, [startOver]);
  const shown = Math.min(index, Math.max(0, count - 1));
  const openAt = (i) => { setIndex(i); setOpen(true); };
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.card}>
        <Pressable onPress={() => count && openAt(shown)} accessibilityRole="button" accessibilityLabel={`Open slide ${shown + 1} full width`}>
          {count ? renderSlide(shown, width) : <View style={{ width, height: width * RATIO, backgroundColor: '#222' }} />}
          {count > 1 ? <Text style={styles.corner}>{shown + 1}/{count}</Text> : null}
        </Pressable>
        {children}
      </View>
      {count > 1 ? (
        <View style={styles.strip}>
          {Array.from({ length: count }, (_, i) => (
            <Pressable key={i} onPress={() => openAt(i)} accessibilityRole="button" accessibilityLabel={`Open slide ${i + 1}`}
              style={[styles.thumb, i === shown && styles.thumbOn]}>
              {renderSlide(i, 52)}
            </Pressable>
          ))}
        </View>
      ) : null}
      {count > 1 ? <Text style={styles.hint}>Tap a slide to open it, then swipe.</Text> : null}
      {open ? <FullView count={count} start={shown} renderSlide={renderSlide} onIndex={setIndex} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

function FullView({ count, start, renderSlide, onIndex, onClose }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(start);
  const pageWidth = width;
  const slideWidth = width - 32;
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={styles.full}>
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button"><Text style={styles.closeText}>Close</Text></Pressable>
        <Text style={styles.fullCount}>{index + 1} of {count}</Text>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          contentOffset={{ x: start * pageWidth, y: 0 }}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
            setIndex(i);
            onIndex(i);
          }}
          style={{ flexGrow: 0 }}>
          {Array.from({ length: count }, (_, i) => (
            <View key={i} style={{ width: pageWidth, alignItems: 'center' }}>{renderSlide(i, slideWidth)}</View>
          ))}
        </ScrollView>
        <View style={styles.dots}>
          {Array.from({ length: count }, (_, i) => <View key={i} style={[styles.dot, i === index && styles.dotOn]} />)}
        </View>
      </View>
    </Modal>
  );
}

// A text-only post's slides in Instagram's feed card, with its caption underneath.
export function TextSlides({ text, styleId, backgroundId, drawSlides, width, caption, tile }) {
  const parts = splitSlides(text, styleId).slice(0, 10);
  const laptop = useLaptopSlides(drawSlides, text, styleId, backgroundId);
  const count = laptop ? laptop.slides.length : parts.length;
  const renderSlide = laptop
    ? (i, w) => <Image source={{ uri: laptop.slides[i] }} style={{ width: w, height: w * RATIO }} />
    : (i, w) => <DraftSlide text={parts[i]} index={i} count={parts.length} styleId={styleId} backgroundId={backgroundId} width={w} />;
  // The profile grid's tile: the first slide in a 3:4 frame, keeping its lower part (as the web page measured).
  if (tile) {
    return (
      <View style={{ width, height: (width * 4) / 3, overflow: 'hidden', borderRadius: 4, justifyContent: 'flex-end' }}>
        {count ? renderSlide(0, width) : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Carousel count={count} renderSlide={renderSlide} width={width} startOver={styleId}>{caption}</Carousel>
      {laptop ? null : <Text style={styles.hint}>Drawn on the phone; the laptop's slides may break lines a little differently. Connect to see them exactly.</Text>}
    </View>
  );
}

// ---- The pickers in Instagram's card ----

export function StylePicker({ f, value, background, editable, onChange }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{f.label}</Text>
      <View style={styles.styles}>
        {SLIDE_STYLES.map((s) => (
          <Pressable key={s.id} onPress={() => editable && onChange(s.id)} accessibilityRole="button" accessibilityState={{ selected: value === s.id }}
            style={[styles.styleCard, value === s.id && styles.picked]}>
            <StyleThumb styleId={s.id} backgroundId={background} />
            <Text style={styles.styleName}>{s.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function StyleThumb({ styleId, backgroundId }) {
  const style = slideStyle(styleId);
  const color = slideBackground(backgroundId).text;
  const bars = style.cover ? ['80%', '55%'] : ['80%', '70%', '76%', '44%'];
  return (
    <View style={styles.thumbBox}>
      <View style={StyleSheet.absoluteFill}><SlideBackground id={backgroundId} width={96} height={84} /></View>
      <View style={[styles.bars, { alignItems: style.align === 'center' ? 'center' : 'flex-start' }]}>
        {bars.map((w, i) => <View key={i} style={{ width: w, height: style.cover ? 8 : 3, borderRadius: 2, backgroundColor: color }} />)}
        {style.cover ? <View style={{ width: '30%', height: 3, borderRadius: 2, marginTop: 3, backgroundColor: color, opacity: 0.6 }} /> : null}
      </View>
    </View>
  );
}

export function BackgroundPicker({ f, value, editable, onChange }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{f.label} <Text style={styles.pickedName}>· {slideBackground(value).name}</Text></Text>
      <View style={styles.swatches}>
        {SLIDE_BACKGROUNDS.map((b) => (
          <Pressable key={b.id} onPress={() => editable && onChange(b.id)} accessibilityRole="button" accessibilityLabel={b.name}
            accessibilityState={{ selected: value === b.id }} style={[styles.swatch, value === b.id && styles.picked]}>
            <View style={{ borderRadius: 6, overflow: 'hidden' }}><SlideBackground id={b.id} width={38} height={48} /></View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  pickedName: { fontSize: 13, fontWeight: '600', color: colors.accent },
  hint: { fontSize: 12, color: colors.muted },
  styles: { flexDirection: 'row', gap: 8 },
  styleCard: { flex: 1, gap: 6, padding: 5, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  picked: { borderWidth: 2, borderColor: colors.accent },
  thumbBox: { height: 84, borderRadius: 6, overflow: 'hidden' },
  bars: { flex: 1, padding: 10, gap: 4, justifyContent: 'center' },
  styleName: { fontSize: 12, fontWeight: '500', color: colors.text },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // The ring sits a little away from the colour (padding), so it shows on light and dark backgrounds alike.
  swatch: { width: 48, height: 58, borderRadius: 9, padding: 3, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, alignSelf: 'flex-start' },
  corner: { position: 'absolute', right: 6, top: 6, backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, paddingHorizontal: 6, borderRadius: 8 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { borderRadius: 4, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: colors.accent },
  full: { flex: 1, backgroundColor: '#0b0a0f', justifyContent: 'center', gap: 16 },
  close: { position: 'absolute', top: 24, right: 16, minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  fullCount: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: '#fff' },
});
