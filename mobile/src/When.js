// "When" on the Review step (and the Move dialog): the next free time, or a day and time you pick, with the
// day strip and the same warnings as the web page (slot rules in public/rules.js). The laptop has the final say:
// it works out the next free time when the post arrives.
import { Pressable, StyleSheet, View } from 'react-native';
import { Chip, RadioButton } from 'react-native-paper';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { nextFreeTime, slotProblems, outsideHours, dayStrip, formatTime, formatDay, SCHEDULE } from '../../public/rules.js';
import { colors, Text } from './ui';

export const timeOf = (p) => p.postedAt ?? p.at;

// The laptop's posts that hold a time (from its last schedule), for the slot rules; leave out the post being moved.
export const takenSlots = (posts, except) => (posts ?? [])
  .filter((p) => p.id !== except && p.state !== 'cancelled' && Number.isFinite(timeOf(p)))
  .map((p) => ({ id: p.id, at: timeOf(p), kind: p.kind, platforms: p.platforms }));

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// "Today, 6:00 PM", "Tomorrow, 9:00 AM", "Thu 19 Nov, 3:30 PM".
export function whenLabel(ms) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = sameDay(ms, Date.now()) ? 'Today' : sameDay(ms, tomorrow.getTime()) ? 'Tomorrow' : formatDay(ms);
  return `${day}, ${formatTime(ms)}`;
}

const SOON_MS = 60_000;
const LEAD_MS = 5 * 60_000;

// Where Pick a time starts: the next free time, but at least 5 minutes ahead on a 5-minute mark, so it isn't
// already in the past by the time Schedule is tapped.
export function firstPick(taken, kind, platforms, now = Date.now()) {
  const from = Math.ceil((now + LEAD_MS) / LEAD_MS) * LEAD_MS;
  return nextFreeTime(taken, kind, from, platforms);
}

// What Post does: { mode, at, now, label, blocked }. when: the post's { mode: 'auto' | 'picked', at }.
export function whenChoice(kind, taken, when, platforms = []) {
  // Immediately: as soon as the laptop has it, whatever the posting hours and gaps (decided 2026-11-19).
  if (when?.mode === 'now') return { mode: 'now', at: Date.now(), now: true };
  if (when?.mode === 'picked') {
    if (!Number.isFinite(when.at)) return { mode: 'picked', blocked: 'Choose a day and a time' };
    if (when.at <= Date.now()) return { mode: 'picked', blocked: 'That time has passed. Pick a later time.' };
    if (outsideHours(when.at)) return { mode: 'picked', blocked: outsideHours(when.at) };
    return { mode: 'picked', at: when.at, now: false, label: `Schedule for ${whenLabel(when.at)}` };
  }
  const at = nextFreeTime(taken, kind, Date.now(), platforms);
  if (at - Date.now() < SOON_MS) return { mode: 'auto', at, now: true };
  return { mode: 'auto', at, now: false, label: `Post at ${whenLabel(at)}` };
}

// One day's posting hours: free (green), too close to another post (orange), posts, and your time.
export function Strip({ taken, kind, day, picked, platforms }) {
  const s = dayStrip(taken, kind, day, platforms);
  const span = s.end - s.start;
  const pos = (ms) => `${((ms - s.start) / span) * 100}%`;
  const hours = [];
  for (let h = SCHEDULE.startHour; h <= SCHEDULE.endHour; h += 3) hours.push(new Date(s.start).setHours(h));
  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.bar, s.full && { backgroundColor: '#fff4e5' }]}>
        {s.tooClose.map((r) => (
          <View key={r.from} style={[styles.range, { left: pos(r.from), width: `${((r.to - r.from) / span) * 100}%` }]} />
        ))}
        {s.posts.map((p) => <View key={`${p.id}-${p.at}`} style={[styles.post, p.kind === 'text' && styles.textPost, { left: pos(p.at) }]} />)}
        {Number.isFinite(picked) && picked >= s.start && picked <= s.end ? <View style={[styles.pick, { left: pos(picked) }]} /> : null}
      </View>
      <View style={styles.hours}>
        {hours.map((h) => <Text key={h} style={[styles.hour, { left: pos(h) }]}>{formatTime(h).replace(':00', '')}</Text>)}
      </View>
      <Text style={styles.legend}>
        Green: free · Orange: too close to a post · Plum: a post · Line: your time
      </Text>
      {s.full ? <Text style={styles.legend}>This day already has {SCHEDULE.perDay[kind]} {kind === 'video' ? 'videos' : 'image posts'}.</Text> : null}
    </View>
  );
}

