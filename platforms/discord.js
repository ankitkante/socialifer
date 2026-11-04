import { request, env, hasEnv, UPLOAD_TIMEOUT } from './http.js';

const ENV = ['DISCORD_WEBHOOK_URL'];

export default {
  id: 'discord',
  name: 'Discord',
  limit: 2000,
  // Discord's default upload limit is 10 MB per file; boosted servers allow more.
  media: { maxImages: 10, maxVideos: 10, maxItems: 10, mix: true, imageMB: 10, videoMB: 10 },
  envVars: ENV,
  isConfigured: () => hasEnv(...ENV),
  async post(text, media) {
    const webhook = new URL(env('DISCORD_WEBHOOK_URL'));
    webhook.searchParams.set('wait', 'true');

    const body = new FormData();
    body.append('payload_json', JSON.stringify({ content: text }));
    for (const [i, m] of media.entries()) body.append(`files[${i}]`, await m.blob(), m.name);

    const { data } = await request(webhook, { method: 'POST', body, timeout: UPLOAD_TIMEOUT });
    const guildId = env('DISCORD_GUILD_ID');
    return { url: guildId ? `https://discord.com/channels/${guildId}/${data.channel_id}/${data.id}` : null };
  },
};
