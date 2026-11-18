// Calendar: the laptop's posts (from the web page and the phone), a week at a time, waiting and finished.
// A waiting post can be moved, posted now, edited (its text) or cancelled while the laptop is connected; one already
// on a platform is changed there (YouTube Studio). The list comes from the laptop's last schedule, kept on the phone.
import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { formatDay, formatTime } from '../../public/rules.js';
import { Picker, takenSlots, timeOf, whenLabel } from './When';
import { Button, Screen, colors, Text, TextInput } from './ui';
import Logo from './Logo';

const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
function mondayOf(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
const when = (p) => (p.state === 'waiting' ? p.at : timeOf(p));
const kindLabel = { text: 'Text', image: 'Image', video: 'Video' };

export function statusOf(p) {
  if (p.state === 'waiting') return { tone: 'wait', text: p.at <= Date.now() ? 'Going out now' : 'Waiting' };
  if (p.state === 'posting') return { tone: 'wait', text: 'Posting' };
  if (p.state === 'unknown') return { tone: 'fail', text: 'Unknown' };
  const results = p.results ?? [];
  const failed = results.filter((r) => !r.ok).length;
  if (p.platforms.length === 1 && p.platforms[0] === 'youtube' && p.at > Date.now() && results[0]?.ok) return { tone: 'wait', text: 'Scheduled on YouTube' };
  if (!failed) return { tone: 'ok', text: 'Posted' };
  return { tone: 'fail', text: failed === results.length ? 'Failed' : `${failed} failed` };
}

function studioLink(url) {
  const id = /(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/.exec(url ?? '')?.[1];
  return id ? `https://studio.youtube.com/video/${id}/edit` : 'https://studio.youtube.com/';
}

const snippet = (p) => (p.text || p.files?.map((f) => f.name).join(', ') || 'No text').replace(/\s+/g, ' ');

export function PostCard({ p, withDay, onPress }) {
  const status = statusOf(p);
  return (
    <Pressable onPress={onPress} style={[styles.card, styles[status.tone]]}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTime}>{withDay ? whenLabel(when(p)) : formatTime(when(p))}</Text>
        <View style={styles.logos}>{p.platforms.map((id) => <Logo key={id} id={id} size={14} />)}</View>
      </View>
      <Text style={styles.cardText} numberOfLines={2}>{snippet(p)}</Text>
      <Text style={styles.cardStatus}>{kindLabel[p.kind] ?? ''} · {status.text}{p.source === 'web' ? ' · from the web page' : ''}</Text>
    </Pressable>
  );
}

// One post in full, with what can still be done to it. act(action, body) calls the laptop and reloads the schedule.
export function PostSheet({ p, posts, platforms, connected, act, onClose }) {
  const [mode, setMode] = useState(null); // null, 'move' or 'edit'
  const [at, setAt] = useState(p.at);
  const [text, setText] = useState(p.text);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const results = new Map((p.results ?? []).map((r) => [r.id, r]));
  const youtube = results.get('youtube');
  const name = (id) => platforms.find((x) => x.id === id)?.name ?? id;
  const run = async (action, body) => {
    setBusy(true);
    try {
      const data = await act(p, action, body);
      setMessage(data?.note ?? '');
      setMode(null);
      if (action === 'cancel' && !data?.post) onClose();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };
  const status = statusOf(p);
  return (
    <Modal animationType="slide" visible onRequestClose={onClose}>
      <Screen>
        <View style={styles.sheetHead}>
          <Pressable onPress={onClose} hitSlop={12}><Text style={styles.back}>‹ Back</Text></Pressable>
          <Text style={styles.small}>{status.text}</Text>
        </View>
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 32 }}>
          <Text style={styles.title}>{p.state === 'waiting' && p.at <= Date.now() ? 'Now' : whenLabel(when(p))}</Text>
          <Text style={styles.small}>
            {p.when === 'picked' ? 'Time you picked' : p.when === 'now' ? 'Posted straight away' : 'Next free time'} · {kindLabel[p.kind]} · from the {p.source === 'web' ? 'web page' : 'phone'}
          </Text>
          {p.moved ? <Text style={styles.warning}>Moved here: its time, {whenLabel(p.moved.from)}, passed while the laptop was off.</Text> : null}
          {mode === 'edit' ? (
            <TextInput style={styles.input} multiline value={text} onChangeText={setText} textAlignVertical="top" />
          ) : <Text style={styles.body}>{p.text || 'No main text'}</Text>}
          {p.files?.length ? <Text style={styles.small}>{p.filesRemoved ? 'Posted with' : 'Files'}: {p.files.map((f) => f.name).join(', ')}</Text> : null}
          {p.platforms.map((id) => {
            const r = results.get(id);
            return (
              <View key={id} style={styles.result}>
                <Logo id={id} size={18} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName}>{name(id)}</Text>
                  {r?.ok && r.url ? <Pressable onPress={() => Linking.openURL(r.url)}><Text style={styles.link}>{id === 'youtube' && p.state === 'waiting' ? `On YouTube, public ${whenLabel(p.at)}` : 'View post'}</Text></Pressable> : null}
                  {r && !r.ok ? <Text style={styles.error}>{r.error}</Text> : null}
                  {!r && p.steps?.[id] ? <Text style={styles.small}>{p.steps[id].step}…</Text> : null}
                  {r?.ok && r.todo ? <Pressable onPress={() => Linking.openURL(r.todo.url)}><Text style={styles.link}>{r.todo.label}</Text></Pressable> : null}
                </View>
              </View>
            );
          })}
          {youtube?.ok ? (
            <View style={styles.studio}>
              <Text style={styles.small}>YouTube already has this video. Change its time, text or settings in YouTube Studio.</Text>
              <Button kind="secondary" label="Open in YouTube Studio" onPress={() => Linking.openURL(studioLink(youtube.url))} />
            </View>
          ) : null}

          {p.state === 'waiting' && !connected ? <Text style={styles.small}>Connect to the laptop to change this post.</Text> : null}
          {p.state === 'waiting' && connected && mode === 'move' ? (
            <View style={{ gap: 10 }}>
              <Picker at={at} kind={p.kind} taken={takenSlots(posts, p.id)} platforms={p.platforms} onChange={setAt} />
              <View style={styles.row}>
                <Button kind="secondary" label="Cancel" onPress={() => setMode(null)} />
                <Button label="Move" disabled={busy} onPress={() => run('move', { at })} />
              </View>
            </View>
          ) : null}
          {p.state === 'waiting' && connected && mode === 'edit' ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.small}>The text can be changed here; files can't. Change other settings on the web page.</Text>
              <View style={styles.row}>
                <Button kind="secondary" label="Cancel" onPress={() => { setText(p.text); setMode(null); }} />
                <Button label="Save" disabled={busy} onPress={() => run('edit', { text, options: p.options })} />
              </View>
            </View>
          ) : null}
          {p.state === 'waiting' && connected && !mode ? (
            <View style={styles.row}>
              <Button kind="secondary" label="Move" onPress={() => setMode('move')} />
              <Button kind="secondary" label="Post now" disabled={busy} onPress={() => run('now')} />
              <Button kind="secondary" label="Edit" onPress={() => setMode('edit')} />
              <Button kind="danger" label="Cancel post" disabled={busy} onPress={() => run('cancel')} />
            </View>
          ) : null}
          {p.state === 'done' || p.state === 'unknown' ? <Text style={styles.small}>Already on the platforms: change it there.</Text> : null}
          {message ? <Text style={styles.warning}>{message}</Text> : null}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

