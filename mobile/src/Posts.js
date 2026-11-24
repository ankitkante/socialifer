// The list of posts on the phone, newest first, with where each one is: draft, ready, on the laptop, finished.
// Above them, posts from the web page that are waiting on the laptop (from its last schedule).
// Long press selects posts to delete (one or several) or, for one post, to duplicate; the round ＋ button starts a new post.
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { Checkbox, FAB, IconButton } from 'react-native-paper';
import { Button, Screen, colors, Text, useToast } from './ui';
import { tunnelProblem } from './status';
import Logo, { BrandMark } from './Logo';
import { needsFinishing } from './Substack';
import { PostCard, PostSheet } from './Calendar';
import { whenLabel } from './When';
import { canDeleteState, copyPost, deleteByHand } from './store';
import { log, short } from './log';

function statusLine(post, live) {
  if (post.state === 'draft') return post.error ? `Draft · the laptop refused it: ${post.error}` : 'Draft';
  if (post.state === 'ready') {
    const at = post.when?.mode === 'picked' ? ` · for ${whenLabel(post.when.at)}` : '';
    return `Ready${at} · goes to the laptop when connected`;
  }
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
    return post.at > Date.now() ? `On the laptop · goes out ${whenLabel(post.at)}` : 'On the laptop · going out now';
  }
  if (post.state === 'cancelled') return "Cancelled · it didn't go out";
  const ok = (post.results ?? []).filter((r) => r.ok).length;
  const failed = (post.results ?? []).length - ok;
  return `Finished · ${ok} posted${failed ? `, ${failed} failed` : ''}${needsFinishing(post) ? ' · Finish by hand' : ''}`;
}

// Sections as in the Scheduling mockup's Posts tab (Drafts, Waiting, Finished), plus Cancelled.
const SECTIONS = [
  ['Drafts', (p) => p.state === 'draft'],
  ['Waiting', (p) => p.state === 'ready' || p.state === 'sending' || p.state === 'handed'],
  ['Finished', (p) => p.state === 'done'],
  ['Cancelled', (p) => p.state === 'cancelled'],
];

