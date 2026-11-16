// One card per chosen platform: its count, problems and notes, and (opened) its own text and FIELDS settings.
// Cards instead of the web page's tabs, so they can't be mistaken for the "Post to" pills.
import { useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { FIELDS } from '../../public/fields.js';
import { countFor, effectiveText, resolveTitle, splitThread } from '../../public/rules.js';
import { mediaFile } from './store';
import { colors } from './ui';

const metaOf = (media) => media.map(({ name, type, size, duration }) => ({ name, type, size, duration }));

// "312 / 280", or "312 · 2 posts" when X will split it into a thread (as counter() in public/js/main.js).
function counter(p, text, own) {
  const n = countFor(p.id, text);
  if (p.threads && own?.thread && n > p.limit) return { label: `${n.toLocaleString()} · ${splitThread(p.id, text, p.limit).length} posts`, over: false };
  return { label: `${n.toLocaleString()} / ${p.limit.toLocaleString()}`, over: n > p.limit };
}

export default function PlatformCard({ p, post, check, editable, onOption, onText, onPickImage, onRemoveImage }) {
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
        <Text style={styles.name}>{p.name}</Text>
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
        </View>
      ) : null}
    </View>
  );
}

// Dates are typed, as the phone has no date picker yet: YYYY-MM-DD, and for a time YYYY-MM-DD HH:MM.
const DATE_HINT = { date: 'YYYY-MM-DD', 'datetime-local': 'YYYY-MM-DD HH:MM (24-hour, your time)' };

function Field({ f, value, post, editable, placeholder, onChange, onPickImage, onRemoveImage }) {
  let control;
  if (f.type === 'check') {
    control = (
      <View style={styles.checkRow}>
        <Switch value={Boolean(value)} onValueChange={onChange} disabled={!editable} />
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
  } else {
    const isDate = f.type in DATE_HINT;
    control = (
      <View style={{ gap: 4 }}>
        <Text style={styles.label}>{f.label}</Text>
        <TextInput
          style={styles.input}
          editable={editable}
          value={isDate ? String(value ?? '').replace('T', ' ') : String(value ?? '')}
          placeholder={isDate ? DATE_HINT[f.type] : placeholder}
          keyboardType={f.type === 'number' ? 'decimal-pad' : isDate ? 'numbers-and-punctuation' : 'default'}
          multiline={f.type === 'textarea'}
          autoCapitalize="none"
          // The rules and the laptop read a time as YYYY-MM-DDTHH:MM, the format a browser's picker gives.
          onChangeText={(text) => onChange(f.type === 'datetime-local' ? text.trim().replace(' ', 'T') : text)}
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
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{f.label}</Text>
            <FlatList
              data={f.choices}
              keyExtractor={([v]) => v || '(none)'}
              renderItem={({ item: [v, label] }) => (
                <Pressable style={styles.choice} onPress={() => { onChange(v); setOpen(false); }}>
                  <Text style={[styles.choiceText, v === value && { color: colors.accent, fontWeight: '600' }]}>{label}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.soft, borderRadius: 8, padding: 10, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontWeight: '600', color: colors.text },
  count: { flex: 1, color: colors.muted },
  toggle: { color: colors.accent },
  problem: { color: colors.danger },
  note: { color: colors.muted },
  body: { marginTop: 8, gap: 10 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  textBox: { minHeight: 90, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, fontSize: 15, color: colors.text },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, color: colors.text },
  selectText: { fontSize: 15, color: colors.text },
  hint: { fontSize: 12, color: colors.muted },
  link: { color: colors.accent },
  remove: { color: colors.danger },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkLabel: { flex: 1, color: colors.text },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  imageThumb: { width: 64, height: 64, borderRadius: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '70%' },
  sheetTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8, color: colors.text },
  choice: { paddingVertical: 10 },
  choiceText: { fontSize: 15, color: colors.text },
});
