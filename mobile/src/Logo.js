// Platform logos, drawn from the web page's own files in ../public/icons (Simple Icons: one path on a 24×24 grid).
import Svg, { Path } from 'react-native-svg';
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
