// "Finish by hand": what's left to do by hand after posting. Posting on Substack, which has no API (see AGENTS.md),
// and platforms' own items from their results (YouTube: make a private video public in YouTube Studio).
// The dialog opens right after Post (once the post is on the laptop, or saved here when the laptop isn't
// around), before any results, so it covers Substack only. The finished post shows everything until Done.
import { Linking, Modal, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { mediaFile } from './store';
import { log, short } from './log';
import { Button, colors, Text } from './ui';

const isVideo = (item) => item.type.startsWith('video/');

// Platforms' items still open: post.todoDone is set by the finished post's Done.
export const todosOf = (post) => (post.todoDone ? [] : (post.results ?? []).filter((r) => r.ok && r.todo).map((r) => r.todo));
export const needsFinishing = (post) => (post.results ?? []).some((r) => r.ok) && (!post.substackDone || todosOf(post).length > 0);

// Copy text, Share for each photo. Videos aren't shared: Substack's app isn't offered for them in the
// share sheet, so they're picked from the gallery inside Substack instead.
function SubstackPart({ post }) {
  const media = post.mediaRemoved ? [] : post.media;
  const photos = media.filter((item) => !isVideo(item));
  const videos = post.media.filter(isVideo).length;
  const copy = async () => {
    await Clipboard.setStringAsync(post.text);
    log(`Post ${short(post.sendId)}: text copied for Substack`);
  };
  const share = async (item) => {
    if (!(await Sharing.isAvailableAsync())) return;
    await Sharing.shareAsync(mediaFile(post, item).uri, { mimeType: item.type, dialogTitle: 'Share to Substack' });
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.heading}>Post this on Substack too</Text>
      <Text style={styles.note}>
        Substack has no way for apps to post, so copy the text{photos.length ? ' and share the photos to Substack\'s app' : ''}.
        {videos ? ` Add the video${videos > 1 ? 's' : ''} from your gallery inside Substack's app.` : ''}
      </Text>
      <View style={styles.row}>
        {post.text.trim() ? <Button kind="secondary" label="Copy text" onPress={copy} /> : null}
        {photos.map((item, i) => (
          <Button key={item.file} kind="secondary" label={photos.length > 1 ? `Share photo ${i + 1}` : 'Share photo'} onPress={() => share(item)} />
        ))}
      </View>
    </View>
  );
}

// note: an extra line, e.g. that YouTube's link comes later. onDone: Done was tapped.
export function FinishByHand({ post, note, onDone }) {
  const todos = todosOf(post);
  const done = () => {
    onDone();
    log(`Post ${short(post.sendId)}: finish by hand marked done`);
  };
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.title}>Finish by hand</Text>
      {todos.map((t) => (
        <View key={t.url} style={{ gap: 8 }}>
          <Text style={styles.note}>{t.text}</Text>
          <Button kind="secondary" label={t.label} onPress={() => Linking.openURL(t.url)} />
        </View>
      ))}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {post.substackDone ? null : <SubstackPart post={post} />}
      <Button label="Done" onPress={done} />
    </View>
  );
}

// A private YouTube video is only uploaded later, so its Studio link can't be in the dialog yet.
function youtubeNote(post) {
  const yt = post.options?.youtube;
  if (post.results || !post.platforms.includes('youtube') || !post.media.some(isVideo) || yt?.publishAt) return null;
  return (yt?.privacy ?? 'private') === 'private'
    ? 'YouTube: the video goes up private. Once it\'s posted, this post shows a link to make it public.'
    : null;
}

// Closes only with Done, so it can't be dismissed by accident: the back button does nothing.
export function FinishByHandDialog({ post, onDone }) {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.status}>
            {post.state === 'handed' || post.state === 'done' ? '✓ Posting now.' : '✓ Saved. It will post when your laptop is on the same Wi-Fi.'}
          </Text>
          <FinishByHand post={post} note={youtubeNote(post)} onDone={onDone} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '600', fontSize: 16, color: colors.text },
  heading: { fontWeight: '600', color: colors.text },
  note: { color: colors.muted },
  status: { color: colors.ok, fontWeight: '500' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.bg, borderRadius: 12, padding: 20, gap: 12 },
});
