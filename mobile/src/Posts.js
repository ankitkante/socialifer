// The list of posts on the phone, newest first, with where each one is: draft, ready, on the laptop, finished.
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Screen, colors } from './ui';
import { tunnelProblem } from './status';

function statusLine(post, live) {
  if (post.state === 'draft') return post.error ? `Draft · the laptop refused it: ${post.error}` : 'Draft';
  if (post.state === 'ready') return 'Ready · goes to the laptop when connected';
  if (post.state === 'sending') {
    const progress = post.files ? `Sending to laptop · ${post.sent ?? 0} of ${post.files} files` : 'Sending to laptop';
    return post.retryError ? `${progress} · last try failed: ${post.retryError}` : progress;
  }
  if (post.state === 'handed') {
    const info = live?.[post.id];
    if (info?.state === 'posting') {
      const steps = Object.values(info.steps ?? {}).map((s) => s.step).filter(Boolean);
      return `Posting${steps.length ? ` · ${steps[0]}` : '…'}`;
    }
    return 'On the laptop · waiting its turn';
  }
  const ok = (post.results ?? []).filter((r) => r.ok).length;
  const failed = (post.results ?? []).length - ok;
  return `Finished · ${ok} posted${failed ? `, ${failed} failed` : ''}${ok && !post.substackDone ? ' · Substack: not done' : ''}`;
}

export default function Posts({ posts, live, connection, onOpen, onNew, onPair }) {
  const tunnel = connection.state === 'connected' ? tunnelProblem(connection.status) : null;
  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Social Post</Text>
        <Pressable onPress={onPair} hitSlop={8}><Text style={styles.link}>Laptop</Text></Pressable>
      </View>
      <Text style={[styles.connection, connection.state === 'connected' ? (tunnel ? styles.warn : styles.on) : styles.off]}>
        {connection.state === 'connected' ? `● Connected to laptop${tunnel ? ` · ${tunnel}` : ''}` : connection.state === 'checking' ? '○ Looking for the laptop…' : `○ ${connection.message}`}
      </Text>
      <Button label="New post" onPress={onNew} style={{ marginVertical: 12 }} />
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<Text style={styles.empty}>No posts yet.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onOpen(item)}>
            <Text style={styles.text} numberOfLines={2}>{item.text.trim() || (item.media.length ? `${item.media.length} file${item.media.length > 1 ? 's' : ''}` : '(empty)')}</Text>
            <Text style={[styles.status, item.state === 'done' && (item.results ?? []).some((r) => !r.ok) && { color: colors.danger }]}>
              {statusLine(item, live)}
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '600', color: colors.text },
  link: { fontSize: 15, color: colors.accent },
  connection: { marginTop: 6, fontSize: 13 },
  on: { color: colors.ok },
  off: { color: colors.muted },
  warn: { color: colors.warn },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 32 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 4 },
  text: { fontSize: 15, color: colors.text },
  status: { fontSize: 13, color: colors.muted },
});
