import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { call, forgetPairing, loadPairing, parsePairing, savePairing } from './src/laptop';
import { handOver } from './src/handover';
import { listPosts, loadPlatforms, loadSettings, newId, pruneOldMedia, savePlatforms } from './src/store';
import Compose from './src/Compose';
import Posts from './src/Posts';
import { Button, Screen, colors } from './src/ui';

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

  const refresh = useCallback(() => setPosts(listPosts()), []);

  useEffect(() => { loadPairing().then(setPairing); }, []);

  useEffect(() => {
    openId.current = screen.name === 'compose' ? screen.post.id : null;
  }, [screen]);

  useEffect(() => {
    if (!pairing) return undefined;
    let stopped = false;
    const check = async () => {
      try {
        const hello = await call(pairing, 'GET', '/app/hello');
        if (stopped) return;
        setConnection({ state: 'connected' });
        // Kept on the phone, so the platforms and their limits are there when writing offline.
        savePlatforms(hello.platforms);
        setPlatforms(hello.platforms);
        const now = await handOver(pairing, refresh, openId.current);
        if (!stopped && now) setLive(now);
      } catch (err) {
        if (!stopped) setConnection({ state: 'away', message: err.message });
      }
    };
    setConnection({ state: 'checking' });
    check();
    const timer = setInterval(check, CHECK_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [pairing, refresh]);

  const close = useCallback(() => {
    setScreen({ name: 'posts' });
    refresh();
  }, [refresh]);

  if (pairing === undefined) return <View style={styles.blank} />;
  if (!pairing || screen.name === 'pair') {
    return (
      <Scanner
        onPaired={async (next) => { await savePairing(next); setPairing(next); setScreen({ name: 'posts' }); }}
        onCancel={pairing ? () => setScreen({ name: 'laptop' }) : null}
      />
    );
  }
  if (screen.name === 'laptop') {
    return (
      <Laptop
        pairing={pairing}
        connection={connection}
        onBack={() => setScreen({ name: 'posts' })}
        onPair={() => setScreen({ name: 'pair' })}
        onUnpair={async () => { await forgetPairing(); setPairing(null); setScreen({ name: 'posts' }); }}
      />
    );
  }
  if (screen.name === 'compose') {
    return <Compose initial={screen.post} platforms={platforms} settings={loadSettings()} onClose={close} />;
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
      <StatusBar style="dark" />
    </>
  );
}

function Laptop({ pairing, connection, onBack, onPair, onUnpair }) {
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
        <Text style={styles.small}>{pairing.host}:{pairing.port}</Text>
        <View style={styles.row}>
          <Button kind="secondary" label="Pair again" onPress={onPair} />
          <Button kind="danger" label="Unpair" onPress={onUnpair} />
        </View>
      </View>
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
  error: { fontSize: 14, color: colors.danger, textAlign: 'center' },
  camera: { width: 280, height: 280 },
  row: { flexDirection: 'row', gap: 12, marginTop: 12 },
});
