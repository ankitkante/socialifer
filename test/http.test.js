import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { request, redactUrl, ApiError } from '../platforms/http.js';

test('hides tokens in logged URLs', () => {
  assert.equal(redactUrl('https://graph.facebook.com/v23.0/1/media?access_token=SECRET&fields=id'),
    'https://graph.facebook.com/v23.0/1/media?access_token=REDACTED&fields=id');
  assert.equal(redactUrl('https://api.telegram.org/bot123:ABC/sendMessage'), 'https://api.telegram.org/botREDACTED/sendMessage');
  assert.equal(redactUrl('https://discord.com/api/webhooks/42/TOKEN?wait=true'), 'https://discord.com/api/webhooks/42/REDACTED?wait=true');
});

test('explains network failures instead of "fetch failed"', async (t) => {
  t.mock.method(console, 'error', () => {});
  // A port nothing listens on: connection refused.
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => srv.once('listening', resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));

  const err = await request(`http://127.0.0.1:${port}/`).catch((e) => e);
  assert.ok(err instanceof ApiError);
  assert.match(err.message, /refused the connection/);

  const missing = await request('http://no-such-host.invalid/').catch((e) => e);
  assert.match(missing.message, /Couldn't reach no-such-host\.invalid|Network error/);
});

test('retries dropped connections and 5xx, re-creating headers each time', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let hits = 0;
  const seen = [];
  const srv = http.createServer((req, res) => {
    hits += 1;
    seen.push(req.headers['x-attempt']);
    if (hits === 1) return req.socket.destroy(); // dropped connection
    if (hits === 2) { res.writeHead(503); return res.end('busy'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => srv.once('listening', resolve));
  t.after(() => srv.close());
  // Shorten the backoff so the test runs quickly.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempt = 0;
  const pending = request(`http://127.0.0.1:${srv.address().port}/`, { retries: 3, headers: () => ({ 'x-attempt': String(++attempt) }) });
  for (let i = 0; i < 50 && hits < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(10_000);
  }
  const { data } = await pending;
  assert.deepEqual(data, { ok: true });
  assert.equal(hits, 3);
  assert.deepEqual(seen, ['1', '2', '3']);
});

test('reports API errors with the status and the API message', async (t) => {
  t.mock.method(console, 'error', () => {});
  const srv = http.createServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"error":{"message":"Bad caption"}}');
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => srv.once('listening', resolve));
  t.after(() => srv.close());
  const err = await request(`http://127.0.0.1:${srv.address().port}/`, { retries: 2 }).catch((e) => e);
  assert.ok(err instanceof ApiError);
  assert.equal(err.message, 'HTTP 400: Bad caption');
  assert.equal(err.details.status, 400);
});
