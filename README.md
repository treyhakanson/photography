# Photography

A static photo gallery generated from a folder of images and a JSON file of
captions. TypeScript, React and Vite; no backend, no runtime dependencies
beyond React itself.

Deploys to GitHub Pages under `/photography`.

```sh
npm install
npm run dev      # http://localhost:5173/photography/
npm test         # 115 tests
npm run build    # -> dist/
```

---

## Layout of the repo

| Path | What it is |
| --- | --- |
| `raw_media/<gallery>/` | Full-resolution originals. **Gitignored** — only `npm run downsize` reads them. |
| `media/<gallery>/` | Web-sized photos derived from `raw_media/`, and committed. Inside each gallery, **one folder per category** — that folder name becomes the section. |
| `config/` | **One file per gallery.** Each holds that gallery's title, photo folders, section order, and captions. The filename is the gallery's slug. |
| `site.config.json` | Site-wide only: title, base path, copyright, and the layout and derive knobs. |
| `scripts/` | Build-time only: image dimensions, grid packing, manifest generation. |
| `plugins/` | Vite plugins: serving `media/`, the SPA 404 fallback, the dev write endpoint. |
| `src/` | The app. |
| `src/data/` | **Generated**: `manifest.json` and `spans.css`. Committed, but never hand-edited. |
| `deploy/` | A GitHub Pages workflow, inactive until you copy it into `.github/workflows/`. |
| `LICENSE` / `LICENSE-MEDIA` | MIT for the code, all-rights-reserved for the photos. See [Licensing](#licensing). |

Images are referenced from `media/` by relative path; they are not copied or
rewritten until a production build, which copies them into `dist/media/`.
`raw_media/` never reaches the site.

### Adding photos

Drop the originals in a category folder under `raw_media/uk-2026/`, then:

```sh
npm run downsize   # raw_media/ -> media/
npm run manifest   # or just `npm run dev`, which does it first
```

A new folder becomes a new section, appended to the end of that gallery's
`sections` array for you to move; new files get blank caption slots.

---

## `config/` — one file per gallery

Every `*.json` in this directory is a gallery, and **the filename is its slug**
— the URL segment, and the folder its photos are published under. Adding a
gallery means adding a file; nothing else registers it.

```
config/
  edinburgh-london-2026.json   ->  /photography/edinburgh-london-2026
  tokyo-kyoto-2025.json        ->  /photography/tokyo-kyoto-2025
```

```jsonc
{
  "title": "Tokyo & Kyoto 2025",
  "date": "2025-11",                 // optional; orders the index, newest first
  "raw": "./raw_media/uk-2026",      // optional; defaults to ./raw_media/<slug>
  "media": "./media/uk-2026",        // optional; defaults to ./media/<slug>
  "cover": "temple/Kamakura-Daibutsu",  // optional; the index card's photo
  "sections": [ /* order and labels */ ],
  "captions":  { /* category -> photo name -> entry */ }
}
```

| Field | Effect |
| --- | --- |
| `title` | Heading, and the name on the index card. Defaults to the slug. |
| `date` | Sorts the index, newest first. Undated galleries sort last, by slug. Not displayed. |
| `raw` / `media` | Where the photos live. Omit them when the folders are named after the slug. |
| `cover` | Which photo represents the gallery on the index, as `<category>/<name>` — the folder it is in, then its filename without the extension. Omit it and the first favorite is used, or the first photo if nothing is favorited. A value that matches no photo warns during the build and falls back the same way. |
| `sections` | Section order and labels — see below. |
| `captions` | Per-photo title, caption and favorite flag — see below. |

`sections` and `captions` are created if missing, and the build keeps them in
step with the photos: a new category folder is appended to `sections`, and a new
photo gets a blank caption slot. Nothing already written is rewritten, the
section order is never resorted, and the file is only touched when something was
actually added. Anything else in the file is left alone and carried through
edits, so you can park your own notes in it.

### A gallery before its photos

A config file may exist before there are any photos for it. The build says so
and moves on, and the gallery stays off the index until there is something to
show:

```
Tokyo & Kyoto 2025: no photos under ./media/tokyo-kyoto-2025 yet -- skipping.
  add originals to ./raw_media/tokyo-kyoto-2025, then run `npm run downsize`.
```

### `sections`

**Array position is section order.** Move an entry to move the section,
`favorites` included — it is a section like any other.

```jsonc
"sections": [
  "favorites",                                // shorthand: label is the titleized id
  { "id": "arch",  "label": "Architecture" }, // when the folder name isn't the label
  { "id": "glass", "label": "Stained Glass" }
]
```

`id` is a category folder name under the gallery's media directory. A bare string is shorthand for
`{"id": "<string>"}`, whose label becomes the title-cased folder name — so
`"nature"` displays as *Nature*, and only categories whose label differs need
the object form.

The **folder name stays the identity** — it keys `captions` and the
`Image--<folder>` classes — so renaming a label never touches your caption
data. Labels appear in section headers, on the back of each card, in the
editor's group headings, and on the index card.

A category with no entry here is **appended at the end** on the next build with
a title-cased default. Removing an entry sends that section to the bottom
rather than hiding it.

### `captions`

Keyed by folder name, then by filename without extension. Every field is
optional, so an entry can be written three ways:

```jsonc
"captions": {
  "arch": {
    "bank": "",                           // nothing set yet (the default stub)
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

- **New photos get a `""` stub**, so the file stays a complete index of your library.
- **Existing entries are never rewritten.** Your chosen form is preserved —
  `{"favorite": true}` is not expanded with empty `title`/`caption` keys — and
  the `sections` array is never resorted.
- **Deleting a photo drops its entry, but only if it was blank.** An entry you
  had written something in is kept and reported instead — a photo may only have
  been renamed, and losing a caption over that would be worse than a stale key.

Newlines in a caption are preserved (`white-space: pre-wrap`).

### Links in captions

Captions support one piece of markdown — inline links — and nothing else:

```jsonc
"dog": { "caption": "Commissioned by the [Order of St John](https://example.org)." }
```

Each becomes an `<a target="_blank" rel="noopener noreferrer">`. `http(s)`,
`mailto:`, and relative or `#anchor` links are allowed; any other scheme
(`javascript:`, `data:`) is refused and left visible as plain text. Malformed
syntax is left alone rather than guessed at.

Everything else in a caption stays literal text — React escapes what it renders,
so a caption containing `<b>` or `<script>` shows those characters rather than
markup. Titles do not parse markdown.

> **Note:** macOS Finder comments are *not* a caption source. They live in an
> extended attribute, not in the image file, and are stripped by git, copies,
> and uploads. Put text in the gallery's config file.

---

## `site.config.json`

```jsonc
{
  "siteTitle": "Galleries",
  "base": "/photography/",          // must match the repo name on Pages
  "copyright": { "holder": "...", "year": 2026, "terms": "..." },
  "configDir": "./config",          // every *.json in here is a gallery
  "layout": { "area": 12, "minSpan": 2, "maxSpan": 5, "iters": 6000, "seed": 11 },
  "derive": { "maxEdge": 2560, "quality": 82 }
}
```

| Field | Effect |
| --- | --- |
| `base` | Vite's base and the router's basename. Trailing slash required. |
| `configDir` | Where the per-gallery files live. Scanned on every build. |
| `layout.area` | Target grid cells per photo. Lower means smaller tiles. |
| `layout.minSpan` / `maxSpan` | Clamp on how many columns/rows a photo may span. |
| `layout.iters` | Packing search budget for sections too large to search exactly. |
| `layout.seed` | Makes that search deterministic. |
| `derive.maxEdge` | Cap on a derived photo's longest edge. Photos already smaller are re-encoded but not scaled. |
| `derive.quality` | JPEG quality for derived photos. |

### Adding a gallery

1. Add `config/<slug>.json` with at least a `title`.
2. Put the originals in `raw_media/<slug>/`, one folder per category.
3. `npm run downsize && npm run manifest`.

It gets its own route, its own card on the index, and its own tab in the caption
editor. There is no list to update — the build scans `config/`.

Photos are served under `media/<slug>/`, derived from the slug rather than the
folder on disk, so `media/uk-2026/` is published as
`media/edinburgh-london-2026/`. Two galleries therefore can't collide even if
their source folders are named alike.

---

## The caption editor

`http://localhost:5173/photography/admin` — a thumbnail per photo with fields
for title, caption and favorite, and a Save button that overwrites that
gallery's config file in place. With more than one gallery, a picker in the bar
switches between them (or go straight to `/admin/<slug>`).

A browser cannot write to disk, so Save posts to the Vite dev server, which does
the writing (`plugins/index.ts`).

- Only captions are editable. Save is a whole-file overwrite, so `sections` and
  anything else in the file is carried through from the copy last read off disk
  — a section order you edited by hand is not undone by saving captions.
- The page reads the config file on load, so it reflects hand-edits made since
  the manifest was generated.
- Because Save rewrites the whole file, it re-checks disk first: if the file
  changed underneath you, the first Save is refused with a warning and a second
  click overwrites deliberately.
- If the write is rejected, the file is offered as a download instead, so edits
  are never stranded in the tab.
- **The route does not exist in a production build.** It needs an endpoint only
  the dev server has, so it is compiled out entirely.

---

## Downsizing

`raw_media/` holds the originals and is gitignored. `media/` is derived from it
and committed, because the Pages build has to have something to publish.

```sh
npm run downsize            # only what changed
npm run downsize -- --force # re-derive everything
```

Re-runs are incremental: a photo is rebuilt only when its original is newer than
the output, or when `derive.maxEdge` / `derive.quality` changed.

`media/` is a function of `raw_media/`, not a pile that only grows, so a derived
photo whose original has been renamed or deleted is pruned, and any category
folder left empty goes with it. Without that a rename would show up in the
gallery as two copies of the same photo. The one exception is an originals
folder with no images in it at all — far more likely a mistake than an
instruction to delete everything — which is reported and left alone.

### How the size was chosen

Photos are sized for the largest they can ever be drawn, which is the lightbox
cap in `src/styles/lightbox.css`:

```css
max-width: min(92vw, 1500px);
max-height: 84vh;
```

So the biggest CSS box a photo occupies is about **1500 x 1210**. The grid's
widest tile is smaller — a span-5 of 12 columns on a 2560px viewport is ~1060
CSS px — so the lightbox is the binding constraint. A **2560px** longest edge
covers the grid at 2x device pixels and the lightbox at ~1.7x.

Raising it further buys little here: the median original is only 2033px on its
longest edge, so most of the library cannot reach 2x at the 1500px cap whatever
the cap is. Only 10 of 54 photos are actually scaled down.

### Where the saving comes from

The originals are near-lossless — about **5.4 bits per pixel**, where a
well-tuned web JPEG is 0.5–1.5. So most of the reduction is re-encoding, not
resizing:

| | |
| --- | --- |
| `raw_media/` | 138.5 MB, 5.44 bits/px |
| `media/` | 28.5 MB, 1.59 bits/px |

Derived files are progressive mozjpeg at 4:4:4 chroma, which keeps fine detail
in stained glass and ironwork that 4:2:0 would smear.

### Metadata

Each derived photo is written from a raw pixel buffer, so **nothing is inherited
from the original** — including its embedded thumbnail, which would otherwise
add ~25 KB per file. EXIF orientation is baked into the pixels first, so stored
dimensions are always the right way up (the layout reads those dimensions).

Only two fields are written back, so a downloaded file still says who owns it:

```
Artist     Trey Hakanson
Copyright  (C) 2026 Trey Hakanson. Personal viewing only -- no commercial use…
```

GPS coordinates and everything else are dropped.

---

## How the layout works

Useful when tuning, or when the output looks surprising.

**Spans come from aspect ratio, normalized on area.** Each photo targets ~12
grid cells: `cols = round(sqrt(area * ratio))`, `rows = round(sqrt(area / ratio))`.
Normalizing on *area* rather than a fixed dimension keeps a 1:1 photo from
reading as much smaller than a 16:9 one. At the default area, a 4:3 photo lands
on exactly `span 4 / span 3`.

**Document order decides how tight the grid is.** CSS `grid-auto-flow: dense`
can only backfill a hole with a *later* item that fits, so the browser's
placement algorithm is simulated in `scripts/layout.ts` and the order is
searched — exhaustively for sections of 8 photos or fewer, annealed above that.
This is why the app ships a fixed order rather than sorting at runtime.

**Column counts are fixed per breakpoint** (12 / 9 / 6) rather than emerging
from `auto-fill`, so the order that was optimised is the order that renders. At
the narrowest tier every tile is refitted to a half row or a full one, because a
4- or 5-wide tile in a 6-column grid always strands an unfillable pocket.

Everything above happens at build time:

```
media/  +  config/*.json
        │
        ▼  npm run manifest
        ▼
src/data/manifest.json  +  src/data/spans.css
        │
        ▼  vite
      dist/
```

`npm run dev` and `npm run build` both regenerate the manifest first, so it
cannot drift from `config/`.

---

## Deploying to GitHub Pages

The site is built to be served at `treyhakanson.github.io/photography`.

The simplest arrangement is a repo **named `photography`** — GitHub serves
project pages at `<user>.github.io/<repo>`, which is exactly the target URL, and
`base` in `site.config.json` already matches.

1. Push this repo to GitHub as `photography`.
2. Repo settings → Pages → Source: **GitHub Actions**.
3. Push to `main`.

To serve from a subfolder of the `treyhakanson.github.io` repo instead, build
locally and copy `dist/` into that repo's `photography/` folder; `base` stays the
same either way.

### Two things that will bite

- **`media/` is committed, `raw_media/` is not.** The build copies `media/`
  into `dist/`, so it has to be in the repo — 28.5 MB, comfortably inside the
  1 GB Pages limit. The originals never leave your machine, which matters
  because a public repo grants every GitHub user the right to fork it and
  **git history is permanent**: committing full-resolution files even once
  leaves them forkable forever, whatever you do later.
- **Do not use Git LFS for the photos.** Pages serves LFS pointer files as plain
  text; every image would 404.

### Deep links

GitHub Pages has no rewrite rules, so a reload of
`/photography/edinburgh-london-2026` would 404. The build writes a `404.html`
that is a copy of `index.html`, which lets the router take over.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Regenerate the manifest, then serve with HMR. |
| `npm run build` | Manifest, typecheck, bundle to `dist/`, copy media, write `404.html`. |
| `npm run preview` | Serve `dist/` as it will be served in production. |
| `npm run manifest` | Regenerate `src/data/` only. |
| `npm run downsize` | Derive `media/` from `raw_media/`. Incremental; `-- --force` redoes everything. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Run the suite once. |
| `npm run test:watch` | Watch mode. |

Recognised image extensions: `.jpg .jpeg .png .gif .webp .avif .bmp .tif .tiff`.
Dimensions are read for JPEG, PNG, GIF, WebP and BMP; anything else is skipped
with a warning rather than failing the build.

`src/data/manifest.json` and `src/data/spans.css` are generated but **committed**,
so the tree always reflects a buildable state and diffs show when a caption or
the packing order actually changed.

---

## Tests

115 tests, no browser required (jsdom).

| File | Covers |
| --- | --- |
| `layout.test.ts` | Span maths, the dense-placement simulation, tie-breaking. |
| `markdown.test.tsx` | Caption links, scheme allowlist, injection resistance. |
| `gallery.test.tsx` | Section order and counts, favorites, the lightbox and its flight. |
| `index.test.tsx` | Gallery cards, counts, cover sizing, footer. |
| `admin.test.tsx` | Serialization forms, section preservation, staleness, fallbacks. |
| `validate.test.ts` | The dev write endpoint's input gate. |
| `galleries.test.ts` | Discovery, cover selection, and which orphaned captions are safe to drop. |
| `index-multi.test.tsx` | That the index renders one card per gallery, in manifest order. |
| `css-scope.test.tsx` | That no two pages share a class name. Every stylesheet is loaded on every route, so a shared name silently restyles the other page. |

---

## Licensing

The repository is deliberately split in two.

| Covers | Licence |
| --- | --- |
| **Code** — `src/`, `scripts/`, `plugins/`, stylesheets, config | [MIT](LICENSE) |
| **Photographs** — `media/`, `raw_media/`, and the copies in any build output | [All rights reserved](LICENSE-MEDIA) — personal viewing only; no commercial use, redistribution, derivative works, or ML training without permission |

Each file states its scope explicitly, because a lone root `LICENSE` is
conventionally read as covering the whole repository. Dropping a bare MIT file
in here would have handed away commercial rights to all 54 photographs.

Three separate layers assert the photo terms, because each reaches somewhere
the others don't:

- **The page footer**, rendered from `site.config.json`. It is not what creates
  the copyright — that is automatic — but it rebuts an "innocent infringement"
  defence and deters casual reuse.
- **EXIF `Copyright` and `Artist`**, written into every derived photo by
  `npm run downsize`. Unlike the footer, these travel with a downloaded file.
- **`LICENSE-MEDIA`**, which is what someone actually reads before reusing
  something.

One thing no licence can change: making the repository public grants every
GitHub user the right to fork it, per GitHub's Terms of Service. That is the
reason `media/` holds 2560px JPEGs and `raw_media/` is gitignored — a fork gets
web-sized images, never print-resolution originals.

*None of this is legal advice.*

---

## Provenance

The grid packing and the lightbox began as a Python generator that emitted a
single HTML file. The layout algorithm was ported rather than reinvented, and
verified against it: identical image dimensions for all 54 photos, identical
fill percentages in every section, and byte-identical photo order in the
sections small enough to search exhaustively.

`scripts/layout.ts` rounds halves to even rather than up. The published layout
was computed with that rule, so changing it would reshape tiles across the
gallery.
