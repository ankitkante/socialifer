// The reminder to post on Substack by hand, since Substack has no API (see AGENTS.md). It opens as a dialog
// right after Post (once the post is on the laptop, or saved here when the laptop isn't around), and stays
// inside the finished post until Done.
import { Modal, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { mediaFile } from './store';
import { log, short } from './log';
import { Button, colors } from './ui';

const isVideo = (item) => item.type.startsWith('video/');

// Copy text, Share for each photo, Done. Videos aren't shared: Substack's app isn't offered for them in the
// share sheet, so they're picked from the gallery inside Substack instead.
export function SubstackReminder({ post, onDone }) {
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
  const done = () => {
    onDone();
    log(`Post ${short(post.sendId)}: Substack marked done`);
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.title}>Post this on Substack too</Text>
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
      <Button label="Done" onPress={done} />
    </View>
  );
}

// Closes only with Done, so it can't be dismissed by accident: the back button does nothing.
export function SubstackDialog({ post, onDone }) {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.status}>
            {post.state === 'handed' || post.state === 'done' ? '✓ Posting now.' : '✓ Saved. It will post when your laptop is on the same Wi-Fi.'}
          </Text>
          <SubstackReminder post={post} onDone={onDone} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '600', fontSize: 16, color: colors.text },
  note: { color: colors.muted },
  status: { color: colors.ok, fontWeight: '500' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.bg, borderRadius: 12, padding: 20, gap: 12 },
});
