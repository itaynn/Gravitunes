#!/usr/bin/env python3
"""Analyse the open sound library into sound-engine voice presets.

For each entry in sound-engine/library/manifest.json whose file has been downloaded
(sound-engine/library/fetch.py) into data/earth/instruments/<id>/:
  1. trim to one note (manifest `trim` [start, end] seconds, else automatic onset/offset detection)
     and write data/earth/instruments/<id>/<id>.trim.wav (mono, 44.1 kHz, 16-bit) for sample voices;
  2. pitch: YIN on 40 ms frames; f0 = median over stable frames; confidence = (1 - median aperiodicity)
     x share of frames within +-50 cents of f0; unpitched if confidence < 0.6;
  3. spectrum: averaged FFT over the sustain; peaks within +-3 % of an integer multiple of f0 are
     harmonics, the rest inharmonic partials {ratio, amp, decay}; top 20 kept, normalized to max 1;
  4. envelope: RMS fitted to attack/decay/sustain/release;
and write sound-engine/library/presets/<id>.json (engine voice format + sample + source) and index.json.

Run from the repo root with the repo venv (numpy, scipy, soundfile):
    uv venv .venv && uv pip install --python .venv/bin/python numpy scipy soundfile
    .venv/bin/python analysis/scripts/instrument-analysis/analyze.py [--only id,id]
"""
import argparse, json, math
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "sound-engine" / "library" / "manifest.json"
PRESETS = ROOT / "sound-engine" / "library" / "presets"
DATA = ROOT / "data" / "earth" / "instruments"
SR = 44100
MAX_LEN = {"instrument": 4.0, "sound": 6.0}


def file_name(entry):
    import urllib.parse
    return urllib.parse.unquote(entry["url"].rsplit("/", 1)[-1]).replace(" ", "_")


