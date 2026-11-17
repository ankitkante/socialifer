// Platform logos, drawn from the web page's own files in ../public/icons (Simple Icons: one path on a 24×24 grid).
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import bluesky from '../../public/icons/bluesky.svg';
import discord from '../../public/icons/discord.svg';
import facebook from '../../public/icons/facebook.svg';
import instagram from '../../public/icons/instagram.svg';
import linkedin from '../../public/icons/linkedin.svg';
import mastodon from '../../public/icons/mastodon.svg';
import telegram from '../../public/icons/telegram.svg';
import threads from '../../public/icons/threads.svg';
import x from '../../public/icons/x.svg';
import youtube from '../../public/icons/youtube.svg';
import { colors } from './ui';

const pathOf = (svg) => svg.match(/<path[^>]*\sd="([^"]+)"/)[1];
const PATHS = Object.fromEntries(Object.entries({
  bluesky, discord, facebook, instagram, linkedin, mastodon, telegram, threads, x, youtube,
}).map(([id, svg]) => [id, pathOf(svg)]));

// The same as BRAND_COLORS in public/js/dom.js (which can't be imported here: it's page code). X and Threads are black, so they use the text colour.
const BRAND_COLORS = {
  youtube: '#FF0000', instagram: '#E4405F', linkedin: '#0A66C2', discord: '#5865F2',
  facebook: '#0866FF', bluesky: '#0285FF', mastodon: '#6364FF', telegram: '#26A5E4',
};
export const brandColor = (id) => BRAND_COLORS[id] ?? colors.text;

// color overrides the brand colour, e.g. grey for a platform that isn't chosen. name is read out by TalkBack.
export default function Logo({ id, name, size = 20, color }) {
  const d = PATHS[id];
  if (!d) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={Boolean(name)} accessibilityLabel={name}>
      <Path d={d} fill={color ?? brandColor(id)} />
    </Svg>
  );
}

// Socialifer's mark: the white Ring of fire on a plum rounded square, as in socialifer.com's header and the favicon (brand/).
const SPARKS = 'M33.5 23.3L36.8 23.6M32.8 26.1L37.9 28.2M33.2 27.7L41 32.5M32.1 30.5L39.7 38.8M30.2 31L36.2 40.1M28.4 32.1L30.9 39.1M25.7 33.7L25.9 42.1M23.6 33.6L21.9 41.9M22 33L20.5 36.9M20.6 32.5L16.2 40M17.9 30.7L11.4 35.9M16.7 30.6L6.4 37.3M14.8 28.4L8.1 30.3M14.4 26.3L4.6 27.1M13.5 23.8L7.3 22.7M14.8 21.6L7.2 18.4M14.9 20L12.1 18.2M17 17.6L12.3 11.5M18 17L12 7.3M20 15.3L16.8 3.6M22.2 13.9L22 4.8M23.8 14.5L25.1 4.6M25.7 13.9L26.9 10.3M28.7 14.9L33.6 8.3M29.6 16.6L31.9 14.5M31.4 18.4L39.7 14M32.2 20.1L41.9 17.2M34.1 22.3L40.8 22.2';
export function BrandMark({ size = 28 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}>
      <Rect width={48} height={48} rx={10} fill="#5b4a8b" />
      <G transform="translate(5.25 5.25) scale(0.78125)" fill="none" stroke="#ffffff" strokeLinecap="round">
        <Circle cx={24} cy={24} r={6.5} strokeWidth={4} />
        <Path d={SPARKS} strokeWidth={1.9} />
      </G>
    </Svg>
  );
}
