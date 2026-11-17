// What a finished post shows: each platform's result (links open the post), Send again for the ones that failed,
// and "Finish by hand": posting it on Substack by hand (no API, see AGENTS.md) and platforms' own items.
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { FinishByHand, needsFinishing } from './Substack';
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

      {anyPosted ? (!needsFinishing(post) ? <Text style={styles.note}>✓ Finish by hand: done</Text> : (
        <View style={styles.reminder}>
          <FinishByHand post={post} onDone={() => onUpdate({ substackDone: true, todoDone: true })} />
        </View>
      )) : null}
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
});
