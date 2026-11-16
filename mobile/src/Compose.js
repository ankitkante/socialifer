// Writing a post: text, platforms, photos and videos, with the same checks as the web page (public/rules.js).
// Every change is saved on the phone as a draft; Post marks it ready to go to the laptop.
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { problemsFor, adjustmentsFor, formatDuration } from '../../public/rules.js';
import { addMedia, deletePost, loadSettings, mediaFile, newId, removeMedia, savePost, saveSettings } from './store';
import { optionsFor, withDefaults } from './options';
import PlatformCard from './Fields';
import { log, short } from './log';
import { Button, Screen, colors } from './ui';

const metaOf = (media) => media.map(({ name, type, size, duration }) => ({ name, type, size, duration }));

export default function Compose({ initial, platforms, settings, onClose }) {
  // Posts saved before per-platform settings existed get the default values.
  const [post, setPost] = useState(() => ({ ...initial, options: withDefaults(initial.options, settings.sticky) }));
  const [notice, setNotice] = useState('');
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

  const usable = platforms.filter((p) => p.configured);
  const targets = usable.filter((p) => post.platforms.includes(p.id));
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
  const reason = targets.length === 0 ? 'Select at least one platform'
    : isEmpty ? 'Write something, or add a photo or video'
    : issues ? `Fix ${issues} issue${issues > 1 ? 's' : ''} first`
    : '';

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
    const ready = { ...post, state: 'ready', sendId: newId(), error: null };
    savePost(ready);
    log(`Post ${short(ready.sendId)}: ready for ${ready.platforms.join(', ')}${ready.media.length ? ` with ${ready.media.length} file${ready.media.length > 1 ? 's' : ''}` : ''}`);
    onClose();
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}><Text style={styles.back}>‹ Posts</Text></Pressable>
        <Text style={styles.state}>{STATE_LABEL[post.state] ?? ''}</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32, gap: 14 }}>
        {post.error ? <Text style={styles.error}>The laptop refused this post: {post.error}</Text> : null}
        {post.state === 'sending' && post.retryError ? <Text style={styles.error}>Last try to send it failed: {post.retryError} It will be tried again.</Text> : null}
        {post.state === 'ready' ? <Text style={styles.note}>Ready. It goes to the laptop the next time they're on the same Wi-Fi. Editing makes it a draft again.</Text> : null}

        <TextInput
          style={styles.text}
          multiline
          editable={editable}
          placeholder="What do you want to post?"
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
        {platforms.length === 0 ? <Text style={styles.note}>Connect to the laptop once to load your platforms.</Text> : null}
        <View style={styles.pills}>
          {platforms.map((p) => {
            const on = post.platforms.includes(p.id);
            return (
              <Pressable
                key={p.id}
                disabled={!p.configured || !editable}
                onPress={() => toggle(p.id)}
                style={[styles.pill, on && styles.pillOn, !p.configured && styles.pillOff]}
              >
                <Text style={[styles.pillText, on && styles.pillTextOn]}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>

        {checks.map((check) => (
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
        ))}

        {post.results ? <Results results={post.results} /> : null}

        {editable ? (
          <View style={{ gap: 6 }}>
            <Button label={targets.length > 1 ? `Post to ${targets.length} platforms` : targets.length ? `Post to ${targets[0].name}` : 'Post'} onPress={submit} disabled={Boolean(reason)} />
            {reason ? <Text style={styles.reason}>{reason}</Text> : null}
          </View>
        ) : null}
        {post.state === 'done' || post.state === 'draft' ? (
          <Button kind="danger" label="Delete post" onPress={() => { deletePost(post.id); log(`Deleted ${post.state === 'done' ? `finished post ${short(post.sendId)}` : 'a draft'}`); onClose(); }} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export const STATE_LABEL = {
  draft: 'Draft', ready: 'Ready', sending: 'Sending to laptop', handed: 'On the laptop', done: 'Finished',
};

export function Results({ results }) {
  return (
    <View style={{ gap: 4 }}>
      {results.map((r) => (
        <Text key={r.id} style={r.ok ? styles.ok : styles.problem}>
          {r.ok ? '✓' : '✕'} {r.name}{r.ok ? (r.url ? `: ${r.url}` : ': posted') : `: ${r.error}`}
          {r.warnings?.length ? `\n  ⚠ ${r.warnings.join('\n  ⚠ ')}` : ''}
        </Text>
      ))}
    </View>
  );
}

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
  pill: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillOff: { opacity: 0.35 },
  pillText: { color: colors.text },
  pillTextOn: { color: '#fff' },
  check: { backgroundColor: colors.soft, borderRadius: 8, padding: 10, gap: 3 },
  checkName: { fontWeight: '600', color: colors.text },
  count: { fontWeight: '400', color: colors.muted },
  problem: { color: colors.danger },
  note: { color: colors.muted },
  ok: { color: colors.ok },
  error: { color: colors.danger },
  reason: { color: colors.muted, textAlign: 'center' },
});
