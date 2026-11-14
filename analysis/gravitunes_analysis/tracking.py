"""Track detected vortices across frames.

Same idea as itay's storm tracker (analysis/scripts/storm-watch/preprocess.py): advect each live track by the
flow, then associate by a cost mixing advected distance and region overlap, with a short memory for gaps.
Here the objects are Okubo-Weiss vortex regions and matching is one-to-one (Hungarian), and spin direction must agree.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math

import numpy as np
from scipy.optimize import linear_sum_assignment

from .flow import EARTH_RADIUS_KM


def great_circle_km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def advect(lat: float, lon: float, u_kmh: float, v_kmh: float, hours: float) -> tuple[float, float]:
    """Move a point by (u east, v north) km/h for `hours` (flat-earth step, fine for a few hundred km)."""
    if not (math.isfinite(u_kmh) and math.isfinite(v_kmh)):
        return lat, lon
    lat2 = lat + v_kmh * hours / 111.32
    lon2 = lon + u_kmh * hours / (111.32 * max(math.cos(math.radians(lat)), 0.05))
    lon2 = (lon2 + 180.0) % 360.0 - 180.0
    return max(-90.0, min(90.0, lat2)), lon2


@dataclass
class TrackParams:
    max_distance_km: float = 600.0   # gate on advected-centre distance (also scaled by radius below)
    radius_factor: float = 1.5       # gate = max(max_distance_km, radius_factor * radius)
    overlap_weight: float = 0.5      # cost reward for mask overlap (IoU), when label images are given
    memory_frames: int = 2           # keep a lost track alive this many frames
    min_lifetime_frames: int = 1     # tracks shorter than this are dropped from the output


@dataclass
class _Track:
    id: int
    points: list = field(default_factory=list)  # (t, vortex dict)
    missed: int = 0
    mask: np.ndarray | None = None


class VortexTracker:
    """Feed frames in order with update(); read tracks with finish()."""

    def __init__(self, dt_hours: float, params: TrackParams = TrackParams()):
        self.dt = dt_hours
        self.p = params
        self.live: list[_Track] = []
        self.done: list[_Track] = []
        self.next_id = 1

    def update(self, t: int, vortices: list[dict], labels: np.ndarray | None = None,
               flow_px: tuple[np.ndarray, np.ndarray] | None = None) -> list[dict]:
        """Assign `id` to each vortex dict (in place) and return them.

        labels: label image from detect_vortices (vortex['label'] values); flow_px: (dx, dy) px/hour fields used
        to forward-warp previous masks for overlap scoring.
        """
        n_t, n_v = len(self.live), len(vortices)
        cost = np.full((n_t, n_v), np.inf)
        for i, tr in enumerate(self.live):
            last = tr.points[-1][1]
            gap = (t - tr.points[-1][0]) * self.dt
            plat, plon = advect(last["lat"], last["lon"], last["u_kmh"], last["v_kmh"], gap)
            prev_mask = tr.mask
            for j, vx in enumerate(vortices):
                if vx["direction"] != last["direction"]:
                    continue
                d = great_circle_km(plat, plon, vx["lat"], vx["lon"])
                gate = max(self.p.max_distance_km, self.p.radius_factor * max(vx["radius_km"], last["radius_km"]))
                iou = 0.0
                if prev_mask is not None and labels is not None:
                    cur = labels == vx["label"]
                    inter = np.count_nonzero(prev_mask & cur)
                    if inter:
                        iou = inter / np.count_nonzero(prev_mask | cur)
                if d > gate and iou == 0.0:
                    continue
                cost[i, j] = d / gate - self.p.overlap_weight * iou + 0.1 * tr.missed
        matched_t, matched_v = set(), set()
        if n_t and n_v:
            finite = np.where(np.isfinite(cost), cost, 1e6)
            rows, cols = linear_sum_assignment(finite)
            for r, c in zip(rows, cols):
                if np.isfinite(cost[r, c]):
                    matched_t.add(r)
                    matched_v.add(c)
                    self._extend(self.live[r], t, vortices[c], labels, flow_px)
        survivors = []
        for i, tr in enumerate(self.live):
            if i in matched_t:
                survivors.append(tr)
            else:
                tr.missed += 1
                if tr.missed > self.p.memory_frames:
                    self.done.append(tr)
                else:
                    if tr.mask is not None and flow_px is not None:
                        tr.mask = _warp(tr.mask, flow_px, self.dt)
                    survivors.append(tr)
        for j, vx in enumerate(vortices):
            if j not in matched_v:
                tr = _Track(self.next_id)
                self.next_id += 1
                self._extend(tr, t, vx, labels, flow_px)
                survivors.append(tr)
        self.live = survivors
        return vortices

    def _extend(self, tr: _Track, t: int, vx: dict, labels, flow_px) -> None:
        vx["id"] = tr.id
        tr.points.append((t, vx))
        tr.missed = 0
        if labels is not None:
            m = labels == vx["label"]
            tr.mask = _warp(m, flow_px, self.dt) if flow_px is not None else m

    def finish(self) -> list[dict]:
        """Close all tracks and return summaries: id, birth/death frame, lifetime, direction, per-frame points."""
        tracks = self.done + self.live
        self.done, self.live = [], []
        out = []
        for tr in sorted(tracks, key=lambda x: x.id):
            if len(tr.points) < self.p.min_lifetime_frames:
                continue
            pts = [vx for _, vx in tr.points]
            spins = [vx["spin_turns_per_hour"] for vx in pts]
            out.append({
                "id": tr.id,
                "birth": tr.points[0][0],
                "death": tr.points[-1][0],
                "frames": len(pts),
                "lifetime_hours": (tr.points[-1][0] - tr.points[0][0] + 1) * self.dt,
                "direction": pts[0]["direction"],
                "cyclonic": pts[0]["cyclonic"],
                "max_radius_km": max(vx["radius_km"] for vx in pts),
                "mean_spin_turns_per_hour": float(np.mean(spins)),
                "max_abs_circulation_km2_per_h": max(abs(vx["circulation_km2_per_h"]) for vx in pts),
                "points": [{"t": t, "lat": vx["lat"], "lon": vx["lon"], "radius_km": vx["radius_km"],
                            "spin_turns_per_hour": vx["spin_turns_per_hour"],
                            "circulation_km2_per_h": vx["circulation_km2_per_h"]} for t, vx in tr.points],
            })
        return out


def _warp(mask: np.ndarray, flow_px: tuple[np.ndarray, np.ndarray], hours: float) -> np.ndarray:
    """Forward-shift a boolean mask by the mean flow inside it (cheap stand-in for full warping)."""
    dx, dy = flow_px
    sel = mask & np.isfinite(dx)
    if not sel.any():
        return mask
    sx = int(round(float(np.mean(dx[sel])) * hours))
    sy = int(round(float(np.mean(dy[sel])) * hours))
    out = np.roll(mask, sx, axis=1)
    if sy > 0:
        out = np.vstack([np.zeros((sy, mask.shape[1]), bool), out[:-sy]])
    elif sy < 0:
        out = np.vstack([out[-sy:], np.zeros((-sy, mask.shape[1]), bool)])
    return out
