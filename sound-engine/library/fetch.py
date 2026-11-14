#!/usr/bin/env python3
"""Download the open sound library listed in manifest.json into data/earth/instruments/<id>/.

Usage (from the repo root):
    python3 sound-engine/library/fetch.py              # download what is missing, verify sha256
    python3 sound-engine/library/fetch.py --dry-run    # print what would be downloaded and the total size
    python3 sound-engine/library/fetch.py --update-hashes   # fill in sha256 for entries that have none
    python3 sound-engine/library/fetch.py --only oud,marimba

Writes data/earth/instruments/LICENSES.md with one attribution per file.
Standard library only. Uses a generic User-Agent and waits 5 s between Wikimedia downloads (it rate-limits).
"""
import argparse, hashlib, json, sys, time, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
MANIFEST = HERE / "manifest.json"
OUT = ROOT / "data" / "earth" / "instruments"
UA = "GravitunesInstrumentLibrary/0.1 (open-source sonification project)"
ALLOWED = ("CC0", "CC BY", "Iowa MIS")  # CC BY covers CC BY-SA; NC/ND/Sampling+ are refused below
REFUSED = ("NC", "ND", "Sampling", "GFDL")


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
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while block := r.read(1 << 16):
                    f.write(block)
            tmp.replace(dest)
            return
        except urllib.error.HTTPError as err:
            if err.code != 429 or attempt == 3:
                raise
            time.sleep(30 * (attempt + 1))


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
    a = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
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
