// Pairing with the laptop and talking to its phone server.
import * as SecureStore from 'expo-secure-store';
import { signedHeaders } from './sign';

const PAIRING_KEY = 'pairing';

// The QR code holds SP:<ip>:<port>:<32 hex key, in capitals> (see startPhoneServer in ../../phone.js).
export function parsePairing(data) {
  const m = /^SP:(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5}):([A-F0-9]{32})$/.exec(String(data).trim());
  return m ? { host: m[1], port: Number(m[2]), key: m[3].toLowerCase() } : null;
}

export async function loadPairing() {
  const saved = await SecureStore.getItemAsync(PAIRING_KEY);
  return saved ? JSON.parse(saved) : null;
}

export const savePairing = (pairing) => SecureStore.setItemAsync(PAIRING_KEY, JSON.stringify(pairing));
export const forgetPairing = () => SecureStore.deleteItemAsync(PAIRING_KEY);

// Throws an Error with a message to show. Off the laptop's Wi-Fi, the request just times out.
export async function call(pairing, method, path, { json, timeoutMs = 5000 } = {}) {
  const body = json === undefined ? '' : JSON.stringify(json);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`http://${pairing.host}:${pairing.port}${path}`, {
      method,
      headers: { ...signedHeaders(pairing.key, method, path, { body }), ...(body && { 'Content-Type': 'application/json' }) },
      ...(body && { body }),
      signal: controller.signal,
    });
  } catch {
    throw new Error("Can't reach the laptop. Check that both are on the same Wi-Fi and the server is running.");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The laptop answered ${res.status}.`);
  return data;
}
