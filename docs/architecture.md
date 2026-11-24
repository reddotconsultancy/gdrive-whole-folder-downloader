# Architecture

One file, `index.html`, holding markup, styles and script. No build step, no
dependencies, no server. That constraint is deliberate: the app handles people's files,
and a single readable file is something you can audit in an afternoon.

## Why the Drive API and not drive.google.com

`drive.google.com` download pages send no CORS headers, so a browser cannot read them.
Tools that scrape those pages, gdown among them, work because they are not browsers.
Everything here goes through `https://www.googleapis.com/drive/v3`, which does send CORS
headers. This is also why an API key is needed at all: there is no public, CORS-enabled
endpoint that lists a folder without one.

## Scanning

`scanTree` walks breadth-first. Each level lists up to five folders in parallel, and
`listChildren` follows `nextPageToken` until a folder is exhausted, which matters above
1000 children.

Two things make this harder than it looks:

- **Shortcuts.** A shortcut carries its own name but its target's bytes. The entry is
  rewritten to the target's id and mime type, keeping the shortcut's name.
- **Shortcut loops.** A shortcut can point at an ancestor folder. A visited-ID set makes
  the second visit a no-op, so the walk terminates.

A folder that fails to list is recorded on the node and the rest of the scan continues.
One unreadable subfolder should not cost you the other nine thousand files.

## Naming

Drive allows two files with the same name in one folder. Filesystems do not. Names are
sanitized per path segment (illegal characters, control characters, trailing dots and
spaces, Windows reserved names, length), then deduplicated, so the second `report.pdf`
becomes `report (2).pdf` and nothing is silently overwritten.

Folder names are claimed before file names in the same directory, so a file can never
take a folder's name.

Paths are relative to the destination. The destination directory is already named after
the Drive folder, so the root contributes no segment of its own. Getting this wrong
produces `Photos/Photos/...`, which is exactly what happened the first time.

## Downloading

A scheduler keeps up to `S.limit` fetches in flight, pulling from a queue. Each response
body is read chunk by chunk and written to a `FileSystemWritableFileStream`. Nothing is
buffered, so peak memory does not scale with file size or folder size.

The failure paths are the interesting part:

| Condition | Response |
|---|---|
| 429, 5xx, `rateLimitExceeded`, `userRateLimitExceeded` | Exponential backoff with jitter; concurrency halves itself after repeated hits |
| `cannotDownloadAbusiveFile` | Retried once with `acknowledgeAbuse=true` |
| `downloadQuotaExceeded` | Not retryable. Skipped with an explanation; the run continues |
| 404 | Skipped. The file is no longer shared |
| Network drop, or a body shorter than the reported size | Partial file deleted, up to 3 attempts |
| `QuotaExceededError` from the disk | The run stops. Every remaining file would fail identically |

Deleting the partial file matters more than it sounds: resume works by comparing the
size on disk against Drive's reported size, so a half-written file left behind would be
indistinguishable from a complete one on the next run.

Google's "download quota exceeded" and a full local disk are unrelated conditions that
both read as the word "quota". Only a genuine `QuotaExceededError` that is not a
`DriveError` stops the run.

## Fallback for browsers without the File System Access API

Safari, Firefox and mobile browsers cannot write into a chosen folder. There, each file
is fetched, assembled, and handed to the browser's own downloader with the folder path
folded into the filename.

Two measured constraints shape this path:

- Browsers drop rapid back-to-back downloads. At no spacing, 10 of 40 arrived; at 150ms,
  all 40 did. Saves run one at a time, spaced 250ms apart.
- The file is held in memory, so there is a 2GB ceiling. Past that the file is reported
  rather than attempted.

Resume is impossible here, because a page cannot see the Downloads folder. The UI says
so before the run starts rather than discovering it afterwards.

## Integrity checking

Optional, off by default, because it re-reads every byte. Drive reports `md5Checksum`
for binary files, and `crypto.subtle` does not implement MD5, so there is a streaming
MD5 in the file. It was verified against a reference implementation over known vectors,
randomized chunk boundaries and multi-megabyte inputs. A mismatch deletes the file and
reports it, rather than leaving bad data on disk looking finished.

## Debug flags

- `?debug=1` logs every API call, retry and skip decision to a panel and the console.
- `?dryrun=1` runs the whole flow, makes the real requests, and writes nothing.
