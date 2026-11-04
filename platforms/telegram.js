import { request, env, hasEnv, UPLOAD_TIMEOUT } from './http.js';
import { isVideo } from '../public/rules.js';

const ENV = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
const CAPTION_LIMIT = 1024;

const method = (name) => `https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${name}`;

async function send(name, fields, files = {}) {
  const body = new FormData();
  body.append('chat_id', env('TELEGRAM_CHAT_ID'));
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  for (const [k, m] of Object.entries(files)) body.append(k, await m.blob(), m.name);
  return (await request(method(name), { method: 'POST', body, timeout: UPLOAD_TIMEOUT })).data.result;
}

// Single files use the matching send method; GIFs go as animations so they keep moving.
function single(m, caption) {
  if (isVideo(m)) return send('sendVideo', { ...caption, supports_streaming: 'true' }, { video: m });
  if (m.type === 'image/gif') return send('sendAnimation', caption, { animation: m });
  return send('sendPhoto', caption, { photo: m });
}

function album(media, caption) {
  const files = Object.fromEntries(media.map((m, i) => [`file${i}`, m]));
  const items = media.map((m, i) => ({ type: isVideo(m) ? 'video' : 'photo', media: `attach://file${i}`, ...(i === 0 && caption) }));
  return send('sendMediaGroup', { media: JSON.stringify(items) }, files);
}

function link(message) {
  // Only public channels and groups have a shareable link.
  return message.chat.username ? `https://t.me/${message.chat.username}/${message.message_id}` : null;
}

export default {
  id: 'telegram',
  name: 'Telegram',
  limit: 4096,
  media: { maxImages: 10, maxVideos: 10, maxItems: 10, mix: true, imageMB: 10, videoMB: 50 },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    if (media.length === 0) return { url: link(await send('sendMessage', { text })) };

    // Captions are capped at 1024 characters; longer text is sent as its own message after the media.
    const fits = text.length <= CAPTION_LIMIT;
    const caption = text && fits ? { caption: text } : {};
    const result = media.length === 1 ? await single(media[0], caption) : await album(media, caption);
    if (text && !fits) await send('sendMessage', { text });
    return { url: link(Array.isArray(result) ? result[0] : result) };
  },
};
