#!/usr/bin/env python3
"""Build each demo as ONE self-contained HTML file in dist/ (open from file://, no server).

    python3 app/tools/build-standalone.py               # all modes in app/modes/index.json
    python3 app/tools/build-standalone.py --mode explore --variant light

How it works: CSS is inlined; ES modules are stored as text and loaded as blob: URLs with their
import specifiers rewritten; data files (grids, JSON) are stored in a virtual file table and served
by a small fetch() override; images and video become data: URLs. The served app is not changed.
Every hourly frame is kept. Datasets exported with `gravitunes_data export-hd` ship two variants:
  <mode>.html     light: value grid at 256x128 (6-bit), every hour, painted with the colour bar (~10 MB);
  <mode>-hd.html  hd: the original SVS frames (1024x512 WebP) + a 512x256 value grid, every hour (larger).
--variant light|hd|both picks which to build (default both). --every N still thins old raw grids (and says so).
"""
import argparse
import base64
import gzip
import html
import json
import mimetypes
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'dist'
MODES = ROOT / 'app' / 'modes'
SKIP = {}
DEFAULT_EVERY = 1  # never drop hours unless asked (--every N, or "standalone": {"every": N} for raw grids only)
DROP_SOURCES = ('.mp4',)
FIRST = ['synth-lab', 'world-orchestra']  # gallery order, as in app/core/switcher.js orderModes()


REDIRECT = ('<!doctype html><meta charset="utf-8"><title>{name}</title>'
            '<meta http-equiv="refresh" content="0; url={to}"><a href="{to}">{name}</a>')
# Merged demos: old dist file -> (new file, title). Same map as REDIRECTS in app/core/host.js.
REDIRECTS = {'timbre-atlas': ('world-orchestra.html?instruments=1', 'World orchestra'),
             'ozone-probe': ('explore.html', 'Explore'), 'layered-maps': ('explore.html', 'Explore'),
             'ozone-probe-hd': ('explore-hd.html', 'Explore'), 'layered-maps-hd': ('explore-hd.html', 'Explore'),
             'mapping-lab': ('explore.html', 'Explore'), 'mapping-lab-hd': ('explore-hd.html', 'Explore')}  # hidden mode


def order_modes(modes):
    rank = lambda m: FIRST.index(m['id']) if m['id'] in FIRST else len(FIRST)
    return sorted(modes, key=rank)  # stable: the rest keep index.json order


def one_line(d):
    m = re.match(r'^.*?[.!?](\s|$)', d or '')
    return (m.group(0) if m else (d or '')).strip()


def switcher_js(all_modes, mid, only=None):
    """Globals read by app/core/switcher.js: the demo list (bundled files) and the current demo.
    main() rewrites it after the build with only= the files that really exist."""
    lst = [{'id': m['id'], 'name': m['name'], 'description': m.get('description', ''), 'file': f"{m['id']}.html"}
           for m in order_modes(all_modes) if m['id'] not in SKIP and (only is None or m['id'] in only)]
    return f'window.__GT_MODES__ = {json.dumps(lst)}; window.__GT_CURRENT__ = {json.dumps(mid)};'


def extra_files(m):
    """mode.json "standalone": {"files": [repo globs]} -> virtual files (text, or base64 for binaries such as samples)."""
    out = {}
    for pat in ((m.get('standalone') or {}).get('files') or []):
        for p in sorted(ROOT.glob(pat)):
            if p.is_file() and p.suffix in ('.json', '.txt', '.csv', '.md'):
                out[key_of(p)] = {'text': p.read_text(), 'type': mimetypes.guess_type(str(p))[0] or 'text/plain'}
            elif p.is_file():  # audio samples and other binaries
                out[key_of(p)] = {'b64': base64.b64encode(p.read_bytes()).decode()}
    return out  # precipitation-ball: keep the 2.8 MB webm, drop the 30 MB mp4


