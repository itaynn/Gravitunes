// Demo switcher: "All demos" link + a dropdown of every demo in app/modes/index.json, on every page.
// Mounts itself into #gt-switcher (or at the top of <body>) when imported in a browser.
// Standalone builds set window.__GT_MODES__ ([{id, name, description, file}]) and window.__GT_CURRENT__;
// the dropdown then switches between the built dist/*.html files.

// Gallery order: the tone lab, then the world orchestra (instruments map), then the data demos as listed.
export const FIRST = ['synth-lab', 'world-orchestra'];
export function orderModes(modes) {
  const rank = (m) => (FIRST.includes(m.id) ? FIRST.indexOf(m.id) : FIRST.length);
  return modes.map((m, i) => [m, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([m]) => m);
}

// First sentence of a description, for one-line summaries.
export const oneLine = (d = '') => (d.match(/^.*?[.!?](\s|$)/)?.[0] || d).trim();

// Served URL of a mode page, relative to the app root (app/).
export function modeHref(m, appRoot) {
  return m.href ? new URL(`modes/${m.id}/${m.href}`, appRoot).href : new URL(`mode.html?mode=${encodeURIComponent(m.id)}`, appRoot).href;
}

function currentId() {
  if (window.__GT_CURRENT__) return window.__GT_CURRENT__;
  const q = new URLSearchParams(location.search).get('mode');
  if (q) return q;
  return location.pathname.match(/\/modes\/([\w-]+)\//)?.[1] || null;
}

async function demoList() {
  if (Array.isArray(window.__GT_MODES__)) {
    return { modes: window.__GT_MODES__.map((m) => ({ ...m, url: m.file })), home: 'index.html' };
  }
  const appRoot = new URL('../', import.meta.url);
  const { modes } = await (await fetch(new URL('modes/index.json', appRoot))).json();
  return { modes: orderModes(modes).map((m) => ({ ...m, url: modeHref(m, appRoot) })), home: appRoot.href };
}

// Self-contained styles, so the bar looks the same on pages that do not load core/style.css (itay's pages).
const CSS = `.gt-switcher{display:flex;flex-wrap:wrap;align-items:center;gap:.4em .8em;padding:8px 16px;
background:#1d2229;color:#f2f2f2;font:15px/1.4 system-ui,sans-serif;border-bottom:1px solid #2c333d;position:relative;z-index:50}
.gt-switcher a{color:#ffd34d;font-weight:600}
.gt-switcher button{font:inherit;padding:.25em .8em;border-radius:4px;background:#ffd34d;color:#000;border:0;font-weight:600;cursor:pointer}
.gt-switcher button:disabled{opacity:.5;cursor:default}
.gt-switcher select{font:inherit;padding:.25em .5em;border-radius:4px;background:#2b323b;color:#f2f2f2;border:1px solid #b8bec6;max-width:100%}
.gt-switcher .gt-demo-desc{color:#b8bec6;font-size:.9em;flex:1 1 20ch}
.gt-switcher :focus-visible{outline:3px solid #ffd34d;outline-offset:2px}
.gt-switcher .visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`;

export async function mountSwitcher(root = document.getElementById('gt-switcher')) {
  if (!document.getElementById('gt-switcher-css')) {
    document.head.append(Object.assign(document.createElement('style'), { id: 'gt-switcher-css', textContent: CSS }));
  }
  if (!root) {
    root = document.createElement('nav');
    root.id = 'gt-switcher';
    document.body.prepend(root);
  }
  root.classList.add('gt-switcher');
  if (root.tagName !== 'NAV') root.setAttribute('role', 'navigation');
  root.setAttribute('aria-label', 'Demos');
  const { modes, home } = await demoList();
  const cur = currentId();
  const all = Object.assign(document.createElement('a'), { href: home, textContent: 'All demos' });
  const label = Object.assign(document.createElement('label'), { textContent: 'Demo', htmlFor: 'gt-demo' });
  const sel = Object.assign(document.createElement('select'), { id: 'gt-demo' });
  const desc = Object.assign(document.createElement('span'), { id: 'gt-demo-desc', className: 'gt-demo-desc' });
  sel.setAttribute('aria-describedby', desc.id);
  for (const m of modes) {
    const o = new Option(m.name, m.url, m.id === cur, m.id === cur);
    o.title = oneLine(m.description);
    sel.append(o);
  }
  if (!modes.some((m) => m.id === cur)) sel.prepend(new Option('Choose a demo...', '', true, true));
  const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Go' });
  // Go is disabled while the current demo (or the placeholder) is selected, so it never silently does nothing.
  const showDesc = () => {
    desc.textContent = sel.selectedOptions[0]?.title || '';
    btn.disabled = !sel.value || !!sel.selectedOptions[0]?.defaultSelected;
  };
  showDesc();
  // Choosing only previews the description; the Go button (or Enter on the closed select) opens it,
  // so keyboard and screen-reader users can browse the list without leaving the page.
  const go = () => { if (sel.value && !sel.selectedOptions[0]?.defaultSelected) location.href = sel.value; };
  sel.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  sel.addEventListener('change', showDesc);
  btn.addEventListener('click', go);
  root.replaceChildren(all, label, sel, btn, desc);
}

if (typeof document !== 'undefined') {
  const run = () => mountSwitcher().catch((e) => console.warn('[switcher]', e.message));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
}
