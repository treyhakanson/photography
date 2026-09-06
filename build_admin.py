"""Generate gallery_admin.html: a local editor for captions.json.

Edit each photo's title, caption and favorite flag, then hit Save to overwrite
captions.json in place. Saving posts to serve_admin.py, which does the writing --
a page cannot touch the disk on its own. Served any other way (plain http.server,
or a file:// URL) the button falls back to downloading the file instead, so the
edits are never trapped in the tab.

Either path writes the shape rules documented in the README: a photo with
nothing set serializes to "", a photo with only a caption to a bare string, and
anything else to an object carrying just the fields that are set.
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
  --panel: #1a1a1e;
  --line: #2a2a31;
  --ink: #ededf2;
  --muted: #8b8b96;
  --tile: #1a1a1e;
  --accent: #7aa2f7;
  --good: #5ec269;
  --bad: #e5736b;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}

.Bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.7rem 1rem;
  background: rgba(17, 17, 17, 0.96);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(6px);
}
.Save {
  padding: 0.45rem 0.9rem;
  font: inherit;
  font-weight: 600;
  color: #0b1220;
  background: var(--accent);
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.Save:hover { background: #93b6f9; }
.Save:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.Save[disabled] { opacity: 0.55; cursor: default; }
.Flash { font-size: 0.85rem; }
.Flash.is-good { color: var(--good); }
.Flash.is-bad { color: var(--bad); }
.Status { color: var(--muted); font-size: 0.85rem; }
.Status b { color: var(--ink); font-weight: 600; }
.Hint { margin-left: auto; color: #61616c; font-size: 0.78rem; }

main { padding: 1.25rem 1rem 4rem; }
.Group { margin: 0 0 2rem; }
.Group-name {
  margin: 0 0 0.6rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #9a9aa6;
}

.Row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) auto;
  gap: 0.9rem;
  align-items: start;
  padding: 0.75rem;
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 3px solid transparent;
  border-radius: 2px;
}
.Row + .Row { margin-top: 0.4rem; }
.Row.is-changed { border-left-color: var(--accent); }

.Row-thumb {
  display: block;
  width: 84px;
  height: 84px;
  object-fit: cover;
  background: var(--tile);
  border-radius: 2px;
}
.Row-name {
  margin: 0 0 0.4rem;
  color: var(--muted);
  font-size: 0.78rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.Row-name b { color: var(--ink); font-weight: 600; }

.Field { display: block; margin-bottom: 0.4rem; }
.Field:last-child { margin-bottom: 0; }
input[type="text"], textarea {
  display: block;
  width: 100%;
  padding: 0.4rem 0.55rem;
  color: var(--ink);
  font: inherit;
  background: #131317;
  border: 1px solid var(--line);
  border-radius: 2px;
}
textarea { min-height: 3.4rem; resize: vertical; line-height: 1.55; }
input[type="text"]:focus, textarea:focus {
  outline: none;
  border-color: #45455a;
}
input::placeholder, textarea::placeholder { color: #4e4e58; }

.Fav {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding-top: 0.15rem;
  color: var(--muted);
  font-size: 0.8rem;
  white-space: nowrap;
  cursor: pointer;
}
.Fav input { accent-color: var(--accent); width: 1rem; height: 1rem; cursor: pointer; }
.Fav.is-on { color: var(--ink); }
"""

