// Writing a post: text, platforms, photos and videos, with the same checks as the web page (public/rules.js).
// Every change is saved on the phone as a draft; Post marks it ready to go to the laptop.
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { problemsFor, adjustmentsFor, formatDuration, postKind } from '../../public/rules.js';
import { addMedia, canDeleteState, copyPost, deleteByHand, deletePost, loadSettings, mediaFile, newId, removeMedia, savePost, saveSettings } from './store';
import Finished from './Finished';
import { optionsFor, withDefaults } from './options';
import PlatformCard from './Fields';
import { log, short } from './log';
import { Button, Screen, colors, Text, TextInput, useToast } from './ui';
import Logo, { brandColor } from './Logo';
import When, { takenSlots, whenChoice, whenLabel } from './When';

const metaOf = (media) => media.map(({ name, type, size, duration }) => ({ name, type, size, duration }));

// onPosted: Post was tapped (closes the post, then the Substack reminder opens); onOpen: shows another post, e.g. the copy made by Send again.
// schedule: the laptop's posts as last seen, plus this phone's not yet sent, for When's next free time and warnings.
// Two steps, as on the web page: Write (text, files, where to post), then Review (each platform, previews, When).
// onAct(post, 'cancel' | 'delete'): Cancel or Delete on the laptop, for a post it has (needs a connection).
export default function Compose({ initial, platforms, settings, schedule, connected, onAct, onClose, onPosted, onOpen }) {
  const [step, setStep] = useState('write');
  // Posts saved before per-platform settings existed get the default values.
  const [post, setPost] = useState(() => ({ ...initial, options: withDefaults(initial.options, settings.sticky) }));
  const [notice, setNotice] = useState('');
  const [deleteNote, setDeleteNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const editable = post.state === 'draft' || post.state === 'ready';
  const isEmpty = !post.text.trim() && post.media.length === 0;

  // Saved on every change, so nothing is lost if Android closes the app. An empty new post isn't kept.
  useEffect(() => {
    if (!editable) return;
    if (isEmpty) deletePost(post.id);
    else savePost(post);
  }, [post]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  // Any edit to a ready post makes it a draft again, so a half-finished change never goes to the laptop.
  const change = (changes) => setPost((p) => ({ ...p, ...changes, state: 'draft', error: null }));

  // Only platforms set up on the laptop are offered (decided 2026-11-19). One a post already has that isn't set up
  // (taken out of .env since) stays on it, flagged, and blocks Post until it's removed or set up.
  const usable = platforms.filter((p) => p.configured);
  const targets = usable.filter((p) => post.platforms.includes(p.id));
  const unset = post.platforms.filter((id) => !usable.some((p) => p.id === id));
  const nameOf = (id) => platforms.find((p) => p.id === id)?.name ?? id;
  const media = metaOf(post.media);
  const checks = useMemo(() => targets.map((p) => {
    const own = optionsFor(post, p.id);
    return {
      p,
      problems: isEmpty ? [] : problemsFor(p, post.text, media, own),
      notes: adjustmentsFor(p, media, own, post.text),
    };
  }), [post, platforms]);
  const issues = checks.reduce((n, c) => n + c.problems.length, 0);
  const kind = postKind(media);
  // Leaves this post out: once Post is tapped it's in the schedule too, as a phone post not yet sent.
  const taken = takenSlots(schedule, post.id);
  const choice = whenChoice(kind, taken, post.when, post.platforms);
  // The Write step only needs a post and somewhere to send it; issues are fixed on Review, where the settings are.
  const writeReason = platforms.length === 0 ? 'Pair once to choose platforms'
    : unset.length ? `${unset.map(nameOf).join(', ')} ${unset.length > 1 ? "aren't" : "isn't"} set up on your laptop`
    : targets.length === 0 ? 'Select at least one platform'
    : isEmpty ? 'Write something, or add a photo or video'
    : '';
  const reason = writeReason
    || (issues ? `Fix ${issues} issue${issues > 1 ? 's' : ''} first` : '')
    || (choice.blocked ?? '');
  // Red for an error (something to fix), grey for a plain next step (decided 2026-11-19).
  const isError = (text) => Boolean(text) && !['Select at least one platform', 'Write something, or add a photo or video', 'Choose a day and a time'].includes(text);
  const review = step === 'review' || !editable;
  const postNow = targets.length > 1 ? `Post to ${targets.length} platforms` : targets.length ? `Post to ${targets[0].name}` : 'Post';

  const toggle = (id) => {
    const next = post.platforms.includes(id) ? post.platforms.filter((x) => x !== id) : [...post.platforms, id];
    change({ platforms: next });
  };

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, orderedSelection: true, quality: 1,
    });
    if (result.canceled) return;
    const added = [];
    const problems = [];
    for (const asset of result.assets) {
      const item = await addMedia(post, asset);
      if (item.problem) problems.push(item.problem);
      else added.push(item);
    }
    setNotice(problems.join(' '));
    if (added.length) change({ media: [...post.media, ...added] });
  };

  const remove = (item) => {
    removeMedia(post, item);
    change({ media: post.media.filter((m) => m !== item) });
  };

  const setOwn = (id, values) => change({ options: { ...post.options, [id]: { ...post.options[id], ...values } } });

  // Sticky fields (YouTube's visibility, X's thread...) are remembered for the next post, as on the web page.
  const setOption = (id, f, value) => {
    setOwn(id, { [f.key]: value });
    if (!f.sticky) return;
    const current = loadSettings();
    saveSettings({ ...current, sticky: { ...current.sticky, [id]: { ...current.sticky?.[id], [f.key]: value } } });
  };

  // null puts the platform back on the main post's text.
  const setText = (id, text) => {
    const { text: _old, ...rest } = post.options[id] ?? {};
    change({ options: { ...post.options, [id]: text === null ? rest : { ...rest, text } } });
  };

  const pickImage = async (id, f) => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return;
    const item = await addMedia(post, result.assets[0]);
    if (item.problem) { setNotice(item.problem); return; }
    const previous = post.options[id]?.[f.key];
    if (previous?.file) removeMedia(post, previous);
    setOwn(id, { [f.key]: item });
  };

  const removeImage = (id, f) => {
    const previous = post.options[id]?.[f.key];
    if (previous?.file) removeMedia(post, previous);
    setOwn(id, { [f.key]: '' });
  };

  const submit = () => {
    saveSettings({ ...loadSettings(), selected: post.platforms });
    const when = choice.mode === 'picked' ? { mode: 'picked', at: choice.at } : choice.mode === 'now' ? { mode: 'now', at: null } : { mode: 'auto', at: null };
    const ready = { ...post, when, state: 'ready', sendId: newId(), error: null, readyAt: Date.now() };
    savePost(ready);
    // Each Post gives a new sendId, so a post edited after Post shows up in the logs under a new name; say which.
    const replaces = post.sendId ? ` (replaces post ${short(post.sendId)}, edited after Post)` : '';
    log(`Post ${short(ready.sendId)}: ready for ${ready.platforms.join(', ')}${ready.media.length ? ` with ${ready.media.length} file${ready.media.length > 1 ? 's' : ''}` : ''}${when.mode === 'picked' ? `, for ${whenLabel(when.at)}` : when.mode === 'now' ? ', immediately' : ''}${replaces}`);
    onPosted(ready);
  };

  // Drafts and ready posts are only on this phone. Once the laptop has a post, Cancel stops it (it stays here,
  // marked cancelled) and Delete removes it everywhere; both need the laptop.
  const onLaptop = post.sendId && ['handed', 'done', 'cancelled'].includes(post.state);
  const canDelete = canDeleteState(post.state) || onLaptop;
  const removePost = async () => {
    if (!onLaptop) {
      if (!deleteByHand(post.id)) { setDeleteNote("It has started going to the laptop, so it can't be deleted now."); return; }
      onClose();
      return;
    }
    if (!connected) { setDeleteNote('Connect to the laptop to delete it everywhere.'); return; }
    setBusy(true);
    try {
      const data = await onAct(post, 'delete');
      toast(data?.note ?? 'Deleted everywhere.');
      onClose();
    } catch (err) {
      setDeleteNote(err.message);
    } finally {
      setBusy(false);
    }
  };
  const cancelPost = async () => {
    if (!connected) { setDeleteNote('Connect to the laptop to cancel it.'); return; }
    setBusy(true);
    try {
      const data = await onAct(post, 'cancel');
      toast(data?.note ?? "Cancelled. It stays in Posts, marked cancelled.");
      onClose();
    } catch (err) {
      setDeleteNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Drafts are saved on every change; this just says so and goes back to the list.
  const saveDraft = () => {
    toast('Saved as a draft.');
    onClose();
  };

  // A new draft with the same text, platforms, settings and media, opened in place of this one, with a message
  // saying so (the two look the same). Not offered once the media copies are gone.
  const duplicate = () => {
    const copy = copyPost(post, post.platforms, { fresh: true });
    log(`${post.sendId ? `Post ${short(post.sendId)}` : 'A draft'}: duplicated into a new draft`);
    onOpen(copy);
    toast("Copy made. You're now editing the copy; the original is in Posts.");
  };

  return (
    <Screen>
      <View style={styles.header}>
        {editable && step === 'review'
          ? <Pressable onPress={() => setStep('write')} hitSlop={12}><Text style={styles.back}>‹ Write</Text></Pressable>
          : <Pressable onPress={onClose} hitSlop={12}><Text style={styles.back}>‹ Posts</Text></Pressable>}
        <Text style={styles.state}>{editable ? `Step ${step === 'review' ? 2 : 1} of 2 · ${step === 'review' ? 'Review' : 'Write'}` : STATE_LABEL[post.state] ?? ''}</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32, gap: 14 }}>
        {post.error ? <Text style={styles.error}>The laptop refused this post: {post.error}</Text> : null}
        {post.state === 'sending' && post.retryError ? <Text style={styles.error}>Last try to send it failed: {post.retryError} It will be tried again.</Text> : null}
        {post.state === 'ready' ? <Text style={styles.note}>Ready. It goes to the laptop the next time they're on the same Wi-Fi. Editing makes it a draft again.</Text> : null}
        {post.state === 'handed' && post.at > Date.now() ? <Text style={styles.note}>On the laptop, going out {whenLabel(post.at)}. Change it in Calendar.</Text> : null}
        {post.state === 'cancelled' ? <Text style={styles.note}>Cancelled: it didn't go out.</Text> : null}
        {post.moved ? <Text style={styles.note}>Moved: its time, {whenLabel(post.moved.from)}, passed while the laptop was off.</Text> : null}

        {editable && review ? (
          <Pressable onPress={() => setStep('write')} style={styles.summary}>
            <Text style={styles.summaryText} numberOfLines={3}>{post.text.trim() || `${post.media.length} file${post.media.length === 1 ? '' : 's'}`}</Text>
            <Text style={styles.link}>Edit post ›</Text>
          </Pressable>
        ) : null}
        {!editable || step === 'write' ? (<>
        <TextInput
          style={styles.text}
          multiline
          editable={editable}
          placeholder="What do you want to post?"
          placeholderTextColor={colors.placeholder}
          value={post.text}
          onChangeText={(text) => change({ text })}
          textAlignVertical="top"
        />

        <View style={styles.mediaRow}>
          {post.media.map((item) => (
            <View key={item.file} style={styles.thumb}>
              {post.mediaRemoved
                ? <View style={[styles.thumbImage, styles.removed]}><Text style={styles.removedText}>{item.type.startsWith('video/') ? 'Video' : 'Photo'} removed after a week</Text></View>
                : item.type.startsWith('video/')
                ? <View style={[styles.thumbImage, styles.video]}><Text style={styles.videoText}>▶ {item.duration ? formatDuration(item.duration) : 'Video'}</Text></View>
                : <Image source={{ uri: mediaFile(post, item).uri }} style={styles.thumbImage} />}
              {editable ? <Pressable style={styles.remove} onPress={() => remove(item)} hitSlop={8}><Text style={styles.removeText}>×</Text></Pressable> : null}
            </View>
          ))}
          {editable ? <Pressable style={[styles.thumb, styles.add]} onPress={pick}><Text style={styles.addText}>+ Photo or video</Text></Pressable> : null}
        </View>
        {notice ? <Text style={styles.error}>{notice}</Text> : null}

        <Text style={styles.label}>Post to</Text>
        {platforms.length === 0 ? <Text style={styles.note}>Pair once to choose platforms. Your post is saved here meanwhile.</Text> : null}
        {platforms.length > 0 && usable.length === 0 ? <Text style={styles.note}>No platforms are set up on your laptop yet. Add one in its .env file.</Text> : null}
        <View style={styles.pills}>
          {[...usable, ...unset.map((id) => platforms.find((p) => p.id === id) ?? { id, name: id, configured: false })].map((p) => {
            const on = post.platforms.includes(p.id);
            // Logos only (decided 2026-11-17); the name is read out by TalkBack. Chosen: brand-coloured, with a light tint of it.
            return (
              <Pressable
                key={p.id}
                // An unset platform can only be taken off.
                disabled={!editable || (!p.configured && !on)}
                onPress={() => toggle(p.id)}
                accessibilityRole="switch"
                accessibilityLabel={p.configured ? p.name : `${p.name}: not set up on your laptop`}
                accessibilityState={{ checked: on, disabled: !editable || (!p.configured && !on) }}
                style={[styles.pill, on && { borderColor: brandColor(p.id), backgroundColor: `${brandColor(p.id)}17` }, !p.configured && styles.pillUnset]}
              >
                <Logo id={p.id} size={22} color={on ? undefined : colors.placeholder} />
              </Pressable>
            );
          })}
        </View>
        {unset.length ? (
          <Text style={styles.error}>
            Not set up on your laptop: {unset.map(nameOf).join(', ')}. Tap {unset.length > 1 ? 'them' : 'it'} to remove {unset.length > 1 ? 'them' : 'it'}, or set {unset.length > 1 ? 'them' : 'it'} up in the laptop's .env.
          </Text>
        ) : null}

        </>) : null}

        {review ? checks.map((check) => (
          <PlatformCard
            key={check.p.id}
            p={check.p}
            post={post}
            check={check}
            editable={editable}
            onOption={setOption}
            onText={setText}
            onPickImage={pickImage}
            onRemoveImage={removeImage}
          />
        )) : null}

        {editable && review ? (
          <When kind={kind} taken={taken} when={post.when} platforms={post.platforms} editable={editable}
            youtubeVideo={kind === 'video' && post.platforms.includes('youtube')}
            onChange={(when) => change({ when })} />
        ) : null}

        {post.state === 'done' ? (
          <Finished
            post={post}
            onUpdate={(changes) => { const next = { ...post, ...changes }; savePost(next); setPost(next); }}
            onSendAgain={(ids) => {
              const copy = copyPost(post, ids);
              log(`Post ${short(post.sendId)}: copied to a new draft to send again to ${ids.join(', ')}`);
              onOpen(copy);
            }}
          />
        ) : null}

        {editable && step === 'write' ? (
          <View style={{ gap: 6 }}>
            <Button label="Next: review and post ›" onPress={() => setStep('review')} disabled={Boolean(writeReason)} />
            {writeReason ? <Text style={[styles.reason, isError(writeReason) && styles.reasonError]}>{writeReason}</Text> : null}
            {post.state === 'draft' ? <Button kind="secondary" icon="content-save-outline" label="Save as draft" onPress={saveDraft} disabled={isEmpty} /> : null}
          </View>
        ) : null}
        {editable && step === 'review' ? (
          <View style={{ gap: 6 }}>
            <Button label={choice.mode === 'now' ? 'Post now' : choice.now || !choice.label ? postNow : choice.label} onPress={submit} disabled={Boolean(reason)} />
            {reason ? <Text style={[styles.reason, isError(reason) && styles.reasonError]}>{reason}</Text> : null}
            <Text style={styles.reason}>It goes to the laptop the next time they're on the same Wi-Fi, and goes out from there.</Text>
          </View>
        ) : null}
        {!post.mediaRemoved && !isEmpty ? <Button kind="secondary" label="Duplicate post" onPress={duplicate} /> : null}
        {post.state === 'handed' ? <Button kind="danger" label="Cancel post" onPress={cancelPost} disabled={busy} /> : null}
        {canDelete ? <Button kind="danger" label={onLaptop ? 'Delete post everywhere' : 'Delete post'} onPress={removePost} disabled={busy} /> : null}
        {deleteNote ? <Text style={styles.error}>{deleteNote}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

export const STATE_LABEL = {
  draft: 'Draft', ready: 'Ready', sending: 'Sending to laptop', handed: 'On the laptop', done: 'Finished', cancelled: 'Cancelled',
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  back: { fontSize: 17, color: colors.accent },
  state: { fontSize: 13, color: colors.muted },
  text: { minHeight: 140, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, fontSize: 16, color: colors.text },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 96, height: 96, borderRadius: 8, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  video: { backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  videoText: { color: '#fff', fontSize: 14 },
  removed: { backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center', padding: 6 },
  removedText: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontSize: 16, lineHeight: 18 },
  add: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', padding: 8 },
  addText: { color: colors.accent, textAlign: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 22, width: 52, height: 44, alignItems: 'center', justifyContent: 'center' },
  pillUnset: { borderColor: colors.danger, borderStyle: 'dashed', backgroundColor: colors.bg },
  check: { backgroundColor: colors.soft, borderRadius: 8, padding: 10, gap: 3 },
  checkName: { fontWeight: '600', color: colors.text },
  count: { fontWeight: '400', color: colors.muted },
  problem: { color: colors.danger },
  note: { color: colors.muted },
  ok: { color: colors.ok },
  error: { color: colors.danger },
  reason: { color: colors.muted, textAlign: 'center' },
  reasonError: { color: colors.danger },
  summary: { backgroundColor: colors.soft, borderRadius: 8, padding: 12, gap: 6 },
  summaryText: { fontSize: 15, color: colors.text },
  link: { color: colors.accent, fontWeight: '600' },
});
