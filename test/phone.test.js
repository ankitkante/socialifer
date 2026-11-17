import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPhoneServer, signature, sha256 } from '../phone.js';

const KEY = 'a'.repeat(32);
let server, base;

before(async () => {
  server = createPhoneServer(KEY);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// Signs like the app does; overrides break one part at a time.
function signed(path, { method = 'GET', body = '', key = KEY, time = Date.now(), nonce = crypto.randomBytes(16).toString('hex') } = {}) {
  const sig = signature(key, { method, path, time: String(time), nonce, digest: sha256(body) });
  return fetch(`${base}${path}`, {
    method,
    headers: { 'X-SP-Time': String(time), 'X-SP-Nonce': nonce, 'X-SP-Signature': sig },
    ...(body && { body }),
  });
}

test('a signed hello returns the platforms', async () => {
  const res = await signed('/app/hello');
  assert.equal(res.status, 200);
  const hello = await res.json();
  assert.equal(hello.name, 'Social Post');
  assert.ok(hello.platforms.length >= 9);
  assert.ok(hello.platforms.every((p) => Array.isArray(p.envVars) && p.media));
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