// onAct(post, 'delete'): deletes a post the laptop has, everywhere.
export default function Posts({ posts, live, platforms, connection, schedule, act, onAct, onOpen, onNew, onPair, onPairNow, onChange }) {
  const tunnel = connection.state === 'connected' ? tunnelProblem(connection.status) : null;
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState(null); // null, or the ids picked for deleting
  const toast = useToast();
  const fromWeb = (schedule?.posts ?? []).filter((p) => p.source === 'web' && (p.state === 'waiting' || p.state === 'posting')).sort((a, b) => a.at - b.at);
  const open = (schedule?.posts ?? []).find((p) => p.id === openId);
  const selecting = selected !== null;

  // Back leaves selecting first.
  useEffect(() => {
    if (!selecting) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSelected(null); return true; });
    return () => sub.remove();
  }, [selecting]);

  const toggle = (post) => {
    const next = selected?.includes(post.id) ? selected.filter((id) => id !== post.id) : [...(selected ?? []), post.id];
    setSelected(next.length ? next : null);
  };
  // One post only, and not once its media copies are gone (as on the post's own screen).
  const single = selected?.length === 1 ? posts.find((p) => p.id === selected[0]) : null;
  const canCopy = single && !single.mediaRemoved && (single.text.trim() || single.media.length);
  const duplicate = () => {
    copyPost(single, single.platforms, { fresh: true });
    log(`${single.sendId ? `Post ${short(single.sendId)}` : 'A draft'}: duplicated into a new draft`);
    setSelected(null);
    onChange();
    toast("Copy made. It's at the top of the list.");
  };
  // Drafts and ready posts are deleted here; posts the laptop has are deleted everywhere (needs the laptop). A post
  // part-way through being sent can be selected (to duplicate) but not deleted.
  const onLaptop = (p) => p?.sendId && ['handed', 'done', 'cancelled'].includes(p.state);
  const deletable = (selected ?? []).some((id) => { const p = posts.find((x) => x.id === id); return canDeleteState(p?.state) || onLaptop(p); });
  const remove = async () => {
    const picked = selected.map((id) => posts.find((p) => p.id === id)).filter(Boolean);
    setSelected(null);
    let gone = 0;
    let kept = 0;
    for (const p of picked) {
      if (!onLaptop(p)) { if (deleteByHand(p.id)) gone++; else kept++; continue; }
      if (connection.state !== 'connected') { kept++; continue; }
      try { await onAct(p, 'delete'); gone++; } catch { kept++; }
    }
    onChange();
    toast(kept
      ? `Deleted ${gone}. ${kept} couldn't be deleted now: ${connection.state === 'connected' ? 'still being sent' : 'connect to the laptop to delete posts it has'}.`
      : `Deleted ${gone} post${gone > 1 ? 's' : ''}.`);
  };
  const sections = SECTIONS.map(([title, test]) => ({ title, data: posts.filter(test) })).filter((section) => section.data.length);

  return (
    <Screen>
      {selecting ? (
        <View style={styles.header}>
          <View style={styles.brand}>
            <IconButton icon="close" accessibilityLabel="Stop selecting" onPress={() => setSelected(null)} style={{ margin: 0 }} />
            <Text style={styles.title}>{selected.length} selected</Text>
          </View>
          <View style={styles.brand}>
            {canCopy ? <Button kind="secondary" icon="content-copy" label="Duplicate" compact onPress={duplicate} /> : null}
            {deletable ? <Button kind="danger" icon="delete-outline" label="Delete" compact onPress={remove} /> : null}
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.brand}>
            {/* The mark before every tab's title keeps the brand on each screen (decided 2026-11-19). */}
            <BrandMark size={24} />
            <Text style={styles.title}>Posts</Text>
          </View>
          <Pressable onPress={onPair} hitSlop={8}><Text style={styles.link}>Laptop ›</Text></Pressable>
        </View>
      )}
      {connection.state === 'unpaired' ? (
        // Posts can still be written and saved; they wait on the phone until it's paired.
        <Pressable onPress={onPairNow} accessibilityRole="button" style={styles.unpaired}>
          <Text style={styles.unpairedText}>
            This phone isn't paired with your laptop yet, so posts stay here and nothing goes out. <Text style={styles.unpairedLink}>Pair now ›</Text>
          </Text>
        </Pressable>
      ) : (
        <Text style={[styles.connection, connection.state === 'connected' ? (tunnel ? styles.warn : styles.on) : styles.off]}>
          {connection.state === 'connected' ? `● Connected to laptop${tunnel ? ` · ${tunnel}` : ''}` : connection.state === 'checking' ? '○ Looking for the laptop…' : `○ ${connection.message}`}
        </Text>
      )}
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.group}>{section.title.toUpperCase()} · {section.data.length}</Text>}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 96 }}
        ListEmptyComponent={(
          <View style={styles.emptyBox}>
            <BrandMark size={56} />
            <Text style={styles.empty}>No posts yet. Tap ＋ to write one.</Text>
          </View>
        )}
        ListHeaderComponent={fromWeb.length ? (
          <View style={styles.fromWeb}>
            <Text style={styles.section}>Waiting on the laptop, from the web page</Text>
            {fromWeb.map((p) => <PostCard key={p.id} p={p} withDay onPress={() => setOpenId(p.id)} />)}
            <Text style={styles.section}>On this phone</Text>
          </View>
        ) : null}
        renderItem={({ item }) => {
          const on = selected?.includes(item.id);
          return (
            <Pressable
              style={[styles.row, on && styles.rowOn]}
              onPress={() => (selecting ? toggle(item) : onOpen(item))}
              onLongPress={() => toggle(item)}
              accessibilityState={selecting ? { checked: on } : undefined}
              accessibilityHint={selecting ? undefined : 'Long press to select for deleting'}
            >
              {selecting ? <Checkbox.Android status={on ? 'checked' : 'unchecked'} color={colors.accent} onPress={() => toggle(item)} /> : null}
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.logos}>
                  {item.platforms.map((id) => {
                    // A platform that failed is greyed; the status line below says how many.
                    const failed = item.state === 'done' && (item.results ?? []).some((r) => r.id === id && !r.ok);
                    const name = platforms.find((p) => p.id === id)?.name ?? id;
                    return <Logo key={id} id={id} size={16} name={failed ? `${name}: failed` : name} color={failed ? colors.line : undefined} />;
                  })}
                </View>
                <Text style={styles.text} numberOfLines={2}>{item.text.trim() || (item.media.length ? `${item.media.length} file${item.media.length > 1 ? 's' : ''}` : '(empty)')}</Text>
                <Text style={[styles.status, item.state === 'done' && (item.results ?? []).some((r) => !r.ok) && { color: colors.danger }]}>
                  {statusLine(item, live)}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
      {selecting ? null : <FAB icon="plus" label={posts.length ? undefined : 'New post'} accessibilityLabel="New post" onPress={onNew} style={styles.fab} color="#fff" />}
      {open ? <PostSheet p={open} posts={schedule.posts} platforms={platforms} connected={connection.state === 'connected'} act={act} onClose={() => setOpenId(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, color: colors.text },
  link: { fontSize: 15, color: colors.accent, fontWeight: '500' },
  connection: { marginTop: 6, fontSize: 13 },
  on: { color: colors.ok },
  off: { color: colors.muted },
  warn: { color: colors.warn },
  unpaired: { marginTop: 8, backgroundColor: '#fdecee', borderWidth: 1, borderColor: '#e8a3ab', borderRadius: 10, padding: 10 },
  unpairedText: { fontSize: 13, color: colors.danger },
  unpairedLink: { fontWeight: '600', textDecorationLine: 'underline' },
  emptyBox: { alignItems: 'center', gap: 12, marginTop: 48 },
  empty: { color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowOn: { backgroundColor: colors.accentSoft },
  logos: { flexDirection: 'row', gap: 8 },
  text: { fontSize: 15, color: colors.text },
  status: { fontSize: 13, color: colors.muted },
  fromWeb: { gap: 8, paddingBottom: 8 },
  section: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 4 },
  group: { fontSize: 12, fontWeight: '700', color: colors.muted, letterSpacing: 0.5, paddingTop: 16, paddingBottom: 4 },
  fab: { position: 'absolute', right: 16, bottom: 16, backgroundColor: colors.accent },
});
