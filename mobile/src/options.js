// Per-platform options on a phone post: post.options[platformId] holds the FIELDS values from public/fields.js
// and, only when that platform's box was edited, its own text. Image fields hold a copied file like post.media.
import { FIELDS, fieldsOf, initialOf } from '../../public/fields.js';

// A new post's starting values: sticky fields as last used, the rest as FIELDS says.
export function defaultOptions(sticky = {}) {
  return Object.fromEntries(Object.keys(FIELDS).map((id) => [id, Object.fromEntries(fieldsOf(id).map((f) => [
    f.key, f.sticky && sticky[id]?.[f.key] !== undefined ? sticky[id][f.key] : initialOf(f),
  ]))]));
}

// Fills in fields a post saved by an older version of the app doesn't have yet.
export function withDefaults(options = {}, sticky = {}) {
  const merged = { ...options };
  for (const [id, values] of Object.entries(defaultOptions(sticky))) merged[id] = { ...values, ...(options[id] ?? {}) };
  return merged;
}

const metaOf = (media) => media.map(({ name, type, size, duration }) => ({ name, type, size, duration }));

// A platform's options as the rules see them (forSend false) or as the laptop gets them (forSend true):
// fields hidden for what's attached are dropped, as on the web page, and empty image fields are left out.
// When sending, imageFile(item) returns the { file: n } reference for an image field's file.
export function optionsFor(post, id, { imageFile } = {}) {
  const own = { ...(post.options?.[id] ?? {}) };
  const media = metaOf(post.media);
  for (const f of fieldsOf(id)) {
    if (f.when && !f.when({ media, values: own })) { delete own[f.key]; continue; }
    if (f.type === 'image') {
      if (!own[f.key]?.file) delete own[f.key];
      else if (imageFile) own[f.key] = imageFile(own[f.key]);
    }
  }
  return own;
}

// Every copied file an image field holds, e.g. for cleanup.
export const fieldImages = (post) => Object.entries(post.options ?? {}).flatMap(([id, own]) =>
  fieldsOf(id).filter((f) => f.type === 'image' && own?.[f.key]?.file).map((f) => own[f.key]));
