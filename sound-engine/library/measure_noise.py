"""Rank app samples by background noise (numbers only, never plays audio).

    uv run --no-project --with numpy python sound-engine/library/measure_noise.py [files...]
"""
import os, subprocess, sys
from pathlib import Path
import numpy as np


def load(p, sr=32000):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True)
    return np.frombuffer(r.stdout, np.float32), sr


def measure(p):
    """snr: loud-quarter vs quietest-10% frame energy (dB); flat: median spectral flatness of loud frames
    within 150 Hz-7 kHz (0 = tonal, 1 = white noise); hiss: energy above 4 kHz relative to the whole spectrum in loud frames."""
    x, sr = load(p)
    n, h = 1024, 512
    if len(x) < n * 4:
        x = np.pad(x, (0, n * 4))
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::h] * np.hanning(n)
    S = np.abs(np.fft.rfft(fr, axis=1)) ** 2 + 1e-12
    f = np.fft.rfftfreq(n, 1 / sr)
    db = 10 * np.log10(S.sum(1))
    order = np.argsort(db)
    q, loud = order[: max(1, len(db) // 10)], order[-max(1, len(db) // 4):]
    b = (f > 150) & (f < 7000)
    B = S[loud][:, b]
    flat = np.median(np.exp(np.log(B).mean(1)) / B.mean(1))
    hiss = 10 * np.log10(S[loud][:, f > 4000].sum() / S[loud].sum())
    return {"snr": db[loud].mean() - db[q].mean(), "flat": float(flat), "hiss": hiss}


if __name__ == "__main__":
    files = sys.argv[1:] or sorted(str(p) for p in (Path(__file__).parent / "samples").glob("*.mp3"))
    rows = sorted(((os.path.basename(p), measure(p)) for p in files), key=lambda r: -r[1]["flat"])
    for name, m in rows:
        print(f"{name:28s} snr={m['snr']:5.1f} flat={m['flat']:.3f} hiss>4k={m['hiss']:6.1f}dB")
