"""gravitunes_data command line: list / size / build / export."""
from __future__ import annotations

import argparse
import shutil
import sys

from . import svs
from .paths import data_root


def _mb(n): return f"{n / 1e6:,.1f} MB" if n < 1e9 else f"{n / 1e9:,.2f} GB"


def cmd_list(a):
    e = svs.entry(a.id)
    print(f"{e.svs_id}: {e.title}\n  {e.description}")
    for c in e.credits:
        print(f"  {c}")
    for m in e.media:
        if m.kind in ("Movie", "Frames") or m in e.colorbars:
            print(f"  [{m.kind}] {m.width}x{m.height}  {m.url}")


def cmd_size(a):
    e = svs.entry(a.id)
    free = shutil.disk_usage(data_root().parent if not data_root().exists() else data_root()).free
    for m in e.by_kind("Frames"):
        files = svs.frame_files(m.url)
        n = len(files)
        sample = [svs.head_size(f) for f in files[:: max(1, n // 3)][:3]]
        per = sum(s for s in sample if s) / max(1, sum(1 for s in sample if s))
        sel = len(files[::a.every])
        ram = sel * (m.width or 0) * (m.height or 0) * 3
        print(f"frames {m.width}x{m.height}: {n} files, ~{_mb(per)} each -> every={a.every}: {sel} frames = "
              f"{_mb(per * sel)} on disk, {_mb(ram)} as uint8 in RAM")
    for m in e.by_kind("Movie"):
        s = svs.head_size(m.url)
        print(f"movie {m.width}x{m.height}: {_mb(s or 0)}  {m.url}")
    print(f"free disk: {_mb(free)}.  Cheaper: --every N, or `build` (decodes from the MP4).")


def cmd_build(a):
    from .dataset import build
    sizes = [tuple(int(x) for x in s.split("x")) for s in a.size]
    build(a.id, sizes=sizes, fill_from_png=not a.no_png)


def cmd_export(a):
    from .dataset import export_web
    for s in a.size:
        b, j = export_web(a.id, tuple(int(x) for x in s.split("x")))
        print(f"wrote {b} ({_mb(b.stat().st_size)}) and {j}")


def main(argv=None):
    p = argparse.ArgumentParser(prog="gravitunes_data", description=__doc__)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("list", help="show what an SVS entry offers"); s.add_argument("id"); s.set_defaults(f=cmd_list)
    s = sp.add_parser("size", help="estimate download size (no download)"); s.add_argument("id")
    s.add_argument("--every", type=int, default=1); s.set_defaults(f=cmd_size)
    s = sp.add_parser("build", help="download MP4 (+ a few PNGs) and decode value grids")
    s.add_argument("id"); s.add_argument("--size", nargs="+", default=["512x256", "256x128"])
    s.add_argument("--no-png", action="store_true", help="don't fill hours missing from the MP4 with PNG frames")
    s.set_defaults(f=cmd_build)
    s = sp.add_parser("export", help="write browser grids (.bin + .json) to data/nasa-svs/<id>/web/")
    s.add_argument("id"); s.add_argument("--size", nargs="+", default=["256x128"]); s.set_defaults(f=cmd_export)
    a = p.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    sys.exit(main())
