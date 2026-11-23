import { CONFIG } from './config.js';
import { explainError, parseDriveId, walkFolder } from './drive.js';
import { buildZip, buildZipInMemory, fsaSupported, pickZipTarget } from './zipper.js';
import { formatBytes, sleep } from './util.js';

const $ = (sel) => document.querySelector(sel);
const KEY_STORE = 'gwfd.apiKey';
const MEMORY_LIMIT = 1024 ** 3; // don't assemble more than 1 GiB in RAM

const el = {
  form: $('#scan-form'),
  link: $('#folder-link'),
  keyRow: $('#key-row'),
  key: $('#api-key'),
  scanBtn: $('#scan-btn'),
  scanStatus: $('#scan-status'),
  summary: $('#summary'),
  stats: $('#stats'),
  warnings: $('#warnings'),
  startBtn: $('#start-btn'),
  altBtn: $('#alt-btn'),
  modeNote: $('#mode-note'),
  progress: $('#progress'),
  bar: $('#bar'),
  barFill: $('#bar-fill'),
  progressHead: $('#progress-head'),
  progressMeta: $('#progress-meta'),
  current: $('#current-file'),
  cancelBtn: $('#cancel-btn'),
  log: $('#log'),
  result: $('#result'),
  support: $('#support'),
};

let scan = null;
let controller = null;

/* ---------- helpers ---------- */

function log(message, kind = 'info') {
  const line = document.createElement('div');
  line.className = `log-line log-${kind}`;
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  el.log.prepend(line);
  while (el.log.childElementCount > 300) el.log.lastElementChild.remove();
}

function show(node, visible = true) {
  node.hidden = !visible;
}

function apiKey() {
  return (el.key.value.trim() || CONFIG.apiKey || '').trim();
}

function setBusy(busy) {
  el.scanBtn.disabled = busy;
  el.link.disabled = busy;
  el.startBtn.disabled = busy;
}

/* ---------- scanning ---------- */

el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = parseDriveId(el.link.value);
  if (!id) {
    el.scanStatus.textContent = 'That does not look like a Google Drive link. Paste the folder URL or its id.';
    el.scanStatus.className = 'status status-bad';
    return;
  }
  const key = apiKey();
  if (!key) {
    el.scanStatus.textContent = 'An API key is required. Paste one above.';
    el.scanStatus.className = 'status status-bad';
    el.key.focus();
    return;
  }
  if (el.key.value.trim()) localStorage.setItem(KEY_STORE, el.key.value.trim());

  setBusy(true);
  show(el.summary, false);
  show(el.result, false);
  el.scanStatus.className = 'status';
  el.scanStatus.textContent = 'Reading the folder…';
  controller = new AbortController();

  try {
    scan = await walkFolder(id, key, {
      signal: controller.signal,
      onProgress: ({ files, folders }) => {
        el.scanStatus.textContent = `Reading the folder… ${files} file${files === 1 ? '' : 's'} in ${folders + 1} folder${folders === 0 ? '' : 's'} so far`;
      },
      onNotice: (err, attempt) => log(`Listing retry ${attempt}: ${explainError(err)}`, 'warn'),
    });
    renderSummary();
  } catch (err) {
    el.scanStatus.className = 'status status-bad';
    el.scanStatus.textContent = explainError(err);
  } finally {
    setBusy(false);
  }
});

function renderSummary() {
  const { files, skipped, folderCount, totalBytes, unknownSizes, root } = scan;
  el.scanStatus.textContent = '';
  el.scanStatus.className = 'status';

  el.stats.innerHTML = '';
  const cards = [
    ['Folder', root.name],
    ['Files', String(files.length)],
    ['Subfolders', String(folderCount)],
    ['Total size', unknownSizes ? `${formatBytes(totalBytes)}+` : formatBytes(totalBytes)],
  ];
  for (const [label, value] of cards) {
    const d = document.createElement('div');
    d.className = 'stat';
    d.innerHTML = `<span class="stat-label"></span><span class="stat-value"></span>`;
    d.querySelector('.stat-label').textContent = label;
    d.querySelector('.stat-value').textContent = value;
    el.stats.append(d);
  }

  el.warnings.innerHTML = '';
  if (skipped.length) {
    const details = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = `${skipped.length} item${skipped.length === 1 ? '' : 's'} cannot be downloaded`;
    details.append(sum);
    const ul = document.createElement('ul');
    for (const s of skipped.slice(0, 200)) {
      const li = document.createElement('li');
      li.textContent = `${s.path} — ${s.reason}`;
      ul.append(li);
    }
    details.append(ul);
    el.warnings.append(details);
  }

  // Decide the output mode for this browser and this folder.
  const streaming = fsaSupported();
  el.startBtn.disabled = files.length === 0;
  show(el.altBtn, false);
  if (streaming) {
    el.startBtn.textContent = 'Download as one ZIP';
    el.modeNote.textContent =
      'Streamed straight to the file you choose — one archive, no size limit, no split parts.';
  } else if (totalBytes && totalBytes <= MEMORY_LIMIT) {
    el.startBtn.textContent = `Download as one ZIP (${formatBytes(totalBytes)})`;
    el.modeNote.textContent =
      'This browser cannot stream to disk, so the archive is built in memory. It works at this size; Chrome or Edge has no limit.';
  } else {
    el.startBtn.disabled = true;
    el.startBtn.textContent = 'Download as one ZIP';
    el.modeNote.textContent =
      'This browser cannot stream to disk and the folder is too large to hold in memory. Use Chrome or Edge for a single archive, or fetch the files one by one.';
    show(el.altBtn, files.length > 0);
  }

  show(el.summary, true);
}

/* ---------- downloading ---------- */

