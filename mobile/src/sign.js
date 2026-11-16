// Signs requests for the laptop's phone server. The string signed must match signature() in ../../phone.js.
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { getRandomBytes } from 'expo-crypto';

// digest: the body's SHA-256; file uploads pass "<type>:<size>" instead (see phone.js).
export function signedHeaders(key, method, path, { body = '', digest } = {}) {
  const time = String(Date.now());
  const nonce = bytesToHex(getRandomBytes(16));
  const d = digest ?? bytesToHex(sha256(utf8ToBytes(body)));
  const message = [method, path, time, nonce, d].join('\n');
  const signature = bytesToHex(hmac(sha256, hexToBytes(key), utf8ToBytes(message)));
  return { 'X-SP-Time': time, 'X-SP-Nonce': nonce, 'X-SP-Signature': signature };
}
