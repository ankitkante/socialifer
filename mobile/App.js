import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { BackHandler, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { call, forgetPairing, loadPairing, parsePairing, savePairing } from './src/laptop';
import { handOver } from './src/handover';
import { listPosts, loadPlatforms, loadSettings, newId, pruneOldMedia, savePlatforms, savePost } from './src/store';
import Compose from './src/Compose';
import Posts from './src/Posts';
import { SubstackDialog } from './src/Substack';
import { Button, Screen, colors } from './src/ui';
import { clearLog, log, logErrors, readLog } from './src/log';
import { statusLines, tunnelProblem } from './src/status';

logErrors();

// How often to look for the laptop (and hand over ready posts) while the app is open.
const CHECK_MS = 5000;

export default function App() {
  const [pairing, setPairing] = useState(undefined); // undefined while loading, null when not paired
  const [screen, setScreen] = useState({ name: 'posts' });
  const [connection, setConnection] = useState({ state: 'checking' });
  const [posts, setPosts] = useState(() => {
    pruneOldMedia();
    return listPosts();
  });
  const [platforms, setPlatforms] = useState(() => loadPlatforms());
  const [live, setLive] = useState({});
  const openId = useRef(null);
  const checkNow = useRef(null);
  // The post just marked ready, whose Substack reminder opens once it's dealt with (see reminderFor).
  const [remind, setRemind] = useState(null);

  const refresh = useCallback(() => setPosts(listPosts()), []);

  useEffect(() => { loadPairing().then(setPairing); }, []);

  useEffect(() => {
    openId.current = screen.name === 'compose' ? screen.post.id : null;
  }, [screen]);

  useEffect(() => {
    if (!pairing) return undefined;
    let stopped = false;
    // Logged only when it changes: every 5 seconds would bury everything else.
    let last = '';
    const note = (line) => {
      if (line !== last) log(line);
      last = line;
    };
    const check = async () => {
      let hello;
      try {
        hello = await call(pairing, 'GET', '/app/hello');
      } catch (err) {
        if (stopped) return;
        setConnection({ state: 'away', message: err.message });
        note(`Laptop not reachable: ${err.message}`);
        return;
      }
      if (stopped) return;
      setConnection({ state: 'connected', status: hello.status ?? null });
      const tunnel = tunnelProblem(hello.status);
      note(`Connected to the laptop at ${pairing.host}:${pairing.port} (${hello.platforms.filter((p) => p.configured).length} platforms set up${tunnel ? `, ${tunnel}` : ''})`);
      // Kept on the phone, so the platforms and their limits are there when writing offline.
      savePlatforms(hello.platforms);
      setPlatforms(hello.platforms);
      // A hand-over error is shown on its post and logged there; it isn't a connection problem.
      try {
        const now = await handOver(pairing, refresh, openId.current);
        if (!stopped && now) setLive(now);
      } catch {}
    };
    checkNow.current = check;
    setConnection({ state: 'checking' });
    check();
    const timer = setInterval(check, CHECK_MS);
    return () => { stopped = true; checkNow.current = null; clearInterval(timer); };
  }, [pairing, refresh]);

  const close = useCallback(() => {
    setScreen({ name: 'posts' });
    refresh();
  }, [refresh]);

  // Post tapped: hand it over now rather than on the next 5-second check, so the reminder isn't kept waiting.
  const posted = useCallback((post) => {
    setRemind(post.id);
    openId.current = null;
    close();
    checkNow.current?.();
  }, [close]);

  const reminding = reminderFor(posts.find((p) => p.id === remind), connection);
  useEffect(() => {
    if (remind && reminding === null) setRemind(null);
  }, [remind, reminding]);

  if (pairing === undefined) return <View style={styles.blank} />;
  if (!pairing || screen.name === 'pair') {
    return (
      <Scanner
        onPaired={async (next) => { await savePairing(next); log(`Paired with the laptop at ${next.host}:${next.port}`); setPairing(next); setScreen({ name: 'posts' }); }}
        onCancel={pairing ? () => setScreen({ name: 'laptop' }) : null}
      />
    );
  }
  if (screen.name === 'laptop') {
    return (
      <Laptop
        pairing={pairing}
        connection={connection}
        platforms={platforms}
        onBack={() => setScreen({ name: 'posts' })}
        onPair={() => setScreen({ name: 'pair' })}
        onUnpair={async () => { await forgetPairing(); log('Unpaired from the laptop'); setPairing(null); setScreen({ name: 'posts' }); }}
        onLog={() => setScreen({ name: 'log' })}
      />
    );
  }
  if (screen.name === 'log') return <ActivityLog onBack={() => setScreen({ name: 'laptop' })} />;
  if (screen.name === 'compose') {
    return <Compose key={screen.post.id} initial={screen.post} platforms={platforms} settings={loadSettings()} onClose={close} onPosted={posted} onOpen={(post) => setScreen({ name: 'compose', post })} />;
  }
  return (
    <>
      <Posts
        posts={posts}
        live={live}
        connection={connection}
        onOpen={(post) => setScreen({ name: 'compose', post })}
        onNew={() => setScreen({
          name: 'compose',
          post: { id: newId(), text: '', platforms: loadSettings().selected, media: [], options: {}, state: 'draft', createdAt: Date.now() },
        })}
        onPair={() => setScreen({ name: 'laptop' })}
      />
      {reminding ? (
        <SubstackDialog
          post={reminding}
          onDone={() => { savePost({ ...reminding, substackDone: true }); setRemind(null); refresh(); }}
        />
      ) : null}
      <StatusBar style="dark" />
    </>
  );
}

// The Substack reminder opens once the post has been dealt with: handed to the laptop when it's connected,
// or saved here when it isn't. It doesn't wait for the platforms. Returns the post to remind about, false to
// keep waiting, or null when there's nothing to remind about (refused, deleted, or already done).
function reminderFor(post, connection) {
  if (!post || post.substackDone || post.state === 'draft') return null;
  if (post.state === 'handed' || post.state === 'done' || post.retryError) return post;
  return connection.state === 'away' ? post : false;
}

function Laptop({ pairing, connection, platforms, onBack, onPair, onUnpair, onLog }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  return (
    <Screen>
      <Pressable onPress={onBack} hitSlop={12}><Text style={styles.back}>‹ Posts</Text></Pressable>
      <View style={styles.center}>
        <Text style={styles.title}>Laptop</Text>
        <Text style={styles.line}>
          {connection.state === 'connected' ? 'Connected' : connection.state === 'checking' ? 'Looking for the laptop…' : connection.message}
        </Text>
        {connection.state === 'connected' && statusLines(connection.status, platforms).map(({ ok, text }) => (
          <Text key={text} style={[styles.status, { color: ok ? colors.ok : ok === null ? colors.muted : colors.warn }]}>
            {ok ? '●' : '○'} {text}
          </Text>
        ))}
        <Text style={styles.small}>{pairing.host}:{pairing.port}</Text>
        <View style={styles.row}>
          <Button kind="secondary" label="Pair again" onPress={onPair} />
          <Button kind="danger" label="Unpair" onPress={onUnpair} />
        </View>
        <Button kind="secondary" label="Activity log" onPress={onLog} />
      </View>
    </Screen>
  );
}

// What the app did, newest at the bottom. Share sends it as text (e.g. to paste into a chat when something failed).
function ActivityLog({ onBack }) {
  const [lines, setLines] = useState(() => readLog());
  const scroller = useRef(null);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  return (
    <Screen>
      <View style={styles.logHead}>
        <Pressable onPress={onBack} hitSlop={12}><Text style={styles.back}>‹ Laptop</Text></Pressable>
        <View style={styles.row}>
          <Button kind="secondary" label="Share" onPress={() => Share.share({ message: lines.join('\n') || 'The activity log is empty.' })} />
          <Button kind="danger" label="Clear" onPress={() => { clearLog(); setLines([]); }} />
        </View>
      </View>
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
        {lines.length ? lines.map((line, i) => <Text key={i} style={styles.logLine} selectable>{line}</Text>)
          : <Text style={styles.small}>Nothing logged yet.</Text>}
      </ScrollView>
    </Screen>
  );
}

function Scanner({ onPaired, onCancel }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState('');
  // The camera reports the same code many times a second; handle it once.
  const handled = useRef(false);

  if (!permission) return <View style={styles.blank} />;
  if (!permission.granted) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.title}>Pair with your laptop</Text>
          <Text style={styles.line}>The camera is needed to scan the QR code in the server's terminal.</Text>
          <Button label="Allow camera" onPress={requestPermission} />
        </View>
      </Screen>
    );
  }

  const scanned = ({ data }) => {
    if (handled.current) return;
    const next = parsePairing(data);
    if (!next) {
      setProblem("That isn't a Social Post pairing code. Scan the one printed when the server starts.");
      return;
    }
    handled.current = true;
    onPaired(next);
  };

  return (
    <Screen>
      <View style={styles.center}>
        <Text style={styles.title}>Pair with your laptop</Text>
        <Text style={styles.line}>Scan the QR code printed in the server's terminal.</Text>
        <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned} />
        {problem ? <Text style={styles.error}>{problem}</Text> : null}
        {onCancel ? <Button kind="secondary" label="Cancel" onPress={onCancel} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  back: { fontSize: 17, color: colors.accent },
  title: { fontSize: 22, fontWeight: '600', color: colors.text },
  line: { fontSize: 16, textAlign: 'center', color: colors.text },
  small: { fontSize: 13, color: colors.muted },
  status: { fontSize: 14, textAlign: 'center' },
  error: { fontSize: 14, color: colors.danger, textAlign: 'center' },
  camera: { width: 280, height: 280 },
  row: { flexDirection: 'row', gap: 12, marginTop: 12 },
  logHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  logLine: { fontSize: 12, fontFamily: 'monospace', color: colors.text, paddingVertical: 2 },
});
