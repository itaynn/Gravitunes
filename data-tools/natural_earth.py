#!/usr/bin/env python3
"""Convert Natural Earth (public domain) line shapefiles to compact JSON for the map basemap.

Usage:
  python3 -I data-tools/natural_earth.py <ne_coastline.zip> <ne_admin_0_boundary_lines_land.zip> [--tol 0.1] [--out data/earth]

Download the zips from https://naciscdn.org/naturalearth/{110m,50m}/... (keep them outside the repo).
Output: data/earth/coastlines.json and data/earth/borders.json, each
  {"source": ..., "lines": [[lon0, lat0, lon1, lat1, ...], ...]}  (degrees, 2 decimals, simplified).
Stdlib only: reads the .shp (PolyLine) directly from the zip.
"""
import argparse, json, struct, zipfile
from pathlib import Path


def read_polylines(zpath):
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.endswith('.shp'))
        b = z.read(name)
    lines, off = [], 100
    while off + 8 <= len(b):
        _, clen = struct.unpack('>ii', b[off:off + 8])
        rec = b[off + 8: off + 8 + clen * 2]
        off += 8 + clen * 2
        stype = struct.unpack('<i', rec[:4])[0]
        if stype not in (3, 13, 23):
            continue
        nparts, npts = struct.unpack('<ii', rec[36:44])
        parts = list(struct.unpack(f'<{nparts}i', rec[44:44 + 4 * nparts])) + [npts]
        p0 = 44 + 4 * nparts
        pts = struct.unpack(f'<{2 * npts}d', rec[p0:p0 + 16 * npts])
        for i in range(nparts):
            lines.append([(pts[2 * k], pts[2 * k + 1]) for k in range(parts[i], parts[i + 1])])
    return lines


def simplify(pts, tol):
    """Douglas-Peucker in degrees."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, c = stack.pop()
        (ax, ay), (cx, cy) = pts[a], pts[c]
        dx, dy = cx - ax, cy - ay
        L = (dx * dx + dy * dy) ** 0.5
        best, bi = -1.0, -1
        for i in range(a + 1, c):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L if L else ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, c)]
    return [p for p, k in zip(pts, keep) if k]


def convert(zpath, tol, source):
    out = []
    for line in read_polylines(zpath):
        s = simplify(line, tol)
        flat, prev = [], None
        for x, y in s:
            q = (round(x, 2), round(y, 2))
            if q != prev:
                flat += [q[0], q[1]]; prev = q
        if len(flat) >= 4:
            out.append(flat)
    return {'source': source, 'license': 'public domain', 'lines': out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('coastline_zip'); ap.add_argument('borders_zip')
    ap.add_argument('--tol', type=float, default=0.1)
    ap.add_argument('--out', default=str(Path(__file__).resolve().parent.parent / 'data' / 'earth'))
    a = ap.parse_args()
    for zp, fname in ((a.coastline_zip, 'coastlines.json'), (a.borders_zip, 'borders.json')):
        d = convert(zp, a.tol, f'Natural Earth {Path(zp).name} (naturalearthdata.com)')
        p = Path(a.out) / fname
        p.write_text(json.dumps(d, separators=(',', ':')))
        print(p, len(d['lines']), 'lines', p.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
