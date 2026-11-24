// The phone app's own server, on PHONE_PORT over the Wi-Fi. Unlike the page's server (loopback only, no
// login), every request here must be signed with the key the phone got from the QR code: an HMAC of the
// method, path, time, a one-time nonce and the body's SHA-256. The key itself never travels.
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { platforms } from './platforms/index.js';
import { canCompress, describe } from './publish.js';
import { httpError } from './media.js';
import { appendPhoneLog, log, readPhoneLog } from './log.js';
import { laptopStatus } from './status.js';

const DIR = new URL('./phone/', import.meta.url);
const PAIRING = new URL('pairing.json', DIR);
const DEFAULT_PORT = 3001;
// Phone and laptop clocks are both set from the internet, so a minute either way is plenty.
const MAX_SKEW_MS = 60_000;
// A nonce only needs remembering while its time would still be accepted.
const NONCE_TTL_MS = 2 * MAX_SKEW_MS;
const JSON_LIMIT = 1_000_000;
// The phone keeps at most 500 unsent lines, and its Activity log screen shows the laptop's last 500.
const MAX_LOG_LINES = 500;

const NOT_PAIRED = "This phone isn't paired with this laptop. Scan the QR code in the server's terminal again.";
const BAD_CLOCK = "The phone's clock and the laptop's are more than a minute apart. Set both to the correct time automatically.";

// Created on first start; deleting phone/pairing.json unpairs every phone.
export async function loadKey() {
  try {
    const { key } = JSON.parse(await readFile(PAIRING, 'utf8'));
    if (/^[a-f0-9]{32}$/.test(key)) return key;
  } catch {}
  // 128 bits: plenty for an HMAC key, and short enough to keep the QR code small.
  const key = crypto.randomBytes(16).toString('hex');
  await mkdir(DIR, { recursive: true });
  await writeFile(PAIRING, JSON.stringify({ key }, null, 2));
  return key;
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// The app builds the same string (mobile/src/sign.js); change both together.
// digest: the SHA-256 of the body, or for a file upload "<type>:<size>", so a video isn't hashed twice.
export function signature(key, { method, path, time, nonce, digest }) {
  return crypto.createHmac('sha256', Buffer.from(key, 'hex')).update([method, path, time, nonce, digest].join('\n')).digest('hex');
}

// Home networks only: 10/8, 172.16/12, 192.168/16, and loopback for tests.
function isPrivate(address) {
  const a = address.replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
}

// The address the phone should use. Windows also gives virtual adapters (WSL, Hyper-V, VirtualBox) private
// addresses the phone can't reach, so those come last. PHONE_HOST overrides the guess.
function wifiAddress() {
  if (process.env.PHONE_HOST?.trim()) return process.env.PHONE_HOST.trim();
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && isPrivate(i.address)) found.push({ name, address: i.address });
    }
  }
  const real = found.filter((f) => !/vEthernet|virtual|vmware|vbox|docker|wsl|hyper-v/i.test(f.name));
  return (real.find((f) => /wi-?fi|wlan|wireless/i.test(f.name)) ?? real[0] ?? found[0])?.address ?? null;
}

// Returns why the request isn't trusted, or null when it is.
function rejection(key, seen, req, digest) {
  const time = req.headers['x-sp-time'] ?? '';
  const nonce = req.headers['x-sp-nonce'] ?? '';
  const given = req.headers['x-sp-signature'] ?? '';
  if (!/^\d{1,15}$/.test(time) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(given)) return NOT_PAIRED;
  const expected = signature(key, { method: req.method, path: req.url, time, nonce, digest });
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'))) return NOT_PAIRED;
  const now = Date.now();
  if (Math.abs(now - Number(time)) > MAX_SKEW_MS) return BAD_CLOCK;
  for (const [n, expires] of seen) if (expires < now) seen.delete(n);
  if (seen.has(nonce)) return NOT_PAIRED;
  seen.set(nonce, now + NONCE_TTL_MS);
  return null;
}

