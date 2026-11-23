# Drive Folder Downloader

Paste a Google Drive folder shared as **“Anyone with the link”** and download the
whole thing as one archive — subfolders included, no 2 GB split, no server.

Everything runs in the browser. The page talks straight to the Google Drive API
and writes the archive to your disk, so no file ever passes through a server of
ours. That is also why it can be hosted free on GitHub Pages.

## Why it exists

Drive's own "Download folder" button zips server-side, caps each archive at 2 GB,
and splits anything bigger into numbered parts that then have to be stitched back
together. Large folders also fail halfway with nothing to show for it. This does
the opposite: one ZIP64 archive of any size, written incrementally, with per-file
retries and a resume on a dropped connection.

## How it works

1. **List** — the Drive API is walked breadth-first from the folder you paste,
   following subfolders and resolving shortcuts, with a guard against loops.
2. **Stream** — each file is fetched and piped straight into a single ZIP64
   archive via [zip.js](https://github.com/gildas-lormeau/zip.js), written through
   the File System Access API to the file you picked. Memory stays flat no matter
   how large the folder is, because nothing is buffered.
3. **Recover** — if a transfer drops or ends short, the remaining bytes are
   re-requested with an HTTP `Range` header and the entry continues intact.
   Rate limits (`429`, `403 rateLimitExceeded`) back off exponentially. A file
   that cannot be fetched at all is logged and skipped, and you get a
   "retry the ones that failed" button rather than a ruined archive.

### Deliberate behaviour worth knowing

| Situation | What happens |
| --- | --- |
| Google Docs, Sheets, Slides, Drawings | Exported to `.docx` / `.xlsx` / `.pptx` / `.png` (Google caps exports at 10 MB) |
| Forms, Jamboards, Sites, My Maps | Listed as skipped — Google provides no download format |
| Shortcuts | Resolved to the target's bytes, kept under the shortcut's name |
| Two files with the same name | Second becomes `name (2).ext` |
| Names with `/ \ : * ? " < > |` or trailing dots | Sanitized per path segment, safe to unzip on any OS |
| Folder shared with specific people only | Fails with a clear message — an API key can only read link-shared files |
| Chrome / Edge | Streams to disk, unlimited size |
| Firefox / Safari | No streaming-to-disk API, so archives are built in memory and capped at 1 GiB; above that it offers file-by-file download |

## Setup

### 1. Get a Drive API key

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. Restrict it (important — the key is public in a static site):
   - **Application restrictions → Websites**, allow `https://<you>.github.io/*`
     and your custom domain if you have one.
   - **API restrictions → Restrict key →** Google Drive API only.

A browser API key is public by design; restricting it means nobody can spend
your quota from anywhere but your own site.

### 2. Configure

Put the key in `src/config.js` to ship a shared key, or leave it blank to make
each visitor paste their own (stored only in their browser):

```js
export const CONFIG = {
  apiKey: 'AIza…',
  allowUserKey: true,
  donateUrl: 'https://…',
};
```

### 3. Publish

**Settings → Pages → Build and deployment → Deploy from a branch**, pick your
branch and `/ (root)`. There is nothing to build.

## Local development

```bash
npm run serve
```

Then open <http://localhost:8080>. A plain static server is enough; the only
requirement is a secure context, which `localhost` counts as.

## Tests

```bash
npm install
npm test
```

`test/e2e.mjs` drives the real page in headless Chromium against a mocked Drive
API and checks the resulting archive with its own independent ZIP parser. It
covers folder walking, shortcut resolution, Google-native export, name
sanitizing and collisions, skipped types, resuming after a truncated response,
and both output modes.

## Licence

MIT — see [LICENSE](LICENSE). Bundled and referenced third-party code is listed
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Support

This is free to use and costs nothing to run beyond API quota. If it saved you
an afternoon, donation details go in `CONFIG.donateUrl`.
