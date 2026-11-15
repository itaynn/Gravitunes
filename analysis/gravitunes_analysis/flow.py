"""Optical flow, vorticity, divergence and Okubo-Weiss vortex detection on equirectangular grids.

Conventions used everywhere in this module:
- Arrays are (H, W) with row 0 at the top (north) and column 0 at the west edge.
- Pixel flow (dx, dy) is image motion: dx to the right (east), dy downward (south).
- Physical velocity (u, v) is km/h with u positive east and v positive north.
- Vorticity is positive counterclockwise as seen on a north-up map (cyclonic in the Northern Hemisphere).
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math

import cv2
import numpy as np
from scipy import ndimage

KM_PER_DEG = 111.32
EARTH_RADIUS_KM = 6371.0


@dataclass(frozen=True)
class Grid:
    """Equirectangular grid. Defaults are the whole globe (lon -180..180, lat 90..-90)."""

    width: int
    height: int
    lon_west: float = -180.0
    lon_east: float = 180.0
    lat_north: float = 90.0
    lat_south: float = -90.0

    @property
    def deg_x(self) -> float:
        return (self.lon_east - self.lon_west) / self.width

    @property
    def deg_y(self) -> float:
        return (self.lat_north - self.lat_south) / self.height

    @property
    def global_wrap(self) -> bool:
        return abs((self.lon_east - self.lon_west) - 360.0) < 1e-6

    @property
    def lat(self) -> np.ndarray:
        return self.lat_north - (np.arange(self.height) + 0.5) * self.deg_y

    @property
    def lon(self) -> np.ndarray:
        return self.lon_west + (np.arange(self.width) + 0.5) * self.deg_x

    def km_per_px_x(self) -> np.ndarray:
        """(H, 1) km per pixel eastward at each row (shrinks with cos(latitude))."""
        cos = np.maximum(np.cos(np.radians(self.lat)), 0.02)
        return (self.deg_x * KM_PER_DEG * cos)[:, None]

    @property
    def km_per_px_y(self) -> float:
        return self.deg_y * KM_PER_DEG

    def cell_area_km2(self) -> np.ndarray:
        return self.km_per_px_x() * self.km_per_px_y

    def resized(self, width: int, height: int) -> "Grid":
        return Grid(width, height, self.lon_west, self.lon_east, self.lat_north, self.lat_south)

    def to_latlon(self, x: float, y: float) -> tuple[float, float]:
        """Fractional pixel coordinates (pixel centres at i + 0.5... we use x = column index) to lat, lon."""
        lon = self.lon_west + (x + 0.5) * self.deg_x
        if self.global_wrap:
            lon = (lon + 180.0) % 360.0 - 180.0
        return self.lat_north - (y + 0.5) * self.deg_y, lon


@dataclass
class FlowParams:
    """Farneback and smoothing settings. Pixel sizes refer to the analysis grid."""

    # Tuned on 4285 (analysis/scripts/flow-tracers/validate.py): a wide window and 6 pyramid levels follow
    # whole storm systems, temporal + spatial smoothing make the field coherent instead of noisy.
    pre_sigma: float = 1.5          # Gaussian blur of the scalar field before Farneback (px)
    pyr_scale: float = 0.5
    levels: int = 6
    winsize: int = 29
    iterations: int = 6
    poly_n: int = 7
    poly_sigma: float = 1.5
    flow_sigma: float = 7.0         # normalized-convolution smoothing of the flow (px)
    valid_threshold: float = 0.03   # field value (0..1) above which flow is trusted
    valid_dilate: int = 7           # grow the trusted area by this many px
    min_weight: float = 0.2         # keep smoothed flow only where local trusted fraction >= this
    temporal: int = 2               # average flow over +-temporal neighbouring frame pairs
    wrap_pad: int = 32              # columns of wrap-around padding for global grids


def to_uint8(field01: np.ndarray, sigma: float = 0.0) -> np.ndarray:
    f = np.nan_to_num(field01.astype(np.float32), nan=0.0)
    if sigma > 0:
        f = cv2.GaussianBlur(f, (0, 0), sigma)
    return np.clip(f * 255.0, 0, 255).astype(np.uint8)


def _wrap_pad(img: np.ndarray, pad: int) -> np.ndarray:
    return np.concatenate([img[:, -pad:], img, img[:, :pad]], axis=1) if pad else img


def farneback(prev01: np.ndarray, next01: np.ndarray, params: FlowParams = FlowParams(),
              wrap: bool = False) -> np.ndarray:
    """Dense optical flow between two 0..1 fields. Returns (H, W, 2) pixel displacement (dx east, dy south)."""
    a = to_uint8(prev01, params.pre_sigma)
    b = to_uint8(next01, params.pre_sigma)
    pad = min(params.wrap_pad, a.shape[1] // 4) if wrap else 0
    a, b = _wrap_pad(a, pad), _wrap_pad(b, pad)
    flow = cv2.calcOpticalFlowFarneback(
        a, b, None, pyr_scale=params.pyr_scale, levels=params.levels, winsize=params.winsize,
        iterations=params.iterations, poly_n=params.poly_n, poly_sigma=params.poly_sigma,
        flags=cv2.OPTFLOW_FARNEBACK_GAUSSIAN,
    )
    return flow[:, pad:pad + prev01.shape[1]] if pad else flow


def farneback_gray(prev: np.ndarray, nxt: np.ndarray, winsize: int = 21, levels: int = 3,
                   gaussian: bool = False) -> np.ndarray:
    """Plain Farneback on two uint8 images (no wrap, no smoothing): storm tracking uses this on masked
    grey frames. Returns (H, W, 2) pixel displacement."""
    return cv2.calcOpticalFlowFarneback(
        prev, nxt, None, pyr_scale=0.5, levels=levels, winsize=winsize, iterations=3, poly_n=5,
        poly_sigma=1.2, flags=cv2.OPTFLOW_FARNEBACK_GAUSSIAN if gaussian else 0,
    )


def valid_mask(field01: np.ndarray, params: FlowParams = FlowParams()) -> np.ndarray:
    f = np.nan_to_num(field01, nan=0.0)
    if params.pre_sigma > 0:
        f = cv2.GaussianBlur(f.astype(np.float32), (0, 0), params.pre_sigma)
    m = (f >= params.valid_threshold).astype(np.uint8)
    if params.valid_dilate:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * params.valid_dilate + 1,) * 2)
        m = cv2.dilate(m, k)
    return m.astype(bool)


def smooth_masked(values: np.ndarray, weight: np.ndarray, sigma: float, wrap: bool,
                  min_weight: float = 0.25) -> np.ndarray:
    """Normalized convolution: Gaussian average of `values` using only cells where weight > 0. NaN elsewhere."""
    w = weight.astype(np.float32)
    v = np.nan_to_num(values.astype(np.float32)) * w
    mode = ("nearest", "wrap") if wrap else "nearest"
    if sigma > 0:
        num = ndimage.gaussian_filter(v, sigma, mode=mode)
        den = ndimage.gaussian_filter(w, sigma, mode=mode)
    else:
        num, den = v, w
    out = np.full(values.shape, np.nan, np.float32)
    ok = (den >= min_weight) & (weight > 0)
    out[ok] = num[ok] / den[ok]
    return out


@dataclass
class FlowSeries:
    """Per-frame velocity. dx, dy: px/hour on the analysis grid; u, v: km/h (east, north). NaN = no flow."""

    grid: Grid
    dx: np.ndarray
    dy: np.ndarray
    u: np.ndarray
    v: np.ndarray
    valid: np.ndarray
    extra: dict = field(default_factory=dict)


def px_to_kmh(dx: np.ndarray, dy: np.ndarray, grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """Pixel velocity (px/h, y down) to km/h (u east, v north)."""
    return dx * grid.km_per_px_x(), -dy * grid.km_per_px_y


def compute_flow(fields: np.ndarray, dt_hours: float, grid: Grid,
                 params: FlowParams = FlowParams(), progress=None) -> FlowSeries:
    """Optical flow for every frame of a (T, H, W) 0..1 field stack.

    Flow for frame t averages the pairs (t-k-1 -> t-k) ... (t+k -> t+k+1) around it (k = params.temporal),
    so the output has one field per input frame. Flow is kept only where the field has signal.
    """
    T, H, W = fields.shape
    wrap = grid.global_wrap
    pairs = []
    for t in range(T - 1):
        pairs.append(farneback(fields[t], fields[t + 1], params, wrap=wrap))
        if progress:
            progress(t + 1, T - 1)
    masks = np.stack([valid_mask(f, params) for f in fields])
    dx = np.full((T, H, W), np.nan, np.float32)
    dy = np.full((T, H, W), np.nan, np.float32)
    valid = np.zeros((T, H, W), bool)
    for t in range(T):
        # pair p goes from frame p to p+1; temporal=1 uses the pair ending at t and the one starting at t
        idx = [p for p in range(t - max(params.temporal, 1), t + max(params.temporal, 1)) if 0 <= p < T - 1]
        if params.temporal == 0:
            idx = [min(t, T - 2)]
        if not idx:
            continue
        sx = np.mean([pairs[p][..., 0] for p in idx], axis=0)
        sy = np.mean([pairs[p][..., 1] for p in idx], axis=0)
        m = masks[t]
        dx[t] = smooth_masked(sx, m, params.flow_sigma, wrap, params.min_weight) / dt_hours
        dy[t] = smooth_masked(sy, m, params.flow_sigma, wrap, params.min_weight) / dt_hours
        valid[t] = np.isfinite(dx[t])
    u, v = px_to_kmh(dx, dy, grid)
    return FlowSeries(grid, dx, dy, u.astype(np.float32), v.astype(np.float32), valid)


def _ddx(a: np.ndarray, wrap: bool) -> np.ndarray:
    """Central difference along x (per pixel). NaN propagates."""
    if wrap:
        return (np.roll(a, -1, axis=-1) - np.roll(a, 1, axis=-1)) / 2.0
    return np.gradient(a, axis=-1)


def _ddy_north(a: np.ndarray) -> np.ndarray:
    """Derivative per pixel toward north (rows increase southward, so negate)."""
    return -np.gradient(a, axis=-2)


def kinematics(u: np.ndarray, v: np.ndarray, grid: Grid, max_abs_lat: float = 80.0) -> dict[str, np.ndarray]:
    """Vorticity, divergence, normal/shear strain and Okubo-Weiss W from u, v (km/h). Units 1/h (W: 1/h^2).

    Rows poleward of `max_abs_lat` are NaN (east-west pixels shrink to nothing there and derivatives blow up).
    Uses spherical metric terms: vorticity = dv/dx - du/dy + u tan(lat)/R, divergence = du/dx + dv/dy - v tan(lat)/R.
    """
    wrap = grid.global_wrap
    kx = grid.km_per_px_x()
    ky = grid.km_per_px_y
    tan = np.tan(np.radians(np.clip(grid.lat, -89, 89)))[:, None] / EARTH_RADIUS_KM
    dudx = _ddx(u, wrap) / kx
    dvdx = _ddx(v, wrap) / kx
    dudy = _ddy_north(u) / ky
    dvdy = _ddy_north(v) / ky
    vort = dvdx - dudy + u * tan
    div = dudx + dvdy - v * tan
    sn = dudx - dvdy
    ss = dvdx + dudy
    ow = sn ** 2 + ss ** 2 - vort ** 2
    polar = np.abs(grid.lat) > max_abs_lat
    for a in (vort, div, sn, ss, ow):
        a[..., polar, :] = np.nan
    return {"vorticity": vort, "divergence": div, "strain_normal": sn, "strain_shear": ss, "okubo_weiss": ow}


@dataclass
class VortexParams:
    k: float = 0.5                  # W < -k * std(W) marks rotation-dominated cells
    min_area_km2: float = 80000.0   # ~ 320 km diameter (the smoother 4285 flow finds many small eddies)
    min_spin_turns_per_hour: float = 0.0
    close_px: int = 1               # morphological closing radius on the vortex mask


def spin_turns_per_hour(vorticity: float) -> float:
    """Solid-body rotation: vorticity = 2 * angular velocity, so turns/h = vorticity / (4 pi)."""
    return vorticity / (4.0 * math.pi)


def detect_vortices(kin: dict[str, np.ndarray], u: np.ndarray, v: np.ndarray, grid: Grid,
                    params: VortexParams = VortexParams(), w_std: float | None = None,
                    field01: np.ndarray | None = None) -> tuple[list[dict], np.ndarray]:
    """Okubo-Weiss vortex regions for one frame. Returns (vortex list, label image with 0 = none).

    `w_std` lets callers use one threshold for a whole sequence (recommended); default is this frame's std.
    """
    W = kin["okubo_weiss"]
    vort = kin["vorticity"]
    finite = np.isfinite(W)
    if w_std is None:
        w_std = float(np.nanstd(W)) if finite.any() else 0.0
    mask = finite & (W < -params.k * w_std)
    if params.close_px:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * params.close_px + 1,) * 2)
        mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, k).astype(bool) & finite
    # Split regions where the vorticity sign changes, so one region spins one way.
    labels = np.zeros(W.shape, np.int32)
    n = 0
    for sign in (1, -1):
        part = mask & (np.sign(np.nan_to_num(vort)) == sign)
        lab, cnt = ndimage.label(part, structure=np.ones((3, 3)))
        labels[lab > 0] = lab[lab > 0] + n
        n += cnt
    area = grid.cell_area_km2() * np.ones_like(W)
    out = []
    keep = np.zeros(n + 1, np.int32)
    next_id = 1
    objs = ndimage.find_objects(labels)
    for lab_id, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        reg = labels[sl] == lab_id
        a = area[sl][reg]
        area_km2 = float(a.sum())
        if area_km2 < params.min_area_km2:
            continue
        om = vort[sl][reg]
        mean_om = float(np.sum(om * a) / area_km2)
        spin = spin_turns_per_hour(mean_om)
        if abs(spin) < params.min_spin_turns_per_hour:
            continue
        ys, xs = np.nonzero(reg)
        ys = ys + sl[0].start
        xs = xs + sl[1].start
        wgt = np.abs(om) * a
        cy = float(np.sum(ys * wgt) / wgt.sum())
        cx = float(np.sum(xs * wgt) / wgt.sum())
        lat, lon = grid.to_latlon(cx, cy)
        uu, vv = u[sl][reg], v[sl][reg]
        info = {
            "x": cx / grid.width, "y": cy / grid.height,   # 0..1 fractions, (0, 0) = north-west corner
            "lat": lat, "lon": lon,
            "area_km2": area_km2,
            "radius_km": math.sqrt(area_km2 / math.pi),
            "vorticity": mean_om,                            # 1/h, + = counterclockwise
            "spin_turns_per_hour": abs(spin),
            "period_hours": (1.0 / abs(spin)) if spin else None,
            "direction": "ccw" if mean_om > 0 else "cw",
            "cyclonic": bool((mean_om > 0) == (lat >= 0)),
            "circulation_km2_per_h": float(np.sum(om * a)),  # signed, + = ccw
            "u_kmh": float(np.nanmean(uu)), "v_kmh": float(np.nanmean(vv)),
            "okubo_weiss": float(np.mean(W[sl][reg])),
        }
        if field01 is not None:
            info["intensity"] = float(np.nanmean(field01[sl][reg]))
        keep[lab_id] = next_id
        info["label"] = next_id
        next_id += 1
        out.append(info)
    return out, keep[labels]
