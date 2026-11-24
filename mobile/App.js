import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { BackHandler, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFonts } from 'expo-font';
import { BottomNavigation, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { call, forgetPairing, loadPairing, parsePairing, savePairing } from './src/laptop';
import { handOver, removeDeleted } from './src/handover';
import { deletePost, listPosts, loadPlatforms, loadSchedule, loadSettings, newId, pruneOldMedia, readPost, savePlatforms, savePost, saveSchedule } from './src/store';
import Compose from './src/Compose';
import Posts from './src/Posts';
import Calendar, { withPhonePosts } from './src/Calendar';
import { FinishByHandDialog, todosOf } from './src/Substack';
import { Button, FONTS, Screen, ToastProvider, colors, theme, Text } from './src/ui';
import { log, logErrors, readLog, short, unsentLog } from './src/log';
import { statusLines, tunnelProblem } from './src/status';

logErrors();

// How often to look for the laptop (and hand over ready posts) while the app is open.
const CHECK_MS = 5000;

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <ToastProvider>
          <Main />
        </ToastProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

function Main() {
  // Bundled with the app, so this takes a moment; an error leaves the system font rather than a blank screen.
  const [fontsLoaded, fontError] = useFonts(FONTS);
  // undefined while loading, null when not paired: the app works without a laptop, and pairs when asked to
  // (Laptop screen) or when a post is ready to go (decided 2026-11-19).
  const [pairing, setPairing] = useState(undefined);
  const [screen, setScreen] = useState({ name: 'posts' });
  const [connection, setConnection] = useState({ state: 'checking' });
  const [posts, setPosts] = useState(() => {
    pruneOldMedia();
    return listPosts();
  });
  const [platforms, setPlatforms] = useState(() => loadPlatforms());
  const [live, setLive] = useState({});
  // The laptop's posts (page and phone), for Calendar, Posts and When; kept on the phone for when it's away.
  const [schedule, setSchedule] = useState(() => loadSchedule());
  const openId = useRef(null);
  const checkNow = useRef(null);
  // The post just marked ready, whose "Finish by hand" dialog opens once it's dealt with (see reminderFor).
  const [remind, setRemind] = useState(null);

  const refresh = useCallback(() => setPosts(listPosts()), []);

  useEffect(() => { loadPairing().then(setPairing); }, []);

  useEffect(() => {
    openId.current = screen.name === 'compose' ? screen.post.id : null;
  }, [screen]);

  useEffect(() => {
    if (pairing === null) setConnection({ state: 'unpaired', message: 'Not paired with a laptop yet' });
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
      try {
        const { posts: laptopPosts, deleted } = await call(pairing, 'GET', '/app/schedule');
        if (!stopped && Array.isArray(laptopPosts)) {
          saveSchedule(laptopPosts);
          setSchedule(loadSchedule());
          removeDeleted(deleted, refresh);
        }
      } catch {}
      // After the hand-over, so its lines go too. A failure (or a laptop too old to take it) waits for the next check.
      const unsent = unsentLog();
      if (unsent.lines.length) {
        try {
          await call(pairing, 'POST', '/app/log', { json: { lines: unsent.lines } });
          unsent.done();
        } catch {}
      }
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

  // Move, Post now, Edit, Cancel or Delete a post on the laptop (post.id: the laptop's id), then load its schedule
  // again. Cancel and Delete also change this phone's own copy at once, rather than on the next check.
  const act = useCallback(async (post, action, body) => {
    if (!pairing) throw new Error('Pair with your laptop first.');
    const path = `/app/posts/${post.id}${action === 'edit' ? '' : `/${action}`}`;
    const data = await call(pairing, action === 'edit' ? 'PATCH' : 'POST', path, { json: body ?? {} });
    const did = { now: 'posting now', edit: 'text changed', cancel: 'cancelled', delete: 'deleted everywhere' }[action] ?? `moved to ${new Date(body.at).toLocaleString()}`;
    log(`Post ${short(post.id)}: ${did} from the app`);
    const own = listPosts().find((p) => p.sendId === post.id);
    if (own && action === 'delete') deletePost(own.id);
    if (own && action === 'cancel' && data?.post?.state === 'cancelled') savePost({ ...own, state: 'cancelled', cancelledAt: Date.now() });
    refresh();
    try {
      const { posts: laptopPosts } = await call(pairing, 'GET', '/app/schedule');
      saveSchedule(laptopPosts);
      setSchedule(loadSchedule());
    } catch {}
    checkNow.current?.();
    return data;
  }, [pairing, refresh]);

  // Cancel or Delete from the post's own screen or the list, for a phone post the laptop has (by its sendId).
  const actOnOwn = useCallback((post, action) => act({ id: post.sendId }, action), [act]);

  const newPost = () => setScreen({
    name: 'compose',
    // The platforms last chosen, minus any no longer set up on the laptop.
    post: { id: newId(), text: '', platforms: loadSettings().selected.filter((id) => platforms.some((p) => p.id === id && p.configured)), media: [], options: {}, state: 'draft', createdAt: Date.now() },
  });

  // Post tapped: hand it over now rather than on the next 5-second check, so the reminder isn't kept waiting.
  // Not paired yet: it's just saved, ready; Posts says the phone isn't paired.
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

  if (pairing === undefined || (!fontsLoaded && !fontError)) return <View style={styles.blank} />;
  if (screen.name === 'pair') {
    return (
      <Scanner
        reason={screen.reason}
        onPaired={async (next) => { await savePairing(next); log(`Paired with the laptop at ${next.host}:${next.port}`); setPairing(next); setScreen({ name: 'posts' }); }}
        onCancel={() => setScreen({ name: screen.back ?? 'laptop' })}
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
  if (screen.name === 'log') return <ActivityLog pairing={pairing} connected={connection.state === 'connected'} onBack={() => setScreen({ name: 'laptop' })} />;
  // Posts · Calendar under the lists (decided 2026-11-19: the ＋ button starts a post, so there's no Write tab).
  // Writing a post is full screen, with ‹ Posts to go back.
  const tab = screen.name === 'calendar' ? 'calendar' : 'posts';
  const tabs = (
    <Tabs
      current={tab}
      onTab={(key) => {
        if (key === 'calendar') { refresh(); setScreen({ name: 'calendar' }); }
        else close();
      }}
    />
  );
  const connected = connection.state === 'connected';
  // The laptop's schedule plus this phone's posts it doesn't have yet, for Calendar, the day strip and Move.
  const allPosts = { ...schedule, posts: withPhonePosts(schedule.posts, posts) };
  if (screen.name === 'compose') {
    return (
      <View style={styles.fill}>
        <Compose key={screen.post.id} initial={screen.post} platforms={platforms} settings={loadSettings()} schedule={allPosts.posts}
          connected={connected} onAct={actOnOwn} onClose={close} onPosted={posted} onOpen={(post) => setScreen({ name: 'compose', post })}
          drawSlides={connected ? (body) => call(pairing, 'POST', '/app/slides', { json: body, timeoutMs: 20000 }) : null} />
      </View>
    );
  }
  if (screen.name === 'calendar') {
    return (
      <View style={styles.fill}>
        <Calendar schedule={allPosts} platforms={platforms} connected={connected} act={act}
          onOpenPhone={(id) => { const post = readPost(id); if (post) setScreen({ name: 'compose', post }); }} />
        {tabs}
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <Posts
        posts={posts}
        live={live}
        platforms={platforms}
        connection={connection}
        schedule={allPosts}
        act={act}
        onAct={actOnOwn}
        onOpen={(post) => setScreen({ name: 'compose', post })}
        onNew={newPost}
        onPair={() => setScreen({ name: 'laptop' })}
        onPairNow={() => setScreen({ name: 'pair', back: 'posts' })}
        onChange={refresh}
      />
      {tabs}
      {reminding ? (
        <FinishByHandDialog
          post={reminding}
          paired={Boolean(pairing)}
          // Results usually come later; if they're already here, their items were shown too.
          onDone={() => { savePost({ ...reminding, substackDone: true, ...(todosOf(reminding).length && { todoDone: true }) }); setRemind(null); refresh(); }}
        />
      ) : null}
      <StatusBar style="dark" />
    </View>
  );
}

// Paper's bottom tab bar, with the mockup's icons (list, calendar). Posts first: the app opens there.
const TABS = [
  { key: 'posts', title: 'Posts', focusedIcon: 'format-list-bulleted', unfocusedIcon: 'format-list-bulleted' },
  { key: 'calendar', title: 'Calendar', focusedIcon: 'calendar-month', unfocusedIcon: 'calendar-month-outline' },
];

function Tabs({ current, onTab }) {
  return (
    <BottomNavigation.Bar
      navigationState={{ index: TABS.findIndex((t) => t.key === current), routes: TABS }}
      onTabPress={({ route }) => onTab(route.key)}
      activeColor={colors.accent}
      inactiveColor={colors.muted}
      style={styles.tabs}
    />
  );
}

// The "Finish by hand" dialog opens once the post has been dealt with: handed to the laptop when it's connected,
// or saved here when it isn't. It doesn't wait for the platforms. Returns the post to remind about, false to
// keep waiting, or null when there's nothing to remind about (refused, deleted, or already done).
function reminderFor(post, connection) {
  if (!post || post.substackDone || post.state === 'draft' || post.state === 'cancelled') return null;
  if (post.state === 'handed' || post.state === 'done' || post.retryError) return post;
  return connection.state === 'away' || connection.state === 'unpaired' ? post : false;
}

function Laptop({ pairing, connection, platforms, onBack, onPair, onUnpair, onLog }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  if (!pairing) {
    return (
      <Screen>
        <Pressable onPress={onBack} hitSlop={12}><Text style={styles.back}>‹ Posts</Text></Pressable>
        <View style={styles.center}>
          <Text style={styles.title}>Laptop</Text>
          <Text style={styles.line}>Not paired yet. Posts are saved on this phone, and go to the laptop once it's paired and on the same Wi-Fi.</Text>
          <Button label="Pair with your laptop" icon="qrcode-scan" onPress={onPair} />
          <Button kind="secondary" label="Activity log" onPress={onLog} />
        </View>
      </Screen>
    );
  }
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

// What the app did, newest at the bottom: the laptop's last 500 lines (while connected), then those not sent yet.
// Share sends it as text (e.g. to paste into a chat when something failed).
function ActivityLog({ pairing, connected, onBack }) {
  const [laptop, setLaptop] = useState(null);
  const [lines, setLines] = useState(() => readLog());
  const scroller = useRef(null);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  useEffect(() => {
    if (!connected) return undefined;
    let stopped = false;
    call(pairing, 'GET', '/app/log')
      .then((data) => { if (!stopped) { setLaptop(data.lines ?? []); setLines(readLog()); } })
      .catch(() => {});
    return () => { stopped = true; };
  }, [pairing, connected]);
  const all = [...(laptop ?? []), ...lines];
  return (
    <Screen>
      <View style={styles.logHead}>
        <Pressable onPress={onBack} hitSlop={12}><Text style={styles.back}>‹ Laptop</Text></Pressable>
        <Button kind="secondary" label="Share" onPress={() => Share.share({ message: all.join('\n') || 'The activity log is empty.' })} />
      </View>
      {!connected && <Text style={styles.small}>Not connected: showing only lines not yet on the laptop. The rest are in the laptop's logs folder.</Text>}
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
        {all.length ? all.map((line, i) => <Text key={i} style={styles.logLine} selectable>{line}</Text>)
          : <Text style={styles.small}>Nothing logged yet.</Text>}
      </ScrollView>
    </Screen>
  );
}

// reason: why pairing is asked for now (e.g. a post is ready to go).
function Scanner({ reason, onPaired, onCancel }) {
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
          {reason ? <Text style={styles.line}>{reason}</Text> : null}
          <Text style={styles.line}>The camera is needed to scan the QR code in the server's terminal.</Text>
          <Button label="Allow camera" onPress={requestPermission} />
          <Button kind="secondary" label="Not now" onPress={onCancel} />
        </View>
      </Screen>
    );
  }

  const scanned = ({ data }) => {
    if (handled.current) return;
    const next = parsePairing(data);
    if (!next) {
      setProblem("That isn't a Socialifer pairing code. Scan the one printed when the server starts.");
      return;
    }
    handled.current = true;
    onPaired(next);
  };

  return (
    <Screen>
      <View style={styles.center}>
        <Text style={styles.title}>Pair with your laptop</Text>
        {reason ? <Text style={styles.line}>{reason}</Text> : null}
        <Text style={styles.line}>Scan the QR code printed in the server's terminal.</Text>
        <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned} />
        {problem ? <Text style={styles.error}>{problem}</Text> : null}
        <Button kind="secondary" label="Not now" onPress={onCancel} />
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
  fill: { flex: 1, backgroundColor: colors.bg },
  tabs: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg },
});