def data_root(arg):
    if arg:
        return Path(arg).resolve()
    d = ROOT / 'data'
    if any((d / 'nasa-svs').glob('*/web/light/*')):  # (4285's committed grid alone doesn't count)
        return d
    try:  # in a git worktree, data/ lives in the main checkout
        common = subprocess.run(['git', 'rev-parse', '--git-common-dir'], cwd=ROOT,
                                capture_output=True, text=True, check=True).stdout.strip()
        main = (ROOT / common).resolve().parent / 'data'
        if main.is_dir():
            return main
    except Exception:
        pass
    return d


def data_url(path):
    mime = mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()


def is_local(ref):
    return ref and not re.match(r'^([a-z]+:|//|#)', ref, re.I)


def repo_path(ref, base_dir):
    """Repo-absolute path ('/app/core/x.js') of a reference from a file in base_dir."""
    ref = ref.split('?')[0].split('#')[0]
    p = (ROOT / ref.lstrip('/')) if ref.startswith('/') else (base_dir / ref)
    return p.resolve()


def key_of(p):
    return '/' + p.relative_to(ROOT).as_posix()


# ---- ES modules -> blob loader ---------------------------------------------------------------
SPEC = re.compile(r"""(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+?\.m?js)\2""")


def collect_modules(entry, patches=None):
    """Returns {key: source} for entry and everything it imports; specifiers become @@GT:key@@."""
    patches = patches or {}
    mods, todo = {}, [entry.resolve()]
    while todo:
        p = todo.pop()
        k = key_of(p)
        if k in mods:
            continue
        src = p.read_text()
        for old, new in patches.get(k, []):
            if old not in src:
                raise RuntimeError(f'patch for {k} no longer matches: {old!r}')
            src = src.replace(old, new)

        def sub(m):
            line = src[src.rfind('\n', 0, m.start()) + 1:m.start()].lstrip()
            if not is_local(m.group(3)) or line.startswith(('*', '//', '/*')) or line.rstrip().endswith('{'):
                return m.group(0)  # JSDoc type imports and comments are not real imports
            dep = repo_path(m.group(3), p.parent)
            if not dep.is_file():
                return m.group(0)
            todo.append(dep)
            return f'{m.group(1)}{m.group(2)}@@GT:{key_of(dep)}@@{m.group(2)}'
        mods[k] = SPEC.sub(sub, src)
    return mods


def pack(files):
    """Gzip larger text files (base maps, JSON) in the bundle: the fetch override inflates them (DecompressionStream)."""
    out = {}
    for k, f in files.items():
        if f.get('text') is not None and len(f['text']) > 4096:
            f = {'gz': base64.b64encode(gzip.compress(f['text'].encode(), 9, mtime=0)).decode(), 'type': f.get('type')}
        out[k] = f
    return out


def runtime(files, mods, entry_key, extra_js=''):
    """Inline <script> that installs the fetch override and starts the module graph."""
    # Module sources travel as one gzipped JSON (inflated before the first import).
    gzmods = base64.b64encode(gzip.compress(json.dumps(mods).encode(), 9, mtime=0)).decode()
    payload = json.dumps({'files': pack(files), 'mods': gzmods}).replace('</', '<\\/')
    return f'''<script id="gt-bundle" type="application/json">{payload}</script>
<script>
(() => {{
  const B = JSON.parse(document.getElementById('gt-bundle').textContent);
  {extra_js}
  const bytes = (b) => {{ const s = atob(b), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }};
  const inflate = (b) => new Blob([bytes(b)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const keys = Object.keys(B.files).sort((a, b) => b.length - a.length);
  const find = (u) => {{
    let p; try {{ p = decodeURIComponent(new URL(u, location.href).pathname); }} catch {{ return null; }}
    return keys.find((k) => p.endsWith(k)) || null;
  }};
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (input, init) => {{
    const u = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (/^(https?:|data:|blob:)/.test(u) && !u.startsWith(location.origin + '/')) return realFetch(input, init);
    const k = find(u);
    if (!k) return new Response('not in bundle', {{ status: 404 }});
    const f = B.files[k];
    if (f.gz != null) return new Response(inflate(f.gz), {{ status: 200, headers: {{ 'Content-Type': f.type || 'text/plain' }} }});
    if (f.b64 != null) return new Response(bytes(f.b64), {{ status: 200, headers: {{ 'Content-Type': 'application/octet-stream' }} }});
    return new Response(f.text, {{ status: 200, headers: {{ 'Content-Type': f.type || 'text/plain' }} }});
  }};
  const urls = {{}}, busy = new Set();
  let mods = {{}};
  const url = (k) => {{ if (busy.has(k) && !urls[k]) throw new Error('import cycle at ' + k); busy.add(k); return urls[k] || (urls[k] = URL.createObjectURL(new Blob(
    [mods[k].replace(/@@GT:(.*?)@@/g, (_, d) => url(d))], {{ type: 'text/javascript' }}))); }};
  {"new Response(inflate(B.mods)).json().then((m) => { mods = m; return import(url(" + json.dumps(entry_key) + ")); }).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Error: ' + e.message; });" if entry_key else ''}
}})();
</script>'''


