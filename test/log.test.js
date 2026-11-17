import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendPhoneLog, cleanupLogs, log, readPhoneLog, startLogFiles } from '../log.js';

const dir = mkdtempSync(join(tmpdir(), 'sp-log-test-'));
const pad = (n) => String(n).padStart(2, '0');
const monthOf = (offset) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const thisMonth = monthOf(0);

before(() => {
  process.env.LOG_DIR = dir;
  assert.equal(startLogFiles(), dir);
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('server lines go to this month\'s file with the date, details included', () => {
  log.info('Hello from the test');
  log.error('It broke', 'stack line 1\nstack line 2');
  const text = readFileSync(join(dir, `server-${thisMonth}.log`), 'utf8');
  assert.match(text, new RegExp(`^${thisMonth}-\\d{2} \\d{2}:\\d{2}:\\d{2} Hello from the test$`, 'm'));
  assert.match(text, /✕ It broke\nstack line 1\nstack line 2\n/);
});

test('phone lines go to their own file and read back newest last, at most the limit', async () => {
  // Last month's file is read when this month's has too few lines.
  writeFileSync(join(dir, `phone-${monthOf(-1)}.log`), 'old 1\nold 2\n');
  appendPhoneLog(['new 1', 'new 2']);
  appendPhoneLog(['new 3']);
  assert.deepEqual(await readPhoneLog(500), ['old 1', 'old 2', 'new 1', 'new 2', 'new 3']);
  assert.deepEqual(await readPhoneLog(2), ['new 2', 'new 3']);
});

test('cleanup deletes only month files whose lines are all over 6 months old', async () => {
  const names = [`server-${monthOf(-6)}.log`, `phone-${monthOf(-6)}.log`, `server-${monthOf(-7)}.log`, `phone-${monthOf(-12)}.log`, 'notes.txt'];
  for (const name of names) writeFileSync(join(dir, name), 'x\n');
  await cleanupLogs();
  const left = readdirSync(dir);
  assert.ok(left.includes(`server-${monthOf(-6)}.log`));
  assert.ok(left.includes(`phone-${monthOf(-6)}.log`));
  assert.ok(left.includes(`server-${thisMonth}.log`));
  assert.ok(left.includes('notes.txt'));
  assert.ok(!left.includes(`server-${monthOf(-7)}.log`));
  assert.ok(!left.includes(`phone-${monthOf(-12)}.log`));
});
