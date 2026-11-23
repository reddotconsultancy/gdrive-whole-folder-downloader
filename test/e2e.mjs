/**
 * End-to-end test against a mocked Google Drive API.
 *
 *   npm i -D playwright && node test/e2e.mjs
 *
 * If playwright is installed globally rather than in this project, point at it:
 *   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node test/e2e.mjs
 *
 * Covers: folder walking, shortcut resolution, Google-native export, name
 * sanitizing and collisions, skipped types, resumable transfer after a
 * truncated response, and both output modes (stream-to-disk and in-memory).
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const spec of ['playwright', 'playwright-core', process.env.PLAYWRIGHT_MODULE].filter(Boolean)) {
    try {
      return require_(spec);
    } catch {
      /* try the next one */
    }
  }
  throw new Error('playwright not found — npm i -D playwright, or set PLAYWRIGHT_MODULE');
})();

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';

/* ---------- the fake Drive ---------- */

const bytesFor = (id, size) => Buffer.from(Array.from({ length: size }, (_, i) => (id.charCodeAt(i % id.length) + i) % 256));

const BIG = bytesFor('a.bin', 1_500_000);
const RESUME = bytesFor('resume.bin', 1_000_000);

const ROOT_ID = '1rootFolderIdExample0000000000000';

const TREE = {
  [ROOT_ID]: {
    name: 'My Folder',
    children: [
      { id: 'f_a', name: 'a.bin', mimeType: 'application/octet-stream', size: String(BIG.length) },
      { id: 'f_dup1', name: 'dup.txt', mimeType: 'text/plain', size: '5' },
      { id: 'f_dup2', name: 'dup.txt', mimeType: 'text/plain', size: '5' },
      { id: 'f_bad', name: 'bad/name:?.txt', mimeType: 'text/plain', size: '5' },
      { id: 'f_doc', name: 'report', mimeType: 'application/vnd.google-apps.document' },
      { id: 'f_form', name: 'survey', mimeType: 'application/vnd.google-apps.form' },
      { id: 'f_resume', name: 'resume.bin', mimeType: 'application/octet-stream', size: String(RESUME.length) },
      { id: 'sc_1', name: 'link.bin', mimeType: SHORTCUT, shortcutDetails: { targetId: 'f_a', targetMimeType: 'application/octet-stream' } },
      { id: 'sub', name: 'sub', mimeType: FOLDER },
    ],
  },
  sub: { name: 'sub', children: [{ id: 'deep', name: 'deep', mimeType: FOLDER }] },
  deep: { name: 'deep', children: [{ id: 'f_note', name: 'note.txt', mimeType: 'text/plain', size: '5' }] },
};

const CONTENT = {
  f_a: BIG,
  f_resume: RESUME,
  f_dup1: Buffer.from('one--'),
  f_dup2: Buffer.from('two--'),
  f_bad: Buffer.from('bad--'),
  f_note: Buffer.from('note!'),
};

let truncateOnce = true;
const hits = { range: 0, media: 0 };

async function mockDrive(route, request) {
  const url = new URL(request.url());
  const path = url.pathname.replace('/drive/v3', '');
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  if (path === '/files') {
    const parent = /'([^']+)' in parents/.exec(url.searchParams.get('q') || '')?.[1];
    const node = TREE[parent];
    if (!node) return json({ files: [] });
    return json({ files: node.children });
  }

  const exportMatch = path.match(/^\/files\/([^/]+)\/export$/);
  if (exportMatch) {
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from('DOCX-EXPORT') });
  }

  const fileMatch = path.match(/^\/files\/([^/]+)$/);
  if (fileMatch) {
    const id = decodeURIComponent(fileMatch[1]);
    if (url.searchParams.get('alt') === 'media') {
      const body = CONTENT[id];
      if (!body) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 404, errors: [{ reason: 'notFound' }] } }) });
      const range = request.headers()['range'];
      if (range) {
        hits.range++;
        const start = Number(/bytes=(\d+)-/.exec(range)[1]);
        return route.fulfill({ status: 206, contentType: 'application/octet-stream', body: body.subarray(start) });
      }
      hits.media++;
      // First read of resume.bin stops early, so the client must resume by range.
      if (id === 'f_resume' && truncateOnce) {
        truncateOnce = false;
        return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: body.subarray(0, 400_000) });
      }
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', body });
    }
    const node = TREE[id];
    if (node) return json({ id, name: node.name, mimeType: FOLDER });
    return json({ id, name: id, mimeType: 'application/octet-stream' });
  }

  return route.fulfill({ status: 404, body: '{}' });
}

