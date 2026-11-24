// One card per chosen platform: its count, problems and notes, and (opened) its own text and FIELDS settings.
// Cards instead of the web page's tabs, so they can't be mistaken for the "Post to" pills.
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Dialog, Portal, RadioButton, Switch } from 'react-native-paper';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { FIELDS } from '../../public/fields.js';
import { countFor, effectiveText, resolveTitle, splitThread } from '../../public/rules.js';
import { mediaFile } from './store';
import Preview from './Preview';
import { BackgroundPicker, StylePicker } from './Slides';
import { colors, Text, TextInput } from './ui';
import Logo from './Logo';

const metaOf = (media) => media.map(({ name, type, size, duration }) => ({ name, type, size, duration }));

// "312 / 280", or "312 · 2 posts" when X will split it into a thread (as counter() in public/js/main.js).
function counter(p, text, own) {
  const n = countFor(p.id, text);
  if (p.threads && own?.thread && n > p.limit) return { label: `${n.toLocaleString()} · ${splitThread(p.id, text, p.limit).length} posts`, over: false };
  return { label: `${n.toLocaleString()} / ${p.limit.toLocaleString()}`, over: n > p.limit };
}

export default function PlatformCard({ p, post, check, editable, onOption, onText, onPickImage, onRemoveImage, drawSlides }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const spec = FIELDS[p.id] ?? {};
  const own = post.options?.[p.id] ?? {};
  const edited = typeof own.text === 'string';
  const text = effectiveText(post.text, own, p.id);
  const count = counter(p, text, own);
  const media = metaOf(post.media);
  const visible = (f) => !f.when || f.when({ media, values: own });

  const field = (f) => (
    <Field
      key={f.key}
      f={f}
      value={own[f.key]}
      values={own}
      post={post}
      editable={editable}
      placeholder={f.key === 'title' ? `Defaults to: ${resolveTitle(post.text, '') || 'the first line of your post'}` : f.placeholder}
      onChange={(value) => onOption(p.id, f, value)}
      onPickImage={() => onPickImage(p.id, f)}
      onRemoveImage={() => onRemoveImage(p.id, f)}
    />
  );
  const main = (spec.main ?? []).filter(visible);
  const extra = (spec.more ?? []).filter(visible);

  return (
    <View style={styles.card}>
      <Pressable style={styles.head} onPress={() => setOpen(!open)}>
        <Logo id={p.id} name={p.name} size={20} />
        <Text style={[styles.count, count.over && { color: colors.danger }]}>{count.label}</Text>
        <Text style={styles.toggle}>{open ? 'Close' : 'Settings ›'}</Text>
      </Pressable>
      {check.problems.map((m) => <Text key={m} style={styles.problem}>• {m}</Text>)}
      {check.notes.map((m) => <Text key={m} style={styles.note}>• {m}</Text>)}

      {open ? (
        <View style={styles.body}>
          {main.filter((f) => f.beforeText).map(field)}
          <Text style={styles.label}>{spec.textLabel ?? 'Text'}</Text>
          <TextInput
            style={styles.textBox}
            multiline
            editable={editable}
            value={text}
            placeholder="No text"
            placeholderTextColor={colors.placeholder}
            onChangeText={(value) => onText(p.id, value)}
            textAlignVertical="top"
          />
          {edited
            ? <Pressable onPress={() => onText(p.id, null)} disabled={!editable}><Text style={styles.link}>Use the main post's text again</Text></Pressable>
            : <Text style={styles.hint}>Follows the main post until you edit it here.</Text>}
          {main.filter((f) => !f.beforeText).map(field)}
          {extra.length ? (
            <Pressable onPress={() => setMore(!more)}><Text style={styles.link}>{more ? 'Fewer options' : 'More options'}</Text></Pressable>
          ) : null}
          {more ? extra.map(field) : null}
          {spec.info ? <Text style={styles.hint}>{spec.info}</Text> : null}
          <Preview p={p} post={post} drawSlides={drawSlides} />
        </View>
      ) : null}
    </View>
  );
}

// Values are kept as a browser's pickers give them, in the phone's own time: YYYY-MM-DD, or YYYY-MM-DDTHH:MM.
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function parseLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value ?? '');
  return m ? new Date(m[1], m[2] - 1, m[3], m[4] ?? 0, m[5] ?? 0) : null;
}

