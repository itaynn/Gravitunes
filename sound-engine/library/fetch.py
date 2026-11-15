#!/usr/bin/env python3
"""Download the open sound library listed in manifest.json into data/earth/instruments/<id>/.

Usage (from the repo root):
    python3 sound-engine/library/fetch.py              # download what is missing, verify sha256
    python3 sound-engine/library/fetch.py --dry-run    # print what would be downloaded and the total size
    python3 sound-engine/library/fetch.py --update-hashes   # fill in sha256 for entries that have none
    python3 sound-engine/library/fetch.py --only oud,marimba
    python3 sound-engine/library/fetch.py --samples    # build the small app samples (needs ffmpeg)
    python3 sound-engine/library/fetch.py --samples --only djembe,sitar

Writes data/earth/instruments/LICENSES.md with one attribution per file.
Standard library only. Uses a generic User-Agent and waits 5 s between Wikimedia downloads (it rate-limits).

--samples: for each entry of manifest.json "samples", download every zone's source file (cached in
data/earth/instruments/_samples_src/), cut start..start+dur, mix to mono 32 kHz, fade the tail and encode
MP3 48 kb/s into sound-engine/library/samples/<id>-<n>.mp3 (committed), then write samples/index.json
(what the app loads) and samples/LICENSES.md.
"""
import argparse, hashlib, http.client, json, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
MANIFEST = HERE / "manifest.json"
OUT = ROOT / "data" / "earth" / "instruments"
UA = "GravitunesInstrumentLibrary/0.1 (open-source sonification project)"
ALLOWED = ("CC0", "CC BY", "Iowa MIS")  # CC BY covers CC BY-SA; NC/ND/Sampling+ are refused below
REFUSED = ("NC", "ND", "Sampling", "GFDL")
SAMPLES = HERE / "samples"
SAMPLE_LICENSES = ("CC0", "CC BY", "MIT", "Public domain")   # app samples: CC BY-SA allowed (files stay BY-SA); no NC/ND


