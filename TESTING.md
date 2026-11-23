# Testing

A concrete plan for checking this actually works. Tick items as you go; each one says
what you should see.

Two flags are built into the page:

- `?debug=1` — verbose console logging of every API call, retry and skip decision, plus
  a log panel at the bottom of the page.
- `?dryrun=1` — runs the full scan and the full download loop, makes the real requests
  to Google, and writes nothing to disk. Use it to exercise flow and error handling
  without moving data. Combine them: `?debug=1&dryrun=1`.

---

## Link parsing

- [ ] `https://drive.google.com/drive/folders/<ID>` — scans.
- [ ] `https://drive.google.com/drive/u/2/folders/<ID>` — scans.
- [ ] `https://drive.google.com/drive/folders/<ID>?usp=sharing` — scans; the query is ignored.
- [ ] `https://drive.google.com/open?id=<ID>` — scans.
- [ ] A bare `<ID>` pasted on its own — scans.
- [ ] A link to a *file* rather than a folder — "That link points to a file, not a folder."
- [ ] `hello world` — the message names the expected format. No request is made.

## Scanning

- [ ] **Empty folder** — scan completes, 0 files, download button disabled.
- [ ] **Flat folder, ~10 files** — count and total size match what Drive shows.
- [ ] **Deeply nested, 5+ levels** — the tree expands to the deepest level; folders
      render their children the first time you open them.
- [ ] **More than 1000 children in one folder** — all of them appear. With `?debug=1`
      the log shows `paging ... (1000 so far)`, proving `nextPageToken` was followed.
- [ ] **Folder containing shortcuts** — the shortcut's own name is used, and the
      target's bytes are downloaded.
- [ ] **A shortcut pointing at an ancestor folder** — scan finishes rather than looping.
      With `?debug=1` the log shows `skipping shortcut loop at ...`.
- [ ] **Two files with the identical name in one folder** — both appear; on disk the
      second becomes `name (2).ext`. Open both: contents differ.
- [ ] **Names containing `/ : ? *`, emoji, and non-Latin scripts** — illegal characters
      become `_`; emoji and non-Latin characters survive unchanged.
- [ ] **A private folder** — "Not found" style message explaining the folder must be
      shared with anyone who has the link. No crash, no blank screen.
- [ ] **A deleted or unshared link** — same: a clear message, not a stack trace.

## Downloading

- [ ] **A Google Doc, Sheet, Slide and Drawing** — arrive as `.docx`, `.xlsx`, `.pptx`,
      `.png` and open correctly in Word/Excel/PowerPoint or an image viewer.
- [ ] **The same four with "Docs, Sheets, Slides as" set to PDF** — all arrive as `.pdf`.
- [ ] **A file over 2GB** — downloads as a single file. Watch the tab in Task Manager
      (Shift+Esc in Chrome): memory stays flat, it does not climb toward the file size.
- [ ] **A 20GB+ folder** — finishes; tab memory stays flat throughout, proving nothing
      is buffered.
- [ ] **Cancel at roughly 50%, then run again against the same destination** — the
      second run reports the finished files as "already on disk", re-downloads only what
      was missing, and produces no duplicates such as `file (2).ext`.
- [ ] **Kill wifi mid-download, then restore it** — the partial file is deleted, the
      file is retried, and it ends up complete. The debug log shows `attempt 1 failed`.
- [ ] **DevTools → Network → throttle to Slow 3G** — downloads continue; the rate
      readout drops but nothing fails outright.
- [ ] **Concurrency set to 1** — exactly one file in the in-flight list at a time.
- [ ] **Concurrency set to 10** — up to ten rows in the in-flight list.
- [ ] **Pause, wait, Resume** — byte counter stops and restarts; no file is corrupted.

## Errors

- [ ] **A file Google has quota-capped** — that file is skipped with "Google has
      temporarily capped downloads on this file…"; the rest of the run continues.
- [ ] **A bad API key** — the message explains the key was rejected and what to check
      (key correct, Drive API enabled, referrer allowed).
- [ ] **No API key at all** — on load, a calm line says the app is not configured yet
      and points at "Use your own API key". Scanning is refused before any request.
- [ ] **Rate limiting under concurrency 10 on a large folder** — the concurrency box
      drops on its own and the run continues. Visible in the debug log.

## Browser matrix

- [ ] **Chrome** — full path works end to end.
- [ ] **Edge** — full path works end to end.
- [ ] **Safari** — the gate message appears on load, the download button is disabled,
      and scanning still works. Nothing else breaks.
- [ ] **Firefox** — same as Safari.
- [ ] **Served from `https://` GitHub Pages** — works, including the folder picker.
- [ ] **Opened locally as `file://`** — works. `file://` counts as a secure context in
      Chrome, so the folder picker is available. Note that if the browser blocks site
      data on `file://`, the "Remember in this browser" checkbox has nothing to write to;
      the app handles that and carries on.

## Verification after a real run

- [ ] File count on disk equals the scanned count minus skips and failures. On
      macOS/Linux: `find <dest> -type f | wc -l`.
- [ ] Spot-check three nested paths against Drive in the browser — same folders, same
      names, same nesting.
- [ ] Total bytes on disk matches the reported total. `du -sb <dest>` on Linux,
      `du -sh` on macOS.
- [ ] Run a small folder with **Verify checksums after writing** ticked — zero
      mismatches reported. (This re-reads every byte from disk, so it is slow on large
      folders. A mismatch deletes the file and reports it rather than keeping bad data.)

---

## Debugging

**Using `?debug=1`.** Append it to the URL and a log panel appears under the page. It
records every listing call, every retry with the reason and the wait time, every skip
decision, and every shortcut loop avoided. The same lines go to the browser console
prefixed with `[gwfd]`. Use `?dryrun=1` alongside it to walk the whole flow without
writing anything.

**Reading the failure report.** After a run, "Download report" saves a `.txt` listing
every file grouped into FAILED, SKIPPED and DONE, each failure with its reason. The
reasons are the real Google error translated into plain English — "no longer shared"
means a 404, "temporarily capped" means `downloadQuotaExceeded`.

**The three most likely causes of a silent failure:**

1. **The API key is restricted to the wrong referrer.** The key works on `localhost` but
   not on your Pages domain, or the other way round. Google returns a 403 mentioning the
   key. Fix the Websites restriction and wait a few minutes.
2. **The folder isn't actually public.** "Anyone with the link" has to be set on the
   folder itself, not just on files inside it. A folder shared with specific people
   returns 404 to an API key, which reads as "not found" rather than "no permission".
3. **The destination folder was denied or revoked.** If the browser prompt for write
   access is dismissed, or permission lapses after a long idle, writes stop. Re-pick the
   destination and run again; completed files are skipped.
