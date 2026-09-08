"""Generate gallery.html: every image under media/, laid out on an aspect-aware grid.

Spans come from each image's aspect ratio, normalized on area so a 1:1 image
isn't dwarfed by a 16:9 one. Because CSS `grid-auto-flow: dense` can only
backfill a hole with a *later* item that fits, document order decides how many
holes the grid ends up with -- so the placement algorithm is simulated here and
the order is annealed to pack it tightly.
"""

import argparse
import html
import json
import math
import os
import random
import re
import sys
from collections import Counter
from datetime import date
from itertools import permutations
from pathlib import Path
from urllib.parse import quote, unquote

from PIL import Image

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp", ".tif", ".tiff"}

# (min viewport width, column count). The count is fixed per tier rather than
# emergent from auto-fill, so the order annealed below is the order that renders.
TIERS = [(1080, 12), (720, 9), (0, 6)]


LIGHTBOX_CSS = """
.Section + .Section { margin-top: 2rem; }
.Footer {
  max-width: 70rem;
  margin: 3rem 0 0;
  padding: 1.4rem 0.4rem 0.6rem;
  border-top: 1px solid #22222a;
  color: #6e6e7a;
  font-size: 0.78rem;
  line-height: 1.7;
}
.Footer-terms { display: block; color: #55555f; }

.Section-body { margin: 0; }
.Section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  padding: 0.15rem 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #9a9aa6;
  cursor: pointer;
  user-select: none;
  list-style: none;              /* Firefox default marker */
}
.Section-title::-webkit-details-marker { display: none; }
.Section-title:hover { color: #c8c8d2; }
.Section-title:focus-visible { outline: 2px solid #7aa2f7; outline-offset: 2px; }
.Section-title::before {
  content: "";
  flex: none;
  width: 0.36rem;
  height: 0.36rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);     /* collapsed: points right */
  transition: transform 0.18s ease;
}
.Section-body[open] > .Section-title::before {
  transform: rotate(45deg);      /* expanded: points down */
}
@media (prefers-reduced-motion: reduce) {
  .Section-title::before { transition: none; }
}
.Section-count {
  margin-left: 0.5rem;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: #61616c;
}

.Image { cursor: pointer; }
.Image:focus-visible { outline: 2px solid #7aa2f7; outline-offset: 2px; }
/* Reserve the gutter so locking scroll can't shift the grid mid-transition. */
html { scrollbar-gutter: stable; }
body.is-locked { overflow: hidden; }

.Lightbox {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(1rem, 4vw, 3rem);
}
.Lightbox[hidden] { display: none; }

/* Only this fades. The photo itself stays fully opaque the whole way, so it
   never dips toward the backdrop colour mid-flight. */
.Lightbox-veil {
  position: absolute;
  inset: 0;
  background: rgba(8, 8, 10, 0.95);
}

.Lightbox-close {
  position: absolute;
  top: 0.85rem;
  right: 0.95rem;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  opacity: 0.35;
  cursor: pointer;
  transition: opacity 0.2s, background 0.2s;
}
.Lightbox-close:hover,
.Lightbox-close:focus-visible { opacity: 0.95; background: rgba(255,255,255,0.1); }

/* Two nested transforms, kept apart: the wrapper flies between the tile and
   the centre (FLIP), the card owns the flip. It also holds the perspective,
   since that only applies to a direct child. */
.CardWrap {
  position: relative;
  z-index: 1;
  max-width: 100%;
  max-height: 100%;
  perspective: 1800px;
  will-change: transform;
}
/* Clip only while flying, so the crop morph works without the flip having to
   live inside an overflow container at rest. */
.CardWrap.is-flying { overflow: hidden; }
.Card {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  cursor: pointer;
  transform-style: preserve-3d;
  transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.3, 1);
}
.Card.is-flipped { transform: rotateY(180deg); }
/* While closing, un-flip at the closing speed so both land together. */
.Card.is-closing { transition-duration: 300ms; }

.Face { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.Face--front img {
  display: block;
  width: auto;
  height: auto;
  max-width: min(92vw, 1500px);
  max-height: 84vh;
  background: var(--tile);
  border-radius: 3px;
}
.Face--back {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: clamp(1.1rem, 4vw, 2.75rem);
  overflow: auto;
  transform: rotateY(180deg);
  background: #e7e7ea;
  border: 1px solid #cfcfd5;
  border-radius: 3px;
}
.Back-kind {
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #5f5f6b;
}
.Back-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: #1a1a1f;
}
.Back-text {
  margin: 0;
  max-width: 62ch;
  font-size: 0.98rem;
  line-height: 1.75;
  color: #303038;
  white-space: pre-wrap;
}
.Back-text.is-empty { color: #63636f; font-style: italic; }
.Back-text a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: #000;
  text-underline-offset: 2px;
}
.Back-text a:hover { text-decoration-thickness: 2px; }
.Back-text a:focus-visible { outline: 2px solid #000; outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .Card { transition: none; }
}
"""

