// Draws a text-only post's slides as JPEGs, for Instagram and for the previews (public/slides.js has the styles,
// the backgrounds and the splitting rules). @napi-rs/canvas was chosen over sharp on 2026-11-24: it loads the
// bundled WOFF2 fonts and joins Hindi letters correctly; sharp ignored the fonts.
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { SLIDE_WIDTH, SLIDE_HEIGHT, SLIDE_PADDING, slideStyle, slideBackground } from './public/slides.js';
import { splitSlides } from './public/rules.js';
import { saveFile, getMedia } from './media.js';

// Inter comes in two files split by character range, so each gets its own name and both are listed; Hindi
// falls through to Noto Sans Devanagari.
const font = (name) => fileURLToPath(new URL(`./public/fonts/${name}`, import.meta.url));
GlobalFonts.registerFromPath(font('inter-latin.woff2'), 'Inter');
GlobalFonts.registerFromPath(font('inter-latin-ext.woff2'), 'Inter Ext');
GlobalFonts.registerFromPath(font('noto-sans-devanagari.woff2'), 'Noto Sans Devanagari');
const FAMILY = 'Inter, "Inter Ext", "Noto Sans Devanagari"';

// A CSS gradient angle (0deg points up, clockwise) as canvas start and end points, the way CSS sizes the line.
function linearPoints(angle, w, h) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return [w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half];
}

function paintBackground(ctx, id, w, h) {
  const scale = w / SLIDE_WIDTH;
  for (const l of slideBackground(id).layers) {
    ctx.save();
    if (l.type === 'color') {
      ctx.fillStyle = l.color;
      ctx.fillRect(0, 0, w, h);
    } else if (l.type === 'linear') {
      const g = ctx.createLinearGradient(...linearPoints(l.angle, w, h));
      for (const [at, color] of l.stops) g.addColorStop(at, color);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else if (l.type === 'radial') {
      // An ellipse: a unit circle stretched to rx × ry of the slide. The last colour carries on beyond it, as in CSS.
      ctx.translate(l.x * w, l.y * h);
      ctx.scale(l.rx * w, l.ry * h);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (const [at, color] of l.stops) g.addColorStop(at, color);
      ctx.fillStyle = g;
      const reach = 2 / Math.min(l.rx, l.ry) + 2;
      ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
    } else if (l.type === 'dots') {
      const step = l.spacing * scale;
      ctx.fillStyle = l.color;
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, l.radius * scale * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (l.type === 'rings') {
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width * scale;
      const step = l.spacing * scale;
      const far = Math.hypot(w, h);
      for (let r = step; r < far; r += step) {
        ctx.beginPath();
        ctx.arc(l.x * w, l.y * h, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (l.type === 'stars') {
      for (const [x, y, r, a] of l.stars) {
        const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * scale);
        g.addColorStop(0, `rgba(255, 255, 255, ${a})`);
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x * w - r * scale, y * h - r * scale, r * scale * 2, r * scale * 2);
      }
    }
    ctx.restore();
  }
}

// Breaks text into lines that fit `width` at the context's current font, at spaces. Line breaks in the text are
// kept, and an empty line (between paragraphs) is '' (drawn half height).
function wrap(ctx, text, width) {
  const lines = [];
  for (const part of text.split('\n')) {
    if (!part.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of part.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const GAP = 0.5; // an empty line's height, in lines
const heightOf = (lines, lineHeight) => lines.reduce((sum, line) => sum + (line ? lineHeight : lineHeight * GAP), 0);

// The largest size, up to the style's own, at which the text fits in `height`.
function fit(ctx, text, type, width, height, scale) {
  let size = type.size * scale;
  for (;;) {
    ctx.font = `${type.weight} ${size}px ${FAMILY}`;
    const lines = wrap(ctx, text, width);
    if (heightOf(lines, size * type.lineHeight) <= height || size < 20 * scale) return { size, lines };
    size *= 0.94;
  }
}

function arrow(ctx, x, y, length, color, lineWidth) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + length, y);
  ctx.moveTo(x + length * 0.65, y - length * 0.32);
  ctx.lineTo(x + length, y);
  ctx.lineTo(x + length * 0.65, y + length * 0.32);
  ctx.stroke();
  ctx.restore();
}

// One slide. index and count place the arrow (not on the last slide) and the cover (the first, in that style).
function drawSlide(text, index, count, styleId, backgroundId, w) {
  const h = Math.round((w * SLIDE_HEIGHT) / SLIDE_WIDTH);
  const scale = w / SLIDE_WIDTH;
  const style = slideStyle(styleId);
  const color = slideBackground(backgroundId).text;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  paintBackground(ctx, backgroundId, w, h);

  const pad = SLIDE_PADDING * scale;
  const isCover = Boolean(style.cover) && index === 0;
  const type = isCover ? { ...style, ...style.cover } : style;
  const footer = isCover || style.arrow ? 90 * scale : 0; // room for "Swipe" or the arrow
  const { size, lines } = fit(ctx, text, type, w - pad * 2, h - pad * 2 - footer, scale);
  const lineHeight = size * type.lineHeight;
  const blockHeight = heightOf(lines, lineHeight) + (isCover && count > 1 ? footer : 0);
  let y = (h - blockHeight) / 2 + lineHeight / 2;

  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = type.align === 'center' ? 'center' : 'left';
  const x = type.align === 'center' ? w / 2 : pad;
  for (const line of lines) {
    if (!line) { y += lineHeight * GAP; continue; }
    ctx.fillText(line, x, y);
    y += lineHeight;
  }

  ctx.globalAlpha = 0.75;
  if (isCover && count > 1) {
    ctx.font = `500 ${40 * scale}px ${FAMILY}`;
    ctx.textAlign = 'left';
    const swipeY = y - lineHeight / 2 + footer * 0.7;
    ctx.fillText('Swipe', pad, swipeY);
    arrow(ctx, pad + ctx.measureText('Swipe').width + 22 * scale, swipeY, 54 * scale, color, 5 * scale);
  } else if (style.arrow && index < count - 1) {
    arrow(ctx, w - pad - 74 * scale, h - pad + 10 * scale, 74 * scale, color, 6 * scale);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

// The JPEG of each slide of `text`. width: 1080 to post; smaller for previews. max: draw only the first few.
export async function renderSlides(text, styleId, backgroundId, { width = SLIDE_WIDTH, quality = 90, max = Infinity } = {}) {
  const parts = splitSlides(text, styleId);
  return Promise.all(parts.slice(0, max).map((part, i) => drawSlide(part, i, parts.length, styleId, backgroundId, width).encode('jpeg', quality)));
}

// Half-size slides as data: URLs, for the page's and the phone's previews. Past Instagram's 10 there's nothing to
// show (the post is blocked), so at most 10 are drawn.
export async function previewSlides(text, styleId, backgroundId) {
  const images = await renderSlides(text, styleId, backgroundId, { width: SLIDE_WIDTH / 2, quality: 82, max: 10 });
  return images.map((jpeg) => `data:image/jpeg;base64,${jpeg.toString('base64')}`);
}

// The slides saved as uploads, so they get public /media/ links like any attached image. Each slide's text is
// its alt text, for screen readers. The 24-hour cleanup removes them.
export async function slideMedia(text, styleId, backgroundId) {
  const parts = splitSlides(text, styleId);
  const images = await renderSlides(text, styleId, backgroundId);
  return Promise.all(images.map(async (jpeg, i) => {
    const saved = await saveFile(jpeg, 'image/jpeg', `slide-${i + 1}.jpg`);
    return { ...(await getMedia(saved.id)), altText: parts[i] };
  }));
}
