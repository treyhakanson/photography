# Photo galleries

Static photo galleries generated from folders of images. Two Python scripts read
a `media/` tree and emit plain HTML — no build step at serve time, no framework,
no runtime dependencies. The output is a directory of static files you can host
anywhere.

```
uv run build_gallery.py      # media/ -> gallery.html  (+ registers itself)
uv run build_index.py        # galleries.json -> index.html
uv run build_admin.py        # media/ + config.json -> gallery_admin.html
uv run serve_admin.py        # local server: preview + save from the editor
```

---

## Setup

The project uses [uv](https://docs.astral.sh/uv/). Python 3.12+, one dependency
(Pillow, for reading image dimensions).

```sh
uv sync                      # create .venv and install from uv.lock
uv run build_gallery.py      # uv resolves the env automatically
```

There is no separate activate step — `uv run` handles it. To add a dependency,
`uv add <package>`; commit the updated `uv.lock`.

---

## Files

| Path | Tracked | What it is |
| --- | --- | --- |
| `media/` | yes | Source photos. **One folder per category** — the folder name becomes the section. |
| `config.json` | yes | Section order and labels, plus every photo's title, caption and favorite flag. Hand-edited. |
| `galleries.json` | yes | Registry of built galleries. Written by `build_gallery.py`, read by `build_index.py`. |
| `build_gallery.py` | yes | Generates one gallery page. |
| `build_index.py` | yes | Generates the landing page listing galleries. |
| `build_admin.py` | yes | Generates the local caption editor. |
| `serve_admin.py` | yes | Local server. Serves the pages and writes `config.json` for the editor. |
| `gallery.html` | generated | The gallery. Self-contained: CSS and JS are inlined. |
| `index.html` | generated | Landing page with a card per gallery. |
| `gallery_admin.html` | generated | Local caption editor. Not meant to be published. |

Both HTML files are **generated output** — edit the scripts, not the HTML. They
are committed anyway, because static hosts (GitHub Pages) serve them directly.

Images are referenced from `media/` by relative path; they are not copied or
rewritten. Whatever is in `media/` is what gets served.

### Adding photos

Drop them in a folder under `media/` and rebuild. A new folder becomes a new
section; new files get blank caption slots added automatically.

```sh
uv run build_gallery.py && uv run build_index.py
```

---

## `config.json`

One file holds everything the build reads that isn't an image: what order the
sections go in, what they are called, and what each photo says.

```jsonc
{
  "sections": [ /* order and labels */ ],
  "captions":  { /* category -> photo name -> entry */ }
}
```

Both keys are created if missing. Anything else in the file is left alone and
carried through edits, so you can park your own notes in it.

### `sections`

**Array position is section order.** Move an entry to move the section,
`favorites` included — it is a section like any other.

```jsonc
"sections": [
  "favorites",                               // shorthand: label is the titleized id
  { "id": "arch",  "label": "Architecture" }, // when the folder name isn't the label
  { "id": "glass", "label": "Stained Glass" },
  { "id": "kirk",  "label": "Kirkyard" }
]
```

`id` is the folder name under `media/`. A bare string is shorthand for
`{"id": "<string>"}`, whose label becomes the title-cased folder name — so
`"nature"` displays as *Nature* and only categories whose label differs need the
object form.

The **folder name stays the identity** — it keys `captions` and the
`Image--<folder>` classes — so renaming a label never touches your caption data.
Labels appear in the gallery's section headers, on the back of each card, in the
editor's group headings, and on the index card.

A category with no entry here is **appended at the end** on the next build, with
a title-cased default label, ready for you to move. Removing an entry therefore
sends that section to the bottom rather than hiding it.

### `captions`

Shape is `category -> photo name -> entry`. The category is the folder name; the
photo name is the filename without extension.

Every field is optional, so an entry can be written three ways:

```jsonc
"captions": {
  "arch": {
    "bank": "",                          // nothing set yet (the default stub)
    "nook": "A window in a shell grotto", // shorthand: a bare string is the caption
    "power": {                            // full form — any subset of the three
      "title": "Battersea",
      "caption": "Shot from the south bank.",
      "favorite": true
    }
  }
}
```

| Field | Type | Default | Effect |
| --- | --- | --- | --- |
| `title` | string | `""` | Heading on the back of the card. Falls back to the photo name. Also used as the image `alt`. |
| `caption` | string | `""` | Body text on the back of the card. Blank shows a muted hint. |
| `favorite` | bool | `false` | Also shows the photo in a **favorites** section at the top of the page. |

Rules the build follows:

- **New photos get a `""` stub** added automatically, so the file stays a
  complete index of your library.
- **Existing entries are never rewritten.** The file is only touched when new
  stubs or sections need adding, and your chosen form is preserved —
  `{"favorite": true}` will not be expanded with empty `title`/`caption` keys,
  and the `sections` array is never resorted.
- **Deleting a photo leaves its entry behind.** Harmless, but prune by hand if
  you like.

Newlines in a caption are preserved (`white-space: pre-wrap`).

### Links in captions

Captions support one piece of markdown — inline links — and nothing else:

```jsonc
"dog": {
  "caption": "Commissioned by the [Order of St John](https://en.wikipedia.org/wiki/Knights_Hospitaller)."
}
```

Each becomes an `<a target="_blank" rel="noopener noreferrer">`. `http(s)`,
`mailto:`, and relative or `#anchor` links are allowed; any other scheme
(`javascript:`, `data:`) is refused and left visible as plain text. Malformed
syntax is left alone rather than guessed at.

Everything else in a caption stays literal text — the nodes are built with the
DOM rather than by assigning HTML, so a caption containing `<b>` or `<script>`
renders those characters instead of markup. Titles do not parse markdown; they
are plain text.

### Editing in a browser

`gallery_admin.html` is a local editor for the captions — a thumbnail per photo
with fields for title, caption and favorite, and a **Save** button at the top
left that overwrites `config.json` in place. Groups appear in section order.

The editor only edits captions. Save is a whole-file write, so `sections` and
anything else in the file is carried through from the copy it last read off
disk — reordering sections is a hand edit, not something the editor does.

```sh
uv run build_admin.py        # rebuild the editor after adding photos
uv run serve_admin.py        # then open the printed URL
```

A page cannot write to disk on its own, so Save posts to `serve_admin.py`, which
does the writing. **The editor must be opened through that server** — it also
serves the gallery, so it can replace `python -m http.server` entirely.

Opened any other way (plain `http.server`, or a `file://` URL) Save falls back to
downloading `config.json`, so edits are never stranded in the tab. The same
happens if the write is rejected; the error is shown in the bar.

Written output uses the three forms described above, with categories and names
sorted, so it diffs cleanly against what is on disk.

The page reads `config.json` from disk on load, so it reflects hand-edits made
since it was generated — you do not need to re-run `build_admin.py` after editing
the JSON, only after adding photos. Because Save rewrites the whole file, it
re-checks disk first: if the file changed underneath you (say you edited it in an
editor meanwhile), the first Save is refused with a warning and a second click
overwrites deliberately.

Edits live in the form until saved — nothing is persisted on reload. Changed rows
are marked, the button carries an unsaved count, and closing the tab with unsaved
work prompts first.

Neither the editor nor the server is meant to be published; both are local tools.

**About the write endpoint.** `serve_admin.py` binds to `127.0.0.1` only, so it is
not reachable from your network, and the only path it will ever write is the
`--config` file named at startup. Payloads are validated before anything touches
disk, and the write is atomic (temp file plus rename), so a rejected or
interrupted save cannot leave a half-written `config.json`.

### Live editing

When the page is served over `http(s)`, it re-fetches `config.json` at load, so
editing captions or labels and refreshing is enough — no rebuild. Section
*order* is baked into the markup, so reordering does need a rebuild. Opened as a
`file://` URL the browser blocks that fetch and the build-time copy is used, so
there you need to rebuild for any change.

> **Note:** macOS Finder comments are *not* a caption source. They live in an
> extended attribute, not in the image file, and are stripped by git, copies,
> and uploads. Put text in `config.json`.

---

## `galleries.json`

Written by `build_gallery.py` on each build, keyed by the output href so
rebuilds update in place. `build_index.py` renders one card per entry.

```jsonc
{
  "gallery.html": {
    "title": "Edinburgh & London 2026",
    "images": 54,
    "sections": ["Architecture", "Stained Glass", "Things", "Nature", "Cones",
                 "Kirkyard"],   // display labels, in config.json order
    "updated": "2026-09-07",
    "cover": "media/arch/bank.jpg",
    "cover_width": 1756,
    "cover_height": 1756
  }
}
```

Paths are relative to `galleries.json` itself; the index rebases them onto
wherever it is written. The cover is the first favorited photo, or the first
photo if none are flagged.

### A second gallery

Point the scripts at another folder and give it its own output and captions. It
registers itself, and the index picks it up:

```sh
uv run build_gallery.py --media media2 --out iceland.html \
    --config iceland-config.json --title "Iceland 2027"
uv run build_index.py
```

---

## Command reference

### `build_gallery.py`

| Flag | Default | Purpose |
| --- | --- | --- |
| `--media` | `media` | Source folder, scanned recursively. |
| `--out` | `gallery.html` | Output page. |
| `--title` | `Edinburgh & London 2026` | `<h1>` and `<title>`. |
| `--config` | `config.json` | Section order and labels, plus captions. |
| `--registry` | `galleries.json` | Registry to record this gallery in. |
| `--no-registry` | off | Build without registering (keeps it off the index). |
| `--index` | `index.html` | Target of the back link. |
| `--no-index-link` | off | Omit the back link. |
| `--area` | `12` | Target grid cells per photo. Lower = smaller tiles. |
| `--min-span` / `--max-span` | `2` / `5` | Clamp on how many columns/rows a photo may span. |
| `--iters` | `6000` | Packing search budget (see below). |
| `--seed` | `11` | Makes the packing search deterministic. |
| `--copyright` | `Trey Hakanson` | Rights holder in the footer; `""` omits the footer. |
| `--year` | current year | Year of publication in the notice. |
| `--terms` | usage line | Text under the notice; `""` omits it. |

Recognised extensions: `.jpg .jpeg .png .gif .webp .avif .bmp .tif .tiff`.
Unreadable files are skipped with a warning rather than failing the build.

### `build_index.py`

| Flag | Default | Purpose |
| --- | --- | --- |
| `--registry` | `galleries.json` | Registry to read. |
| `--out` | `index.html` | Output page. |
| `--title` | `Galleries` | Heading and `<title>`. |
| `--copyright` / `--year` / `--terms` | as above | Same footer as the gallery. |

### `build_admin.py`

| Flag | Default | Purpose |
| --- | --- | --- |
| `--media` | `media` | Source folder to list. |
| `--config` | `config.json` | File to load current values from. |
| `--out` | `gallery_admin.html` | Output page. |
| `--title` | `Caption editor` | Heading and `<title>`. |

### `serve_admin.py`

| Flag | Default | Purpose |
| --- | --- | --- |
| `--root` | `.` | Directory to serve. |
| `--config` | `config.json` | The only file Save is allowed to write. |
| `--port` | `8731` | Port on `127.0.0.1`. |

A missing or empty registry produces a valid page with an empty-state panel;
malformed JSON exits non-zero without writing.

---

## How the layout works

Useful when tuning, or when the build output looks surprising.

**Spans come from aspect ratio, normalized on area.** Each photo targets ~12
grid cells: `cols = round(sqrt(area * ratio))`, `rows = round(sqrt(area / ratio))`.
Normalizing on *area* rather than a fixed dimension keeps a 1:1 photo from
reading as much smaller than a 16:9 one. At the default area, a 4:3 photo lands
on exactly `span 4 / span 3`.

**Column counts are fixed per breakpoint** — 12 / 9 / 6, at ≥1080px, ≥720px, and
below. They are not `auto-fill`, because the packing below is optimized for a
known column count. Row height is derived from column width so cells stay square.
On the narrowest tier, 4- and 5-wide tiles are refitted to half- or full-row
widths, since at 6 columns they would always strand an unfillable gap.

**Document order is optimized for density.** CSS `grid-auto-flow: dense` can only
backfill a hole with a *later* item that fits, so the order of the HTML decides
how many holes you get. The build simulates the browser's placement algorithm and
searches for an order that packs tightly — exhaustively when a section is small
enough (≤8 photos), annealed above that. This is why photos are not in filename
order. `--seed` keeps it reproducible; `--iters` trades build time for density.

Each section packs independently, so density is lower than one big grid would
give — several sections means several ragged last rows. The build prints the fill
rate per section so you can see the cost.

**Favorites duplicate tiles.** A favorited photo appears both in the favorites
section and in its own category. The duplicates keep their original category, so
captions and the `Image--<category>` class still resolve correctly.

---

## The gallery page

- **Sections collapse.** Click a section heading to fold it away. These are
  native `<details>`/`<summary>` elements, so they need no JavaScript and work
  from the keyboard. All start expanded; the state is not remembered on reload.
- **Click a photo** to open it full-screen; **click again** to flip to the back
  and read its caption; **X**, **Escape**, or a click outside closes it.
- Opening and closing animate from and back to the tile (a FLIP transform, with
  the crop morphing from the tile's `cover` framing to the whole photo).
- Tiles are keyboard reachable — **Tab** to one, **Enter** to open.
- Respects `prefers-reduced-motion`: transitions are skipped, not degraded.
- Every tile paints a dark placeholder (`--tile`) at its final size before any
  image loads, so nothing reflows as photos arrive. Images are lazy-loaded.
- Photos carry an `Image--<category>` class if you want per-category styling.

---

## Copyright

Both public pages carry a footer:

```
© 2026 Trey Hakanson. All rights reserved.
Personal viewing only — no commercial use or redistribution without permission.
```

Copyright is automatic on creation — the notice does not create the right. It
does defeat an "innocent infringement" defence and deter casual reuse, which is
why it is worth having.

`--year` defaults to the build year. **Pin it with `--year 2026` if you want the
notice to stay at the year of publication** rather than drifting each rebuild.

Two things deliberately not done yet, both more effective than the notice:

- **Embed IPTC/XMP rights metadata in the JPEGs.** It travels with a downloaded
  file, and stripping it is a separate violation (17 U.S.C. § 1202).
- **Downsize the images.** A ~1800px JPEG is fine on screen and of little use for
  print, which is the practical limit on commercial reuse. Also the single
  biggest win for page weight.

## Publishing

The output is static; any host works. For GitHub Pages, commit `index.html`,
`gallery.html`, `media/`, and the two JSON files, and point Pages at the branch
root. `gallery_admin.html` is a local tool — there is no need to publish it.

Two things to know before the first commit:

1. **Resize first.** `media/` is currently ~139 MB of full-resolution originals,
   while the page never displays more than ~1500px. Re-encoding at a 1800px
   longest edge is roughly 21 MB with no visible difference. Git keeps every
   version of a binary forever, so committing the originals and re-encoding
   later means the repo carries both.
2. **Don't use Git LFS for this.** GitHub Pages does not resolve LFS objects —
   it serves the pointer file, so images render broken.

GitHub's limits are not a problem at this size: 100 MB per file (largest here is
~9 MB) and a 1 GB published site.

---

## Local preview

```sh
uv run serve_admin.py
```

Then open <http://127.0.0.1:8731/>. Plain `python -m http.server` works too for
viewing, but the editor's Save button needs `serve_admin.py`.

Use a server rather than opening the files directly — `file://` blocks both the
caption re-fetch and saving.
