#!/usr/bin/env python3
"""Build each demo as ONE self-contained HTML file in dist/ (open from file://, no server).

    python3 app/tools/build-standalone.py               # all modes in app/modes/index.json
    python3 app/tools/build-standalone.py --mode ozone-probe --every 6

How it works: CSS is inlined; ES modules are stored as text and loaded as blob: URLs with their
import specifiers rewritten; data files (grids, JSON) are stored in a virtual file table and served
by a small fetch() override; images and video become data: URLs. The served app is not changed.
Grids are subsampled in time (--every N hours) to keep each file WhatsApp-sized.
"""
import argparse
import base64
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
SKIP = {'storm-watch': '48 full-size PNG frames (~25 MB) plus 2.3 MB of tracks; too big for one file'}
DEFAULT_EVERY = 3  # a mode can override with "standalone": {"every": N} in mode.json
DROP_SOURCES = ('.mp4',)
FIRST = ['synth-lab', 'timbre-atlas']  # gallery order, as in app/core/switcher.js orderModes()


def order_modes(modes):
    rank = lambda m: FIRST.index(m['id']) if m['id'] in FIRST else len(FIRST)
    return sorted(modes, key=rank)  # stable: the rest keep index.json order


def one_line(d):
    m = re.match(r'^.*?[.!?](\s|$)', d or '')
    return (m.group(0) if m else (d or '')).strip()


def switcher_js(all_modes, mid):
    """Globals read by app/core/switcher.js: the demo list (bundled files) and the current demo."""
    lst = [{'id': m['id'], 'name': m['name'], 'description': m.get('description', ''), 'file': f"{m['id']}.html"}
           for m in order_modes(all_modes) if m['id'] not in SKIP]
    return f'window.__GT_MODES__ = {json.dumps(lst)}; window.__GT_CURRENT__ = {json.dumps(mid)};'


def extra_files(m):
    """mode.json "standalone": {"files": [repo globs]} -> virtual files (JSON/text only)."""
    out = {}
    for pat in ((m.get('standalone') or {}).get('files') or []):
        for p in sorted(ROOT.glob(pat)):
            if p.is_file():
                out[key_of(p)] = {'text': p.read_text(), 'type': mimetypes.guess_type(str(p))[0] or 'text/plain'}
    return out  # precipitation-ball: keep the 2.8 MB webm, drop the 30 MB mp4


def data_root(arg):
    if arg:
        return Path(arg).resolve()
    d = ROOT / 'data'
    if any((d / 'nasa-svs').glob('*/web/*.bin')):
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


