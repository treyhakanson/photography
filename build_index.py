"""Generate index.html: a landing page listing the galleries in galleries.json.

Each gallery registers itself when built (see build_gallery.py --registry), so
adding one is a matter of building it, not editing this page.
"""

import argparse
import html
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

import build_gallery as bg

CSS = """
:root {
  --bg: #111;
  --card: #1a1a1e;
  --line: #2a2a31;
  --ink: #ededf2;
  --muted: #8b8b96;
  --tile: #1a1a1e;  /* placeholder behind a cover that hasn't loaded */
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: clamp(1.5rem, 5vw, 4rem) clamp(1rem, 5vw, 4rem);
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.Masthead { max-width: 70rem; margin: 0 auto 2.5rem; }
.Masthead h1 {
  margin: 0 0 0.4rem;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  font-weight: 600;
  letter-spacing: -0.02em;
}
.Masthead p { margin: 0; color: var(--muted); font-size: 0.92rem; }

.Galleries {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: clamp(1rem, 2.5vw, 1.75rem);
  max-width: 70rem;
  margin: 0 auto;
  padding: 0;
  list-style: none;
}

.Gallery {
  display: block;
  overflow: hidden;
  color: inherit;
  text-decoration: none;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 2px;  /* matches .Image in the gallery view */
}
.Gallery:focus-visible { outline: 2px solid #7aa2f7; outline-offset: 3px; }

.Gallery-cover {
  display: block;
  width: 100%;
  /* height:auto is load-bearing. The width/height attributes on the <img>
     are presentational hints that map to CSS width/height; width:100% beats
     the width hint, but without this the height hint survives (a 2015px tall
     card) and, both axes being definite, aspect-ratio is ignored. */
  height: auto;
  aspect-ratio: 3 / 2;
  object-fit: cover;
  background: var(--tile);
  border-bottom: 1px solid var(--line);
}
.Gallery-body { padding: 0.95rem 1.1rem 1.15rem; }
.Gallery-title { margin: 0 0 0.3rem; font-size: 1.05rem; font-weight: 600; }
.Gallery-meta { margin: 0; color: var(--muted); font-size: 0.85rem; }
.Gallery-sections {
  margin: 0.55rem 0 0;
  color: #6e6e7a;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.Footer {
  max-width: 70rem;
  margin: 3rem auto 0;
  padding: 1.4rem 0 0.6rem;
  border-top: 1px solid var(--line);
  color: #6e6e7a;
  font-size: 0.78rem;
  line-height: 1.7;
}
.Footer-terms { display: block; color: #55555f; }

.Empty {
  max-width: 70rem;
  margin: 0 auto;
  padding: 2rem;
  color: var(--muted);
  background: var(--card);
  border: 1px dashed var(--line);
  border-radius: 2px;
}
"""


def card(href: str, meta: dict, out_dir: Path, root: Path) -> str:
    title = str(meta.get("title") or href)
    images = meta.get("images")
    sections = [s for s in meta.get("sections", []) if isinstance(s, str)]

    bits = []
    if isinstance(images, int):
        bits.append(f"{images} photo{'' if images == 1 else 's'}")
    if sections:
        bits.append(f"{len(sections)} section{'' if len(sections) == 1 else 's'}")
    if meta.get("updated"):
        bits.append(str(meta["updated"]))

    cover = ""
    if meta.get("cover"):
        # Registry paths are relative to the registry; rebase onto the index.
        src = quote(Path(os.path.relpath(root / meta["cover"], out_dir)).as_posix())
        dims = ""
        if meta.get("cover_width") and meta.get("cover_height"):
            dims = f' width="{meta["cover_width"]}" height="{meta["cover_height"]}"'
        cover = (f'    <img class="Gallery-cover" src="{src}" alt=""{dims}'
                 f' loading="lazy" decoding="async">\n')

    link = quote(Path(os.path.relpath(root / href, out_dir)).as_posix(), safe="/#?=&")
    listing = (f'    <p class="Gallery-sections">{html.escape(" · ".join(sections))}</p>\n'
               if sections else "")
    return (
        f'  <li>\n'
        f'   <a class="Gallery" href="{link}">\n'
        f'{cover}'
        f'    <div class="Gallery-body">\n'
        f'    <h2 class="Gallery-title">{html.escape(title)}</h2>\n'
        f'    <p class="Gallery-meta">{html.escape(" · ".join(bits))}</p>\n'
        f'{listing}'
        f'    </div>\n'
        f'   </a>\n'
        f'  </li>'
    )


def render(entries: list[tuple[str, dict]], title: str, out_dir: Path,
           root: Path, notice: str = "") -> str:
    if entries:
        total = sum(m.get("images", 0) for _, m in entries
                    if isinstance(m.get("images"), int))
        count = len(entries)
        blurb = (f"{count} galler{'y' if count == 1 else 'ies'}"
                 f"{f' · {total} photos' if total else ''}")
        body = ('<ul class="Galleries">\n'
                + "\n".join(card(h, m, out_dir, root) for h, m in entries)
                + "\n</ul>")
    else:
        blurb = "Nothing here yet"
        body = ('<div class="Empty">No galleries registered yet. '
                "Build one with <code>build_gallery.py</code> and it will "
                "appear here.</div>")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>{CSS}</style>
</head>
<body>
<header class="Masthead">
  <h1>{html.escape(title)}</h1>
  <p>{html.escape(blurb)}</p>
</header>
{body}
{notice}
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=Path("galleries.json"))
    parser.add_argument("--out", type=Path, default=Path("index.html"))
    parser.add_argument("--title", default="Galleries")
    bg.copyright_args(parser)
    args = parser.parse_args()

    entries: list[tuple[str, dict]] = []
    if args.registry.exists():
        try:
            data = json.loads(args.registry.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"{args.registry}: invalid JSON ({exc})", file=sys.stderr)
            return 1
        if not isinstance(data, dict):
            print(f"{args.registry}: expected an object at the top level",
                  file=sys.stderr)
            return 1
        entries = [(h, m) for h, m in data.items() if isinstance(m, dict)]
        # Newest first, then alphabetical, so the list is stable build to build.
        entries.sort(key=lambda e: (str(e[1].get("updated") or ""),
                                    str(e[1].get("title") or e[0])))
        entries.reverse()
    else:
        print(f"{args.registry} not found; writing an empty index",
              file=sys.stderr)

    out = args.out.resolve()
    out.write_text(
        render(entries, args.title, out.parent, args.registry.resolve().parent,
               bg.footer(args.copyright, args.year, args.terms)),
        encoding="utf-8",
    )
    print(f"wrote {args.out} ({len(entries)} galler"
          f"{'y' if len(entries) == 1 else 'ies'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
