import { setTimeout as sleep } from 'node:timers/promises';
import { log } from '../log.js';

// Generous timeout for requests that carry or wait on large files.
export const UPLOAD_TIMEOUT = 15 * 60_000;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// An error from a platform's API or from the network: expected, and worded for the user.
// Anything else thrown while posting is treated as a bug in the app.
export class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.details = details;
  }
}

// Hides secrets that some APIs put in URLs (access tokens in the query, bot and webhook tokens in the path).
export function redactUrl(url) {
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) {
    if (/token|secret|key|password/i.test(key)) u.searchParams.set(key, 'REDACTED');
  }
  u.pathname = u.pathname.replace(/\/bot[^/]+/, '/botREDACTED').replace(/(\/webhooks\/\d+\/)[^/]+/, '$1REDACTED');
  return u.toString();
}

const duration = (ms) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`);

// fetch() only says "fetch failed"; the real reason is in err.cause.
function networkMessage(err, url, timeout) {
  const host = new URL(url).host;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return `${host} didn't respond within ${duration(timeout)}`;
  const code = err.cause?.code || err.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Couldn't reach ${host}. Check your internet connection`;
  if (code === 'ECONNREFUSED') return `${host} refused the connection`;
  if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) return `The connection to ${host} was dropped (${code})`;
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) return `The connection to ${host} timed out (${code})`;
  return `Network error talking to ${host}${code ? ` (${code})` : ''}: ${err.cause?.message || err.message}`;
}

// fetch wrapper that parses JSON, turns failures into readable ApiErrors and logs the details.
// retries: only for requests that are safe to repeat (e.g. re-sending the same upload chunk);
// network errors and 429/5xx responses are retried after 1, 3 and 9 seconds.
// headers may be a function, called on every attempt, for signatures that can't be reused (X's OAuth).
export async function request(url, { timeout = 60_000, retries = 0, headers, ...options } = {}) {
  const method = options.method || 'GET';
  for (let attempt = 0; ; attempt++) {
    const retry = async (why) => {
      log.warn(`${why}; retrying (${attempt + 1} of ${retries})`);
      await sleep(1000 * 3 ** attempt);
    };

    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: typeof headers === 'function' ? headers() : headers,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      const message = networkMessage(err, url, timeout);
      if (attempt < retries) { await retry(message); continue; }
      log.error(`${method} ${redactUrl(url)} failed: ${message}`);
      throw new ApiError(message, { url: redactUrl(url) });
    }

    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }
    if (res.ok) return { data, headers: res.headers };

    if (attempt < retries && RETRYABLE_STATUS.has(res.status)) { await retry(`HTTP ${res.status} from ${new URL(url).host}`); continue; }
    const message = `HTTP ${res.status}: ${errorMessage(data)}`;
    log.error(`${method} ${redactUrl(url)} → ${message}`, raw ? `  Response: ${raw.slice(0, 2000)}` : '');
    throw new ApiError(message, { status: res.status, data, url: redactUrl(url) });
  }
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
    if (Date.now() > deadline) throw new ApiError(`Timed out after ${duration(timeout)} waiting for ${what}`);
    await sleep(every);
  }
}

export function env(name) {
  return process.env[name]?.trim() || '';
}

export function hasEnv(...names) {
  return names.every((n) => env(n));
}
