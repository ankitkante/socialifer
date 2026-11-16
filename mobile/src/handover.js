// Hands ready posts to the laptop and collects their results. A post on the phone goes:
// draft → ready (Post tapped) → sending (files going over) → handed (on the laptop) → done (results back).
// The laptop's queue is keyed by sendId, made fresh each time Post is tapped: a hand-over cut off halfway carries
// on next time, and a post fixed after the laptop refused it isn't mistaken for the old version.
import { call, uploadFile } from './laptop';
import { listPosts, savePost, mediaFile } from './store';

// The laptop's own record goes once the results are saved here; posts it no longer has get this instead.
const LOST = "The laptop no longer has this post, so it's unknown whether it went out. Check the platforms before posting it again.";

let busy = false;

// Returns { [postId]: steps } for posts being posted right now, for the live status line.
// skipId: the post open on screen, which waits so a hand-over never races an edit.
export async function handOver(pairing, onChange, skipId) {
  if (busy) return null;
  busy = true;
  try {
    for (const post of listPosts().filter((p) => (p.state === 'ready' || p.state === 'sending') && p.id !== skipId)) {
      await send(pairing, post, onChange);
    }
    return await collect(pairing, onChange);
  } finally {
    busy = false;
  }
}

async function send(pairing, post, onChange) {
  const update = (changes) => {
    Object.assign(post, changes);
    savePost(post);
    onChange();
  };
  update({ state: 'sending', sent: 0, error: null });
  try {
    const summary = await call(pairing, 'PUT', `/app/posts/${post.sendId}`, {
      json: {
        text: post.text,
        platforms: post.platforms,
        options: post.options ?? {},
        files: post.media.map(({ name, type, size, duration }) => ({ name, type, size, duration })),
        media: post.media.map((_, n) => n),
      },
    });
    for (const n of summary.missing ?? []) {
      const item = post.media[n];
      await uploadFile(pairing, `/app/posts/${post.sendId}/files/${n}`, mediaFile(post, item), item.type);
      update({ sent: post.media.length - summary.missing.length + summary.missing.indexOf(n) + 1 });
    }
    if (summary.state === 'receiving') await call(pairing, 'POST', `/app/posts/${post.sendId}/ready`);
    update({ state: 'handed', handedAt: Date.now() });
  } catch (err) {
    // A post the laptop refuses (400, 413) goes back to draft to be fixed; anything else (no Wi-Fi, pairing,
    // a server error) leaves it to be sent again on the next check.
    const rejected = err.status === 400 || err.status === 413;
    update({ state: rejected ? 'draft' : 'sending', error: err.message });
    if (!rejected) throw err;
  }
}

async function collect(pairing, onChange) {
  const handed = listPosts().filter((p) => p.state === 'handed');
  if (!handed.length) return {};
  const statuses = await call(pairing, 'GET', `/app/posts?ids=${handed.map((p) => p.sendId).join(',')}`);
  const live = {};
  for (const s of statuses) {
    const post = handed.find((p) => p.sendId === s.id);
    if (s.state === 'done' || s.state === 'unknown') {
      savePost({ ...post, state: 'done', results: s.results, finishedAt: Date.now() });
      onChange();
      // Only once the results are safe here; if this fails, the next check collects them again.
      await call(pairing, 'DELETE', `/app/posts/${post.sendId}`).catch(() => {});
    } else if (s.state === 'missing') {
      savePost({ ...post, state: 'done', results: post.platforms.map((id) => ({ id, name: id, ok: false, error: LOST })) });
      onChange();
    } else {
      live[post.id] = { state: s.state, steps: s.steps };
    }
  }
  return live;
}