def build_samples(manifest, only=None):
    """Download, cut and encode the app samples; write samples/index.json and samples/LICENSES.md."""
    src_dir = OUT / "_samples_src"
    src_dir.mkdir(parents=True, exist_ok=True)
    SAMPLES.mkdir(parents=True, exist_ok=True)
    old = json.loads((SAMPLES / "index.json").read_text()) if (SAMPLES / "index.json").exists() else {}
    index, bad = {}, []
    lic = ["# App samples: sources and licences", "",
           "Built by `sound-engine/library/fetch.py --samples` from `manifest.json` \"samples\".", ""]
    for s in manifest["samples"]:
        if not s["license"].startswith(SAMPLE_LICENSES) or any(r in s["license"] for r in ("NC", "ND")):
            raise SystemExit(f"{s['id']}: license {s['license']!r} is not allowed for app samples")
        if s.get("realism") not in ("recorded", "soundfont", "synth"):
            raise SystemExit(f"{s['id']}: realism must be recorded, soundfont or synth")
        if only and s["id"] not in only:
            if s["id"] in old:
                index[s["id"]] = old[s["id"]]
                lic.append(f"- `{s['id']}-*.mp3`: {s['attribution']}")
            continue
        zones = []
        for i, z in enumerate(s["zones"]):
            out = SAMPLES / f"{s['id']}-{i}.mp3"
            src = src_dir / (hashlib.sha1(z["url"].encode()).hexdigest()[:12] + "_" + file_name({"url": z["url"]}))
            if not src.exists():
                print(f"  downloading {s['id']} zone {i} ...", flush=True)
                try:
                    download(z["url"], src)
                except Exception as err:  # keep going; report at the end
                    bad.append(f"{s['id']}: download failed ({err})")
                    continue
                if "wikimedia.org" in z["url"]:
                    time.sleep(3.0)
            fade = min(0.25, z["dur"] * 0.3)
            af = f"afade=t=out:st={z['dur'] - fade:.3f}:d={fade:.3f}"
            dn = s.get("denoise", "")  # optional per-sample ffmpeg chain: band-limit + afftdn noise reduction
            pre = f"{dn}," if dn else ""
            if s.get("clean"):  # field recordings: 5 ms fade-in, lowpass ~7 kHz, peak-normalize to -1 dBFS
                af = f"{pre}afade=t=in:d=0.005,lowpass=f=7000,{af}"
                gain = peak_gain(src, z["start"], z["dur"], f"{pre}lowpass=f=7000")
                af += f",volume={gain:.2f}dB"
            elif dn:
                af = f"{pre}{af}"
            # clean cuts are low-passed at 7 kHz, so 16 kHz / 32 kb/s keeps everything audible at half the size
            rate, kbps = ("16000", "32k") if s.get("clean") else ("32000", "48k")
            cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(z["start"]), "-t", str(z["dur"]), "-i", str(src),
                   "-ac", "1", "-ar", rate, "-af", af,
                   "-c:a", "libmp3lame", "-b:a", kbps, "-map_metadata", "-1", str(out)]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode:
                bad.append(f"{s['id']}: ffmpeg failed: {r.stderr.strip()[:200]}")
                continue
            zones.append({"file": out.name, "f0": z["f0"], "bytes": out.stat().st_size})
        if zones:
            index[s["id"]] = {"label": s["label"], "kind": s["kind"], "realism": s.get("realism", "recorded"), "license": s["license"],
                              "source": s["source"], "attribution": s["attribution"], "zones": zones}
            lic.append(f"- `{s['id']}-*.mp3`: {s['attribution']}")
    lic += ["", "Files from CC BY-SA sources are adaptations and stay under that CC BY-SA licence."]
    (SAMPLES / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (SAMPLES / "LICENSES.md").write_text("\n".join(lic) + "\n", encoding="utf-8")
    total = sum(z["bytes"] for v in index.values() for z in v["zones"])
    print(f"{len(index)} sampled instruments, {sum(len(v['zones']) for v in index.values())} files, {total / 1e3:.0f} KB")
    if bad:
        print("\n".join(bad), file=sys.stderr)
        sys.exit(1)


def peak_gain(src, start, dur, af):
    """dB of gain that brings the cut's peak to -1 dBFS."""
    r = subprocess.run(["ffmpeg", "-v", "info", "-ss", str(start), "-t", str(dur), "-i", str(src), "-ac", "1",
                        "-af", af + ",volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    peak = float(r.stderr.split("max_volume:")[1].split("dB")[0])
    return -1.0 - peak


def file_name(entry):
    name = urllib.parse.unquote(entry["url"].rsplit("/", 1)[-1])
    return name.replace(" ", "_")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def check_license(e):
    lic = e["license"]
    if not lic.startswith(ALLOWED) or any(r in lic for r in REFUSED):
        raise SystemExit(f"{e['id']}: license {lic!r} is not allowed (CC0, CC BY, CC BY-SA or Iowa MIS only)")


def download(url, dest):
    """Fetch url to dest; resumes with a Range request when a big file is cut off, backs off on HTTP 429."""
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.unlink(missing_ok=True)
    for attempt in range(8):
        have = tmp.stat().st_size if tmp.exists() else 0
        headers = {"User-Agent": UA, **({"Range": f"bytes={have}-"} if have else {})}
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r, \
                    open(tmp, "ab" if have and r.status == 206 else "wb") as f:
                while block := r.read(1 << 16):
                    f.write(block)
            tmp.replace(dest)
            return
        except urllib.error.HTTPError as err:
            if err.code != 429 or attempt == 7:
                raise
            time.sleep(30 * (attempt + 1))
        except (OSError, http.client.HTTPException):  # dropped connection: resume from what we have
            if attempt == 7:
                raise
            time.sleep(5)


def write_licenses(entries):
    lines = ["# Instrument and sound recordings: licenses", "",
             "Downloaded by `sound-engine/library/fetch.py` from `sound-engine/library/manifest.json`.",
             "Files marked CC BY-SA are share-alike: changed versions of those recordings must keep the same license.", ""]
    for e in entries:
        sa = " (share-alike)" if e.get("share_alike") else ""
        lines.append(f"- `{e['id']}/{file_name(e)}`: {e['attribution']}{sa}")
    (OUT / "LICENSES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--update-hashes", action="store_true", help="write sha256 of downloaded files into manifest.json where missing")
    ap.add_argument("--only", help="comma-separated ids")
    ap.add_argument("--samples", action="store_true", help="build the app samples in sound-engine/library/samples/")
    a = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if a.samples:
        return build_samples(manifest, set(a.only.split(",")) if a.only else None)
    entries = manifest["entries"]
    if a.only:
        want = set(a.only.split(","))
        entries = [e for e in entries if e["id"] in want]
    for e in entries:
        check_license(e)

    todo = [e for e in entries if not (OUT / e["id"] / file_name(e)).exists()]
    total = sum(e.get("size", 0) for e in todo)
    print(f"{len(entries)} entries, {len(todo)} to download, about {total / 1e6:.1f} MB")
    if total > 80e6:
        raise SystemExit("refusing to download more than 80 MB at once; use --only")
    if a.dry_run:
        for e in todo:
            print(f"  {e['id']:16} {e.get('size', 0) / 1e6:6.2f} MB  {e['license']:14} {e['url']}")
        return

    bad = []
    for e in entries:
        dest = OUT / e["id"] / file_name(e)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            print(f"  downloading {e['id']} ...", flush=True)
            try:
                download(e["url"], dest)
            except Exception as err:  # keep going; report at the end
                bad.append(f"{e['id']}: download failed ({err}); run fetch.py again later")
                continue
            if "wikimedia.org" in e["url"]:
                time.sleep(5.0)
        digest = sha256(dest)
        if e.get("sha256") and e["sha256"] != digest:
            bad.append(f"{e['id']}: sha256 mismatch ({digest} != {e['sha256']})")
        elif not e.get("sha256") and a.update_hashes:
            e["sha256"] = digest
        elif not e.get("sha256"):
            print(f"  {e['id']}: no sha256 in the manifest (run with --update-hashes)")

    if a.update_hashes:
        full = json.loads(MANIFEST.read_text(encoding="utf-8"))
        by_id = {e["id"]: e for e in entries}
        for e in full["entries"]:
            if e["id"] in by_id and not e.get("sha256"):
                e["sha256"] = by_id[e["id"]]["sha256"]
        MANIFEST.write_text(json.dumps(full, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("updated sha256 in manifest.json")

    OUT.mkdir(parents=True, exist_ok=True)
    write_licenses(json.loads(MANIFEST.read_text(encoding="utf-8"))["entries"])
    print(f"wrote {OUT / 'LICENSES.md'}")
    if bad:
        print("\n".join(bad), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
