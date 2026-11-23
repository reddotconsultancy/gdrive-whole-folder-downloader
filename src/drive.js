import { HttpError, mapLimit, sanitizeSegment, uniquePath, withRetry } from './util.js';

const API = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

/** Google-native types have no bytes of their own; they must be exported. */
const EXPORTS = {
  'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
  'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
  'application/vnd.google-apps.drawing': { mime: 'image/png', ext: '.png' },
  'application/vnd.google-apps.script': { mime: 'application/vnd.google-apps.script+json', ext: '.json' },
};

/** Google types with no export path at all. */
const NO_EXPORT = {
  'application/vnd.google-apps.form': 'Google Form',
  'application/vnd.google-apps.jam': 'Jamboard file',
  'application/vnd.google-apps.map': 'Google My Map',
  'application/vnd.google-apps.site': 'Google Site',
  'application/vnd.google-apps.fusiontable': 'Fusion Table',
};

/** Pull a folder (or file) id out of anything a user is likely to paste. */
export function parseDriveId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const patterns = [
    /\/folders\/([-\w]{10,})/,
    /\/file\/d\/([-\w]{10,})/,
    /[?&]id=([-\w]{10,})/,
    /\/d\/([-\w]{10,})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  // A bare id pasted on its own.
  if (/^[-\w]{10,}$/.test(s)) return s;
  return null;
}

async function apiFetch(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (res.ok) return res;
  let reason, message;
  try {
    const body = await res.json();
    reason = body?.error?.errors?.[0]?.reason;
    message = body?.error?.message;
  } catch {
    /* non-JSON error body */
  }
  throw new HttpError(res.status, reason, message);
}

async function apiJson(path, params, { signal, retries = 5, onRetry } = {}) {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  return withRetry(
    async () => (await apiFetch(url, { signal })).json(),
    { retries, signal, onRetry }
  );
}

/** Human-readable explanation for the errors users will actually hit. */
export function explainError(err) {
  if (!(err instanceof HttpError)) return err?.message || String(err);
  switch (err.status) {
    case 400:
      return 'Google rejected the request. The link may not be a folder link.';
    case 401:
    case 403:
      if (err.reason === 'downloadQuotaExceeded')
        return 'Google has temporarily blocked downloads of this file (too many people downloaded it). Try again later.';
      if (err.reason === 'cannotDownloadAbusiveFile')
        return 'Google flagged this file as abusive and will not serve it to apps.';
      if (/API key not valid|API_KEY/i.test(err.message || ''))
        return 'The API key was rejected. Check the key, and that the Drive API is enabled and the referrer restriction allows this site.';
      if (err.reason === 'rateLimitExceeded' || err.reason === 'userRateLimitExceeded')
        return 'Rate limited by Google. The app backs off and retries automatically.';
      return `Access denied by Google${err.message ? `: ${err.message}` : ''}`;
    case 404:
      return 'Not found. The folder must be shared as "Anyone with the link" — a folder shared only with specific people is invisible to an API key.';
    default:
      return err.message;
  }
}

export function mediaUrl(id, key) {
  return `${API}/files/${encodeURIComponent(id)}?${new URLSearchParams({
    alt: 'media',
    key,
    supportsAllDrives: 'true',
  })}`;
}

export function exportUrl(id, mimeType, key) {
  return `${API}/files/${encodeURIComponent(id)}/export?${new URLSearchParams({
    mimeType,
    key,
  })}`;
}

export function getMeta(id, key, opts) {
  return apiJson(`/files/${encodeURIComponent(id)}`, {
    key,
    fields: 'id,name,mimeType',
    supportsAllDrives: 'true',
  }, opts);
}

