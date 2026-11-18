// Hands ready posts to the laptop and collects their results. A post on the phone goes:
// draft → ready (Post tapped) → sending (files going over) → handed (on the laptop) → done (results back).
// The laptop's queue is keyed by sendId, made fresh each time Post is tapped: a hand-over cut off halfway carries
// on next time, and a post fixed after the laptop refused it isn't mistaken for the old version.
import { call, uploadFile } from './laptop';
import { listPosts, readPost, savePost, mediaFile } from './store';
import { optionsFor } from './options';
import { log, short } from './log';

// The laptop's own record goes once the results are saved here; posts it no longer has get this instead.
const LOST = "The laptop no longer has this post: it was cancelled there, or lost. Check the platforms before posting it again.";

let busy = false;

// Returns { [postId]: steps } for posts being posted right now, for the live status line.
// skipId: the post open on screen, which waits so a hand-over never races an edit.
export async function handOver(pairing, onChange, skipId) {
  if (busy) return null;
  busy = true;
  try {
    for (const { id } of listPosts().filter((p) => (p.state === 'ready' || p.state === 'sending') && p.id !== skipId)) {
      // Read again just before sending: a ready post may have been deleted while the posts before it went.
      const post = readPost(id);
      if (post && (post.state === 'ready' || post.state === 'sending')) await send(pairing, post, onChange);
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
  const name = `Post ${short(post.sendId)}`;
  if (post.state === 'ready') log(`${name}: sending to the laptop (${post.platforms.join(', ')})`);
  update({ state: 'sending', sent: 0, error: null });
  try {
    // The post's photos and videos come first; thumbnail and cover images follow, referred to as { file: n }.
    const files = [...post.media];
    const imageFile = (item) => {
      files.push(item);
      return { file: files.length - 1 };
    };
    const options = Object.fromEntries(post.platforms.map((id) => [id, optionsFor(post, id, { imageFile })]));
    const summary = await call(pairing, 'PUT', `/app/posts/${post.sendId}`, {
      json: {
        text: post.text,
        platforms: post.platforms,
        options,
        files: files.map(({ name, type, size, duration }) => ({ name, type, size, duration: duration ?? null })),
        media: post.media.map((_, n) => n),
        // The laptop works out the next free time when the post is ready there; a picked time is kept.
        when: post.when?.mode === 'picked' ? 'picked' : 'auto',
        ...(post.when?.mode === 'picked' && { at: post.when.at }),
      },
    });
    if (summary.missing?.length) log(`${name}: sending ${summary.missing.length} of ${files.length} files`);
    for (const n of summary.missing ?? []) {
      const item = files[n];
      await uploadFile(pairing, `/app/posts/${post.sendId}/files/${n}`, mediaFile(post, item), item.type);
      log(`${name}: sent ${item.name} (${(item.size / 1_000_000).toFixed(1)} MB)`);
      update({ sent: files.length - summary.missing.length + summary.missing.indexOf(n) + 1, files: files.length });
    }
    const queued = summary.state === 'receiving' ? await call(pairing, 'POST', `/app/posts/${post.sendId}/ready`) : summary;
    update({ state: 'handed', handedAt: Date.now(), retryError: null, at: queued.at ?? null, moved: queued.moved ?? null });
    log(`${name}: on the laptop${queued.at > Date.now() ? `, going out ${new Date(queued.at).toLocaleString()}` : ', going out now'}`);
  } catch (err) {
    // A post the laptop refuses (400, 413) goes back to draft to be fixed; anything else (no Wi-Fi, pairing,
    // a server error) leaves it to be sent again on the next check, with the error shown on the post.
    const rejected = err.status === 400 || err.status === 413;
    if (rejected) {
      update({ state: 'draft', error: err.message, retryError: null });
      log(`${name}: the laptop refused it (${err.status}): ${err.message}. Back to draft.`);
    } else {
      // The same error every 5 seconds would fill the log; record it only when it changes.
      if (post.retryError !== err.message) log(`${name}: hand-over failed${err.status ? ` (${err.status})` : ''}: ${err.message}. Will try again.`);
      update({ state: 'sending', retryError: err.message });
      throw err;
    }
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
      log(`Post ${short(post.sendId)}: ${s.state === 'unknown' ? 'unknown, the laptop stopped while posting' : 'finished'}. ${s.results.map((r) => `${r.name}: ${r.ok ? (r.url ?? 'posted') : r.error}`).join(' | ')}`);
      for (const r of s.results) for (const w of r.warnings ?? []) log(`Post ${short(post.sendId)}: ${r.name} warning: ${w}`);
      // Only once the results are safe here; if this fails, the next check collects them again.
      await call(pairing, 'DELETE', `/app/posts/${post.sendId}`).catch(() => {});
    } else if (s.state === 'missing') {
      savePost({ ...post, state: 'done', results: post.platforms.map((id) => ({ id, name: id, ok: false, error: LOST })) });
      onChange();
      log(`Post ${short(post.sendId)}: the laptop no longer has it; marked unknown.`);
    } else {
      if (s.state === 'posting' && post.loggedPosting !== true) {
        log(`Post ${short(post.sendId)}: the laptop is posting it`);
        savePost({ ...post, loggedPosting: true });
      } else if (s.state === 'waiting' && (s.at !== post.at || (s.text ?? '') !== post.text.trim())) {
        // Moved or edited on the laptop (or from Calendar), or moved because the laptop was off.
        savePost({ ...post, at: s.at ?? null, moved: s.moved ?? null, text: s.text ?? post.text, when: s.when === 'picked' ? { mode: 'picked', at: s.at } : post.when });
        onChange();
      }
      live[post.id] = { state: s.state, steps: s.steps };
    }
  }
  return live;
}