export default function Calendar({ schedule, platforms, connected, act }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(Date.now()));
  const [openId, setOpenId] = useState(null);
  const posts = schedule.posts ?? [];
  const open = posts.find((p) => p.id === openId);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const today = new Date().toDateString();
  return (
    <Screen>
      <View style={styles.head}>
        <Text style={styles.title}>Calendar</Text>
        <View style={styles.row}>
          <Pressable onPress={() => setWeekStart(addDays(weekStart, -7))} hitSlop={8}><Text style={styles.nav}>‹</Text></Pressable>
          <Pressable onPress={() => setWeekStart(mondayOf(Date.now()))} hitSlop={8}><Text style={styles.link}>Today</Text></Pressable>
          <Pressable onPress={() => setWeekStart(addDays(weekStart, 7))} hitSlop={8}><Text style={styles.nav}>›</Text></Pressable>
        </View>
      </View>
      <Text style={styles.small}>
        {formatDay(weekStart)} to {formatDay(addDays(weekStart, 6))}
        {schedule.at ? ` · from the laptop, ${connected ? 'live' : `as of ${whenLabel(schedule.at)}`}` : ' · connect to the laptop to load it'}
      </Text>
      <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 12 }}>
        {days.map((day) => {
          const own = posts.filter((p) => Number.isFinite(when(p)) && new Date(when(p)).toDateString() === new Date(day).toDateString())
            .sort((a, b) => when(a) - when(b));
          return (
            <View key={day} style={[styles.day, new Date(day).toDateString() === today && styles.today]}>
              <Text style={styles.dayName}>{formatDay(day)}</Text>
              {own.length ? own.map((p) => <PostCard key={p.id} p={p} onPress={() => setOpenId(p.id)} />)
                : <Text style={styles.small}>Nothing</Text>}
            </View>
          );
        })}
      </ScrollView>
      {open ? <PostSheet p={open} posts={posts} platforms={platforms} connected={connected} act={act} onClose={() => setOpenId(null)} /> : null}
    </Screen>
  );
}

export const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  nav: { fontSize: 22, color: colors.accent, paddingHorizontal: 6 },
  link: { fontSize: 15, color: colors.accent, fontWeight: '600' },
  small: { fontSize: 13, color: colors.muted },
  day: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 10, gap: 6 },
  today: { borderWidth: 2, borderColor: colors.accent, padding: 9 },
  dayName: { fontSize: 13, fontWeight: '700', color: colors.text },
  card: { borderWidth: 1, borderColor: colors.line, borderLeftWidth: 4, borderRadius: 8, padding: 8, gap: 3 },
  wait: { borderLeftColor: colors.accent },
  ok: { borderLeftColor: colors.ok },
  fail: { borderLeftColor: colors.danger },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTime: { fontSize: 13, fontWeight: '700', color: colors.text },
  logos: { flexDirection: 'row', gap: 4 },
  cardText: { fontSize: 13, color: colors.muted },
  cardStatus: { fontSize: 11, color: colors.muted },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  back: { fontSize: 17, color: colors.accent },
  body: { fontSize: 15, color: colors.text },
  input: { minHeight: 120, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, fontSize: 15, color: colors.text },
  result: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  resultName: { fontWeight: '600', color: colors.text },
  error: { color: colors.danger },
  warning: { backgroundColor: '#fff4e5', borderRadius: 8, padding: 10, fontSize: 13, color: colors.text },
  studio: { backgroundColor: colors.soft, borderRadius: 8, padding: 10, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
