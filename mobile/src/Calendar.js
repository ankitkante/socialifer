// Calendar: the laptop's posts (from the web page and the phone), a week at a time, scheduled, posted or cancelled,
// plus the phone's own posts not yet on the laptop. A waiting post can be moved, posted now, edited (its text) or
// cancelled while the laptop is connected, and any post deleted; one already on a platform is changed there (YouTube
// Studio). The laptop's list is its last schedule, kept on the phone.
import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Dialog, IconButton, Portal } from 'react-native-paper';
import { formatDay, formatTime, nextFreeTime, outsideHours, postKind, sideBySide, SCHEDULE } from '../../public/rules.js';
import { Picker, takenSlots, timeOf, whenLabel } from './When';
import { Button, Screen, colors, Text, TextInput } from './ui';
import Logo, { BrandMark } from './Logo';

const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
function mondayOf(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
const when = (p) => (p.state === 'waiting' || p.state === 'cancelled' ? p.at : timeOf(p));
const kindLabel = { text: 'Text', image: 'Image', video: 'Video' };

// The laptop's posts plus the phone's posts it doesn't have yet (Post tapped while away, or sent since its last
// schedule), so Calendar and the day strip show them offline. A picked time is kept; for Next free time the laptop
// decides on arrival, so the time shown is the phone's guess, worked out in the order the posts were made.
export function withPhonePosts(laptopPosts, phonePosts) {
  const posts = [...(laptopPosts ?? [])];
  const onLaptop = new Set(posts.map((p) => p.id));
  const pending = phonePosts
    .filter((p) => p.state === 'ready' || p.state === 'sending' || (p.state === 'handed' && !onLaptop.has(p.sendId)))
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const p of pending) {
    const kind = postKind(p.media);
    const picked = p.when?.mode === 'picked' && Number.isFinite(p.when.at);
    const now = p.when?.mode === 'now';
    const guess = p.state !== 'handed' && !picked;
    const at = p.state === 'handed' && Number.isFinite(p.at) ? p.at
      : picked ? p.when.at : now ? Date.now() : nextFreeTime(takenSlots(posts), kind, Date.now(), p.platforms);
    posts.push({
      id: p.id, onPhone: true, guess, state: 'waiting', at, kind, platforms: p.platforms, text: p.text,
      when: picked ? 'picked' : now ? 'now' : 'auto', source: 'phone', files: p.media.map(({ name }) => ({ name })),
    });
  }
  return posts;
}

