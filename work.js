// One heavy job at a time on this PC: Whisper (lyrics-video) and ffmpeg's subtitle burn-ins both use every
// CPU core, and Whisper's large-v3 also needs more than 4 GB of free memory, so running them together
// slows both down or fails for memory. Waiting jobs run in priority order (Whisper first), then in the
// order they were asked for. A job never waits on another queued job, so nothing can deadlock.
export const WHISPER = 0;
export const BURN = 1;

const waiting = []; // { priority, run, resolve, reject }
let running = null;

function next() {
  if (running || !waiting.length) return;
  let at = 0;
  for (let i = 1; i < waiting.length; i++) if (waiting[i].priority < waiting[at].priority) at = i;
  running = waiting.splice(at, 1)[0];
  Promise.resolve().then(running.run).then(running.resolve, running.reject).finally(() => {
    running = null;
    next();
  });
}

// Runs fn when its turn comes and resolves with its result. cancel() takes it out of the line if it
// hasn't started; it then resolves with undefined.
export function enqueue(priority, fn) {
  const task = { priority, run: fn };
  const promise = new Promise((resolve, reject) => Object.assign(task, { resolve, reject }));
  waiting.push(task);
  next();
  return {
    promise,
    cancel() {
      const at = waiting.indexOf(task);
      if (at < 0) return false;
      waiting.splice(at, 1);
      task.resolve(undefined);
      return true;
    },
  };
}

export const busy = () => Boolean(running) || waiting.length > 0;