const startOfDay = (ms) => new Date(ms).setHours(0, 0, 0, 0);
const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };

// Day chips, Android's date and time dialogs, the strip and the warnings. at: the picked time (ms) or null.
export function Picker({ at, kind, taken, platforms = [], onChange }) {
  const today = startOfDay(Date.now());
  const chosen = Number.isFinite(at) ? at : null;
  const day = chosen ?? firstPick(taken, kind, platforms);
  const setDay = (d) => {
    const base = new Date(day);
    const next = new Date(d);
    next.setHours(base.getHours(), base.getMinutes(), 0, 0);
    onChange(next.getTime());
  };
  const chips = [today, addDays(today, 1), addDays(today, 2), addDays(today, 3)];
  const other = !chips.some((d) => sameDay(d, day));
  const otherDay = () => DateTimePickerAndroid.open({ value: new Date(day), mode: 'date', minimumDate: new Date(), onValueChange: (_, d) => setDay(d.getTime()) });
  const pickTime = () => DateTimePickerAndroid.open({
    value: new Date(day), mode: 'time', is24Hour: false,
    onValueChange: (_, t) => { const d = new Date(day); d.setHours(t.getHours(), t.getMinutes(), 0, 0); onChange(d.getTime()); },
  });
  const check = slotProblems(taken, kind, chosen ?? NaN, Date.now(), platforms);
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.chips}>
        {chips.map((d, i) => {
          const on = sameDay(d, day);
          return (
            <Chip key={d} selected={on} showSelectedCheck={false} onPress={() => setDay(d)} style={[styles.chip, on && styles.chipOn]} textStyle={[styles.chipText, on && styles.chipTextOn]}>
              {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDay(d).split(' ').slice(0, 2).join(' ')}
            </Chip>
          );
        })}
        <Chip selected={other} showSelectedCheck={false} icon="calendar" onPress={otherDay} style={[styles.chip, other && styles.chipOn]} textStyle={[styles.chipText, other && styles.chipTextOn]}>
          {other ? formatDay(day) : 'Other…'}
        </Chip>
      </View>
      <Strip taken={taken} kind={kind} day={day} picked={chosen} platforms={platforms} />
      <Pressable onPress={pickTime} style={[styles.time, (check.warnings.length || check.past) && styles.timeWarn, check.outside && styles.timeError]} accessibilityRole="button">
        <Text style={styles.timeLabel}>Time</Text>
        <Text style={styles.timeValue}>{chosen ? formatTime(chosen) : 'Choose a time'}</Text>
      </Pressable>
      {check.past ? <Text style={[styles.warning, styles.error]}>That time has passed. Pick a later time.</Text> : null}
      {check.outside ? (
        <View style={[styles.warning, styles.errorBox]}>
          <Text style={[styles.warningText, styles.error]}>{check.outside}</Text>
          <Pressable onPress={() => onChange(check.nextFree)}><Text style={styles.link}>Use the next free time: {whenLabel(check.nextFree)}</Text></Pressable>
        </View>
      ) : null}
      {check.warnings.length ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>{check.warnings.join(' ')}</Text>
          <Pressable onPress={() => onChange(check.nextFree)}><Text style={styles.link}>Use the next free time: {whenLabel(check.nextFree)}</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

// The Review step's When: two choices; Pick a time opens the picker.
export default function When({ kind, taken, when, platforms, youtubeVideo, editable, onChange }) {
  const next = nextFreeTime(taken, kind, Date.now(), platforms);
  const nextText = next - Date.now() < SOON_MS ? 'Now' : whenLabel(next);
  const picked = when?.mode === 'picked';
  const now = when?.mode === 'now';
  const auto = !picked && !now;
  // A fresh start each time, a few minutes ahead: an old picked time would often have passed already.
  const startPicking = () => { if (!picked) onChange({ mode: 'picked', at: firstPick(taken, kind, platforms) }); };
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.label}>When</Text>
      <Pressable disabled={!editable} onPress={() => onChange({ mode: 'auto', at: null })} style={[styles.option, auto && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ checked: auto }}>
        <View style={styles.optionRow}>
          <RadioButton.Android value="auto" status={auto ? 'checked' : 'unchecked'} disabled={!editable} color={colors.accent} onPress={() => onChange({ mode: 'auto', at: null })} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>Next free time</Text>
            <Text style={styles.optionDetail}>{nextText}</Text>
          </View>
        </View>
      </Pressable>
      <View style={[styles.option, picked && styles.optionOn, { gap: 12 }]}>
        <Pressable disabled={!editable} onPress={startPicking} accessibilityRole="radio" accessibilityState={{ checked: picked }}>
          <View style={styles.optionRow}>
            <RadioButton.Android value="picked" status={picked ? 'checked' : 'unchecked'} disabled={!editable} color={colors.accent} onPress={startPicking} />
            <Text style={styles.optionTitle}>Pick a time</Text>
          </View>
        </Pressable>
        {picked ? <Picker at={when.at} kind={kind} taken={taken} platforms={platforms} onChange={(at) => onChange({ mode: 'picked', at })} /> : null}
        {picked && youtubeVideo ? <Text style={styles.optionDetail}>YouTube is uploaded as soon as the laptop gets it, and goes public at this time.</Text> : null}
      </View>
      <Pressable disabled={!editable} onPress={() => onChange({ mode: 'now', at: null })} style={[styles.option, now && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ checked: now }}>
        <View style={styles.optionRow}>
          <RadioButton.Android value="now" status={now ? 'checked' : 'unchecked'} disabled={!editable} color={colors.accent} onPress={() => onChange({ mode: 'now', at: null })} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>Immediately</Text>
            <Text style={styles.optionDetail}>As soon as the laptop has it, whatever the posting hours and gaps</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  option: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 8, gap: 2 },
  optionOn: { borderWidth: 2, borderColor: colors.accent, padding: 7 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  optionTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  optionDetail: { fontSize: 13, color: colors.muted },
  bar: { height: 30, borderRadius: 8, backgroundColor: '#e5f4ea', overflow: 'hidden' },
  range: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#fbe3c4' },
  post: { position: 'absolute', top: 5, bottom: 5, width: 8, marginLeft: -4, borderRadius: 4, backgroundColor: colors.accent },
  textPost: { width: 4, marginLeft: -2, opacity: 0.6 },
  pick: { position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1.5, backgroundColor: colors.text },
  hours: { height: 14 },
  hour: { position: 'absolute', fontSize: 11, color: colors.muted },
  legend: { fontSize: 11, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.text, fontFamily: 'Inter_500Medium' },
  chipTextOn: { color: '#fff' },
  time: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10 },
  timeWarn: { borderWidth: 2, borderColor: colors.warn },
  timeError: { borderWidth: 2, borderColor: colors.danger },
  errorBox: { backgroundColor: '#fdecee', borderColor: '#e8a3ab' },
  timeLabel: { fontSize: 13, fontWeight: '600', color: colors.muted },
  timeValue: { fontSize: 15, color: colors.text },
  warning: { backgroundColor: '#fff4e5', borderWidth: 1, borderColor: '#e3b878', borderRadius: 10, padding: 10, gap: 6 },
  warningText: { fontSize: 13, color: colors.text },
  error: { color: colors.danger },
  link: { fontSize: 13, fontWeight: '600', color: colors.accent },
});
