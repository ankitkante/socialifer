// The phone's activity log: what the app did and what went wrong, kept in the app's storage (the last 500
// lines) so it can be read and shared from the Laptop screen even in an installed APK. Also printed to the
// console, which shows in the Expo terminal during development. Posts are named by the start of their
// laptop id (sendId), the same name the server's terminal uses ("Phone post 1a2b3c4d").
import { File, Paths } from 'expo-file-system';

const MAX_LINES = 500;
let lines = null;

const logFile = () => new File(Paths.document, 'activity.log');
const pad = (n) => String(n).padStart(2, '0');

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function load() {
  if (lines) return lines;
  try {
    const file = logFile();
    lines = file.exists ? file.textSync().split('\n').filter(Boolean) : [];
  } catch {
    lines = [];
  }
  return lines;
}

// Never throws: a log that can't be written must not break posting.
export function log(message) {
  console.log(`[app] ${message}`);
  const all = load();
  all.push(`${stamp()} ${message}`);
  if (all.length > MAX_LINES) all.splice(0, all.length - MAX_LINES);
  try {
    logFile().writeSync(`${all.join('\n')}\n`);
  } catch {}
}

export const readLog = () => [...load()];

export function clearLog() {
  lines = [];
  try {
    const file = logFile();
    if (file.exists) file.delete();
  } catch {}
}

export const short = (id) => String(id ?? '').slice(0, 8);

// Crashes and stray errors go in the log too, then on to React Native's own handler (the red screen in development).
export function logErrors() {
  const previous = global.ErrorUtils?.getGlobalHandler?.();
  global.ErrorUtils?.setGlobalHandler?.((error, fatal) => {
    log(`App error${fatal ? ' (crash)' : ''}: ${error?.message ?? String(error)}`);
    previous?.(error, fatal);
  });
}
