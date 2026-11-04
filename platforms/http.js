import { setTimeout as sleep } from 'node:timers/promises';

// Generous timeout for requests that carry or wait on large files.
export const UPLOAD_TIMEOUT = 15 * 60_000;

// fetch wrapper that parses JSON and turns API errors into readable messages.
export async function request(url, { timeout = 60_000, ...options } = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${errorMessage(data)}`);
  return { data, headers: res.headers };
}

function errorMessage(data) {
  if (!data) return 'empty response';
  if (typeof data === 'string') return data.slice(0, 300);
  return (
    data.error?.error_user_msg ||
    data.error?.message ||
    data.error_description ||
    data.detail ||
    data.description ||
    data.message ||
    (typeof data.error === 'string' && data.error) ||
    data.errors?.[0]?.message ||
    JSON.stringify(data).slice(0, 300)
  );
}

// Calls check() until it returns something other than undefined, e.g. while a video processes.
export async function poll(check, { every = 3000, timeout = 10 * 60_000, what = 'processing' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(every);
  }
}

export function env(name) {
  return process.env[name]?.trim() || '';
}

export function hasEnv(...names) {
  return names.every((n) => env(n));
}
