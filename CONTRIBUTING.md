# Contributing

## Ground rules

`index.html` stays one self-contained file: no build step, no package manager, no
frameworks, no CDN, no external scripts, stylesheets or fonts. If a change needs a build
step, it is the wrong change for this project.

Everything is client-side. The app talks to `https://www.googleapis.com/drive/v3` and
nowhere else. Never fetch `drive.google.com`; it sends no CORS headers and will always
fail from a browser.

## Running it

```bash
python3 -m http.server 8080
```

Any static server will do. `localhost` counts as a secure context, which the File System
Access API requires.

## Testing

There is no test runner, by design. [docs/testing.md](docs/testing.md) is a concrete
checklist covering link parsing, scanning edge cases, the download paths, every error
condition, and the browser matrix. Work through the parts your change touches and say
in the pull request what you ran.

The two built-in flags do most of the heavy lifting:

- `?debug=1` for a log panel and verbose console output.
- `?dryrun=1` to exercise the full flow, including real API calls and error handling,
  without writing anything.

## Style

Match what is there. Plain ES2017, no clever abstractions, comments that explain *why*
rather than restating the code. If something looks redundant, check the comment above it
first; several of the stranger-looking branches exist because of a specific Google
behaviour or browser limit that is documented in
[docs/architecture.md](docs/architecture.md).

## Reporting bugs

Include the browser, roughly what the folder contains, and the report from the Download
report button. Remove your API key from anything you paste.