# ---- HTML inlining ---------------------------------------------------------------------------
def inline_html(page, link_map, drop_sources=()):
    """Inline CSS, classic scripts and media of an HTML page. Returns (html, module_entry_or_None)."""
    text, base = page.read_text(), page.parent
    entry = None

    def css(m):
        ref = re.search(r'href="([^"]+)"', m.group(0)).group(1)
        if not is_local(ref):
            return m.group(0)
        return f'<style>\n{repo_path(ref, base).read_text()}\n</style>'
    text = re.sub(r'<link[^>]*rel="stylesheet"[^>]*>', css, text)

    classic = []

    def script(m):
        nonlocal entry
        tag = m.group(0)
        ref = re.search(r'src="([^"]+)"', tag).group(1)
        if not is_local(ref):
            return tag
        if 'type="module"' in tag:
            entry = repo_path(ref, base)
            return ''
        classic.append(repo_path(ref, base).read_text().replace('</script', '<\\/script'))
        return ''
    text = re.sub(r'<script\b[^>]*\bsrc="[^"]+"[^>]*>\s*</script>', script, text)
    # Classic `defer` scripts run after parsing: append them at the end of <body>.
    text = text.replace('</body>', ''.join(f'<script>\n{s}\n</script>\n' for s in classic) + '</body>')

    def source(m):
        ref = m.group(2)
        if not is_local(ref):
            return m.group(0)
        if ref.split('?')[0].endswith(drop_sources):
            return '<!-- dropped -->' if m.group(0).startswith('<source') else m.group(0)
        p = repo_path(ref, base)
        return m.group(0).replace(m.group(1), f'src="{data_url(p)}"') if p.is_file() else m.group(0)
    text = re.sub(r'<source\b[^>]*?(src="([^"]+)")[^>]*>', source, text)
    text = re.sub(r'<img\b[^>]*?(src="([^"]+)")[^>]*>', source, text)

    def anchor(m):
        ref = m.group(2)
        if not is_local(ref):
            return m.group(0)
        p = repo_path(ref, base)
        name = link_map.get(p)
        # Links to other demos point at their bundled file; anything else is not bundled.
        if name:
            return f'{m.group(1)}href="{name}"{m.group(3)}{m.group(4)}</a>'
        # Not bundled: plain text instead of a dead link.
        return f'<span>{m.group(4)} (not in the offline file)</span>'
    text = re.sub(r'(<a\b[^>]*?)href="([^"]+)"([^>]*>)(.*?)</a>', anchor, text, flags=re.S)
    return text, entry


# ---- grids ----------------------------------------------------------------------------------
def b64_file(p):
    return {'b64': base64.b64encode(p.read_bytes()).decode()}


def variant_files(data, ds, variant):
    """Files from `gravitunes_data export-hd`: web/light/ or web/hd/ (+ 1024 px SVS frames for hd). None if missing."""
    web = data / 'nasa-svs' / ds / 'web'
    sub = web / variant
    if not sub.is_dir():
        return None
    base = f'/data/nasa-svs/{ds}/web/'
    out = {}
    for p in sorted(sub.iterdir()):
        out[base + p.name] = ({'text': p.read_text(), 'type': 'application/json'} if p.suffix == '.json' else b64_file(p))
    if variant == 'hd':
        man = web / 'frames_1024.json'
        if not man.is_file():
            return None
        m = json.loads(man.read_text())
        out[base + 'frames.json'] = {'text': json.dumps(m), 'type': 'application/json'}
        for f in m['frames']:
            out[base + f['file']] = b64_file(web / f['file'])
        if m.get('colorbar') and (web / m['colorbar']).is_file():
            out[base + m['colorbar']] = b64_file(web / m['colorbar'])
    return out


