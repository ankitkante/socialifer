import { AsyncLocalStorage } from 'node:async_hooks';

// Every platform posts inside its own context ({ postId, platform, step, onStep }), so any code, however
// deep, can log with the right "[post 7] YouTube:" prefix and report what it's doing to the page.
const context = new AsyncLocalStorage();

const time = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

function prefix() {
  const c = context.getStore();
  return c ? `[post ${c.postId}] ${c.platform}: ` : '';
}

export const log = {
  info: (message) => console.log(`${time()} ${prefix()}${message}`),
  warn: (message) => console.warn(`${time()} ${prefix()}⚠ ${message}`),
  // detail: extra lines for the terminal only, such as a stack trace or an API's full response.
  error: (message, detail) => console.error(`${time()} ${prefix()}✕ ${message}${detail ? `\n${detail}` : ''}`),
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