LIGHTBOX_JS = """
(function () {
  var OPEN_MS = 340;
  var CLOSE_MS = 300;
  var REVEAL_MS = 120;  // longest we'll hold a blank overlay waiting on bytes
  var EASE = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

  // Section labels live in the same array that fixes section order, so they
  // are read back out of it rather than shipped as a second copy.
  function labelsOf(cfg) {
    var out = {};
    var list = (cfg && cfg.sections) || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (typeof s === 'string') out[s] = s;
      else if (s && s.id) out[s.id] = s.label || s.id;
    }
    return out;
  }

  var config = JSON.parse(document.getElementById('config-data').textContent);
  var captions = config.captions || {};
  var labels = labelsOf(config);
  var box = document.getElementById('lightbox');
  var wrap = box.querySelector('.CardWrap');
  var card = box.querySelector('.Card');
  var shot = box.querySelector('.Face--front img');
  var kind = box.querySelector('.Back-kind');
  var title = box.querySelector('.Back-title');
  var text = box.querySelector('.Back-text');
  var closer = box.querySelector('.Lightbox-close');
  var veil = box.querySelector('.Lightbox-veil');
  var grid = document.querySelector('.Gallery');
  var opener = null;
  var flight = null;   // drives settle(); kept after finishing so open() can cancel
  var extras = [];     // veil fade + crop morph, cancelled alongside

  // Served over http(s), re-read the file so edits show on reload without a
  // rebuild. From file:// the build-time copy above is all we get. Section
  // order is baked into the markup, so only labels and captions can change
  // this way; reordering still needs a rebuild.
  if (typeof fetch === 'function' &&
      (location.protocol === 'http:' || location.protocol === 'https:')) {
    fetch(CONFIG_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || typeof d !== 'object') return;
        config = d;
        captions = d.captions || {};
        labels = labelsOf(d);
      })
      .catch(function () {});
  }

  // Captions support exactly one piece of markdown: [text](url). Nodes are
  // built with the DOM rather than innerHTML, so caption text can never inject
  // markup -- the link text and the surrounding prose stay inert strings.
  var LINK = /\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)/g;
  var SCHEME = /^[a-z][a-z0-9+.\\-]*:/i;
  var SAFE = /^(https?|mailto):/i;

  function linkable(href) {
    // Relative and anchor links carry no scheme and are fine. Anything with a
    // scheme must be one we trust -- notably not javascript:.
    return !SCHEME.test(href) || SAFE.test(href);
  }

  function write(el, raw) {
    el.textContent = '';
    var at = 0;
    var m;
    LINK.lastIndex = 0;
    while ((m = LINK.exec(raw)) !== null) {
      if (!linkable(m[2])) continue;   // leave the source text as written
      if (m.index > at) {
        el.appendChild(document.createTextNode(raw.slice(at, m.index)));
      }
      var a = document.createElement('a');
      a.href = m[2];
      a.textContent = m[1];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      el.appendChild(a);
      at = m.index + m[0].length;
    }
    if (at < raw.length) el.appendChild(document.createTextNode(raw.slice(at)));
  }

  function still() {
    if (typeof wrap.animate !== 'function') return true;
    return !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Swapping src can paint one blank frame before the new bitmap is ready,
  // which reads as a flash. Wait for it to be decodable first -- but never
  // block on it: no decode support, or a failed decode, just proceeds.
  //
  // decode() waits on the download too, so a tile clicked before it has
  // finished loading would otherwise hold the overlay invisible for as long
  // as the transfer takes. Cap that wait: past it we open onto the --tile
  // placeholder, which is what the tile itself is still showing anyway.
  function paintable(cb) {
    if (shot.complete && shot.naturalWidth) { cb(); return; }
    if (typeof shot.decode === 'function') {
      var fired = false;
      var once = function () { if (!fired) { fired = true; cb(); } };
      shot.decode().then(once, once);
      setTimeout(once, REVEAL_MS);
      return;
    }
    cb();
  }

  function stop() {
    if (flight) { flight.cancel(); flight = null; }
    for (var i = 0; i < extras.length; i++) extras[i].cancel();
    extras = [];
  }

  // Describe the tile as a pair of transforms on the opened photo.
  //
  // The wrapper alone would stretch the photo, because the tile is a
  // cover-crop of it and the two aspect ratios differ. So the wrapper takes
  // the tile's box (non-uniform, and it clips), while the image counter-scales
  // to stay undistorted -- net a uniform scale k, overflowing the wrapper by
  // exactly the amount the tile crops. That is `object-fit: cover` at the
  // start morphing into the whole photo at the end.
  function onto(tile) {
    var a = tile.getBoundingClientRect();
    var b = shot.getBoundingClientRect();
    if (!a.width || !a.height || !b.width || !b.height) return null;
    var sx = a.width / b.width;
    var sy = a.height / b.height;
    var k = Math.max(sx, sy);
    var dx = (a.left + a.width / 2) - (b.left + b.width / 2);
    var dy = (a.top + a.height / 2) - (b.top + b.height / 2);
    return {
      box: { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + sx + ', ' + sy + ')' },
      img: { transform: 'scale(' + (k / sx) + ', ' + (k / sy) + ')' }
    };
  }

  // Mirrors the Python side: "" or a bare string is caption-only shorthand.
  function entryFor(t, n) {
    var v = (captions[t] || {})[n];
    if (typeof v === 'string') return { title: '', caption: v };
    return (v && typeof v === 'object') ? v : {};
  }

  function open(fig) {
    var img = fig.querySelector('img');
    var t = fig.dataset.type;
    var n = fig.dataset.name;
    var data = entryFor(t, n);
    var note = data.caption || '';

    stop();
    opener = fig;
    shot.src = img.currentSrc || img.src;
    shot.alt = img.alt;
    // Carry the intrinsic size over so the final rect is measurable before
    // this copy of the image has decoded.
    shot.width = img.naturalWidth || img.width;
    shot.height = img.naturalHeight || img.height;
    kind.textContent = labels[t] || t;
    title.textContent = data.title || n;
    write(text, note || 'No notes yet \u2014 add one under "' + t + '" \u2192 "'
      + n + '" in config.json');
    text.classList.toggle('is-empty', !note);

    card.classList.remove('is-flipped');
    card.classList.remove('is-closing');
    box.hidden = false;
    document.body.classList.add('is-locked');

    if (still()) { closer.focus(); return; }

    // Laid out (so rects are measurable) but not painted, so nothing shows
    // until the photo is ready to draw in its opening position.
    box.style.visibility = 'hidden';
    paintable(function () {
      box.style.visibility = '';
      closer.focus();
      var from = onto(fig);
      if (!from) return;
      fig.style.visibility = 'hidden';  // don't show tile and photo at once
      wrap.classList.add('is-flying');
      var timing = { duration: OPEN_MS, easing: EASE };
      extras = [
        veil.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: OPEN_MS, easing: 'ease-out' }),
        shot.animate([from.img, { transform: 'none' }], timing)
      ];
      flight = wrap.animate([from.box, { transform: 'none' }], timing);
      flight.onfinish = function () { wrap.classList.remove('is-flying'); };
    });
  }

  function settle() {
    // Keep the flight/fade handles: both fill forwards, so the next open()
    // must cancel them or the wrapper snaps back to the tile transform.
    box.hidden = true;
    box.style.visibility = '';
    document.body.classList.remove('is-locked');
    wrap.classList.remove('is-flying');
    card.classList.remove('is-flipped');
    card.classList.remove('is-closing');
    if (opener) {
      opener.style.visibility = '';
      opener.focus();
      opener = null;
    }
  }

  function close() {
    if (box.hidden) return;
    stop();
    var to = opener && !still() ? onto(opener) : null;
    if (!to) { settle(); return; }
    card.classList.add('is-closing');
    card.classList.remove('is-flipped');
    wrap.classList.add('is-flying');
    var timing = { duration: CLOSE_MS, easing: EASE, fill: 'forwards' };
    extras = [
      veil.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards' }),
      shot.animate([{ transform: 'none' }, to.img], timing)
    ];
    flight = wrap.animate([{ transform: 'none' }, to.box], timing);
    flight.onfinish = settle;
  }

  grid.addEventListener('click', function (e) {
    var fig = e.target.closest('.Image');
    if (fig) open(fig);
  });

  grid.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var fig = e.target.closest('.Image');
    if (fig) { e.preventDefault(); open(fig); }
  });

  card.addEventListener('click', function (e) {
    // A caption link is a click on the card too -- let it navigate without
    // also flipping the card out from under the reader.
    if (e.target.closest('a')) return;
    card.classList.toggle('is-flipped');
  });
  closer.addEventListener('click', function (e) { e.stopPropagation(); close(); });
  box.addEventListener('click', function (e) {
    if (e.target === box || e.target === veil) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !box.hidden) close();
  });
}());
"""


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    return slug or "misc"


