import { HttpError, backoff, sleep } from './util.js';
import { exportUrl, mediaUrl } from './drive.js';

export const fsaSupported = () => typeof window.showSaveFilePicker === 'function';

export async function pickZipTarget(suggestedName) {
  return window.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
  });
}

async function httpError(res) {
  let reason, message;
  try {
    const body = await res.clone().json();
    reason = body?.error?.errors?.[0]?.reason;
    message = body?.error?.message;
  } catch {
    /* binary or empty body */
  }
  return new HttpError(res.status, reason, message);
}

/**
 * A ReadableStream that survives a dropped connection: on a mid-transfer error
 * it re-requests the remaining bytes with a Range header and carries on, so the
 * consumer (the zip writer) never sees the failure and the entry stays intact.
 */
export function resilientStream(url, { size, retries = 8, signal, onBytes, onRetry } = {}) {
  let pos = 0;
  let reader = null;

  async function open() {
    const res = await fetch(url, {
      signal,
      headers: pos > 0 ? { Range: `bytes=${pos}-` } : {},
    });
    if (!res.ok) throw await httpError(res);
    if (pos > 0 && res.status !== 206) {
      // Server ignored the Range and restarted from zero; resuming would
      // duplicate the bytes already emitted, so fail loudly instead.
      const err = new Error('server does not support resuming this download');
      err.name = 'FatalError';
      throw err;
    }
    return res.body.getReader();
  }

  return new ReadableStream({
    async start() {
      reader = await open();
    },
    async pull(controller) {
      for (let attempt = 0; ; attempt++) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (size != null && pos < size) {
              throw new Error(`transfer ended early at ${pos} of ${size} bytes`);
            }
            controller.close();
            return;
          }
          pos += value.byteLength;
          onBytes?.(value.byteLength);
          controller.enqueue(value);
          return;
        } catch (err) {
          const fatal = err.name === 'FatalError' || (err instanceof HttpError && !err.retryable);
          if (signal?.aborted || fatal || attempt >= retries) {
            controller.error(err);
            return;
          }
          onRetry?.(err, attempt + 1, pos);
          await sleep(backoff(attempt));
          try {
            reader = await open();
          } catch (reopenErr) {
            if (attempt >= retries - 1) {
              controller.error(reopenErr);
              return;
            }
          }
        }
      }
    },
    cancel(reason) {
      try {
        reader?.cancel(reason);
      } catch {
        /* already closed */
      }
    },
  });
}

/**
 * Stream every file straight into one ZIP. Writes through to disk, so memory
 * stays flat regardless of archive size; ZIP64 means no 4 GB wall and no split.
 */
export async function buildZip(files, { key, sink, signal, retries = 8, hooks = {} }) {
  const zip = await import('./vendor/zip.min.js');
  zip.configure({ chunkSize: 1024 * 1024 });

  const writer = new zip.ZipWriter(sink, {
    zip64: true,
    level: 0, // store: Drive content is mostly already compressed; this is far faster
    bufferedWrite: false,
  });

  const failed = [];
  let done = 0;
  let data;

  try {
    for (const file of files) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      hooks.onFileStart?.(file, done, files.length);
      try {
        if (file.kind === 'export') {
          // Export responses have no Content-Length and ignore Range, so buffer
          // them whole — Google caps exports at 10 MB, which is safe to hold.
          const res = await fetch(exportUrl(file.id, file.exportMime, key), { signal });
          if (!res.ok) throw await httpError(res);
          const blob = await res.blob();
          hooks.onBytes?.(blob.size);
          await writer.add(file.zipPath, new zip.BlobReader(blob), { level: 0 });
        } else {
          const stream = resilientStream(mediaUrl(file.id, key), {
            size: file.size,
            retries,
            signal,
            onBytes: hooks.onBytes,
            onRetry: (err, attempt, at) => hooks.onRetry?.(file, err, attempt, at),
          });
          await writer.add(file.zipPath, stream, { level: 0 });
        }
        done++;
        hooks.onFileDone?.(file, done, files.length);
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        failed.push({ file, error: err });
        hooks.onFileFail?.(file, err);
      }
    }
  } finally {
    // close() writes the central directory; without it the archive is unusable.
    // With a Writer sink (in-memory mode) it also hands back the finished data.
    try {
      data = await writer.close();
    } catch (err) {
      if (!signal?.aborted) throw err;
    }
  }

  return { completed: done, failed, data };
}

/** Firefox/Safari path: no streaming-to-disk API, so assemble in memory. */
export async function buildZipInMemory(files, opts) {
  const zip = await import('./vendor/zip.min.js');
  const result = await buildZip(files, { ...opts, sink: new zip.BlobWriter('application/zip') });
  return { ...result, blob: result.data };
}