def grid_files(data, ds, every):
    out = {}
    web = data / 'nasa-svs' / ds / 'web'
    hdr, binp = web / f'{ds}_256x128.json', web / f'{ds}_256x128.bin'
    if not (hdr.is_file() and binp.is_file()):
        return None
    h = json.loads(hdr.read_text())
    w, hh = h.get('dims') or [h['width'], h['height']]
    n = w * hh
    raw = binp.read_bytes()
    frames = h.get('frames') or len(raw) // n
    keep = list(range(0, frames, every))
    h['frames'] = len(keep)
    if h.get('times'):
        h['times'] = [h['times'][i] for i in keep]
    h['subsampled_every'] = every
    if every > 1:
        print(f'  note: {ds} raw grid thinned to every {every} hours ({len(keep)} of {frames} frames)')
    body = b''.join(raw[i * n:(i + 1) * n] for i in keep)
    base = f'/data/nasa-svs/{ds}/web/{ds}_256x128'
    out[base + '.json'] = {'text': json.dumps(h), 'type': 'application/json'}
    out[base + '.bin'] = {'b64': base64.b64encode(body).decode()}
    return out


def committed_files(ds):
    """A dataset grid committed in this checkout (data/nasa-svs/4285/web/), bundled as is. None if missing."""
    return own_files(ROOT / 'data' / 'nasa-svs' / ds / 'web', f'/data/nasa-svs/{ds}/web/')


def own_files(folder, prefix):
    if not folder.is_dir():
        return None
    out = {}
    for p in sorted(folder.rglob('*')):
        if p.is_file():
            k = prefix.rstrip('/') + '/' + p.relative_to(folder).as_posix()
            out[k] = ({'text': p.read_text(), 'type': mimetypes.guess_type(str(p))[0] or 'text/plain'}
                      if p.suffix in ('.json', '.txt', '.csv') else {'b64': base64.b64encode(p.read_bytes()).decode()})
    return out


def build_host_mode(m, data, every, link_map, all_modes, variant='light'):
    mid = m['id']
    datasets = m.get('datasets')
    ids = [str(d) for d in datasets] if isinstance(datasets, list) else ['5152']
    # The -hd variant only exists for modes that show export-hd datasets (not their own copies, not data: false);
    # their other datasets (e.g. 4285, no HD export) use the light grid in it.
    if variant == 'hd' and (m.get('data') is False or not any(
            not (m.get('datasetDirs') or {}).get(ds) and variant_files(data, ds, 'hd') is not None for ds in ids)):
        return None
    files = {}
    for ds in ids:
        own = (m.get('datasetDirs') or {}).get(ds)
        # A mode that ships its own copy of a dataset (mode.json datasetDirs) is bundled whole and not
        # subsampled: its extra layers (e.g. flow) are frame-aligned with the grid. Keys match host.js URLs.
        g = (own_files(MODES / mid / own, f'/modes/{mid}/{own}') if own else
             variant_files(data, ds, variant) or variant_files(data, ds, 'light') or grid_files(data, ds, every)
             or committed_files(ds))
        if g is None:
            print(f'  ! {mid}: no grid for dataset {ds} in {data}', file=sys.stderr)
            return None
        files.update(g)
        desc = ROOT / 'data-tools' / 'datasets' / f'{ds}.json'
        if desc.is_file():
            files[f'/data-tools/datasets/{ds}.json'] = {'text': desc.read_text(), 'type': 'application/json'}
    files['/data-tools/datasets/index.json'] = {'text': json.dumps({'ids': ids}), 'type': 'application/json'}
    files[f'/modes/{mid}/mode.json'] = {'text': (MODES / mid / 'mode.json').read_text(), 'type': 'application/json'}
    files.update(extra_files(m))  # mode.json standalone.files, e.g. the instrument samples
    # data/earth/*.json is tracked: prefer this checkout's copy (falls back to the data root).
    earth = {p.name: p for p in sorted((data / 'earth').glob('*.json'))}
    earth.update({p.name: p for p in sorted((ROOT / 'data' / 'earth').glob('*.json'))})
    for p in earth.values():
        files[f'/data/earth/{p.name}'] = {'text': p.read_text(), 'type': 'application/json'}

    patches = {'/app/core/host.js': [
        ("const modeName = params.get('mode') || '_template';",
         "const modeName = window.__GT_MODE__ || params.get('mode') || '_template';"),
        ("import(new URL('main.js', base))", f"import('../modes/{mid}/main.js')"),
    ]}
    page, entry = inline_html(ROOT / 'app' / 'mode.html', link_map)
    mods = collect_modules(entry, patches)
    rt = runtime(files, mods, key_of(entry), extra_js=f'window.__GT_MODE__ = {json.dumps(mid)}; ' + switcher_js(all_modes, mid))
    return page.replace('</body>', rt + '\n</body>')