def spans(ratio: float, area: float, lo: int, hi: int) -> tuple[int, int]:
    """Map an aspect ratio to (columns, rows) covering roughly `area` cells.

    Normalizing on area rather than on a fixed dimension keeps a 1:1 image from
    reading as much smaller than a 16:9 one. With the default area of 12, a 4:3
    image lands exactly on span 4 / span 3.
    """
    cols = min(hi, max(lo, round(math.sqrt(area * ratio))))
    rows = min(hi, max(lo, round(math.sqrt(area / ratio))))
    return cols, rows


def narrow(shape: tuple[int, int], ncols: int) -> tuple[int, int]:
    """Refit a shape for the narrowest tier so widths tile the row exactly.

    At 6 columns a 4- or 5-wide tile always strands a pocket too small for
    anything to fill, so every image is rounded to a half row or a full one.
    """
    c, r = shape
    target = 3 if c <= 4 else ncols
    return target, max(1, round(r * target / c))


def place(shapes: list[tuple[int, int]], ncols: int) -> tuple[int, int]:
    """Simulate `grid-auto-flow: dense` row-major placement.

    Returns (rows used, cells filled). Rows are column bitmasks, so testing a
    candidate slot is a handful of integer ANDs.
    """
    rows: list[int] = []
    filled = 0
    for c, r in shapes:
        c = min(c, ncols)
        block = (1 << c) - 1
        stops = ncols - c + 1
        row = 0
        while True:
            if len(rows) < row + r:
                rows.extend([0] * (row + r - len(rows)))
            # OR the spanned rows once, then test each column against that.
            merged = rows[row]
            for dr in range(1, r):
                merged |= rows[row + dr]
            col = 0
            while col < stops:
                mask = block << col
                if merged & mask == 0:
                    for dr in range(r):
                        rows[row + dr] |= mask
                    filled += c * r
                    break
                col += 1
            else:
                row += 1
                continue
            break
    return len(rows), filled