JS = """
(function () {
  var SAVE_URL = '/api/captions';
  // The embedded copy is only a fallback for file://; over http the file on
  // disk wins, because it may have been edited since this page was generated.
  var original = JSON.parse(document.getElementById('captions-data').textContent);
  var stale = false;
  var rows = [].slice.call(document.querySelectorAll('.Row'));
  var status = document.getElementById('status');
  var flash = document.getElementById('flash');
  var hint = document.getElementById('hint');
  var button = document.getElementById('save');
  var saving = false;

  function read(row) {
    return {
      title: row.querySelector('.f-title').value.trim(),
      caption: row.querySelector('.f-caption').value.trim(),
      favorite: row.querySelector('.f-fav').checked
    };
  }

  // Same three forms the README documents, so a downloaded file round-trips
  // through the build unchanged: "" when empty, a bare string for a lone
  // caption, otherwise an object holding only what is set.
  function pack(v) {
    if (!v.title && !v.favorite) return v.caption;
    var o = {};
    if (v.title) o.title = v.title;
    if (v.caption) o.caption = v.caption;
    if (v.favorite) o.favorite = true;
    return o;
  }

  function normalize(value) {
    if (typeof value === 'string') return { title: '', caption: value, favorite: false };
    if (value && typeof value === 'object') {
      return {
        title: String(value.title || ''),
        caption: String(value.caption || ''),
        favorite: !!value.favorite
      };
    }
    return { title: '', caption: '', favorite: false };
  }

  // Canonical form, so a file written by hand doesn't look "different" purely
  // because it used the shorthand rather than the object form.
  function canon(data) {
    var out = {};
    Object.keys(data || {}).sort().forEach(function (g) {
      var bucket = data[g] || {};
      var o = {};
      Object.keys(bucket).sort().forEach(function (n) {
        o[n] = pack(normalize(bucket[n]));
      });
      out[g] = o;
    });
    return JSON.stringify(out);
  }

  function fill(data) {
    rows.forEach(function (row) {
      var v = normalize((data[row.dataset.type] || {})[row.dataset.name]);
      row.querySelector('.f-title').value = v.title;
      row.querySelector('.f-caption').value = v.caption;
      row.querySelector('.f-fav').checked = v.favorite;
    });
    original = data;
    refresh();
  }

  function dirty() {
    return rows.some(changed);
  }

  function changed(row) {
    var was = normalize((original[row.dataset.type] || {})[row.dataset.name]);
    var now = read(row);
    return was.title !== now.title || was.caption !== now.caption
      || was.favorite !== now.favorite;
  }

  // Sorted so a saved file diffs cleanly against the one on disk.
  function build() {
    var out = {};
    rows.slice().sort(function (a, b) {
      return a.dataset.type.localeCompare(b.dataset.type)
        || a.dataset.name.localeCompare(b.dataset.name);
    }).forEach(function (row) {
      (out[row.dataset.type] = out[row.dataset.type] || {})[row.dataset.name] =
        pack(read(row));
    });
    return out;
  }

  function refresh() {
    var edits = 0, favs = 0;
    rows.forEach(function (row) {
      var dirty = changed(row);
      row.classList.toggle('is-changed', dirty);
      if (dirty) edits++;
      var on = row.querySelector('.f-fav').checked;
      if (on) favs++;
      row.querySelector('.Fav').classList.toggle('is-on', on);
    });
    status.innerHTML = '<b>' + rows.length + '</b> photos · <b>' + favs
      + '</b> favorites · <b>' + edits + '</b> unsaved';
    button.textContent = saving ? 'Saving\u2026'
      : (edits ? 'Save (' + edits + ')' : 'Save');
    button.disabled = saving || edits === 0;
    return edits;
  }

  function say(msg, kind) {
    flash.textContent = msg;
    flash.className = 'Flash' + (kind ? ' is-' + kind : '');
  }

  // No server to save through: hand the file over as a download instead so the
  // edits aren't stranded in the tab.
  function fallback(text, why) {
    if (typeof URL === 'undefined' || !URL.createObjectURL) {
      say(why + ' \u2014 could not save or download', 'bad');
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'captions.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    say(why + ' \u2014 downloaded instead', 'bad');
    hint.textContent = 'Run serve_admin.py to save in place.';
  }

  // Saving succeeded: the file on disk now matches the form, so rebase the
  // baseline and the unsaved count falls back to zero.
  function commit(data) {
    original = JSON.parse(JSON.stringify(data));
    refresh();
  }

  document.addEventListener('input', function (e) {
    if (e.target.closest('.Row')) refresh();
  });
  document.addEventListener('change', function (e) {
    if (e.target.closest('.Row')) refresh();
  });

  button.addEventListener('click', function () {
    // The disabled attribute stops real clicks, but not a dispatched event --
    // guard here too so nothing can post an unchanged file.
    if (saving || refresh() === 0) return;
    var data = build();
    var text = JSON.stringify(data, null, 2) + '\\n';

    if (typeof fetch !== 'function' || location.protocol === 'file:') {
      fallback(text, 'No server');
      return;
    }

    // Re-read disk first: captions.json may have been edited elsewhere since
    // this page loaded, and Save is a whole-file overwrite.
    if (!stale && typeof fetch === 'function') {
      fetch(CAPTIONS_URL, { cache: 'no-store' }).then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (disk) {
        if (disk && canon(disk) !== canon(original)) {
          stale = true;
          say('captions.json changed on disk \u2014 Save again to overwrite it',
              'bad');
        } else {
          post(data, text);
        }
      }).catch(function () { post(data, text); });
      return;
    }
    post(data, text);
  });

  function post(data, text) {
    saving = true;
    say('');
    refresh();
    fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || !body.ok) {
          throw new Error(body.error || ('HTTP ' + res.status));
        }
        return body;
      });
    }).then(function (body) {
      saving = false;
      stale = false;
      commit(data);
      say('Saved ' + (body.entries || 0) + ' entries to captions.json', 'good');
    }).catch(function (err) {
      saving = false;
      refresh();
      fallback(text, String(err.message || err));
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (refresh() > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  // Load the file as it is on disk right now. This page is generated, so its
  // embedded copy goes stale the moment captions.json is edited by hand -- and
  // saving from a stale form would silently wipe those edits.
  function hydrate() {
    if (typeof fetch !== 'function' || location.protocol === 'file:') return;
    fetch(CAPTIONS_URL, { cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (data) {
      if (!data || typeof data !== 'object') return;
      if (dirty()) {                       // raced a fast typist; don't stomp
        stale = true;
        say('captions.json on disk differs \u2014 reload before saving', 'bad');
        return;
      }
      if (canon(data) !== canon(original)) fill(data);
    }).catch(function () {});
  }

  hydrate();

  // Exposed for tests and for grabbing the JSON from the console.
  window.buildCaptions = build;

  refresh();
}());
"""