def load(path):
    x, sr = sf.read(str(path), always_2d=True, dtype="float64")
    x = x.mean(axis=1)
    if sr != SR:
        g = math.gcd(int(sr), SR)
        x = resample_poly(x, SR // g, int(sr) // g)
    return x


def frame_rms(x, hop=441, win=882):
    n = max(1, 1 + (len(x) - win) // hop)
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    idx = np.minimum(idx, len(x) - 1)
    return np.sqrt((x[idx] ** 2).mean(axis=1)), hop / SR


def auto_trim(x, kind):
    """One note: from the first onset until it dies away, the next strong onset, or MAX_LEN."""
    rms, dt = frame_rms(x)
    peak = rms.max()
    if peak <= 0:
        return 0.0, len(x) / SR
    on = int(np.argmax(rms > 0.1 * peak))
    start = max(0.0, on * dt - 0.01)
    # Look for the end within the window.
    last = min(len(rms), on + int(MAX_LEN[kind] / dt))
    local_peak_i = on + int(np.argmax(rms[on:min(last, on + int(0.5 / dt))]))
    lp = rms[local_peak_i]
    end_i = last
    for i in range(local_peak_i + 1, last):
        if rms[i] < 0.01 * lp:                         # died away (-40 dB)
            end_i = i; break
        if i - local_peak_i > int(0.25 / dt) and i >= 3 and rms[i] > 2.0 * rms[i - 3] and rms[i] > 0.3 * lp:
            end_i = i - 2; break                       # next note starts
    return start, min(len(x) / SR, end_i * dt + 0.02)


def trim_signal(x, start, end):
    y = x[int(start * SR):int(end * SR)].copy()
    fi, fo = int(0.005 * SR), min(int(0.05 * SR), len(y) // 4)
    if len(y) > fi: y[:fi] *= np.linspace(0, 1, fi)
    if fo > 0: y[-fo:] *= np.linspace(1, 0, fo)
    pk = np.abs(y).max()
    return y / pk * 0.9 if pk > 0 else y


def yin(x, fmin=40.0, fmax=2000.0, win=1764, hop=441, thresh=0.15):
    """YIN pitch per 40 ms frame -> (f0 array, aperiodicity array, rms array)."""
    tmin, tmax = int(SR / fmax), int(SR / fmin)
    tmax = min(tmax, win - 1)
    f0s, aps, rs = [], [], []
    for s in range(0, len(x) - win - tmax, hop):
        fr = x[s:s + win + tmax]
        a = fr[:win]
        # difference function via autocorrelation
        n = 1 << int(np.ceil(np.log2(len(fr) * 2)))
        F = np.fft.rfft(fr, n)
        ac = np.fft.irfft(F * np.conj(np.fft.rfft(a, n)), n)[:tmax + 1]
        e0 = np.sum(a * a)
        csum = np.cumsum(np.concatenate([[0.0], fr ** 2]))
        etau = csum[np.arange(tmax + 1) + win] - csum[np.arange(tmax + 1)]
        d = e0 + etau - 2 * ac
        d[0] = 0
        cm = d[1:] * np.arange(1, tmax + 1) / np.maximum(np.cumsum(d[1:]), 1e-12)
        cm = np.concatenate([[1.0], cm])
        tau = None
        for t in range(tmin, tmax):
            if cm[t] < thresh:
                while t + 1 < tmax and cm[t + 1] < cm[t]:
                    t += 1
                tau = t; break
        if tau is None:
            tau = tmin + int(np.argmin(cm[tmin:tmax]))
        ap = float(cm[tau])
        if 0 < tau < tmax:
            a_, b_, c_ = cm[tau - 1], cm[tau], cm[tau + 1]
            den = a_ - 2 * b_ + c_
            tau_f = tau + (0.5 * (a_ - c_) / den if den != 0 else 0)
        else:
            tau_f = tau
        f0s.append(SR / tau_f); aps.append(ap); rs.append(math.sqrt(e0 / win))
    return np.array(f0s), np.array(aps), np.array(rs)


def pitch(y):
    f0, ap, r = yin(y)
    if not len(f0):
        return None, 0.0
    loud = r > 0.1 * r.max()
    stable = loud & (ap < 0.3)
    if stable.sum() < 3:
        return float(np.median(f0[loud])) if loud.any() else None, 0.0
    f = float(np.median(f0[stable]))
    cents = 1200 * np.abs(np.log2(f0[loud] / f))
    share = float((cents < 50).mean())
    conf = (1 - float(np.median(ap[loud]))) * share
    return f, conf


def spectrum_frames(y, n=8192, hop=2048):
    w = np.hanning(n)
    frames = []
    for s in range(0, max(1, len(y) - n), hop):
        seg = y[s:s + n]
        if len(seg) < n: seg = np.pad(seg, (0, n - len(seg)))
        frames.append(np.abs(np.fft.rfft(seg * w)))
    return np.array(frames), hop / SR, SR / n


def peaks(mag, df, fmin=30.0, fmax=12000.0, floor_db=-60):
    m = mag.copy()
    ref = m.max()
    out = []
    for i in range(2, len(m) - 2):
        f = i * df
        if f < fmin or f > fmax: continue
        if m[i] > m[i - 1] and m[i] >= m[i + 1] and m[i] > m[i - 2] and m[i] >= m[i + 2] and 20 * np.log10(m[i] / ref + 1e-12) > floor_db:
            a, b, c = np.log(m[i - 1] + 1e-12), np.log(m[i] + 1e-12), np.log(m[i + 1] + 1e-12)
            den = a - 2 * b + c
            p = 0.5 * (a - c) / den if den != 0 else 0
            out.append(((i + p) * df, float(m[i]), i))
    out.sort(key=lambda t: -t[1])
    return out[:60]


def decay_of(frames, bin_i, dt):
    """Seconds until the partial falls to e^-3 of its peak (engine's partial `decay`), or None if it holds."""
    tr = frames[:, max(0, bin_i - 1):bin_i + 2].max(axis=1)
    k0 = int(np.argmax(tr))
    seg = tr[k0:]
    if len(seg) < 4: return None
    t = np.arange(len(seg)) * dt
    good = seg > tr[k0] * 1e-3
    if good.sum() < 4: return None
    slope = np.polyfit(t[good], np.log(seg[good]), 1)[0]
    if slope > -0.1: return None
    return float(np.clip(3 / -slope, 0.05, 60))


def envelope(y):
    rms, dt = frame_rms(y)
    pk_i = int(np.argmax(rms)); pk = rms[pk_i]
    attack = max(0.002, pk_i * dt)
    tail = rms[pk_i:]
    end_level = float(np.median(tail[-max(1, len(tail) // 5):]) / pk) if len(tail) else 0
    # time to fall to 5 % of the way from peak to the end level (setTarget time constant x 3)
    target = end_level + 0.05 * (1 - end_level)
    below = np.nonzero(tail / pk <= target)[0]
    dec = float(below[0] * dt) if len(below) else len(tail) * dt
    if end_level < 0.15:
        sus, rel = 0.0, float(np.clip(dec * 0.5, 0.05, 4))
    else:
        sus, rel = float(np.clip(end_level, 0, 1)), 0.3
    return {"attack": round(float(np.clip(attack, 0.002, 2)), 4), "decay": round(float(np.clip(max(dec, 0.02), 0.02, 30)), 3),
            "sustain": round(sus, 3), "release": round(rel, 3)}


def loop_points(y, f0, env):
    """A rising-zero-crossing loop of whole periods in the middle of a sustained note, or None."""
    if env["sustain"] < 0.3 or not f0: return None
    n = len(y)
    if n < SR: return None
    per = SR / f0
    s = int(n * 0.4)
    zc = np.nonzero((y[:-1] <= 0) & (y[1:] > 0))[0]
    if not len(zc): return None
    a = zc[np.argmin(np.abs(zc - s))]
    k = max(1, round(0.4 * SR / per))
    b_target = a + k * per
    b = zc[np.argmin(np.abs(zc - b_target))]
    if b <= a or b >= n - int(0.06 * SR): return None
    return round(a / SR, 5), round(b / SR, 5)


def analyze(entry):
    src = DATA / entry["id"] / file_name(entry)
    x = load(src)
    if entry.get("trim"):
        start, end = entry["trim"]
    else:
        start, end = auto_trim(x, entry["kind"])
    y = trim_signal(x, start, end)
    out_wav = DATA / entry["id"] / f"{entry['id']}.trim.wav"
    sf.write(str(out_wav), y.astype(np.float32), SR, subtype="PCM_16")

    f0, conf = pitch(y)
    pitched = bool(f0 and conf >= 0.6)
    env = envelope(y)

    frames, fdt, df = spectrum_frames(y)
    rms, dt = frame_rms(y)
    pk_i = int(np.argmax(rms))
    k0 = min(len(frames) - 1, int(pk_i * dt / fdt))
    k1 = max(k0 + 1, min(len(frames), k0 + int(1.0 / fdt) + 1))
    avg = frames[k0:k1].mean(axis=0)
    pk = peaks(avg, df)
    if not pk:
        raise RuntimeError("no spectral peaks")
    ref = f0 if pitched else pk[0][0]
    harm = {}
    parts = []
    for f, a, bi in pk:
        r = f / ref
        n = round(r)
        if pitched and n >= 1 and abs(r - n) <= 0.03 * n and n <= 24:
            harm[n] = max(harm.get(n, 0), a)
        elif r > 0.2:
            parts.append({"ratio": round(r, 4), "amp": a, "decay": decay_of(frames, bi, fdt)})
    if not pitched:
        harm = {1: pk[0][1]}
        parts = [p for p in parts if abs(p["ratio"] - 1) > 0.01]
    # keep the strongest 20 components overall
    comps = [("h", n, a) for n, a in harm.items()] + [("p", i, p["amp"]) for i, p in enumerate(parts)]
    comps.sort(key=lambda c: -c[2])
    comps = comps[:20]
    top = max(c[2] for c in comps)
    keep_h = {c[1]: c[2] / top for c in comps if c[0] == "h"}
    keep_p = [dict(parts[c[1]], amp=c[2] / top) for c in comps if c[0] == "p"]
    nmax = max(keep_h) if keep_h else 1
    harmonics = [round(keep_h.get(k, 0.0), 4) for k in range(1, nmax + 1)]
    if not any(harmonics): harmonics = [0.0]
    partials = []
    for p in sorted(keep_p, key=lambda p: p["ratio"]):
        q = {"ratio": p["ratio"], "amp": round(p["amp"], 4)}
        if p["decay"]: q["decay"] = round(p["decay"], 3)
        partials.append(q)
    if not any(harmonics) and not partials:
        harmonics = [1.0]

    sample = {"url": f"{entry['id']}/{entry['id']}.trim.wav", "f0": round(float(f0 if pitched else ref), 3)}
    lp = loop_points(y, f0 if pitched else None, env)
    if lp:
        sample.update(loop=True, loopStart=lp[0], loopEnd=lp[1])
    preset = {
        "id": entry["id"], "title": entry["title"], "kind": entry["kind"],
        "harmonics": harmonics, "envelope": env, "amp": 0.5,
        "sample": sample,
        "source": {"f0": round(float(f0), 3) if f0 else None, "confidence": round(conf, 3), "pitched": pitched,
                   "file": f"data/earth/instruments/{entry['id']}/{file_name(entry)}", "trim": [round(start, 3), round(end, 3)],
                   "license": entry["license"], "attribution": entry["attribution"]},
    }
    if partials: preset["partials"] = partials
    return preset


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only")
    a = ap.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    PRESETS.mkdir(parents=True, exist_ok=True)
    for e in manifest["entries"]:
        if a.only and e["id"] not in a.only.split(","): continue
        if not (DATA / e["id"] / file_name(e)).exists():
            print(f"{e['id']:15} missing (run fetch.py)"); continue
        try:
            p = analyze(e)
        except Exception as err:
            print(f"{e['id']:15} FAILED: {err}"); continue
        (PRESETS / f"{e['id']}.json").write_text(json.dumps(p, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        s = p["source"]
        print(f"{e['id']:15} f0 {s['f0'] or 0:8.2f} Hz conf {s['confidence']:.2f} {'pitched' if s['pitched'] else 'UNPITCHED':9} "
              f"h{len(p['harmonics'])} p{len(p.get('partials', []))} env {p['envelope']} loop {p['sample'].get('loop', False)}")
    index = []
    for f in sorted(PRESETS.glob("*.json")):
        if f.name == "index.json": continue
        p = json.loads(f.read_text(encoding="utf-8"))
        index.append({"id": p["id"], "name": p["id"].replace("_", " ").capitalize(), "title": p["title"], "kind": p["kind"], "pitched": p["source"]["pitched"], "license": p["source"]["license"]})
    (PRESETS / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