// Unpaired devices may keep retrying every few seconds; say so once a minute per address, not every time.
const lastLogged = new Map();
function logOnce(key, message) {
  const now = Date.now();
  if (now - (lastLogged.get(key) ?? 0) < 60_000) return;
  lastLogged.set(key, now);
  log.warn(message);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw httpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(raw) {
  try {
    return JSON.parse(raw?.toString('utf8') ?? '');
  } catch {
    throw httpError(400, "The request wasn't valid JSON");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createPhoneServer(key, queue) {
  const seen = new Map();
  return http.createServer(async (req, res) => {
    try {
      const from = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
      if (!isPrivate(from)) {
        logOnce(`403:${from}`, `Phone app: refused a request from ${from}, which isn't on a home network.`);
        return sendJson(res, 403, { error: 'Forbidden' });
      }
      const type = req.headers['content-type'] || '';
      // A file is checked before its body is read, so an unpaired device can't make us store anything.
      let digest;
      let raw = null;
      if (/^(image|video)\//.test(type)) {
        const length = req.headers['content-length'] ?? '';
        if (!/^\d+$/.test(length)) throw httpError(411, 'The upload needs a Content-Length');
        digest = `${type}:${length}`;
      } else {
        raw = await readBody(req);
        digest = sha256(raw);
      }
      const problem = rejection(key, seen, req, digest);
      if (problem) {
        logOnce(`401:${from}`, `Phone app: refused ${req.method} ${req.url.split('?')[0]} from ${from}: ${problem}`);
        return sendJson(res, 401, { error: problem });
      }

      const { pathname, searchParams } = new URL(req.url, 'http://phone');
      if (req.method === 'GET' && pathname === '/app/hello') {
        return sendJson(res, 200, { name: 'Socialifer', ffmpeg: canCompress, platforms: platforms.map(describe), status: await laptopStatus({ wait: false }) });
      }
      if (req.method === 'GET' && pathname === '/app/log') {
        return sendJson(res, 200, { lines: await readPhoneLog(MAX_LOG_LINES) });
      }
      if (req.method === 'POST' && pathname === '/app/log') {
        const { lines } = parseJson(raw) ?? {};
        if (!Array.isArray(lines) || lines.length > MAX_LOG_LINES || !lines.every((l) => typeof l === 'string')) {
          throw httpError(400, `Send the activity log as { lines: [...] }, at most ${MAX_LOG_LINES} lines of text.`);
        }
        // One line per entry, so a stray line break can't fake another line in the file.
        appendPhoneLog(lines.map((l) => l.replace(/[\r\n]+/g, ' ').slice(0, 2000)));
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'GET' && pathname === '/app/posts') {
        const ids = (searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 100);
        return sendJson(res, 200, queue.status(ids));
      }
      // Every post on the laptop, from the page and the phone, for the app's Calendar and Posts tabs.
      if (req.method === 'GET' && pathname === '/app/schedule') {
        // deleted: ids of posts deleted for good, so the phone removes its copies.
        return sendJson(res, 200, { posts: queue.list(), deleted: queue.deletedIds(), now: Date.now() });
      }
      const post = /^\/app\/posts\/([a-f0-9]{32})(\/ready|\/move|\/cancel|\/now|\/delete|\/files\/(\d{1,3}))?$/.exec(pathname);
      if (post) {
        const [, id, rest, n] = post;
        if (req.method === 'PUT' && !rest) return sendJson(res, 200, await queue.create(id, parseJson(raw)));
        if (req.method === 'PUT' && n !== undefined) return sendJson(res, 200, await queue.receiveFile(id, Number(n), req));
        if (req.method === 'POST' && rest === '/ready') return sendJson(res, 200, await queue.ready(id));
        if (req.method === 'POST' && rest === '/move') return sendJson(res, 200, await queue.move(id, parseJson(raw)?.at));
        if (req.method === 'POST' && rest === '/cancel') return sendJson(res, 200, await queue.cancel(id));
        if (req.method === 'POST' && rest === '/now') return sendJson(res, 200, await queue.postNow(id));
        if (req.method === 'POST' && rest === '/delete') return sendJson(res, 200, await queue.deleteForever(id));
        if (req.method === 'PATCH' && !rest) return sendJson(res, 200, await queue.edit(id, parseJson(raw)));
        if (req.method === 'DELETE' && !rest) {
          await queue.remove(id);
          res.writeHead(204);
          return res.end();
        }
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      // The phone is told why, but the terminal should say so too, since nobody may be looking at the phone.
      if (!err.status) log.error(`Phone app: ${req.method} ${req.url} failed`, err?.stack ?? String(err));
      else log.warn(`Phone app: ${req.method} ${req.url.split('?')[0]} refused (${err.status}): ${err.message}`);
      if (res.headersSent) return res.destroy();
      sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong in the app. The details are in the terminal.' });
    }
  });
}

// PHONE_PORT=off turns the phone server off (the tests do this).
// queue: the server's post store (queue.js), shared with the web page.
export async function startPhoneServer(queue) {
  const setting = process.env.PHONE_PORT?.trim();
  if (setting === 'off') return null;
  const port = setting ? Number(setting) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.log(`Phone app is off: PHONE_PORT "${setting}" isn't a port number.`);
    return null;
  }
  const key = await loadKey();
  const server = createPhoneServer(key, queue);
  try {
    // All interfaces, because the Wi-Fi address can change; requests from outside home networks are refused.
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', resolve);
    });
  } catch (err) {
    console.log(err.code === 'EADDRINUSE'
      ? `Phone app is off: port ${port} is in use. Set a different PHONE_PORT in .env.`
      : `Phone app is off: ${err.message}`);
    return null;
  }
  const host = wifiAddress();
  if (!host) {
    console.log('Phone app: no Wi-Fi address found. Connect the laptop to Wi-Fi and restart the server.');
    return server;
  }
  const { port: actual } = server.address();
  // Capitals, digits and ':' only, so the QR code uses its compact alphanumeric mode (17 lines, not 25).
  const code = `SP:${host}:${actual}:${key.toUpperCase()}`;
  console.log(`Phone app: listening on ${host}:${actual}. To pair, scan this in the Socialifer app (not the camera app, which may send the code to a search engine):`);
  console.log(await QRCode.toString(code, { type: 'terminal', small: true, errorCorrectionLevel: 'L' }));
  return server;
}
