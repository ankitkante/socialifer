import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { countFor, exactCounting } from '../public/rules.js';
import { call, forgetPairing, loadPairing, parsePairing, savePairing } from './src/laptop';

// How often to look for the laptop while the app is open.
const CHECK_MS = 5000;

// rules.js counts exactly with Intl.Segmenter, or closely without it; this shows which the phone gets.
// नमस्ते 👍🏽 is 5 characters (स्ते is one).
function countingStatus() {
  try {
    return `${exactCounting ? 'exact' : 'close'}, test count ${countFor('x', 'नमस्ते 👍🏽')} of 5`;
  } catch (err) {
    return `broken: ${err.message}`;
  }
}

export default function App() {
  const [pairing, setPairing] = useState(undefined); // undefined while loading, null when not paired
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState({ state: 'checking' });

  useEffect(() => { loadPairing().then(setPairing); }, []);

  useEffect(() => {
    if (!pairing) return undefined;
    let stopped = false;
    const check = async () => {
      try {
        const hello = await call(pairing, 'GET', '/app/hello');
        if (!stopped) setStatus({ state: 'connected', platforms: hello.platforms.filter((p) => p.configured).length });
      } catch (err) {
        if (!stopped) setStatus({ state: 'away', message: err.message });
      }
    };
    setStatus({ state: 'checking' });
    check();
    const timer = setInterval(check, CHECK_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [pairing]);

  const paired = async (next) => {
    await savePairing(next);
    setScanning(false);
    setPairing(next);
  };

  const unpair = async () => {
    await forgetPairing();
    setPairing(null);
  };

  if (pairing === undefined) return <View style={styles.screen} />;
  if (scanning || !pairing) {
    return <Scanner onPaired={paired} onCancel={pairing ? () => setScanning(false) : null} />;
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Social Post</Text>
      <Text style={styles.line}>
        {status.state === 'checking' && 'Looking for the laptop…'}
        {status.state === 'connected' && `Connected to laptop · ${status.platforms} platforms set up`}
        {status.state === 'away' && status.message}
      </Text>
      <Text style={styles.small}>Laptop: {pairing.host}:{pairing.port}</Text>
      <Text style={styles.small}>Character counting: {countingStatus()}</Text>
      <View style={styles.row}>
        <Button label="Pair again" onPress={() => setScanning(true)} />
        <Button label="Unpair" onPress={unpair} />
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

function Scanner({ onPaired, onCancel }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState('');
  // The camera reports the same code many times a second; handle it once.
  const handled = useRef(false);

  if (!permission) return <View style={styles.screen} />;
  if (!permission.granted) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Pair with your laptop</Text>
        <Text style={styles.line}>The camera is needed to scan the QR code in the server's terminal.</Text>
        <Button label="Allow camera" onPress={requestPermission} />
      </View>
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
    <View style={styles.screen}>
      <Text style={styles.title}>Pair with your laptop</Text>
      <Text style={styles.line}>Scan the QR code printed in the server's terminal.</Text>
      <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned} />
      {problem ? <Text style={styles.error}>{problem}</Text> : null}
      {onCancel ? <Button label="Cancel" onPress={onCancel} /> : null}
    </View>
  );
}

function Button({ label, onPress }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  line: { fontSize: 16, textAlign: 'center' },
  small: { fontSize: 13, color: '#666' },
  error: { fontSize: 14, color: '#b00020', textAlign: 'center' },
  camera: { width: 280, height: 280 },
  row: { flexDirection: 'row', gap: 12, marginTop: 12 },
  button: { backgroundColor: '#1a73e8', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '500' },
});
