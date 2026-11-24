import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zoneOffset } from './public/rules.js';

// Every platform posts inside its own context ({ postId, platform, step, onStep }), so any code, however
// deep, can log with the right "[post 7] YouTube:" prefix and report what it's doing to the page.
const context = new AsyncLocalStorage();

const time = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

function prefix() {
  const c = context.getStore();
  return c ? `[post ${c.postId}] ${c.platform}: ` : '';
}

// ---- Log files: logs/server-YYYY-MM.log and logs/phone-YYYY-MM.log, kept 6 months ----
// Only what goes through log.* is kept, not everything printed: the startup QR code holds the pairing key.
// Off until startLogFiles(), so modules imported by tests don't write. LOG_DIR moves the folder (tests use it).

const KEEP_MONTHS = 6;
let logDir = null;
let failed = false;
const pad = (n) => String(n).padStart(2, '0');
const month = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
// With the time zone (e.g. +05:30), so a log sent from another country is unambiguous (decided 2026-11-20).
const stamp = (d = new Date()) => `${month(d)}-${pad(d.getDate())} ${time()} ${zoneOffset(d.getTime())}`;

export function startLogFiles() {
  logDir = process.env.LOG_DIR?.trim() || fileURLToPath(new URL('./logs/', import.meta.url));
  return logDir;
}

// Never throws: a log that can't be written must not break posting. Says so once, in the terminal.
function writeLines(kind, lines) {
  if (!logDir || !lines.length) return;
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, `${kind}-${month()}.log`), `${lines.join('\n')}\n`);
  } catch (err) {
    if (!failed) console.error(`Couldn't write the log file in ${logDir}: ${err.message}`);
    failed = true;
  }
}

// The phone's activity log lines, already stamped with the phone's time.
export function appendPhoneLog(lines) {
  writeLines('phone', lines);
}

// The newest phone lines, oldest first, for the phone's Activity log screen.
export async function readPhoneLog(limit) {
  if (!logDir) return [];
  const names = (await readdir(logDir).catch(() => []))
    .filter((name) => /^phone-\d{4}-\d{2}\.log$/.test(name)).sort().reverse();
  let lines = [];
  for (const name of names) {
    const text = await readFile(join(logDir, name), 'utf8').catch(() => '');
    lines = [...text.split('\n').filter(Boolean), ...lines];
    if (lines.length >= limit) break;
  }
  return lines.slice(-limit);
}

// Deletes a month's file once all its lines are over 6 months old (on 1 December, May's file goes).
export async function cleanupLogs() {
  if (!logDir) return;
  const now = new Date();
  const oldest = month(new Date(now.getFullYear(), now.getMonth() - KEEP_MONTHS, 1));
  const names = await readdir(logDir).catch(() => []);
  for (const name of names) {
    const m = /^(server|phone)-(\d{4}-\d{2})\.log$/.exec(name);
    if (m && m[2] < oldest) await rm(join(logDir, name), { force: true });
  }
}

function out(print, line) {
  print(`${time()} ${line}`);
  writeLines('server', [`${stamp()} ${line}`]);
}

export const log = {
  info: (message) => out(console.log, `${prefix()}${message}`),
  warn: (message) => out(console.warn, `${prefix()}⚠ ${message}`),
  // detail: extra lines, such as a stack trace or an API's full response.
  error: (message, detail) => out(console.error, `${prefix()}✕ ${message}${detail ? `\n${detail}` : ''}`),
};

export function runWithContext(ctx, fn) {
  return context.run(ctx, fn);
}

// Records what the current platform is doing right now. It's logged (unless quiet), shown live on the
// page, and named in the error message if the platform fails at this point.
// progress (0–1) is optional: when given, the page shows a filling bar instead of a moving one.
export function step(message, { quiet = false, progress } = {}) {
  const c = context.getStore();
  if (!c) return;
  c.step = message;
  c.onStep?.(message, progress);
  if (!quiet) log.info(message);
}

export function currentStep() {
  return context.getStore()?.step;
}
