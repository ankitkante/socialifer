// The phone's activity log: what the app did and what went wrong. Lines wait in the app's storage until the
// laptop has them (it keeps them 6 months, in logs/phone-YYYY-MM.log), then they're deleted here; the
// Activity log screen shows the laptop's copy plus what's still waiting. At most 500 lines wait, so a phone
// away from the laptop for long keeps the newest. Also printed to the console, which shows in the Expo
// terminal during development. Posts are named by the start of their laptop id (sendId), the same name the
// server's terminal uses ("Phone post 1a2b3c4d").
import { File, Paths } from 'expo-file-system';

const MAX_LINES = 500;
let lines = null;
// Lines dropped from the start since the app opened (see unsentLog).
let dropped = 0;

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

function save() {
  try {
    logFile().writeSync(lines.length ? `${lines.join('\n')}\n` : '');
  } catch {}
}

// Never throws: a log that can't be written must not break posting.
export function log(message) {
  console.log(`[app] ${message}`);
  const all = load();
  all.push(`${stamp()} ${message}`);
  if (all.length > MAX_LINES) {
    const n = all.length - MAX_LINES;
    all.splice(0, n);
    dropped += n;
  }
  save();
}

// The lines the laptop doesn't have yet.
export const readLog = () => [...load()];

// The waiting lines, and a function to call once the laptop has them. Lines logged while they're on the
// way stay for next time.
export function unsentLog() {
  const batch = [...load()];
  const droppedBefore = dropped;
  return {
    lines: batch,
    // Lines dropped meanwhile were part of this batch.
    done: () => {
      const n = batch.length - (dropped - droppedBefore);
      if (n > 0) {
        load().splice(0, n);
        save();
      }
    },
  };
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
