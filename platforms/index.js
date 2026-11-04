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

// Each platform exports:
//   { id, name, limit, media: rules (see public/rules.js), title?, textForbids?, envVars, isConfigured(),
//     post(text, media, options) -> { url } }
export const platforms = [x, bluesky, mastodon, threads, instagram, youtube, linkedin, facebook, telegram, discord];
