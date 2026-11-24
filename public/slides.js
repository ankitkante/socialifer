// Text carousels for Instagram: a text-only post becomes slides (1080 × 1350 JPEGs drawn by the server, slides.js
// at the root). Shared by the web page, the server and the phone app: the styles, the backgrounds, and the CSS that
// draws a background on the page. Plain data plus pure functions, so all three can import it.

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
export const SLIDE_PADDING = 120;

// How each style lays out a slide, in pixels at full size. `budget` is how many characters a slide holds before
// the next sentence moves on (splitSlides in rules.js); the server shrinks the type if a slide still overflows.
export const SLIDE_STYLES = [
  { id: 'centred', name: 'Centred', budget: 160, size: 74, weight: 700, lineHeight: 1.4, align: 'center' },
  { id: 'arrow', name: 'Left, with arrow', budget: 220, size: 64, weight: 500, lineHeight: 1.5, align: 'left', arrow: true },
  // The first sentence alone, big, as the hook seen in the feed; the rest in regular text.
  { id: 'cover', name: 'Cover first', budget: 230, size: 61, weight: 500, lineHeight: 1.5, align: 'left',
    cover: { budget: 90, size: 115, weight: 800, lineHeight: 1.15 } },
];
export const slideStyle = (id) => SLIDE_STYLES.find((s) => s.id === id) ?? SLIDE_STYLES[0];

// rgba() with a new alpha, so gradients fade to the same colour, not to grey.
const fade = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
const glow = (x, y, rx, ry, hex, alpha) => ({ type: 'radial', x, y, rx, ry, stops: [[0, fade(hex, alpha)], [0.7, fade(hex, 0)]] });

// Each background: its text colour and its layers, bottom first. Positions and radii are fractions of the slide's
// width and height; sizes in px are at full size (1080 wide).
const STARS = [[0.02, 0.904, 2.8, 0.63], [0.531, 0.336, 3.9, 0.54], [0.677, 0.63, 2.9, 0.47], [0.7, 0.69, 5.4, 0.95],
  [0.677, 0.469, 4, 0.36], [0.513, 0.906, 3.7, 0.56], [0.896, 0.892, 3, 0.68], [0.339, 0.166, 3.2, 0.43], [0.92, 0.555, 4.2, 0.33],
  [0.283, 0.558, 3.2, 0.39], [0.893, 0.073, 3.1, 0.6], [0.907, 0.514, 5.4, 0.95], [0.409, 0.292, 3.2, 0.45], [0.53, 0.609, 4.2, 0.51],
  [0.848, 0.63, 3.4, 0.53], [0.681, 0.922, 3.8, 0.41], [0.583, 0.357, 3.1, 0.66], [0.862, 0.127, 2.5, 0.48], [0.167, 0.095, 2.8, 0.58],
  [0.158, 0.459, 2.6, 0.71], [0.869, 0.875, 4.2, 0.64], [0.284, 0.03, 2.5, 0.3], [0.612, 0.242, 3.3, 0.61], [0.249, 0.867, 3.1, 0.7]];

