import x from './x.js';
import bluesky from './bluesky.js';
import mastodon from './mastodon.js';
import threads from './threads.js';
import instagram from './instagram.js';
import linkedin from './linkedin.js';
import facebook from './facebook.js';
import telegram from './telegram.js';
import discord from './discord.js';
import youtube from './youtube.js';
import substack from './substack.js';

// Each platform exports:
//   { id, name, limit, media: rules (see public/rules.js), title?, textForbids?, envVars, isConfigured(),
//     post(text, media, options) -> { url } }
// Display order on the page: the user's main platforms first.
export const platforms = [x, youtube, instagram, substack, linkedin, discord, facebook, bluesky, mastodon, threads, telegram];
