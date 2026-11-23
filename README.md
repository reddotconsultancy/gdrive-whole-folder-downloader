# GDrive Whole Folder Downloader — Download a Whole Google Drive Folder at Once

Paste a link to a public Google Drive folder and download every file in it to your
disk in one run, with the folder structure intact.

## The problem

Google Drive's own "Download folder" button zips everything server-side and splits
anything large into multiple ~2GB zip files, with the split falling wherever Google
likes. The folder structure ends up spread across several archives, and putting it
back together is manual work. Large folders also tend to fail partway through, leaving
you with nothing.

This tool never zips. It writes each file straight to its correct place on your disk,
so what you get is the folder, not a pile of archives.

## Live demo

https://reddotconsultancy.github.io/gdrive-whole-folder-downloader/

## Screenshot

<!-- Replace with a real screenshot of the app after a scan. -->
![GDrive Whole Folder Downloader](docs/screenshot.png)

## Features

- Runs entirely in your browser. Files go straight from Google to your disk.
- Nothing is stored. No sign-in, no account, no link history, no analytics.
- The whole folder in one go, structure intact — no 2GB zips to piece together.
- Downloads several files at once, so it finishes faster.
- Stops halfway? Run it again and it picks up where it left off.

## How it works

1. **Paste a link.** The folder ID is pulled out of whatever form of Drive URL you have.
2. **Scan.** The Drive API is walked folder by folder, following subfolders and
   resolving shortcuts, until the whole tree is known.
3. **Review.** You see every file and folder, with counts and total size, and can
   untick anything you don't want. Nothing downloads until you say so.
4. **Download.** You pick a destination folder, and files stream into it — several at
   a time, each written directly to disk rather than held in memory.

## Setup

### 1. Create a Google API key

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown in the top bar → **New project** → name it → **Create**.
3. **APIs & Services** → **Library** → search for **Google Drive API** → **Enable**.
4. **APIs & Services** → **Credentials** → **Create credentials** → **API key**.
5. Click **Edit API key** on the key you just made and restrict it:
   - **API restrictions** → **Restrict key** → tick **Google Drive API** only.
   - **Application restrictions** → **Websites** → **Add** →
     `https://YOUR-USERNAME.github.io/*` (and your custom domain, if you have one).
6. **Save.** Restrictions can take a few minutes to take effect.

### 2. Paste the key into index.html (optional)

Visitors can paste their own key into the page, which is the default. Setting one here
just means they do not have to.

Near the top of the `<script>` block there is exactly one line to change:

```js
const API_KEY = "PASTE_YOUR_API_KEY_HERE";
```

That is the only edit the app needs.

### 3. Push and publish

```bash
git add -A && git commit -m "Add API key" && git push
```

The included workflow turns GitHub Pages on by itself and deploys on every push to
`main`. If the first run fails on permissions, go to **Settings** → **Actions** →
**General** → **Workflow permissions** and set **Read and write permissions**, then
re-run the job.

### Social preview image

`og-image.svg` is the source. Convert it to a 1200×630 PNG named `og-image.png` and
commit it next to `index.html` — the meta tags already point at that filename. Any SVG
to PNG converter will do.

## Limitations

- **Link-shared folders only.** An API key can only read files shared as "anyone with
  the link". Folders shared with specific people need OAuth, which this tool
  deliberately does not do.
- **Folder structure needs Chrome, Edge or Opera.** Writing into a folder you choose
  needs the File System Access API. Safari, Firefox and mobile browsers have not shipped
  it, so there the files are saved one at a time to the Downloads folder with the folder
  path folded into each filename. Everything still downloads; only the folders are lost.
- **Google Docs, Sheets and Slides are converted.** They have no original bytes to
  download, so they are exported to .docx, .xlsx and .pptx (or PDF, if you prefer).
  Exports have their own size cap and very large documents can fail; those are listed
  in the report rather than stopping the run.
- **Forms, Sites, Jamboards and My Maps cannot be downloaded at all.** Google offers no
  export for them. They are listed, not silently dropped.
- **Google caps downloads per file.** A file that a lot of people have downloaded
  recently returns a quota error for everyone, and no tool can work around it.

## FAQ

### Why does Google Drive split my folder into multiple 2GB zip files?

Google builds the zip on its own servers before sending it, and caps each archive at
roughly 2GB. Anything larger is split into several zips, with the boundary falling
wherever the cap is reached rather than on any sensible folder edge. This tool skips
zipping entirely and copies files one by one, so the limit never applies.

### How do I download a whole Google Drive folder at once?

Paste the folder's share link here, scan it, choose a destination folder, and every
file is written into it with its subfolder structure preserved. There is no zipping
step and no reassembly afterwards.

### Is it safe to put an API key in a public web page?

A browser API key is public by design — it identifies the project, it does not grant
access to anything private. It can only read files that are already shared publicly.
The thing to protect is your quota, which is why the setup steps restrict the key to
the Drive API and to your own domain. A key copied off your page will not work anywhere
else.

### Why do I need an API key at all?

Listing the contents of a folder requires an authenticated call to the Drive API. Google
does not expose a public, CORS-enabled endpoint that returns a folder listing without
one. The key is what makes the listing call possible; it is not a sign-in.

### Does this work on private Google Drive folders?

No. It reads folders shared as "anyone with the link" only. Anything narrower requires a
Google sign-in flow, which this tool does not implement — no OAuth means no account
access and nothing to leak.

### Why does it say download quota exceeded?

Google temporarily caps downloads on individual files that have been fetched a lot
recently. The cap is applied on Google's side, across all users and all tools, and
usually clears within a day. The run continues and the affected files are listed in the
report so you can retry them later.

### Does this work in Safari or Firefox?

Yes, with one difference. Saving into a folder you choose needs the File System Access
API, which only Chrome, Edge and Opera have shipped. In other browsers — including
Safari, Firefox and browsers on phones — every file still downloads, but it goes to your
Downloads folder one at a time with the folder path in the filename, like
`Holiday photos_Day 1_beach.jpg`. The page says which mode it is in before you start.
Two caveats in that mode: the browser asks once whether to allow multiple downloads, and
re-running starts over instead of resuming, because a page cannot see what is already in
your Downloads folder.

### How is this different from gdown?

[gdown](https://github.com/wkentaro/gdown) is a Python command-line tool: you install
Python, install the package, and run it in a terminal. This is a web page — nothing to
install, and it writes directly into a folder you pick. gdown also scrapes
`drive.google.com` download pages, which a browser cannot do because those pages send no
CORS headers; this tool uses the official Drive API instead.

## Support this project

If this saved you an afternoon of stitching zip files back together, you can buy me a
coffee.

<!-- OWNER: replace the URL below with your own Buy Me a Coffee page, then delete this comment. -->
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-donate-yellow)](https://www.buymeacoffee.com/REPLACE_ME)

## Testing

`TESTING.md` has the full check-by-check plan, including the `?debug=1` and `?dryrun=1`
flags built into the page.

## License

MIT — see [LICENSE](LICENSE).

---

GDrive Whole Folder Downloader is a free, open-source Google Drive folder downloader for
anyone who needs to download an entire Google Drive folder at once without Google's 2GB
zip splits. It runs as a static page, keeps your folder structure intact, resumes where
it left off, and never sends your files or your link anywhere except Google.