def fill_rate(shapes: list[tuple[int, int]], ncols: int) -> float:
    used, filled = place(shapes, ncols)
    return filled / (used * ncols) if used else 1.0


def score(order: list[dict], weights: list[tuple[int, float]]) -> float:
    total = 0.0
    for ncols, weight in weights:
        smallest = ncols == TIERS[-1][1]
        shapes = [
            narrow(i["shape"], ncols) if smallest else i["shape"] for i in order
        ]
        total += weight * fill_rate(shapes, ncols)
    return total / sum(w for _, w in weights)


def anneal(
    items: list[dict], weights: list[tuple[int, float]], iters: int, seed: int
) -> list[dict]:
    """Reorder images to minimize grid holes, weighted toward the widest tier."""
    rng = random.Random(seed)
    n = len(items)
    if n < 3 or iters <= 0:
        return items

    best = cur = items[:]
    bs = cs = score(cur, weights)
    for step in range(iters):
        temp = 0.010 * (1 - step / iters) + 0.0005
        cand = cur[:]
        i, j = rng.randrange(n), rng.randrange(n)
        if rng.random() < 0.5:
            cand[i], cand[j] = cand[j], cand[i]
        else:
            cand.insert(j, cand.pop(i))
        s = score(cand, weights)
        if s >= cs or rng.random() < math.exp((s - cs) / temp):
            cur, cs = cand, s
            if s > bs:
                best, bs = cand[:], s
    return best


# Sections are small, so an exact search is usually cheap; anneal only above this.
PERM_BUDGET = 50_000