export const SLIDE_BACKGROUNDS = [
  { id: 'paper', name: 'Paper', text: '#1C1917', layers: [
    { type: 'radial', x: 0, y: 0, rx: 1.2, ry: 0.9, stops: [[0, '#FFFDF8'], [1, '#EFE7D8']] },
    { type: 'dots', spacing: 44, radius: 3.4, color: 'rgba(28, 25, 23, 0.10)' }] },
  { id: 'glow', name: 'Glow', text: '#18181B', layers: [
    { type: 'color', color: '#FFFFFF' }, glow(0, 1, 0.6, 0.5, '#38BDF8', 0.22), glow(1, 0, 0.7, 0.55, '#7C5CFF', 0.28)] },
  { id: 'midnight', name: 'Midnight', text: '#FFFFFF', layers: [
    { type: 'linear', angle: 180, stops: [[0, '#0B1230'], [1, '#050816']] },
    glow(0, 1, 0.6, 0.45, '#22C5EB', 0.2), glow(0.5, -0.1, 0.95, 0.6, '#5865F2', 0.6),
    { type: 'stars', stars: STARS }] },
  { id: 'sunset', name: 'Sunset', text: '#FFFFFF', layers: [
    { type: 'linear', angle: 150, stops: [[0, '#E8553E'], [0.55, '#B8306E'], [1, '#5B1E73']] }] },
  { id: 'ocean', name: 'Ocean', text: '#FFFFFF', layers: [
    { type: 'linear', angle: 160, stops: [[0, '#0B2F7A'], [1, '#0E6A8A']] }, glow(1, 1, 0.7, 0.6, '#2DD4BF', 0.45)] },
  { id: 'aurora', name: 'Aurora', text: '#FFFFFF', layers: [
    { type: 'color', color: '#0B1020' }, glow(0.5, 1, 0.6, 0.5, '#EC4899', 0.4),
    glow(0.85, 0.3, 0.55, 0.45, '#A855F7', 0.5), glow(0.15, 0.2, 0.55, 0.45, '#22D3EE', 0.45)] },
  { id: 'peach', name: 'Peach', text: '#1C1917', layers: [
    { type: 'color', color: '#FFF4EC' }, glow(0.9, 0.1, 0.5, 0.4, '#C4B5FD', 0.55),
    glow(0.9, 0.9, 0.6, 0.5, '#F4A6C8', 0.7), glow(0.1, 0.1, 0.6, 0.5, '#FFB794', 0.75)] },
  { id: 'mint', name: 'Mint', text: '#0F2A1F', layers: [
    { type: 'color', color: '#F2FBF6' }, glow(1, 1, 0.6, 0.55, '#7DD3FC', 0.6), glow(0, 0, 0.6, 0.5, '#86EFAC', 0.65)] },
  { id: 'forest', name: 'Forest', text: '#FFFFFF', layers: [
    { type: 'linear', angle: 165, stops: [[0, '#12432F'], [1, '#0A2419']] }, glow(1, 0, 0.7, 0.55, '#A3E635', 0.25)] },
  { id: 'ripple', name: 'Ripple', text: '#FFFFFF', layers: [
    { type: 'linear', angle: 160, stops: [[0, '#3A1450'], [1, '#1C0A2A']] }, glow(1, 1, 0.75, 0.6, '#F472B6', 0.38),
    { type: 'rings', x: 1, y: 1, spacing: 74, width: 3.4, color: 'rgba(255, 255, 255, 0.08)' }] },
  { id: 'lemon', name: 'Lemon', text: '#1C1917', layers: [
    { type: 'linear', angle: 150, stops: [[0, '#FFF1A6'], [0.5, '#FFD36B'], [1, '#FFAE5C']] }] },
  { id: 'ink', name: 'Ink', text: '#FFFFFF', layers: [
    { type: 'linear', angle: 180, stops: [[0, '#1A1A1D'], [1, '#0B0B0C']] },
    { type: 'dots', spacing: 54, radius: 3.4, color: 'rgba(255, 255, 255, 0.12)' }] },
];
export const slideBackground = (id) => SLIDE_BACKGROUNDS.find((b) => b.id === id) ?? SLIDE_BACKGROUNDS[0];

const pct = (n) => `${+(n * 100).toFixed(2)}%`;
const stopList = (stops) => stops.map(([at, color]) => `${color} ${pct(at)}`).join(', ');

// The background as CSS for an element `width` px wide (swatches, the style cards): { background, backgroundSize }.
export function backgroundCss(id, width = SLIDE_WIDTH) {
  const scale = width / SLIDE_WIDTH;
  const px = (n) => `${+(n * scale).toFixed(2)}px`;
  const layers = [];
  for (const l of slideBackground(id).layers) {
    if (l.type === 'color') layers.push([l.color, 'auto']);
    else if (l.type === 'linear') layers.push([`linear-gradient(${l.angle}deg, ${stopList(l.stops)})`, 'auto']);
    else if (l.type === 'radial') layers.push([`radial-gradient(${pct(l.rx)} ${pct(l.ry)} at ${pct(l.x)} ${pct(l.y)}, ${stopList(l.stops)})`, 'auto']);
    else if (l.type === 'dots') {
      layers.push([`radial-gradient(circle, ${l.color} ${px(l.radius)}, transparent ${px(l.radius * 1.5)})`, `${px(l.spacing)} ${px(l.spacing)}`]);
    } else if (l.type === 'rings') {
      layers.push([`repeating-radial-gradient(circle at ${pct(l.x)} ${pct(l.y)}, ${l.color} 0px, ${l.color} ${px(l.width)}, transparent ${px(l.width * 1.5)}, transparent ${px(l.spacing)})`, 'auto']);
    } else if (l.type === 'stars') {
      for (const [x, y, r, a] of l.stars) layers.push([`radial-gradient(circle ${px(r)} at ${pct(x)} ${pct(y)}, rgba(255, 255, 255, ${a}) 0%, transparent 100%)`, 'auto']);
    }
  }
  // CSS lists the top layer first; a plain colour can only be the last.
  layers.reverse();
  const plain = layers.length && !layers[layers.length - 1][0].includes('(') ? layers.pop()[0] : '';
  return {
    background: [...layers.map(([image]) => image), plain].filter(Boolean).join(', '),
    backgroundSize: layers.map(([, size]) => size).join(', ') || 'auto',
  };
}