def row(item: dict, data: dict) -> str:
    name = item["name"]
    kind = item["kind"]
    title = html.escape(str(data.get("title") or ""), quote=True)
    caption = html.escape(str(data.get("caption") or ""))
    checked = " checked" if data.get("favorite") else ""
    return (
        f'    <div class="Row" data-type="{html.escape(kind, quote=True)}"'
        f' data-name="{html.escape(name, quote=True)}">\n'
        f'      <img class="Row-thumb" src="{item["src"]}" alt="" loading="lazy"'
        f' decoding="async">\n'
        f'      <div>\n'
        f'        <p class="Row-name">{html.escape(kind)}/<b>{html.escape(name)}</b></p>\n'
        f'        <label class="Field">\n'
        f'          <input class="f-title" type="text" value="{title}"'
        f' placeholder="Title (defaults to &quot;{html.escape(name, quote=True)}&quot;)">\n'
        f'        </label>\n'
        f'        <label class="Field">\n'
        f'          <textarea class="f-caption" placeholder="Caption">{caption}</textarea>\n'
        f'        </label>\n'
        f'      </div>\n'
        f'      <label class="Fav">\n'
        f'        <input class="f-fav" type="checkbox"{checked}> Favorite\n'
        f'      </label>\n'
        f'    </div>'
    )


def render(groups: list[tuple[str, list[dict]]], captions: dict, title: str,
           captions_href: str, labels: dict) -> str:
    body = []
    for kind, items in groups:
        rows = "\n".join(
            row(i, bg.entry((captions.get(kind) or {}).get(i["name"])))
            for i in items
        )
        body.append(
            f'  <section class="Group">\n'
            f'    <h2 class="Group-name">{html.escape(labels.get(kind, kind))}'
            f'</h2>\n'
            f"{rows}\n"
            f"  </section>"
        )

    payload = json.dumps(captions, ensure_ascii=False).replace("<", "\\u003c")
    captions_url = json.dumps(captions_href)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>{CSS}</style>
</head>
<body>
<div class="Bar">
  <button class="Save" id="save" type="button">Save</button>
  <span class="Flash" id="flash"></span>
  <span class="Status" id="status"></span>
  <span class="Hint" id="hint">Edits live in this tab until saved.</span>
</div>
<main>
{chr(10).join(body)}
</main>
<script type="application/json" id="captions-data">{payload}</script>
<script>var CAPTIONS_URL = {captions_url};{JS}</script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media", type=Path, default=Path("media"))
    parser.add_argument("--out", type=Path, default=Path("gallery_admin.html"))
    parser.add_argument("--captions", type=Path, default=Path("captions.json"))
    parser.add_argument("--categories", type=Path, default=Path("categories.json"))
    parser.add_argument("--title", default="Caption editor")
    args = parser.parse_args()

    media_dir = args.media.resolve()
    if not media_dir.is_dir():
        print(f"no such directory: {args.media}", file=sys.stderr)
        return 1

    out = args.out.resolve()
    items = bg.collect(media_dir, out.parent, 12.0, 2, 5)
    if not items:
        print(f"no images found under {args.media}", file=sys.stderr)
        return 1

    captions = {}
    if args.captions.exists():
        try:
            loaded = json.loads(args.captions.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                captions = loaded
        except json.JSONDecodeError as exc:
            print(f"{args.captions}: invalid JSON ({exc})", file=sys.stderr)
            return 1
    else:
        print(f"{args.captions} not found; starting from blank entries",
              file=sys.stderr)

    groups = [
        (kind, [i for i in items if i["kind"] == kind])
        for kind in sorted({i["kind"] for i in items})
    ]
    href = quote(
        Path(os.path.relpath(args.captions.resolve(), out.parent)).as_posix()
    )
    labels = bg.load_labels(args.categories, [k for k, _ in groups])
    out.write_text(render(groups, captions, args.title, href, labels),
                   encoding="utf-8")
    print(f"wrote {args.out} ({len(items)} photos in {len(groups)} categories)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
