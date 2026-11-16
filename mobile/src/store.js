// Posts and settings kept on the phone, in the app's document folder (never cleared by Android):
// posts/<id>/post.json with the post's files beside it, platforms.json (the laptop's last platform list,
// so writing works offline) and settings.json (the platforms last chosen).
import { Directory, File, Paths } from 'expo-file-system';
import { bytesToHex } from '@noble/hashes/utils.js';
import { getRandomBytes } from 'expo-crypto';
import { fieldImages } from './options';

// What the laptop accepts (EXTENSIONS in ../../media.js, without SRT).
export const ACCEPTED = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
};
const TYPE_BY_EXTENSION = Object.fromEntries(Object.entries(ACCEPTED).map(([type, ext]) => [ext, type]));
TYPE_BY_EXTENSION.jpeg = 'image/jpeg';

const postsDir = () => new Directory(Paths.document, 'posts');
const postDir = (id) => new Directory(postsDir(), id);

// The same 32-hex id the laptop's queue expects; it also stops a resend from posting twice.
export const newId = () => bytesToHex(getRandomBytes(16));

function readJson(file, fallback) {
  try {
    return file.exists ? JSON.parse(file.textSync()) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  file.writeSync(JSON.stringify(value));
}

export function listPosts() {
  const dir = postsDir();
  if (!dir.exists) return [];
  return dir.list()
    .filter((entry) => entry instanceof Directory)
    .map((entry) => readJson(new File(entry, 'post.json'), null))
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function savePost(post) {
  const dir = postDir(post.id);
  if (!dir.exists) dir.create({ intermediates: true });
  writeJson(new File(dir, 'post.json'), { ...post, updatedAt: Date.now() });
}

export function deletePost(id) {
  const dir = postDir(id);
  if (dir.exists) dir.delete();
}

export const mediaFile = (post, item) => new File(postDir(post.id), item.file);

// Copies a picked photo or video into the post's folder, so it survives being deleted from the gallery.
// Returns the item, or { problem } when the laptop wouldn't accept the file.
export async function addMedia(post, asset) {
  const ext = (asset.fileName ?? asset.uri).split('.').pop().toLowerCase();
  const type = asset.mimeType && ACCEPTED[asset.mimeType] ? asset.mimeType : TYPE_BY_EXTENSION[ext];
  const name = asset.fileName || `${asset.type === 'video' ? 'video' : 'photo'}.${ext}`;
  if (!type) return { problem: `${name} isn't supported. Use JPEG, PNG, GIF, WebP, MP4 or MOV.` };
  const dir = postDir(post.id);
  if (!dir.exists) dir.create({ intermediates: true });
  const file = `${newId()}.${ACCEPTED[type]}`;
  const target = new File(dir, file);
  await new File(asset.uri).copy(target);
  return {
    file,
    name,
    type,
    size: target.size,
    duration: asset.duration ? asset.duration / 1000 : null,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

// A week after a post went out on every platform, its photo and video copies go to free space. The post itself
// (text, links, results) stays until deleted by hand. Posts with a failed platform keep theirs, to be fixed.
const MEDIA_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export function pruneOldMedia() {
  for (const post of listPosts()) {
    const allPosted = post.state === 'done' && post.results?.length && post.results.every((r) => r.ok);
    if (!allPosted || post.mediaRemoved || !post.media.length || Date.now() - (post.finishedAt ?? 0) < MEDIA_KEEP_MS) continue;
    for (const item of [...post.media, ...fieldImages(post)]) removeMedia(post, item);
    savePost({ ...post, mediaRemoved: true });
  }
}

export function removeMedia(post, item) {
  const file = mediaFile(post, item);
  if (file.exists) file.delete();
}

const platformsFile = () => new File(Paths.document, 'platforms.json');
export const loadPlatforms = () => readJson(platformsFile(), []);
export const savePlatforms = (platforms) => writeJson(platformsFile(), platforms);

const settingsFile = () => new File(Paths.document, 'settings.json');
export const loadSettings = () => readJson(settingsFile(), { selected: [] });
export const saveSettings = (settings) => writeJson(settingsFile(), settings);
