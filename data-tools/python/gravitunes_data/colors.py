"""Turn SVS visualization colours back into data values.

SVS frames such as GEOS-CF 5152/5153/5154 are drawn as

    pixel = a(v) * colorbar(v) + (1 - a(v)) * B

where colorbar(v) is the colour-bar colour for value v, a(v) is an opacity that grows with v,
and B is a fixed greyscale Earth image (black ocean, white ice, grey land) under the data.
Low values are therefore drawn nearly transparent (dark over the ocean, light over ice).

`BlendDecoder` inverts that model. `fit_background` recovers B from a stack of frames.
Values are an approximation from visualization colours, not raw science data.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter

_Q = np.arange(64) * 4 + 2.0                       # 6-bit colour cube centres
_CUBE = np.stack(np.meshgrid(_Q, _Q, _Q, indexing="ij"), -1).reshape(-1, 3)


def cube_index(rgb: np.ndarray) -> np.ndarray:
    f = (np.asarray(rgb)[..., :3] >> 2).astype(np.int64)
    return f[..., 0] * 4096 + f[..., 1] * 64 + f[..., 2]


def read_colorbar(path, row: int | None = None, x0: int | None = None, x1: int | None = None) -> np.ndarray:
    """Sample the colour ramp (N x 3 floats, low -> high) from a colour-bar image.

    Defaults find the opaque bar automatically (works for SVS *_colorbar_plain.png).
    """
    im = np.asarray(Image.open(path).convert("RGBA")).astype(float)
    if row is None:
        rows = np.where((im[..., 3] > 200).sum(1) > im.shape[1] * 0.4)[0]
        if not len(rows):
            raise ValueError(f"no opaque colour bar found in {path}")
        row = int(rows[len(rows) // 2])
    if x0 is None or x1 is None:
        cols = np.where(im[row, :, 3] > 200)[0]
        x0 = int(cols[0]) + 2 if x0 is None else x0      # skip anti-aliased / white border pixels
        x1 = int(cols[-1]) - 1 if x1 is None else x1
    return im[row, x0:x1, :3]


class BlendDecoder:
    """Decode values from pixels drawn as a(v)*ramp(v) + (1-a(v))*B."""

    def __init__(self, ramp: np.ndarray, vmin: float, vmax: float, opacity: dict | None = None,
                 bg_levels: np.ndarray = np.arange(0, 256, 8.0), values: np.ndarray | None = None, log: bool = False):
        """values: value of each ramp entry (increasing); default linspace(vmin, vmax).
        log: the colour bar is logarithmic (opacity and render interpolate in log10)."""
        self.ramp = np.asarray(ramp, float)
        self.vmin, self.vmax = float(vmin), float(vmax)
        self.values = np.linspace(vmin, vmax, len(self.ramp)) if values is None else np.asarray(values, float)
        self._f = np.log10 if log else (lambda x: np.asarray(x, float))
        if opacity:
            self.alpha = np.interp(self._f(self.values), self._f(opacity["values"]), opacity["alpha"])
        else:
            self.alpha = np.ones(len(self.ramp))
        self.bg_levels = np.asarray(bg_levels, float)
        self._vi = np.empty((len(self.bg_levels), len(_CUBE)), np.int16)
        self._err = np.empty((len(self.bg_levels), len(_CUBE)), np.float32)
        a = self.alpha[:, None]
        for j, b in enumerate(self.bg_levels):
            curve = a * self.ramp + (1 - a) * b
            for s in range(0, len(_CUBE), 16384):
                e = ((_CUBE[s:s + 16384, None] - curve[None]) ** 2).sum(-1)
                i = e.argmin(1)
                self._vi[j, s:s + 16384] = i
                self._err[j, s:s + 16384] = np.sqrt(e[np.arange(len(i)), i])

    def _bg_index(self, background) -> np.ndarray | int:
        if background is None:
            return 0
        step = self.bg_levels[1] - self.bg_levels[0]
        return np.clip(np.round(np.asarray(background, float) / step), 0, len(self.bg_levels) - 1).astype(int)

    def decode(self, rgb: np.ndarray, background=None, max_err: float = 40.0) -> np.ndarray:
        """RGB(A) frame (H,W,3+) uint8 -> float32 values; NaN where the colour doesn't fit the model."""
        k = cube_index(rgb)
        bi = self._bg_index(background)
        v = self.values[self._vi[bi, k]].astype(np.float32)
        v[self._err[bi, k] > max_err] = np.nan
        return v

    def fit_error(self, rgb, background=None) -> np.ndarray:
        return self._err[self._bg_index(background), cube_index(rgb)]

    def render(self, values: np.ndarray, background=None) -> np.ndarray:
        """Forward model, values -> RGB uint8 (for checking a decode)."""
        v = np.nan_to_num(np.asarray(values, float), nan=self.vmin)
        i = np.round(np.interp(self._f(np.maximum(v, self.values[0])), self._f(self.values), np.arange(len(self.ramp)))).astype(int)
        a = self.alpha[i][..., None]
        b = 0.0 if background is None else np.asarray(background, float)[..., None]
        return np.clip(a * self.ramp[i] + (1 - a) * b, 0, 255).astype(np.uint8)

    def fit_background(self, frames: np.ndarray) -> np.ndarray:
        """Per-pixel background grey level (H,W uint8) that best explains a stack of frames (T,H,W,3)."""
        frames = np.asarray(frames)
        K = cube_index(frames)
        best = np.full(K.shape[1:], np.inf, np.float32)
        out = np.zeros(K.shape[1:], np.uint8)
        for j, b in enumerate(self.bg_levels):
            e = np.median(self._err[j][K], 0)
            better = e < best
            best[better] = e[better]
            out[better] = int(b)
        return out


def line_mask(frames: np.ndarray, boxes=(), dark: float = 90, std: float = 6, contrast: float = 25) -> np.ndarray:
    """Pixels that are drawn overlay, not data: thin dark lines constant in time + fixed label boxes.

    boxes: (x, y, w, h) as fractions of the frame.
    """
    st = np.asarray(frames)[..., :3].astype(np.float32).mean(-1)
    lo = st.min(0)
    med = np.asarray(Image.fromarray(lo.astype(np.uint8)).filter(ImageFilter.MedianFilter(9))).astype(np.float32)
    m = (st.max(0) < dark) & (st.std(0) < std) & (med - lo > contrast)
    H, W = m.shape
    for x, y, w, h in boxes:
        m[int(y * H):int(np.ceil((y + h) * H)), int(x * W):int(np.ceil((x + w) * W))] = True
    return m
