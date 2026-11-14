"""Minimal, polite client for NASA's Scientific Visualization Studio (svs.gsfc.nasa.gov)."""
from __future__ import annotations

import json
import re
import shutil
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

BASE = "https://svs.gsfc.nasa.gov"
USER_AGENT = "gravitunes-data/0.1 (NASA Space Apps hackathon tool)"
MAX_WORKERS = 2


def vis_dir_url(svs_id: int | str) -> str:
    """https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005152/ for id 5152."""
    n = int(svs_id)
    return f"{BASE}/vis/a{n // 10000 * 10000:06d}/a{n // 100 * 100:06d}/a{n:06d}/"


def _request(url: str, method: str = "GET", retries: int = 4, timeout: float = 60, headers: dict | None = None):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT, **(headers or {})})
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
        time.sleep(1.5 * 2 ** attempt)
    raise ConnectionError(f"could not reach {url} after {retries} tries: {last}")


def get_json(url: str) -> dict:
    with _request(url) as r:
        return json.load(r)


def get_text(url: str) -> str:
    with _request(url) as r:
        return r.read().decode("utf-8", "replace")


def head_size(url: str) -> int | None:
    try:
        with _request(url, method="HEAD") as r:
            n = r.headers.get("Content-Length")
            return int(n) if n else None
    except Exception:
        return None


def download(url: str, dest: Path, expected_size: int | None = None) -> Path:
    """Download to dest atomically (via .part, renamed only when complete).

    Partial transfers are resumed with HTTP Range requests until the size matches Content-Length.
    """
    dest = Path(dest)
    if dest.exists() and (expected_size is None or dest.stat().st_size == expected_size):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.unlink(missing_ok=True)
    for _ in range(20):
        have = tmp.stat().st_size if tmp.exists() else 0
        hdr = {"Range": f"bytes={have}-"} if have else None
        try:
            with _request(url, headers=hdr) as r, open(tmp, "ab" if have else "wb") as f:
                if have and r.status != 206:          # server ignored Range: start over
                    f.truncate(0)
                if expected_size is None:
                    cr = r.headers.get("Content-Range")       # bytes a-b/total
                    if cr and "/" in cr:
                        expected_size = int(cr.rsplit("/", 1)[1])
                    elif r.headers.get("Content-Length") and not have:
                        expected_size = int(r.headers["Content-Length"])
                shutil.copyfileobj(r, f, 1 << 20)
        except (ConnectionError, OSError):
            pass                                     # resume on the next loop
        if expected_size is None or tmp.stat().st_size >= expected_size:
            break
    if expected_size is not None and tmp.stat().st_size != expected_size:
        tmp.unlink(missing_ok=True)
        raise IOError(f"size mismatch for {url}")
    tmp.replace(dest)
    return dest


def _download_retry(url, dest, size, tries=4):
    for i in range(tries):
        try:
            return download(url, dest, size)
        except (IOError, ConnectionError):
            if i == tries - 1:
                raise
            time.sleep(2 * 2 ** i)


def download_many(items: list[tuple[str, Path, int | None]], progress=print) -> None:
    done = 0
    with ThreadPoolExecutor(MAX_WORKERS) as ex:
        for _ in ex.map(lambda it: _download_retry(*it), items):
            done += 1
            if progress and (done % 10 == 0 or done == len(items)):
                progress(f"  downloaded {done}/{len(items)}")


class _LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def parse_listing(html: str) -> list[str]:
    """File/subfolder names from an Apache-style directory listing (no parent/sort links)."""
    p = _LinkParser()
    p.feed(html)
    out = []
    for h in p.links:
        if h.startswith(("?", "/", "http:", "https:", "#", "..")) or h in ("./",):
            continue
        out.append(h)
    return out


@dataclass
class Media:
    kind: str            # Image, Movie, Frames, ...
    url: str
    width: int | None
    height: int | None
    filename: str = ""


@dataclass
class Entry:
    svs_id: int
    title: str
    description: str
    credits: list[str]
    media: list[Media] = field(default_factory=list)

    def by_kind(self, kind: str) -> list[Media]:
        return [m for m in self.media if m.kind.lower() == kind.lower()]

    @property
    def colorbars(self) -> list[Media]:
        return [m for m in self.media if re.search(r"colou?r_?bar|legend", m.url, re.I)]


def entry(svs_id: int | str) -> Entry:
    """Metadata and media list from the SVS JSON API (https://svs.gsfc.nasa.gov/api/<id>)."""
    d = get_json(f"{BASE}/api/{int(svs_id)}")
    media = []
    for g in d.get("media_groups") or []:
        for it in g.get("items") or []:
            inst = it.get("instance", it)
            url = inst.get("url")
            if not url:
                continue
            url = url.replace("http://", "https://", 1)
            media.append(Media(inst.get("media_type", "?"), url, inst.get("width"), inst.get("height"),
                               inst.get("filename", url.rstrip("/").split("/")[-1])))
    credits = []
    for c in d.get("credits") or []:
        names = ", ".join(f"{p.get('name')} ({p.get('employer')})" if p.get("employer") else p.get("name", "")
                          for p in c.get("people") or [])
        credits.append(f"{c.get('role')}: {names}")
    desc = re.sub(r"<[^>]+>", "", d.get("description") or "").strip()
    return Entry(int(svs_id), d.get("title", ""), desc, credits, media)


def frame_files(folder_url: str) -> list[str]:
    """Full URLs of image frames inside an SVS frames folder."""
    folder_url = folder_url.rstrip("/") + "/"
    names = [n for n in parse_listing(get_text(folder_url)) if re.search(r"\.(png|tif|tiff|jpg)$", n, re.I)]
    return [folder_url + n for n in sorted(names)]