el.startBtn.addEventListener('click', () => startDownload(scan.files));
el.cancelBtn.addEventListener('click', () => controller?.abort());
el.altBtn.addEventListener('click', downloadIndividually);

async function startDownload(queue) {
  const key = apiKey();
  const streaming = fsaSupported();
  let sink = null;

  if (streaming) {
    let handle;
    try {
      handle = await pickZipTarget(`${scan.root.safeName}.zip`);
    } catch {
      return; // user dismissed the save dialog
    }
    sink = await handle.createWritable();
  }

  controller = new AbortController();
  const totalBytes = queue.reduce((n, f) => n + (f.size || 0), 0);
  let bytes = 0;
  let lastTick = performance.now();
  let lastBytes = 0;
  let speed = 0;

  el.log.innerHTML = '';
  show(el.progress, true);
  show(el.result, false);
  setBusy(true);
  el.progressHead.textContent = `Downloading ${queue.length} file${queue.length === 1 ? '' : 's'}`;

  const paint = () => {
    const now = performance.now();
    if (now - lastTick > 500) {
      speed = ((bytes - lastBytes) * 1000) / (now - lastTick);
      lastTick = now;
      lastBytes = bytes;
    }
    const pct = totalBytes ? Math.min(100, (bytes / totalBytes) * 100) : 0;
    el.barFill.style.width = `${pct}%`;
    el.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    const eta = speed > 0 && totalBytes > bytes ? (totalBytes - bytes) / speed : null;
    el.progressMeta.textContent = [
      totalBytes ? `${formatBytes(bytes)} of ${formatBytes(totalBytes)}` : formatBytes(bytes),
      speed ? `${formatBytes(speed)}/s` : null,
      eta ? `${Math.ceil(eta / 60)} min left` : null,
    ]
      .filter(Boolean)
      .join('  ·  ');
  };

  const hooks = {
    onFileStart: (file, done) => {
      el.current.textContent = `${done + 1}/${queue.length}  ${file.path}`;
      paint();
    },
    onBytes: (n) => {
      bytes += n;
      paint();
    },
    onRetry: (file, err, attempt, at) =>
      log(`Retry ${attempt} for ${file.path} at ${formatBytes(at)}: ${explainError(err)}`, 'warn'),
    onFileFail: (file, err) => log(`Failed: ${file.path} — ${explainError(err)}`, 'bad'),
  };

  try {
    const result = streaming
      ? await buildZip(queue, { key, sink, signal: controller.signal, hooks })
      : await buildZipInMemory(queue, { key, signal: controller.signal, hooks });

    if (!streaming && result.blob) {
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${scan.root.safeName}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    renderResult(result, queue.length);
  } catch (err) {
    if (err?.name === 'AbortError') {
      log('Cancelled. The partial archive was still closed properly and will open.', 'warn');
      el.progressHead.textContent = 'Cancelled';
    } else {
      log(explainError(err), 'bad');
      el.progressHead.textContent = 'Stopped on an error';
    }
  } finally {
    el.current.textContent = '';
    setBusy(false);
  }
}

function renderResult({ completed, failed }, total) {
  el.progressHead.textContent = failed.length ? 'Finished with problems' : 'Done';
  el.result.innerHTML = '';

  const h = document.createElement('p');
  h.className = failed.length ? 'status status-warn' : 'status status-good';
  h.textContent = failed.length
    ? `${completed} of ${total} files downloaded. ${failed.length} could not be fetched.`
    : `All ${completed} file${completed === 1 ? '' : 's'} downloaded into one archive.`;
  el.result.append(h);

  if (failed.length) {
    const ul = document.createElement('ul');
    for (const f of failed.slice(0, 100)) {
      const li = document.createElement('li');
      li.textContent = `${f.file.path} — ${explainError(f.error)}`;
      ul.append(li);
    }
    el.result.append(ul);

    const retry = document.createElement('button');
    retry.className = 'btn';
    retry.textContent = `Retry the ${failed.length} that failed`;
    retry.addEventListener('click', () => startDownload(failed.map((f) => f.file)));
    el.result.append(retry);
  }
  show(el.result, true);
}

/** Last resort for browsers without streaming: hand the files over one at a time. */
async function downloadIndividually() {
  const files = scan.files;
  show(el.progress, true);
  el.progressHead.textContent = `Fetching ${files.length} files one by one`;
  el.progressMeta.textContent = 'Your browser may ask permission to download multiple files.';
  log('Individual mode: each file is requested from Google directly.', 'info');
  for (const [i, file] of files.entries()) {
    el.current.textContent = `${i + 1}/${files.length}  ${file.path}`;
    el.barFill.style.width = `${((i + 1) / files.length) * 100}%`;
    const a = document.createElement('a');
    a.href = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(file.id)}`;
    a.download = file.path.split('/').pop();
    a.rel = 'noopener';
    a.click();
    await sleep(1200);
  }
  el.current.textContent = '';
  el.progressHead.textContent = 'All files handed to the browser';
}

/* ---------- boot ---------- */

(function init() {
  const stored = localStorage.getItem(KEY_STORE);
  if (stored) el.key.value = stored;
  const needsKey = !CONFIG.apiKey || CONFIG.allowUserKey;
  show(el.keyRow, needsKey);
  if (CONFIG.apiKey) el.key.placeholder = 'Optional — use your own key instead of the built-in one';

  if (CONFIG.donateUrl) {
    const a = document.createElement('a');
    a.className = 'btn btn-support';
    a.href = CONFIG.donateUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = CONFIG.donateLabel;
    el.support.append(a);
    show(el.support, true);
  }

  if (!fsaSupported()) {
    log('This browser has no streaming-to-disk API. Chrome or Edge gives unlimited archive size.', 'warn');
  }
})();
