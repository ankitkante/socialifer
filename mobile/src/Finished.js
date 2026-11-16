// What a finished post shows: each platform's result (links open the post), Send again for the ones that failed,
// and the reminder to post it on Substack by hand, since Substack has no API (see AGENTS.md).
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { mediaFile } from './store';
import { log, short } from './log';
import { Button, colors } from './ui';

export default function Finished({ post, onUpdate, onSendAgain }) {
  const results = post.results ?? [];
  const failed = results.filter((r) => !r.ok);
  const anyPosted = results.some((r) => r.ok);
  // An unknown result may still have gone out; the message says to check before sending again.
  const unknown = failed.some((r) => /unknown|stopped while posting|no longer has/.test(r.error ?? ''));

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 6 }}>
        {results.map((r) => (
          <View key={r.id}>
            <Text style={r.ok ? styles.ok : styles.problem}>{r.ok ? '✓' : '✕'} {r.name}{r.ok ? '' : `: ${r.error}`}</Text>
            {r.ok && r.url ? (
              <Pressable onPress={() => Linking.openURL(r.url)}><Text style={styles.link}>{r.url}</Text></Pressable>
            ) : null}
            {(r.warnings ?? []).map((w) => <Text key={w} style={styles.warn}>⚠ {w}</Text>)}
          </View>
        ))}
      </View>

      {failed.length ? (
        <View style={{ gap: 4 }}>
          {unknown ? <Text style={styles.note}>Check those platforms first: the post may already be there.</Text> : null}
          <Button
            kind="secondary"
            label={`Send again to ${failed.map((r) => r.name).join(', ')}`}
            onPress={() => onSendAgain(failed.map((r) => r.id))}
          />
          <Text style={styles.note}>Opens a copy to fix and post; this one stays as it is.</Text>
        </View>
      ) : null}

      {anyPosted ? <Substack post={post} onUpdate={onUpdate} /> : null}
    </View>
  );
}

function Substack({ post, onUpdate }) {
  if (post.substackDone) return <Text style={styles.note}>✓ Substack: done</Text>;
  const files = post.mediaRemoved ? [] : post.media;
  const copy = async () => {
    await Clipboard.setStringAsync(post.text);
    log(`Post ${short(post.sendId)}: text copied for Substack`);
  };
  const share = async (item) => {
    if (!(await Sharing.isAvailableAsync())) return;
    await Sharing.shareAsync(mediaFile(post, item).uri, { mimeType: item.type, dialogTitle: 'Share to Substack' });
  };
  return (
    <View style={styles.reminder}>
      <Text style={styles.reminderTitle}>Post this on Substack by hand</Text>
      <Text style={styles.note}>Substack has no way for apps to post, so copy the text and share the files to Substack's app.</Text>
      <View style={styles.row}>
        {post.text.trim() ? <Button kind="secondary" label="Copy text" onPress={copy} /> : null}
        {files.map((item, i) => (
          <Button key={item.file} kind="secondary" label={files.length > 1 ? `Share ${item.type.startsWith('video/') ? 'video' : 'photo'} ${i + 1}` : `Share ${item.type.startsWith('video/') ? 'video' : 'photo'}`} onPress={() => share(item)} />
        ))}
      </View>
      <Button label="Done" onPress={() => { onUpdate({ substackDone: true }); log(`Post ${short(post.sendId)}: Substack marked done`); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  ok: { color: colors.ok, fontWeight: '600' },
  problem: { color: colors.danger },
  warn: { color: colors.warn },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  note: { color: colors.muted },
  reminder: { borderWidth: 1, borderColor: colors.warn, borderRadius: 8, padding: 12, gap: 8 },
  reminderTitle: { fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
