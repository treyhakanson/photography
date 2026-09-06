"""Serve the project locally and let gallery_admin.html save captions.json.

A page loaded over plain http:// cannot write to disk, so the Save button posts
its JSON here and this process writes the file. Everything else behaves like
`python -m http.server`, so this can replace it for previewing the gallery too.

    uv run serve_admin.py            # http://127.0.0.1:8731/gallery_admin.html

Binds to loopback only. This process writes to a file on your disk, so it is
deliberately not reachable from the network, and the only path it will ever
write is the --captions file named at startup.
"""

import argparse
import json
import os
import sys
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SAVE_PATH = "/api/captions"
MAX_BODY = 4 * 1024 * 1024


def validate(data) -> str:
    """Return an error message, or "" if this looks like a captions file."""
    if not isinstance(data, dict):
        return "expected a JSON object at the top level"
    for group, bucket in data.items():
        if not isinstance(bucket, dict):
            return f"{group!r} should map photo names to entries"
        for name, value in bucket.items():
            if isinstance(value, str):
                continue
            if not isinstance(value, dict):
                return f"{group}/{name} should be a string or an object"
            extra = set(value) - {"title", "caption", "favorite"}
            if extra:
                return f"{group}/{name} has unknown field(s): {sorted(extra)}"
    return ""


def write_atomically(path: Path, text: str) -> None:
    """Write via a temp file in the same directory, then rename over the target.

    A half-written captions.json would be worse than a failed save.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".captions-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class Handler(SimpleHTTPRequestHandler):
    captions: Path = Path("captions.json")

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802 - name fixed by BaseHTTPRequestHandler
        if self.path.rstrip("/") != SAVE_PATH:
            self._json(404, {"ok": False, "error": "unknown endpoint"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._json(400, {"ok": False, "error": "missing or oversized body"})
            return

        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._json(400, {"ok": False, "error": f"invalid JSON: {exc}"})
            return

        problem = validate(data)
        if problem:
            self._json(400, {"ok": False, "error": problem})
            return

        try:
            write_atomically(self.captions,
                             json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        except OSError as exc:
            self._json(500, {"ok": False, "error": f"could not write: {exc}"})
            return

        entries = sum(len(v) for v in data.values())
        print(f"saved {self.captions} ({entries} entries)")
        self._json(200, {"ok": True, "entries": entries,
                         "path": str(self.captions)})

    def end_headers(self) -> None:
        # The admin page must never be served from cache after a rebuild.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--captions", type=Path, default=Path("captions.json"))
    parser.add_argument("--port", type=int, default=8731)
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.is_dir():
        print(f"no such directory: {args.root}", file=sys.stderr)
        return 1

    Handler.captions = args.captions.resolve()
    handler = partial(Handler, directory=str(root))

    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError as exc:
        print(f"cannot bind 127.0.0.1:{args.port} ({exc}). "
              f"Another server may already be running there.", file=sys.stderr)
        return 1

    print(f"serving {root} at http://127.0.0.1:{args.port}/")
    print(f"saving to {Handler.captions}")
    print(f"open http://127.0.0.1:{args.port}/gallery_admin.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
