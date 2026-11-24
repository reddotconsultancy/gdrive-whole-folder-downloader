# Changelog

Notable changes. Dates are UTC.

## Unreleased

### Added
- Fallback for browsers without the File System Access API: files save to the Downloads
  folder one at a time with the folder path in the filename, instead of the app
  refusing to run. Saves are paced, because browsers silently drop rapid back-to-back
  downloads.
- Content Security Policy restricting the page to the Drive API.
- Write permission is confirmed on the chosen directory before a run starts.
- A full disk stops the run with an explanation instead of failing every remaining file.
- Warning before closing the tab mid-download.

### Changed
- Entering your own API key is now the default path, with linked setup steps on the page.
- Repository reorganised: documentation under `docs/`, images under `assets/`.

## 0.1.0

First working version: recursive scan, review step, concurrent streaming downloads
straight to disk, resume, retries and the failure report.
