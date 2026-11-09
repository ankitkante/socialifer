// Substack has no official posting API. This posts Notes the way substack.com's own composer does,
// with the user's session cookie, so it can break whenever Substack changes its site.
// Endpoints were taken from unofficial clients (see docs/platforms.md) and haven't been tested live.
import { request, env, hasEnv, ApiError, UPLOAD_TIMEOUT } from './http.js';
import { trimUrl } from './bluesky.js';
import { step } from '../log.js';

const ENV = ['SUBSTACK_SESSION_COOKIE'];
const API = 'https://substack.com/api/v1';

// Substack sits behind Cloudflare, which rejects Node's default User-Agent on some requests
// with "error code: 1010", so we present a browser's.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

// Accepts the bare cookie value or a pasted "substack.sid=..." pair.
const cookie = () => `substack.sid=${env('SUBSTACK_SESSION_COOKIE').replace(/^substack\.sid=/, '').replace(/;.*$/, '')}`;

const headers = () => ({
  Cookie: cookie(),
  'User-Agent': BROWSER_UA,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://substack.com',
  Referer: 'https://substack.com/notes',
});

async function call(path, body, options = {}) {
  try {
    const { data } = await request(`${API}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), ...options });
    return data;
  } catch (err) {
    const status = err.details?.status;
    if (status === 403 && /1010/.test(String(err.details?.data))) {
      throw new ApiError('Substack\'s firewall (Cloudflare) blocked the request. Try again later; if it keeps happening, Substack may have changed how its site works.', err.details);
    }
    if (status === 401 || status === 403) {
      throw new ApiError('Substack didn\'t accept your session cookie. Sign in at substack.com, copy a fresh substack.sid cookie into SUBSTACK_SESSION_COOKIE in .env, and restart the app.', err.details);
    }
    throw err;
  }
}

// One paragraph per line, as the composer does; a blank line is an empty paragraph.
// Links are sent as link marks so they stay clickable.
function paragraph(line) {
  if (!line.trim()) return { type: 'paragraph' };
  const content = [];
  let rest = line;
  for (const m of line.matchAll(/https?:\/\/\S+/g)) {
    const href = trimUrl(m[0]);
    const before = rest.slice(0, rest.indexOf(m[0]));
    if (before) content.push({ type: 'text', text: before });
    content.push({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] });
    rest = rest.slice(before.length + href.length);
  }
  if (rest) content.push({ type: 'text', text: rest });
  return { type: 'paragraph', content };
}

export function toNoteBody(text) {
  const lines = text.trim() ? text.trim().split(/\r?\n/) : [''];
  return { type: 'doc', attrs: { schemaVersion: 'v1' }, content: lines.map(paragraph) };
}

// Images go to Substack's CDN first, then become attachments the Note refers to by id.
async function attach(m) {
  step(`Uploading ${m.name}`);
  const image = `data:${m.type};base64,${(await m.buffer()).toString('base64')}`;
  const uploaded = await call('/image', { image }, { timeout: UPLOAD_TIMEOUT });
  if (!uploaded?.url) throw new ApiError(`Substack didn't return a link for ${m.name}, so it couldn't be attached.`);
  const attachment = await call('/comment/attachment', { url: uploaded.url, type: 'image' });
  // The endpoint answers null instead of an error for attachments it doesn't accept.
  if (!attachment?.id) throw new ApiError(`Substack wouldn't attach ${m.name}.`);
  return attachment.id;
}

export default {
  id: 'substack',
  name: 'Substack',
  // Not published by Substack; 10,000 characters and 6 images come from Buffer's and Substack's Notes help pages.
  limit: 10_000,
  // Videos can't be attached this way: the attachment endpoint returns null for type "video".
  media: { maxImages: 6, maxVideos: 0, maxItems: 6, mix: false, imageMB: null, videoMB: null },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    const attachmentIds = [];
    for (const m of media) attachmentIds.push(await attach(m));

    step('Publishing the Note');
    const note = await call('/comment/feed', {
      bodyJson: toNoteBody(text),
      tabId: 'for-you',
      surface: 'feed',
      replyMinimumRole: 'everyone',
      ...(attachmentIds.length && { attachmentIds }),
    });
    if (!note?.id) throw new ApiError('Substack didn\'t confirm the Note. Check your Notes on substack.com before posting again.');
    return { url: `https://substack.com/note/c-${note.id}` };
  },
};
