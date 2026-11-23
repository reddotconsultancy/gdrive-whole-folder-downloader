export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter, capped at 20s. */
export function backoff(attempt) {
  const base = Math.min(20000, 500 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

export class HttpError extends Error {
  constructor(status, reason, message) {
    super(message || `HTTP ${status}${reason ? ` (${reason})` : ''}`);
    this.status = status;
    this.reason = reason;
  }
  /** Worth another try: rate limits, transient server faults. */
  get retryable() {
    if (this.status === 403) return RETRYABLE_403.has(this.reason);
    return this.status === 429 || this.status >= 500;
  }
}

const RETRYABLE_403 = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'sharingRateLimitExceeded',
  'backendError',
  'internalError',
]);

export function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

/**
 * Make one path segment safe for every OS and for unzip tools:
 * no separators, no control chars, no reserved Windows names, no trailing dots.
 */
export function sanitizeSegment(name) {
  let s = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = `_${s}`;
  if (!s) s = 'unnamed';
  // Keep well under filesystem limits, preserving the extension.
  if (s.length > 180) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 12 ? s.slice(dot) : '';
    s = s.slice(0, 180 - ext.length) + ext;
  }
  return s;
}

/** Resolve "a/b.txt" against names already used, returning "a/b (2).txt" on collision. */
export function uniquePath(path, used) {
  if (!used.has(path.toLowerCase())) {
    used.add(path.toLowerCase());
    return path;
  }
  const slash = path.lastIndexOf('/');
  const dir = slash === -1 ? '' : path.slice(0, slash + 1);
  const file = slash === -1 ? path : path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${dir}${stem} (${i})${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

/** Run an async fn, retrying only errors that say they are retryable. */
export async function withRetry(fn, { retries = 6, signal, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (signal?.aborted) throw err;
      const retryable = err instanceof HttpError ? err.retryable : err.name !== 'FatalError';
      if (!retryable || attempt >= retries) throw err;
      onRetry?.(err, attempt + 1);
      await sleep(backoff(attempt));
    }
  }
}

/** Run tasks with bounded concurrency, preserving input order in the result. */
export async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i], i);
      }
    })
  );
  return out;
}
