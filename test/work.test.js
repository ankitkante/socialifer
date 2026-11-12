import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, WHISPER, BURN } from '../work.js';

test('runs one heavy job at a time, Whisper before waiting burn-ins, and can take one out of line', async () => {
  const order = [];
  let release;
  const first = enqueue(BURN, () => new Promise((resolve) => { order.push('burn 1'); release = resolve; }));
  const burn2 = enqueue(BURN, async () => { order.push('burn 2'); });
  const whisper = enqueue(WHISPER, async () => { order.push('whisper'); return 'subtitles'; });
  const skipped = enqueue(BURN, async () => { order.push('never'); });
  assert.equal(skipped.cancel(), true);

  // burn 1 is already running; nothing else starts until it ends.
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ['burn 1']);
  release();
  await first.promise;
  assert.equal(await whisper.promise, 'subtitles');
  await burn2.promise;
  assert.deepEqual(order, ['burn 1', 'whisper', 'burn 2']);
  assert.equal(await skipped.promise, undefined);
});