def runtime(files, mods, entry_key, extra_js=''):
    """Inline <script> that installs the fetch override and starts the module graph."""
    payload = json.dumps({'files': files, 'mods': mods}).replace('</', '<\\/')
    return f'''<script id="gt-bundle" type="application/json">{payload}</script>
<script>
(() => {{
  const B = JSON.parse(document.getElementById('gt-bundle').textContent);
  {extra_js}
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
    if (f.b64 != null) {{
      const s = atob(f.b64), a = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
      return new Response(a, {{ status: 200, headers: {{ 'Content-Type': 'application/octet-stream' }} }});
    }}
    return new Response(f.text, {{ status: 200, headers: {{ 'Content-Type': f.type || 'text/plain' }} }});
  }};
  const urls = {{}}, busy = new Set();
  const url = (k) => {{ if (busy.has(k) && !urls[k]) throw new Error('import cycle at ' + k); busy.add(k); return urls[k] || (urls[k] = URL.createObjectURL(new Blob(
    [B.mods[k].replace(/@@GT:(.*?)@@/g, (_, d) => url(d))], {{ type: 'text/javascript' }}))); }};
  {"import(url(" + json.dumps(entry_key) + ")).catch((e) => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'Error: ' + e.message; });" if entry_key else ''}
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
    body = b''.join(raw[i * n:(i + 1) * n] for i in keep)
    base = f'/data/nasa-svs/{ds}/web/{ds}_256x128'
    out[base + '.json'] = {'text': json.dumps(h), 'type': 'application/json'}
    out[base + '.bin'] = {'b64': base64.b64encode(body).decode()}
    return out


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


def build_host_mode(m, data, every, link_map, all_modes):
    mid = m['id']
    datasets = m.get('datasets')
    ids = [str(d) for d in datasets] if isinstance(datasets, list) else ['5152']
    files = {}
    for ds in ids:
        own = (m.get('datasetDirs') or {}).get(ds)
        # A mode that ships its own copy of a dataset (mode.json datasetDirs) is bundled whole and not
        # subsampled: its extra layers (e.g. flow) are frame-aligned with the grid. Keys match host.js URLs.
        g = own_files(MODES / mid / own, f'/modes/{mid}/{own}') if own else grid_files(data, ds, every)
        if g is None:
            print(f'  ! {mid}: no grid for dataset {ds} in {data}', file=sys.stderr)
            return None
        files.update(g)
        desc = ROOT / 'data-tools' / 'datasets' / f'{ds}.json'
        if desc.is_file():
            files[f'/data-tools/datasets/{ds}.json'] = {'text': desc.read_text(), 'type': 'application/json'}
    files['/data-tools/datasets/index.json'] = {'text': json.dumps({'ids': ids}), 'type': 'application/json'}
    files[f'/modes/{mid}/mode.json'] = {'text': (MODES / mid / 'mode.json').read_text(), 'type': 'application/json'}
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
<p class="lead">NASA Earth data you can hear. Start with the Tone lab to hear the instruments, then the Timbre atlas, then the data demos.
Each demo is one self-contained file that works offline; every demo has a menu at the top to switch to the others.</p>
<ul class="demos">
{items}
</ul>
<p class="note"><strong>On iPhone:</strong> WhatsApp's preview does not run the demo. Save the file
(Share, Save to Files), then open it from the Files app so it opens in Safari. On a computer, open it in Chrome, Safari, Firefox or Edge.
Tap "Start sound" first; check that the phone is not on silent. Grids are sampled every {every} hours or more to keep the files small;
recorded instrument samples are left out (the Tone lab uses their analysed tones instead).{skipped}</p>
</body></html>
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--mode', help='build one mode id')
    ap.add_argument('--every', type=int, help='keep every Nth hourly frame (default: mode.json standalone.every, else 3)')
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
        try:
            page = build_page_mode(m, link_map, all_modes) if m.get('href') else build_host_mode(m, data, a.every or (m.get('standalone') or {}).get('every') or DEFAULT_EVERY, link_map, all_modes)
        except Exception as e:  # keep going; report
            print(f'FAIL  {mid}: {e}')
            continue
        if page is None:
            print(f'skip  {mid}: data missing')
            continue
        f = out / f'{mid}.html'
        f.write_text(page)
        size = f.stat().st_size / 1e6
        print(f'built {f.relative_to(ROOT) if f.is_relative_to(ROOT) else f}  {size:.1f} MB' + ('  (over 10 MB!)' if size > 10 else ''))
        built.append(m)

    existing = [m for m in order_modes(all_modes) if (out / f"{m['id']}.html").is_file()]
    items = '\n'.join(
        f'<li class="card"><h2>{html.escape(m["name"])}</h2>'
        f'<p>{html.escape(one_line(m.get("description", "")))}</p>'
        f'<p class="links"><a class="open" href="{m["id"]}.html" aria-label="Open {html.escape(m["name"])}">Open</a> '
        f'<a href="{m["id"]}.html" download aria-label="Download {html.escape(m["name"])}">Download</a> '
        f'<span class="size">{(out / (m["id"] + ".html")).stat().st_size / 1e6:.1f} MB</span></p></li>'
        for m in existing)
    (out / 'index.html').write_text(INDEX.format(items=items, every=a.every or DEFAULT_EVERY, skipped=''.join(
        f' {html.escape(m["name"])} is only in the online version ({html.escape(SKIP[m["id"]])}).' for m in all_modes if m['id'] in SKIP)))
    print(f'index {out / "index.html"}  ({len(existing)} demos)')


if __name__ == '__main__':
    main()
