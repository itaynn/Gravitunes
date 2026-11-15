#!/usr/bin/env python3
"""Serve the repo for local development, with HTTP byte ranges.

    python3 app/tools/serve.py          # http://localhost:8000/app/
    python3 app/tools/serve.py 8080

Same as `python3 -m http.server`, plus `Range:` requests (206 Partial Content). Browsers need those to seek
inside a video: without them the storm picker's timeline can't jump, and the Sound lab can't step through
the movie to learn the static map.
"""
import os
import re
import sys
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self._range = None
        match = RANGE.match(self.headers.get("Range", "").strip())
        path = self.translate_path(self.path)
        if not match or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        first, last = match.groups()
        if first:
            start, end = int(first), min(int(last) if last else size - 1, size - 1)
        elif last:  # "bytes=-N": the last N bytes
            start, end = max(0, size - int(last)), size - 1
        else:
            return super().send_head()
        if start >= size or start > end:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        f = open(path, "rb")
        f.seek(start)
        self._range = end - start + 1
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(self._range))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        if getattr(self, "_range", None) is None:
            return super().copyfile(source, outputfile)
        left = self._range
        while left > 0:
            chunk = source.read(min(64 * 1024, left))
            if not chunk:
                break
            outputfile.write(chunk)
            left -= len(chunk)

    def end_headers(self):
        if getattr(self, "_range", None) is None:
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("", port), partial(RangeHandler, directory=str(ROOT)))
    print(f"Serving {ROOT} at http://localhost:{port}/app/ (with byte ranges)")
    try:
        server.serve_forever()
    except (KeyboardInterrupt, BrokenPipeError):
        pass


if __name__ == "__main__":
    main()
