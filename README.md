# gdrive-whole-folder-downloader

A small web app (hosted on GitHub Pages) where you paste a Google Drive
"anyone with the link" folder URL and download the whole folder in one go —
no manual clicking through subfolders, and no Google's 2 GB zip split.

> Status: early setup. Nothing is implemented yet beyond project scaffolding.

## Goals

- Paste a public ("anyone with the link") Drive folder link, get everything.
- Recursive: subfolders included, structure preserved.
- No 2 GB cap and no multi-part zip splits.
- Fail-safe: per-file retries, resumable where possible, a clear report of
  anything that could not be fetched.
- Fully static — runs on GitHub Pages, no server to pay for.

## License

MIT — see [LICENSE](LICENSE).

Third-party code and attributions (including [gdown](https://github.com/wkentaro/gdown),
also MIT) are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Support

This is a donation-funded project. Donation links will be added here.