async function listChildren(folderId, key, opts) {
  const files = [];
  let pageToken;
  do {
    const page = await apiJson('/files', {
      key,
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields:
        'nextPageToken,files(id,name,mimeType,size,md5Checksum,shortcutDetails(targetId,targetMimeType))',
      pageSize: '1000',
      orderBy: 'folder,name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    }, opts);
    files.push(...(page.files || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

/** Decide how a single entry gets its bytes. */
function describe(entry) {
  const exp = EXPORTS[entry.mimeType];
  if (exp) return { kind: 'export', exportMime: exp.mime, suffix: exp.ext, size: null };
  if (NO_EXPORT[entry.mimeType]) return { kind: 'skip', reason: `${NO_EXPORT[entry.mimeType]} — no downloadable format` };
  if (entry.mimeType?.startsWith('application/vnd.google-apps.'))
    return { kind: 'skip', reason: `${entry.mimeType} — no downloadable format` };
  return { kind: 'media', size: entry.size != null ? Number(entry.size) : null, suffix: '', md5: entry.md5Checksum };
}

/**
 * Walk a folder tree breadth-first. Resolves shortcuts, guards against cycles,
 * and assigns every file a collision-free path inside the archive.
 */
export async function walkFolder(rootId, key, { signal, onProgress, onNotice, concurrency = 6, maxDepth = 64 } = {}) {
  const root = await getMeta(rootId, key, { signal, onRetry: onNotice });
  if (root.mimeType !== FOLDER_MIME) {
    const err = new Error('That link points to a file, not a folder.');
    err.name = 'FatalError';
    throw err;
  }

  const rootName = sanitizeSegment(root.name);
  const files = [];
  const skipped = [];
  const usedPaths = new Set();
  const visited = new Set([rootId]);
  let folderCount = 0;

  let frontier = [{ id: rootId, path: '' }];
  for (let depth = 0; frontier.length && depth < maxDepth; depth++) {
    const results = await mapLimit(frontier, concurrency, async (node) => {
      try {
        return { node, children: await listChildren(node.id, key, { signal, onRetry: onNotice }) };
      } catch (err) {
        skipped.push({ path: node.path || rootName, reason: `could not list folder: ${explainError(err)}` });
        return { node, children: [] };
      }
    });

    const next = [];
    for (const { node, children } of results) {
      for (const raw of children) {
        let entry = raw;
        let isFolder = raw.mimeType === FOLDER_MIME;

        if (raw.mimeType === SHORTCUT_MIME) {
          const target = raw.shortcutDetails;
          if (!target?.targetId) {
            skipped.push({ path: `${node.path}${sanitizeSegment(raw.name)}`, reason: 'broken shortcut' });
            continue;
          }
          isFolder = target.targetMimeType === FOLDER_MIME;
          // Keep the shortcut's own name, but fetch the target's bytes.
          entry = { ...raw, id: target.targetId, mimeType: target.targetMimeType, size: undefined, md5Checksum: undefined };
        }

        const base = sanitizeSegment(entry.name);

        if (isFolder) {
          if (visited.has(entry.id)) continue; // shortcut loop
          visited.add(entry.id);
          folderCount++;
          // Reserving the folder's path keeps a sibling file from colliding with it.
          next.push({ id: entry.id, path: `${uniquePath(`${node.path}${base}`, usedPaths)}/` });
          continue;
        }

        const plan = describe(entry);
        const path = uniquePath(`${node.path}${base}${plan.suffix}`, usedPaths);
        if (plan.kind === 'skip') {
          skipped.push({ path, reason: plan.reason });
          continue;
        }
        files.push({ id: entry.id, name: entry.name, path, zipPath: `${rootName}/${path}`, ...plan });
      }
    }

    frontier = next;
    onProgress?.({ files: files.length, folders: folderCount, skipped: skipped.length, depth });
    if (depth === maxDepth - 1 && next.length) {
      skipped.push({ path: '…', reason: `stopped at ${maxDepth} levels deep` });
    }
  }

  const totalBytes = files.reduce((n, f) => n + (f.size || 0), 0);
  const unknownSizes = files.filter((f) => f.size == null).length;
  return { root: { id: rootId, name: root.name, safeName: rootName }, files, skipped, folderCount, totalBytes, unknownSizes };
}