export function statusOf(p) {
  if (p.state === 'cancelled') return { tone: 'off', text: 'Cancelled' };
  if (p.onPhone) return { tone: 'wait', text: p.guess ? 'Not sent yet · the laptop sets the time' : 'Not sent yet' };
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
      if ((action === 'cancel' || action === 'delete') && !data?.post) onClose();
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
            {p.when === 'picked' ? 'Time you picked' : p.when === 'now' ? 'Immediately' : 'Next free time'} · {kindLabel[p.kind]} · from the {p.source === 'web' ? 'web page' : 'phone'}
          </Text>
          {p.onPhone ? <Text style={styles.small}>Not sent yet: it's on this phone until it reaches the laptop{p.guess ? ', which sets its time then' : ''}.</Text> : null}
          {p.state === 'cancelled' ? <Text style={styles.small}>Cancelled: it didn't go out.</Text> : null}
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
                <Button label="Move" disabled={busy || !(at > Date.now()) || Boolean(outsideHours(at))} onPress={() => run('move', { at })} />
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
          {p.state !== 'posting' && connected && !mode ? (
            <Button kind="danger" icon="delete-outline" label="Delete everywhere" disabled={busy} onPress={() => run('delete')} />
          ) : null}
          {p.state !== 'waiting' && p.state !== 'posting' && !connected ? <Text style={styles.small}>Connect to the laptop to delete it.</Text> : null}
          {message ? <Text style={styles.warning}>{message}</Text> : null}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

// The day view, as in the Scheduling mockup: 36 px an hour from 9 AM to 11 PM (wider if a post is outside them).
const HOUR_PX = 36;
const HOUR_MS = 60 * 60 * 1000;
const TEXT_PX = 26;
const MEDIA_PX = 50;
const names = (p, platforms) => p.platforms.map((id) => platforms.find((x) => x.id === id)?.name ?? id).join(', ');

// Three looks only (decided 2026-11-19): scheduled, posted (✓, or ✕ when a platform failed) and cancelled. Who
// picked the time, where it came from and "not sent yet" are in the post's details.
const lookOf = (p) => (p.state === 'cancelled' ? 'cancelled' : p.state === 'waiting' || p.state === 'posting' ? 'scheduled' : 'posted');

function Event({ p, top, place, platforms, onPress }) {
  const look = lookOf(p);
  const status = statusOf(p);
  const media = p.kind === 'image' || p.kind === 'video';
  const mark = look === 'posted' ? (status.tone === 'fail' ? '✕ ' : '✓ ') : '';
  const line = `${formatTime(when(p))} · ${kindLabel[p.kind] ?? 'Post'}`;
  const light = look === 'scheduled';
  const width = 100 / place.cols;
  const struck = look === 'cancelled' && { textDecorationLine: 'line-through' };
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${line}, ${names(p, platforms)}, ${status.text}`}
      style={[styles.event, { top, height: media ? MEDIA_PX : TEXT_PX, left: `${place.col * width}%`, width: `${width}%` }, styles[`ev_${look}`], !media && styles.eventChip]}>
      {media ? (<>
        <Text style={[styles.eventTitle, { color: light ? '#fff' : colors.text }, struck]} numberOfLines={1}>
          <Text style={{ color: status.tone === 'fail' ? colors.danger : colors.ok }}>{mark}</Text>{line}
        </Text>
        <Text style={[styles.eventSub, { color: light ? '#fff' : colors.muted }, struck]} numberOfLines={1}>{names(p, platforms)}</Text>
      </>) : (
        <Text style={[styles.eventSub, { color: light ? '#fff' : colors.text }, struck]} numberOfLines={1}>
          <Text style={{ color: status.tone === 'fail' ? colors.danger : colors.ok }}>{mark}</Text>{line} · {names(p, platforms)}
        </Text>
      )}
    </Pressable>
  );
}

// The ⓘ sheet: what the three looks mean (instead of a legend row, decided 2026-11-19).
function Key({ onClose }) {
  return (
    <Portal>
      <Dialog visible onDismiss={onClose} style={{ backgroundColor: colors.bg }}>
        <Dialog.Title style={styles.keyTitle}>What the colours mean</Dialog.Title>
        <Dialog.Content style={{ gap: 12 }}>
          {/* Small samples of the real posts, so the key looks exactly like the Calendar (squares read as tick boxes). */}
          <View style={{ gap: 4 }}>
            <View style={[styles.sample, styles.ev_scheduled]}><Text style={[styles.sampleText, { color: '#fff' }]}>9:00 AM · Text</Text></View>
            <Text style={styles.keyText}>Scheduled: waiting to go out</Text>
          </View>
          <View style={{ gap: 4 }}>
            <View style={[styles.sample, styles.ev_posted]}><Text style={styles.sampleText}><Text style={{ color: colors.ok }}>✓ </Text>9:00 AM · Text</Text></View>
            <Text style={styles.keyText}>Posted: ✓, or a red ✕ when a platform failed</Text>
          </View>
          <View style={{ gap: 4 }}>
            <View style={[styles.sample, styles.ev_cancelled]}><Text style={[styles.sampleText, { textDecorationLine: 'line-through' }]}>9:00 AM · Text</Text></View>
            <Text style={styles.keyText}>Cancelled: didn't go out</Text>
          </View>
          <Text style={styles.small}>Tap a post for its details: who picked the time, where it came from, whether it's been sent to the laptop yet.</Text>
        </Dialog.Content>
        <Dialog.Actions><Button kind="text" label="OK" onPress={onClose} /></Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

// onOpenPhone(id): a phone post not yet on the laptop opens in Write, like on the Posts tab.
export default function Calendar({ schedule, platforms, connected, act, onOpenPhone }) {
  const [day, setDay] = useState(() => new Date().setHours(0, 0, 0, 0));
  const [openId, setOpenId] = useState(null);
  const [key, setKey] = useState(false);
  const posts = schedule.posts ?? [];
  const open = posts.find((p) => p.id === openId);
  const weekStart = mondayOf(day);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const now = Date.now();
  const today = new Date(now).setHours(0, 0, 0, 0);
  const onDay = (d) => posts.filter((p) => Number.isFinite(when(p)) && new Date(when(p)).toDateString() === new Date(d).toDateString());
  const own = onDay(day).sort((a, b) => when(a) - when(b));
  // Moving a week keeps the weekday; Today goes back to today.
  const goWeek = (n) => setDay(addDays(day, 7 * n));
  const count = (kind) => own.filter((p) => p.kind === kind && p.state !== 'cancelled').length;

  const firstHour = Math.min(SCHEDULE.startHour, ...own.map((p) => new Date(when(p)).getHours()));
  const lastHour = Math.max(SCHEDULE.endHour, ...own.map((p) => new Date(when(p)).getHours() + 1));
  const first = new Date(day).setHours(firstHour, 0, 0, 0);
  const hours = [];
  for (let h = firstHour; h <= lastHour; h += 2) hours.push(new Date(day).setHours(h, 0, 0, 0));
  const height = (lastHour - firstHour) * HOUR_PX;
  const y = (ms) => ((ms - first) / HOUR_MS) * HOUR_PX;
  // Posts at the same or overlapping times sit side by side (sideBySide in rules.js, as on the web page).
  const boxes = own.map((p) => { const top = y(when(p)); return { top, bottom: top + (p.kind === 'text' ? TEXT_PX : MEDIA_PX) }; });
  const places = sideBySide(boxes);
  const isToday = day === today;

  return (
    <Screen>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <BrandMark size={24} />
          <Text style={[styles.title, { marginLeft: 8 }]}>Calendar</Text>
          <IconButton icon="information-outline" size={20} iconColor={colors.accent} accessibilityLabel="What the colours mean" onPress={() => setKey(true)} style={{ margin: 0 }} />
        </View>
        <Text style={styles.small}>Videos {count('video')}/{SCHEDULE.perDay.video} · Images {count('image')}/{SCHEDULE.perDay.image}</Text>
      </View>
      <View style={styles.weekNav}>
        <IconButton icon="chevron-left" accessibilityLabel="Previous week" onPress={() => goWeek(-1)} style={{ margin: 0 }} />
        <Text style={styles.weekText}>{formatDay(weekStart).split(' ').slice(1).join(' ')} – {formatDay(addDays(weekStart, 6)).split(' ').slice(1).join(' ')}</Text>
        <IconButton icon="chevron-right" accessibilityLabel="Next week" onPress={() => goWeek(1)} style={{ margin: 0 }} />
        <View style={{ flex: 1 }} />
        {/* It goes to today's day, so it says Today (the web page's jumps to the week, so says This week). */}
        <Button kind="text" compact label="Today" disabled={day === today} onPress={() => setDay(today)} />
      </View>
      <View style={styles.days}>
        {days.map((d) => {
          const on = d === day;
          const n = onDay(d).length;
          const past = d < today;
          return (
            <Pressable key={d} onPress={() => setDay(d)} style={[styles.dayButton, on && styles.dayOn]} accessibilityRole="button" accessibilityState={{ selected: on }}
              accessibilityLabel={`${formatDay(d)}, ${n} post${n === 1 ? '' : 's'}`}>
              <Text style={[styles.dayName, past && !on && { color: colors.muted }, on && { color: '#fff' }]}>{formatDay(d).split(' ')[0]}</Text>
              <Text style={[styles.dayNumber, past && !on && { color: colors.muted }, on && { color: '#fff' }]}>{new Date(d).getDate()}</Text>
              <Text style={[styles.dots, on && { color: '#fff' }]}>{n ? '●'.repeat(Math.min(n, 3)) : ' '}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.small}>
        {schedule.at ? `From the laptop, ${connected ? 'live' : `as of ${whenLabel(schedule.at)}`}` : "This phone's posts only; connect to the laptop for the rest"}
      </Text>
      <ScrollView style={styles.timeline} contentContainerStyle={{ height: height + 24, paddingTop: 12 }}>
        <View style={{ height }}>
          {hours.map((h) => <Text key={h} style={[styles.hour, { top: y(h) - 6 }]}>{formatTime(h).replace(':00', '')}</Text>)}
          {hours.map((h) => <View key={`l${h}`} style={[styles.hourLine, { top: y(h) }]} />)}
          {isToday && now >= first && y(now) <= height ? (<>
            <View style={[styles.nowLine, { top: y(now) }]} />
            <View style={[styles.nowDot, { top: y(now) - 4 }]} />
          </>) : null}
          <View style={styles.lane}>
            {own.map((p, n) => (
              <Event key={p.id} p={p} top={boxes[n].top} place={places[n]} platforms={platforms} onPress={() => (p.onPhone ? onOpenPhone(p.id) : setOpenId(p.id))} />
            ))}
          </View>
          {own.length ? null : (
            <View style={styles.nothing}>
              <BrandMark size={40} />
              <Text style={styles.small}>Nothing on this day.</Text>
            </View>
          )}
        </View>
      </ScrollView>
      {key ? <Key onClose={() => setKey(false)} /> : null}
      {open ? <PostSheet p={open} posts={posts} platforms={platforms} connected={connected} act={act} onClose={() => setOpenId(null)} /> : null}
    </Screen>
  );
}

export const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  link: { fontSize: 15, color: colors.accent, fontWeight: '600' },
  small: { fontSize: 13, color: colors.muted },
  weekNav: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  weekText: { fontSize: 14, fontWeight: '600', color: colors.text },
  days: { flexDirection: 'row', gap: 4, marginVertical: 6 },
  dayButton: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 10, gap: 1 },
  dayOn: { backgroundColor: colors.accent },
  dayName: { fontSize: 11, color: colors.text },
  dayNumber: { fontSize: 16, fontWeight: '600', color: colors.text },
  dots: { fontSize: 8, color: colors.accent, letterSpacing: 1 },
  timeline: { flex: 1, marginTop: 6, borderTopWidth: 1, borderTopColor: '#eeecf2' },
  hour: { position: 'absolute', left: 0, width: 44, fontSize: 11, color: colors.muted, textAlign: 'right' },
  hourLine: { position: 'absolute', left: 52, right: 0, height: 1, backgroundColor: '#f1eff4' },
  nowLine: { position: 'absolute', left: 50, right: 0, height: 2, backgroundColor: colors.danger },
  nowDot: { position: 'absolute', left: 46, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  nothing: { position: 'absolute', left: 58, right: 0, top: 48, alignItems: 'center', gap: 10 },
  // The events' lane, right of the hours; each event takes its share of it (side by side when they overlap).
  lane: { position: 'absolute', left: 58, right: 0, top: 0, bottom: 0 },
  event: { position: 'absolute', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, justifyContent: 'center', gap: 2, overflow: 'hidden', borderWidth: 2, borderColor: colors.bg },
  eventChip: { borderRadius: 8, paddingVertical: 0 },
  eventTitle: { fontSize: 12, fontWeight: '600' },
  eventSub: { fontSize: 12 },
  ev_scheduled: { backgroundColor: colors.accent },
  ev_posted: { backgroundColor: colors.soft },
  ev_cancelled: { backgroundColor: colors.soft, opacity: 0.7 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  keyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: colors.text },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  keyText: { fontSize: 14, color: colors.text, flex: 1 },
  sample: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  sampleText: { fontSize: 12, color: colors.text },
  card: { borderWidth: 1, borderColor: colors.line, borderLeftWidth: 4, borderRadius: 8, padding: 8, gap: 3 },
  wait: { borderLeftColor: colors.accent },
  ok: { borderLeftColor: colors.ok },
  fail: { borderLeftColor: colors.danger },
  off: { borderLeftColor: colors.line },
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
