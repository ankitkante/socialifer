import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPhoneServer, signature, sha256 } from '../phone.js';
import { startLogFiles } from '../log.js';

const KEY = 'a'.repeat(32);
let server, base;

// The phone's log lines go to a temporary folder, not the real logs/.
const logDir = mkdtempSync(join(tmpdir(), 'sp-phone-log-'));

before(async () => {
  process.env.LOG_DIR = logDir;
  startLogFiles();
  server = createPhoneServer(KEY);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(logDir, { recursive: true, force: true });
});

// Signs like the app does; overrides break one part at a time.
function signed(path, { method = 'GET', body = '', key = KEY, time = Date.now(), nonce = crypto.randomBytes(16).toString('hex') } = {}) {
  const sig = signature(key, { method, path, time: String(time), nonce, digest: sha256(body) });
  return fetch(`${base}${path}`, {
    method,
    headers: { 'X-SP-Time': String(time), 'X-SP-Nonce': nonce, 'X-SP-Signature': sig },
    ...(body && { body }),
  });
}

test('the activity log is kept on the laptop and read back, one line per entry', async () => {
  const send = (json) => signed('/app/log', { method: 'POST', body: JSON.stringify(json) });
  assert.equal((await send({ lines: ['2026-11-17 10:00:00 Paired', '2026-11-17 10:00:05 Sent\nFake line'] })).status, 204);
  assert.equal((await send({ lines: [1] })).status, 400);
  assert.equal((await send({ lines: Array(501).fill('x') })).status, 400);
  const res = await signed('/app/log');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).lines, ['2026-11-17 10:00:00 Paired', '2026-11-17 10:00:05 Sent Fake line']);
  assert.equal(readdirSync(logDir).filter((name) => /^phone-\d{4}-\d{2}\.log$/.test(name)).length, 1);
});

test('the activity log needs a signature', async () => {
  assert.equal((await fetch(`${base}/app/log`)).status, 401);
  assert.equal((await fetch(`${base}/app/log`, { method: 'POST', body: '{"lines":["x"]}' })).status, 401);
});

test('a signed hello returns the platforms', async () => {
  const res = await signed('/app/hello');
  assert.equal(res.status, 200);
  const hello = await res.json();
  assert.equal(hello.name, 'Social Post');
  assert.ok(hello.platforms.length >= 9);
  assert.ok(hello.platforms.every((p) => Array.isArray(p.envVars) && p.media));
  assert.equal(typeof hello.status.ffmpeg, 'boolean');
  assert.equal(typeof hello.status.subtitles, 'boolean');
  assert.equal(typeof hello.status.tunnel.configured, 'boolean');
});

test('refuses unsigned requests and the wrong key', async () => {
  assert.equal((await fetch(`${base}/app/hello`)).status, 401);
  const res = await signed('/app/hello', { key: 'b'.repeat(32) });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /isn't paired/);
});

test('refuses an old timestamp with a clock message', async () => {
  const res = await signed('/app/hello', { time: Date.now() - 5 * 60_000 });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /clock/);
});

test('refuses a replayed nonce', async () => {
  const nonce = crypto.randomBytes(16).toString('hex');
  assert.equal((await signed('/app/hello', { nonce })).status, 200);
  assert.equal((await signed('/app/hello', { nonce })).status, 401);
});

test('a signed request for an unknown path is a 404', async () => {
  assert.equal((await signed('/app/nothing')).status, 404);
});