// Android's own date dialog, then its time dialog for a date and time. Clear empties the field.
function DateField({ f, value, editable, onChange }) {
  const withTime = f.type === 'datetime-local';
  const current = parseLocal(value);
  const choose = () => {
    const start = current ?? new Date();
    DateTimePickerAndroid.open({
      value: start,
      mode: 'date',
      onValueChange: (_, day) => {
        if (!withTime) { onChange(dayOf(day)); return; }
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), start.getHours(), start.getMinutes());
        DateTimePickerAndroid.open({
          value: at,
          mode: 'time',
          is24Hour: true,
          onValueChange: (__, time) => onChange(`${dayOf(day)}T${timeOf(time)}`),
        });
      },
    });
  };
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{f.label}</Text>
      <View style={styles.imageRow}>
        <Pressable style={[styles.input, { flex: 1 }]} onPress={() => editable && choose()} accessibilityRole="button">
          <Text style={current ? styles.selectText : styles.placeholder}>
            {current ? (withTime ? `${dayOf(current)}  ${timeOf(current)}` : dayOf(current)) : withTime ? 'Choose a date and time' : 'Choose a date'}
          </Text>
        </Pressable>
        {editable && value ? <Pressable onPress={() => onChange('')} hitSlop={8}><Text style={styles.remove}>Clear</Text></Pressable> : null}
      </View>
    </View>
  );
}

function Field({ f, value, values, post, editable, placeholder, onChange, onPickImage, onRemoveImage }) {
  let control;
  if (f.type === 'slideStyle') {
    control = <StylePicker f={f} value={value} background={values.slideBackground} editable={editable} onChange={onChange} />;
  } else if (f.type === 'slideBackground') {
    control = <BackgroundPicker f={f} value={value} editable={editable} onChange={onChange} />;
  } else if (f.type === 'check') {
    control = (
      <View style={styles.checkRow}>
        <Switch value={Boolean(value)} onValueChange={onChange} disabled={!editable} color={colors.accent} accessibilityLabel={f.label} />
        <Text style={styles.checkLabel}>{f.label}</Text>
      </View>
    );
  } else if (f.type === 'select') {
    control = <Select f={f} value={value} editable={editable} onChange={onChange} />;
  } else if (f.type === 'image') {
    control = (
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>{f.label}</Text>
        <View style={styles.imageRow}>
          {value?.file ? <Image source={{ uri: mediaFile(post, value).uri }} style={styles.imageThumb} /> : null}
          {editable ? <Pressable onPress={onPickImage}><Text style={styles.link}>{value?.file ? 'Replace image' : 'Choose image'}</Text></Pressable> : null}
          {editable && value?.file ? <Pressable onPress={onRemoveImage}><Text style={styles.remove}>Remove</Text></Pressable> : null}
        </View>
      </View>
    );
  } else if (f.type === 'date' || f.type === 'datetime-local') {
    control = <DateField f={f} value={value} editable={editable} onChange={onChange} />;
  } else {
    control = (
      <View style={{ gap: 4 }}>
        <Text style={styles.label}>{f.label}</Text>
        <TextInput
          style={styles.input}
          editable={editable}
          value={String(value ?? '')}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          keyboardType={f.type === 'number' ? 'decimal-pad' : 'default'}
          multiline={f.type === 'textarea'}
          autoCapitalize="none"
          onChangeText={onChange}
        />
      </View>
    );
  }
  return (
    <View style={{ gap: 2 }}>
      {control}
      {f.hint ? <Text style={styles.hint}>{f.hint}</Text> : null}
    </View>
  );
}

function Select({ f, value, editable, onChange }) {
  const [open, setOpen] = useState(false);
  const current = f.choices.find(([v]) => v === value)?.[1] ?? 'Choose';
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{f.label}</Text>
      <Pressable style={styles.input} onPress={() => editable && setOpen(true)}>
        <Text style={styles.selectText}>{current} ▾</Text>
      </Pressable>
      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)} style={styles.sheet}>
          <Dialog.Title style={styles.sheetTitle}>{f.label}</Dialog.Title>
          <Dialog.ScrollArea style={{ maxHeight: 420, paddingHorizontal: 0 }}>
            <ScrollView>
              <RadioButton.Group value={value ?? ''} onValueChange={(v) => { onChange(v); setOpen(false); }}>
                {f.choices.map(([v, label]) => (
                  <RadioButton.Item key={v || '(none)'} value={v} label={label} mode="android" color={colors.accent} labelStyle={styles.choiceText} />
                ))}
              </RadioButton.Group>
            </ScrollView>
          </Dialog.ScrollArea>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.soft, borderRadius: 8, padding: 10, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { flex: 1, color: colors.muted },
  toggle: { color: colors.accent },
  problem: { color: colors.danger },
  note: { color: colors.muted },
  body: { marginTop: 8, gap: 10 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  textBox: { minHeight: 90, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, fontSize: 15, color: colors.text },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, color: colors.text },
  selectText: { fontSize: 15, color: colors.text },
  placeholder: { fontSize: 15, color: colors.placeholder },
  hint: { fontSize: 12, color: colors.muted },
  link: { color: colors.accent },
  remove: { color: colors.danger },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkLabel: { flex: 1, color: colors.text },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  imageThumb: { width: 64, height: 64, borderRadius: 6 },
  sheet: { backgroundColor: colors.bg },
  sheetTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: colors.text },
  choiceText: { fontSize: 15, color: colors.text, fontFamily: 'Inter_400Regular' },
});