def best_order(
    group: list[dict], weights: list[tuple[int, float]], iters: int, seed: int
) -> tuple[list[dict], str]:
    """Pack one section: exhaustively when the permutations are few, else annealed."""
    if len(group) < 3:
        return group, "exact"
    if math.factorial(len(group)) <= PERM_BUDGET:
        best = max(permutations(group), key=lambda p: score(list(p), weights))
        return list(best), "exact"
    return anneal(group, weights, iters, seed), "annealed"


def collect(media_dir: Path, out_dir: Path, area: float, lo: int, hi: int) -> list[dict]:
    items = []
    for path in sorted(media_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTS:
            continue
        try:
            with Image.open(path) as im:
                width, height = im.size
        except Exception as exc:  # unreadable or not actually an image
            print(f"skipping {path}: {exc}", file=sys.stderr)
            continue
        if not width or not height:
            print(f"skipping {path}: zero dimension", file=sys.stderr)
            continue

        parent = path.parent
        kind = slugify(parent.name if parent != media_dir else "media")
        items.append(
            {
                # relpath, not relative_to: --out may sit outside the media tree
                "src": quote(Path(os.path.relpath(path.resolve(), out_dir)).as_posix()),
                "name": path.stem,
                "alt": path.stem.replace("-", " ").replace("_", " "),
                "kind": kind,
                "width": width,
                "height": height,
                "shape": spans(width / height, area, lo, hi),
            }
        )
    items.sort(key=lambda i: (i["kind"], i["src"]))
    return items


FAVORITES = "favorites"

# The notice is not what creates the copyright -- that is automatic -- but it
# rebuts an "innocent infringement" defense and deters casual reuse.
TERMS = "Personal viewing only \u2014 no commercial use or redistribution without permission."


def footer(holder: str, year: int, terms: str) -> str:
    """Copyright notice for the bottom of a page. Empty holder omits it."""
    if not holder:
        return ""
    line = f"\u00a9 {year} {html.escape(holder)}. All rights reserved."
    extra = (f'\n  <span class="Footer-terms">{html.escape(terms)}</span>'
             if terms else "")
    return f'<footer class="Footer">\n  {line}{extra}\n</footer>'


def copyright_args(parser: argparse.ArgumentParser) -> None:
    """Shared between the gallery and the index page."""
    parser.add_argument("--copyright", default="Trey Hakanson",
                        help="rights holder; empty string omits the footer")
    parser.add_argument("--year", type=int, default=date.today().year,
                        help="year of publication shown in the notice")
    parser.add_argument("--terms", default=TERMS,
                        help="usage line under the notice; empty omits it")


def titleize(kind: str) -> str:
    return kind.replace("-", " ").replace("_", " ").title()


def sections_of(config: dict) -> list[tuple[str, str]]:
    """Read the "sections" array as ordered (folder, display name) pairs.

    Position in the array is what orders the page. An entry may be the bare
    folder name when the titleized folder is label enough, or an object when
    the two differ.
    """
    listed = config.get("sections")
    if not isinstance(listed, list):   # a bare string would iterate per-character
        return []

    out: list[tuple[str, str]] = []
    seen = set()
    for item in listed:
        if isinstance(item, str):
            kind, label = item, ""
        elif isinstance(item, dict):
            kind, label = str(item.get("id") or ""), str(item.get("label") or "")
        else:
            continue
        if not kind or kind in seen:
            continue
        seen.add(kind)
        out.append((kind, label or titleize(kind)))
    return out


def entry(value) -> dict:
    """Normalize one caption entry.

    Everything is optional, so an entry may be written three ways:
        "bank": ""                            -- nothing set yet
        "bank": "some caption"                -- shorthand for just a caption
        "bank": {"title": "...", "favorite": true, "caption": "..."}
    """
    if isinstance(value, str):
        return {"title": "", "caption": value, "favorite": False}
    if isinstance(value, dict):
        return {
            "title": str(value.get("title") or ""),
            "caption": str(value.get("caption") or ""),
            "favorite": bool(value.get("favorite", False)),
        }
    return {"title": "", "caption": "", "favorite": False}


def load_config(path: Path, items: list[dict], kinds: list[str]) -> dict:
    """Read config.json: section order and labels, plus per-photo captions.

    The file grows with the media tree -- a category missing from "sections" is
    appended and every new photo gets a blank caption slot -- but nothing
    already written is rewritten, so hand-chosen order, labels, and the
    shorthand entry forms all survive a rebuild.
    """
    data: dict = {}
    if path.exists():
        loaded = None
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"{path}: invalid JSON ({exc}); starting fresh", file=sys.stderr)
        if isinstance(loaded, dict):
            data = loaded
        elif loaded is not None:
            print(f"{path}: expected an object at the top level", file=sys.stderr)

    sections = data.get("sections")
    if not isinstance(sections, list):
        if sections is not None:
            print(f"{path}: 'sections' is not an array; replacing", file=sys.stderr)
        sections = []
    captions = data.get("captions")
    if not isinstance(captions, dict):
        if captions is not None:
            print(f"{path}: 'captions' is not an object; replacing", file=sys.stderr)
        captions = {}

    # Appended rather than sorted in: array position is the section order, so
    # an unlisted category lands at the end for the author to move.
    listed = {k for k, _ in sections_of({"sections": sections})}
    new_sections = 0
    for kind in [FAVORITES] + list(kinds):
        if kind not in listed:
            sections.append({"id": kind, "label": titleize(kind)})
            listed.add(kind)
            new_sections += 1

    new_slots = 0
    for item in items:
        bucket = captions.setdefault(item["kind"], {})
        if not isinstance(bucket, dict):
            print(f"{path}: captions.{item['kind']!r} is not an object; skipping",
                  file=sys.stderr)
            continue
        if item["name"] not in bucket:
            bucket[item["name"]] = ""
            new_slots += 1

    data["sections"] = sections
    data["captions"] = captions
    if new_sections or new_slots or not path.exists():
        # Only the captions are sorted; the section array carries its meaning
        # in its order.
        written = dict(data)
        written["captions"] = {k: dict(sorted(v.items()))
                               for k, v in sorted(captions.items())
                               if isinstance(v, dict)}
        path.write_text(json.dumps(written, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        print(f"{path}: added {new_sections} section(s), "
              f"{new_slots} blank caption slot(s)")
    return data


def register(path: Path, out: Path, title: str, items: list[dict],
             sections: list[str], cover: dict | None) -> None:
    """Record this gallery in the shared registry the index page reads.

    Keyed by href so rebuilding updates in place rather than duplicating, and
    any hand-edited fields on other entries are left alone.
    """
    data = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data = loaded
        except json.JSONDecodeError as exc:
            print(f"{path}: invalid JSON ({exc}); rewriting", file=sys.stderr)

    root = path.resolve().parent
    href = Path(os.path.relpath(out.resolve(), root)).as_posix()
    entry_data = {
        "title": title,
        "images": len(items),
        "sections": sections,
        "updated": date.today().isoformat(),
    }
    if cover is not None:
        src = (out.resolve().parent / unquote(cover["src"])).resolve()
        entry_data["cover"] = Path(os.path.relpath(src, root)).as_posix()
        entry_data["cover_width"] = cover["width"]
        entry_data["cover_height"] = cover["height"]

    data[href] = {**data.get(href, {}), **entry_data}
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    print(f"{path}: registered {href!r}")


def apply_captions(items: list[dict], captions: dict) -> None:
    """Fold each photo's title and favorite flag onto its item."""
    for item in items:
        bucket = captions.get(item["kind"])
        data = entry(bucket.get(item["name"]) if isinstance(bucket, dict) else None)
        item["title"] = data["title"]
        item["favorite"] = data["favorite"]


def render(groups: list[tuple[str, list[dict]]], title: str, config: dict,
           config_href: str, labels: dict, index_href: str = "",
           notice: str = "") -> str:
    items = [i for _, group in groups for i in group]
    shapes = sorted({i["shape"] for i in items})
    # Favorites repeat photos from other sections, so neither the tile count
    # nor the section count is what the reader should be told.
    photos = {(i["kind"], i["name"]) for i in items}
    categories = [label for label, _ in groups if label != FAVORITES]
    span_rules = "\n".join(
        f".s-{c}-{r} {{ grid-column-end: span {c}; grid-row-end: span {r}; }}"
        for c, r in shapes
    )
    narrow_rules = "\n".join(
        f"  .s-{c}-{r} {{ grid-column-end: span {nc}; grid-row-end: span {nr}; }}"
        for (c, r), (nc, nr) in ((s, narrow(s, TIERS[-1][1])) for s in shapes)
        if (c, r) != narrow((c, r), TIERS[-1][1])
    )

    tiers = []
    for i, (min_width, ncols) in enumerate(TIERS):
        body = (
            f"  :root {{ --n: {ncols}; }}\n"
            f"  .gridContainer {{ grid-template-columns: repeat({ncols}, 1fr); }}"
        )
        if i == len(TIERS) - 1 and narrow_rules:
            body += "\n" + narrow_rules
        upper = TIERS[i - 1][0] - 1 if i else None
        tiers.append(
            f"@media (max-width: {upper}px) {{\n{body}\n}}" if upper
            else body.replace("  ", "", 1).replace("\n  ", "\n")
        )

    def tile(i: dict) -> str:
        return (
            f'      <figure class="Image Image--{i["kind"]} '
            f's-{i["shape"][0]}-{i["shape"][1]}"'
            f' data-type="{i["kind"]}" data-name="{html.escape(i["name"], quote=True)}"'
            f' tabindex="0" role="button">\n'
            f'        <img src="{i["src"]}" alt="{html.escape(i["title"] or i["alt"])}"'
            f' width="{i["width"]}" height="{i["height"]}" loading="lazy"'
            f' decoding="async">\n'
            f"      </figure>"
        )

    sections = "\n".join(
        f'  <section class="Section Section--{kind}" aria-labelledby="sec-{kind}">\n'
        f'    <details class="Section-body" open>\n'
        f'    <summary class="Section-title" id="sec-{kind}">'
        f'{html.escape(labels.get(kind, kind))}'
        f'<span class="Section-count">{len(group)}</span></summary>\n'
        f'    <div class="gridContainer">\n'
        + "\n".join(tile(i) for i in group)
        + "\n    </div>\n    </details>\n  </section>"
        for kind, group in groups
    )
    counts = Counter(i["kind"] for i in items)
    back = (f'  <a class="Backlink" href="{index_href}">'
            f'<span aria-hidden="true">\u2190</span> Galleries</a>\n'
            if index_href else "")

    # "<" is escaped so the payload can never close its own <script> tag.
    config_json = json.dumps(config, ensure_ascii=False).replace("<", "\\u003c")
    config_url = json.dumps(config_href)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
:root {{
  --gap: 0.3rem;
  --pad: 0.3rem;
  --sb: 16px;  /* scrollbar allowance; only nudges row height, never packing */
  /* Placeholder behind every not-yet-loaded photo. Grid spans size the tiles
     independently of the images, so the full layout is drawn in this colour
     before a single byte of image data arrives. Kept near the page black so a
     half-loaded grid doesn't read as a checkerboard. */
  --tile: #1a1a1e;
  color-scheme: light dark;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0;
  padding: var(--pad);
  background: #111;
  color: #eee;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}}
header {{ padding: 0.75rem 0.4rem 1.25rem; }}
.Backlink {{
  display: inline-block;
  margin-bottom: 0.6rem;
  color: #8b8b96;
  font-size: 0.8rem;
  text-decoration: none;
  transition: color 0.15s;
}}
.Backlink:hover, .Backlink:focus-visible {{ color: #ededf2; }}
.Backlink span {{ margin-right: 0.15rem; }}
h1 {{ margin: 0 0 0.25rem; font-size: 1.1rem; font-weight: 600; letter-spacing: 0.01em; }}
header p {{ margin: 0; color: #8b8b8b; font-size: 0.8rem; }}

.gridContainer {{
  display: grid;
  /* Square cells: row height tracks the computed column width. */
  grid-auto-rows: calc(
    (100vw - var(--sb) - 2 * var(--pad) - (var(--n) - 1) * var(--gap)) / var(--n)
  );
  grid-auto-flow: dense;
  grid-gap: var(--gap);
}}

.Image {{ margin: 0; overflow: hidden; background: var(--tile); border-radius: 2px; }}
.Image img {{
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}}

{span_rules}

{chr(10).join(tiers)}
{LIGHTBOX_CSS}
</style>
</head>
<body>
<header>
{back}  <h1>{html.escape(title)}</h1>
  <p>{len(photos)} photos in {len(categories)} categories</p>
</header>
<main class="Gallery">
{sections}
</main>
{notice}

<div class="Lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Photo" hidden>
  <div class="Lightbox-veil"></div>
  <button class="Lightbox-close" type="button" aria-label="Close">
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path d="M2 2 L15 15 M15 2 L2 15" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round"/>
    </svg>
  </button>
  <div class="CardWrap">
    <div class="Card">
      <div class="Face Face--front"><img src="" alt=""></div>
      <div class="Face Face--back">
        <span class="Back-kind"></span>
        <h2 class="Back-title"></h2>
        <p class="Back-text"></p>
      </div>
    </div>
  </div>
</div>

<script type="application/json" id="config-data">{config_json}</script>
<script>var CONFIG_URL = {config_url};{LIGHTBOX_JS}</script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media", type=Path, default=Path("media"))
    parser.add_argument("--out", type=Path, default=Path("gallery.html"))
    parser.add_argument("--area", type=float, default=12.0, help="target cells per image")
    parser.add_argument("--min-span", type=int, default=2)
    parser.add_argument("--max-span", type=int, default=5)
    parser.add_argument("--iters", type=int, default=6000, help="packing search steps")
    parser.add_argument("--seed", type=int, default=11)
    parser.add_argument("--config", type=Path, default=Path("config.json"),
                        help="section order and labels, plus per-photo captions")
    parser.add_argument("--registry", type=Path, default=Path("galleries.json"),
                        help="shared list of galleries the index page renders")
    parser.add_argument("--no-registry", action="store_true")
    parser.add_argument("--index", type=Path, default=Path("index.html"),
                        help="landing page the back link points at")
    parser.add_argument("--no-index-link", action="store_true")
    parser.add_argument("--title", default="Edinburgh & London 2026")
    copyright_args(parser)
    args = parser.parse_args()

    media_dir = args.media.resolve()
    if not media_dir.is_dir():
        print(f"no such directory: {args.media}", file=sys.stderr)
        return 1

    out = args.out.resolve()
    items = collect(media_dir, out.parent, args.area, args.min_span, args.max_span)
    if not items:
        print(f"no images found under {args.media}", file=sys.stderr)
        return 1

    kinds = sorted({i["kind"] for i in items})
    config = load_config(args.config, items, kinds)
    captions = config["captions"]
    apply_captions(items, captions)

    order = sections_of(config)
    labels = dict(order)
    if FAVORITES in kinds:
        print(f"warning: a media folder named {FAVORITES!r} collides with the "
              f"favorites section", file=sys.stderr)

    weights = [(n, 3.0 if i == 0 else 1.0) for i, (_, n) in enumerate(TIERS)]

    # Section order is the "sections" array in config.json; anything missing
    # from it falls in after, alphabetically.
    rank = {k: i for i, (k, _) in enumerate(order)}
    picks = [i for i in items if i["favorite"]]
    buckets = {k: [i for i in items if i["kind"] == k] for k in kinds}
    if picks:
        buckets[FAVORITES] = picks
    sections = sorted(buckets.items(),
                      key=lambda kv: (rank.get(kv[0], len(rank)), kv[0]))

    # Each section is its own grid, so each packs independently.
    groups = []
    for label, group in sections:
        before = score(group, weights)
        group, how = best_order(group, weights, args.iters, args.seed)
        groups.append((label, group, before, score(group, weights), how))

    href = quote(
        Path(os.path.relpath(args.config.resolve(), out.parent)).as_posix()
    )
    index_href = ""
    if not args.no_index_link:
        index_href = quote(
            Path(os.path.relpath(args.index.resolve(), out.parent)).as_posix()
        )

    out.write_text(
        render([(k, g) for k, g, _, _, _ in groups], args.title, config, href,
               labels, index_href,
               footer(args.copyright, args.year, args.terms)),
        encoding="utf-8",
    )

    if not args.no_registry:
        # A favorite makes the best cover; otherwise just take the first photo.
        register(args.registry, out, args.title, items,
                 [labels.get(k, k)
                  for k in sorted(kinds, key=lambda k: (rank.get(k, len(rank)), k))],
                 picks[0] if picks else (items[0] if items else None))

    print(f"wrote {args.out} ({len(items)} images in {len(groups)} sections"
          f"{f', {len(picks)} favorited' if picks else ''})")
    wide = TIERS[0][1]
    print(f"section fill at {wide} cols (packed independently):")
    for kind, group, before, after, how in groups:
        rate = fill_rate([i["shape"] for i in group], wide)
        print(f"  {kind:<10} {len(group):>2} images  "
              f"{before * 100:5.1f}% -> {after * 100:5.1f}%  "
              f"(wide: {rate * 100:5.1f}%, {how})")
    overall = sum(a for _, _, _, a, _ in groups) / len(groups)
    print(f"  {'mean':<10} {len(items):>2} images  "
          f"{sum(b for _, _, b, _, _ in groups) / len(groups) * 100:5.1f}% -> "
          f"{overall * 100:5.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