/* ---------- static server for the app itself ---------- */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, rel === '/' ? 'index.html' : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('nope');
  }
});
await new Promise((r) => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ---------- run ---------- */

const EXPECTED = {
  'My Folder/a.bin': BIG.length,
  'My Folder/dup.txt': 5,
  'My Folder/dup (2).txt': 5,
  'My Folder/bad_name__.txt': 5,
  'My Folder/report.docx': 11,
  'My Folder/resume.bin': RESUME.length,
  'My Folder/link.bin': BIG.length,
  'My Folder/sub/deep/note.txt': 5,
};

const browser = await chromium.launch();
let failures = 0;

for (const mode of ['stream', 'memory']) {
  truncateOnce = true;
  hits.range = 0;
  hits.media = 0;

  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  // In 'stream' mode, stand in for the File System Access API with a sink that
  // collects what the app writes; in 'memory' mode, remove it so the app takes
  // the Blob fallback and we catch the browser download instead.
  await page.addInitScript(
    ({ mode }) => {
      if (mode === 'memory') {
        delete window.showSaveFilePicker;
        return;
      }
      window.__written = [];
      window.__closed = false;
      window.showSaveFilePicker = async () => ({
        createWritable: async () =>
          new WritableStream({
            write(chunk) {
              window.__written.push(Array.from(chunk));
            },
            close() {
              window.__closed = true;
            },
          }),
      });
    },
    { mode }
  );

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://www.googleapis.com/drive/v3/**', mockDrive);

  await page.goto(`${origin}/index.html`);
  await page.fill('#folder-link', `https://drive.google.com/drive/folders/${ROOT_ID}`);
  await page.fill('#api-key', 'TEST_KEY');
  await page.click('#scan-btn');
  await page.waitForSelector('#summary:not([hidden])');

  const stats = await page.textContent('#stats');
  assert.match(stats, /My Folder/, 'folder name shown');
  assert.match(stats, /Files8(?!\d)/, 'eight downloadable files found');
  assert.match(stats, /Subfolders2(?!\d)/, 'both nested folders found');
  const warnings = await page.textContent('#warnings');
  assert.match(warnings, /1 item cannot be downloaded/, 'the Google Form is reported as skipped');

  let zipBytes;
  if (mode === 'stream') {
    await page.click('#start-btn');
    await page.waitForSelector('#result:not([hidden])', { timeout: 60_000 });
    zipBytes = Buffer.from(await page.evaluate(() => window.__written.flat()));
    // Closing the handle is what commits the file to disk; without it the
    // archive would be left incomplete on a real filesystem.
    assert.equal(await page.evaluate(() => window.__closed), true, 'file handle was closed');
  } else {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.click('#start-btn'),
    ]);
    zipBytes = await readFile(await download.path());
  }

  const result = await page.textContent('#result');
  const report = { mode, errors, bytes: zipBytes.length, rangeRequests: hits.range, result: result.trim().slice(0, 120) };

  try {
    assert.deepEqual(errors, [], 'no uncaught page errors');
    assert.match(result, /All 8 files downloaded/, 'all eight files reported complete');
    assert.equal(hits.range, 1, 'exactly one ranged resume request was needed');

    const { entries } = await unzip(zipBytes);
    assert.deepEqual(Object.keys(entries).sort(), Object.keys(EXPECTED).sort(), 'archive holds exactly the expected paths');
    for (const [name, size] of Object.entries(EXPECTED)) {
      assert.equal(entries[name].length, size, `${name} is ${size} bytes`);
    }
    assert.ok(entries['My Folder/resume.bin'].equals(RESUME), 'resumed file matches byte for byte');
    assert.ok(entries['My Folder/a.bin'].equals(BIG), 'large file matches byte for byte');
    assert.ok(entries['My Folder/link.bin'].equals(BIG), 'shortcut resolved to its target bytes');
    assert.equal(entries['My Folder/dup.txt'].toString(), 'one--');
    assert.equal(entries['My Folder/dup (2).txt'].toString(), 'two--');
    console.log(`PASS  ${mode}:`, JSON.stringify(report));
  } catch (err) {
    failures++;
    console.error(`FAIL  ${mode}:`, err.message, JSON.stringify(report));
  }

  await context.close();
}

await browser.close();
server.close();
process.exit(failures ? 1 : 0);

/* ---------- a tiny zip reader, so the test does not trust the writer ---------- */

async function unzip(buf) {
  const { unzipSync } = await import('node:zlib');
  const entries = {};
  // Walk the central directory from the End Of Central Directory record.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, 'end of central directory found');
  let count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  if (offset === 0xffffffff || count === 0xffff) {
    // ZIP64: locator sits just before the EOCD.
    const loc = eocd - 20;
    assert.equal(buf.readUInt32LE(loc), 0x07064b50, 'zip64 locator found');
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    assert.equal(buf.readUInt32LE(z64), 0x06064b50, 'zip64 EOCD found');
    count = Number(buf.readBigUInt64LE(z64 + 32));
    offset = Number(buf.readBigUInt64LE(z64 + 48));
  }

  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(offset), 0x02014b50, 'central directory header');
    const method = buf.readUInt16LE(offset + 10);
    let compressed = buf.readUInt32LE(offset + 20);
    let uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    let local = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

    // Pull the real values out of the zip64 extra field when present.
    let p = offset + 46 + nameLen;
    const extraEnd = p + extraLen;
    while (p < extraEnd - 3) {
      const tag = buf.readUInt16LE(p);
      const len = buf.readUInt16LE(p + 2);
      if (tag === 0x0001) {
        let q = p + 4;
        if (uncompressed === 0xffffffff) { uncompressed = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (compressed === 0xffffffff) { compressed = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (local === 0xffffffff) { local = Number(buf.readBigUInt64LE(q)); }
      }
      p += 4 + len;
    }
    offset = extraEnd + commentLen;

    const lnLen = buf.readUInt16LE(local + 26);
    const lxLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnLen + lxLen;
    const raw = buf.subarray(start, start + compressed);
    const data = method === 0 ? raw : unzipSync(raw, { finishFlush: 2 });
    assert.equal(data.length, uncompressed, `${name} declared size matches stored bytes`);
    entries[name] = data;
  }
  return { entries };
}