def build_page_mode(m, link_map, all_modes):
    page = repo_path(m['href'], MODES / m['id'])
    text, entry = inline_html(page, link_map, DROP_SOURCES)
    if entry:
        mods = collect_modules(entry)
        text = text.replace('</body>', runtime(extra_files(m), mods, key_of(entry), switcher_js(all_modes, m['id'])) + '\n</body>')
    return text


INDEX = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gravitunes demos</title>
<style>:root{{--bg:#111418;--fg:#f2f2f2;--muted:#b8bec6;--accent:#ffd34d;--panel:#1d2229;color-scheme:dark}}
body{{font:17px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:24px 16px 48px;background:var(--bg);color:var(--fg)}}
h1{{margin:.2em 0}} a{{color:var(--accent)}} .lead{{color:var(--muted);max-width:60ch}}
.demos{{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}}
.card{{background:var(--panel);border:1px solid #2c333d;border-radius:10px;padding:14px 18px;display:flex;flex-direction:column}}
.card h2{{font-size:1.15rem;margin:0 0 .3em}} .card h2 a{{color:var(--fg);text-decoration:none}} .card p{{margin:.2em 0;flex:1}}
.links{{display:flex;gap:12px;align-items:center;flex:0 !important;margin-top:.6em !important}}
.open{{background:var(--accent);color:#000;font-weight:600;padding:.25em .9em;border-radius:6px;text-decoration:none}}
.size{{color:var(--muted);font-size:.85em;margin-left:auto}}
.note{{background:var(--panel);padding:.8rem 1rem;border-radius:.5rem;color:var(--muted)}}
:focus-visible{{outline:3px solid var(--accent);outline-offset:3px}}</style>
</head><body>
<h1>Gravitunes demos</h1>
<p class="lead">NASA Earth data you can hear. Start with the Tone lab to hear the instruments, then the World orchestra, then the data demos.
Each demo is one self-contained file that works offline; every demo has a menu at the top to switch to the others.</p>
<ul class="demos">
{items}
</ul>
<p class="note"><strong>On iPhone:</strong> WhatsApp's preview does not run the demo. Save the file
(Share, Save to Files), then open it from the Files app so it opens in Safari. On a computer, open it in Chrome, Safari, Firefox or Edge.
Tap "Sound" first; check that the phone is not on silent. Every hour is kept: the plain files use a coarser map to stay small,
and the "HD" files show the original NASA frames (bigger downloads);
recorded instrument samples are left out (the Tone lab uses their analysed tones instead).{skipped}</p>
</body></html>
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--mode', help='build one mode id')
    ap.add_argument('--every', type=int, help='thin raw grids to every Nth hour (default 1: keep all; export-hd grids are never thinned)')
    ap.add_argument('--variant', choices=['light', 'hd', 'both'], default='both',
                    help='light: <mode>.html (~10 MB, every hour, coarse); hd: <mode>-hd.html (SVS frames, larger); default both')
    ap.add_argument('--data', help='data/ folder (default: repo data/, or the main checkout\'s in a worktree)')
    ap.add_argument('--out', default=str(DIST), help='output folder (default dist/)')
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    data = data_root(a.data)
    modes = json.loads((MODES / 'index.json').read_text())['modes']
    if a.mode:
        modes = [m for m in modes if m['id'] == a.mode]
        if not modes:
            raise SystemExit(f'unknown mode {a.mode}')
    # Links between demos inside the bundle: gallery -> index.html, mode folders -> <id>.html.
    all_modes = json.loads((MODES / 'index.json').read_text())['modes']
    link_map = {ROOT / 'app': 'index.html', ROOT / 'app' / 'index.html': 'index.html'}
    for m in all_modes:
        if m['id'] not in SKIP:
            link_map[MODES / m['id']] = f"{m['id']}.html"

    built = []
    for m in modes:
        mid = m['id']
        if mid in SKIP:
            print(f'skip  {mid}: {SKIP[mid]}')
            continue
        variants = ['light'] if m.get('href') else (['light', 'hd'] if a.variant == 'both' else [a.variant])
        for variant in variants:
            try:
                page = build_page_mode(m, link_map, all_modes) if m.get('href') else build_host_mode(
                    m, data, a.every or DEFAULT_EVERY, link_map, all_modes, variant)
            except Exception as e:  # keep going; report
                print(f'FAIL  {mid} ({variant}): {e}')
                continue
            if page is None:
                if variant == 'light':
                    print(f'skip  {mid}: data missing')
                continue
            f = out / f"{mid}{'-hd' if variant == 'hd' else ''}.html"
            f.write_text(page)
            size = f.stat().st_size / 1e6
            print(f'built {f.relative_to(ROOT) if f.is_relative_to(ROOT) else f}  {size:.1f} MB'
                  + ('  (over 10 MB!)' if size > 10 and variant == 'light' else ''))
            built.append(m)

    # Merged demos: keep old dist/<id>.html links working (timbre-atlas, ozone-probe, layered-maps).
    for old, (to, name) in REDIRECTS.items():
        if (out / to.split('?')[0]).is_file():
            (out / f'{old}.html').write_text(REDIRECT.format(to=to, name=name))
    existing = [m for m in order_modes(all_modes) if (out / f"{m['id']}.html").is_file()]
    # Second pass: the switcher in each built page lists only demos whose files exist.
    have = {m['id'] for m in existing}
    for m in existing:
        for f in (out / f"{m['id']}.html", out / f"{m['id']}-hd.html"):
            if not f.is_file():
                continue
            txt = f.read_text()
            old, new = switcher_js(all_modes, m['id']), switcher_js(all_modes, m['id'], have)
            if old != new and old in txt:
                f.write_text(txt.replace(old, new))
    mb = lambda name: (out / name).stat().st_size / 1e6

    def hd_link(m):
        name = f"{m['id']}-hd.html"
        if not (out / name).is_file():
            return ''
        return (f'<a href="{name}" aria-label="Open {html.escape(m["name"])} in high resolution, {mb(name):.0f} MB">HD</a> '
                f'<span class="size">HD {mb(name):.0f} MB</span>')
    items = '\n'.join(
        f'<li class="card"><h2>{html.escape(m["name"])}</h2>'
        f'<p>{html.escape(m.get("summary") or one_line(m.get("description", "")))}</p>'
        f'<p class="links"><a class="open" href="{m["id"]}.html" aria-label="Open {html.escape(m["name"])}">Open</a> '
        f'<a href="{m["id"]}.html" download aria-label="Download {html.escape(m["name"])}">Download</a> '
        f'<span class="size">{mb(m["id"] + ".html"):.1f} MB</span> {hd_link(m)}</p></li>'
        for m in existing)
    (out / 'index.html').write_text(INDEX.format(items=items, skipped=''.join(
        f' {html.escape(m["name"])} is only in the online version ({html.escape(SKIP[m["id"]])}).' for m in all_modes if m['id'] in SKIP)))
    print(f'index {out / "index.html"}  ({len(existing)} demos)')


if __name__ == '__main__':
    main()
