#!/usr/bin/env python3
"""Write data/earth/land.json (land polygons for the plain basemap) from world-atlas land-110m.json (TopoJSON).

    curl -o /tmp/land-110m.json https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json
    python3 data-tools/land_from_topojson.py /tmp/land-110m.json

world-atlas is ISC-licensed and built from Natural Earth 1:110m land (public domain).
Output: {"rings": [[lon, lat, lon, lat, ...], ...]} rounded to 0.15 degrees; rings under 1 square degrees dropped.
"""
import json, sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "earth" / "land.json"


def main(path):
    t = json.loads(Path(path).read_text())
    (sx, sy), (tx, ty) = t["transform"]["scale"], t["transform"]["translate"]
    arcs = []
    for arc in t["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(idx):
        pts = []
        for i in idx:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.extend(a if not pts else a[1:])
        return pts

    rings = []
    for g in t["objects"]["land"]["geometries"]:
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        for poly in polys:
            for r in poly:
                pts = ring(r)
                area = 0.5 * abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1])))
                if area < 1.0:
                    continue
                flat, last = [], None
                for x, y in pts:
                    q = (round(x / 0.15) * 0.15, round(y / 0.15) * 0.15)
                    if q != last:
                        flat += [round(q[0], 2), round(q[1], 2)]; last = q
                rings.append(flat)
    OUT.write_text(json.dumps({"source": "Natural Earth 1:110m land via world-atlas 2.0.2 (land-110m.json)",
                               "license": "public domain (Natural Earth); world-atlas ISC", "rings": rings}, separators=(",", ":")))
    print(f"{len(rings)} rings -> {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main(sys.argv[1])
