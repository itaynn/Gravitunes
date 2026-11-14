// ctx.panel (labeled accessible controls) and ctx.describe (aria-live announcements).

let uid = 0;
const id = (p) => `${p}-${++uid}`;

export function createPanel(root) {
  function wrap(label, control, hint) {
    const row = document.createElement('div');
    row.className = 'control';
    const lab = document.createElement('label');
    lab.textContent = label; lab.htmlFor = control.id = control.id || id('c');
    row.append(lab, control);
    if (hint) {
      const h = document.createElement('p'); h.className = 'hint'; h.id = id('h'); h.textContent = hint;
      control.setAttribute('aria-describedby', h.id); row.append(h);
    }
    root.append(row);
    return row;
  }
  const rows = [];
  const api = {
    button(label, onClick, { hint } = {}) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.addEventListener('click', onClick);
      const row = document.createElement('div'); row.className = 'control'; row.append(b);
      if (hint) {
        const h = document.createElement('p'); h.className = 'hint'; h.id = id('h'); h.textContent = hint;
        b.setAttribute('aria-describedby', h.id); row.append(h);
      }
      root.append(row); rows.push(row);
      return b;
    },
    slider(label, { min = 0, max = 1, step = 0.01, value = min, hint, format } = {}, onInput) {
      const s = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value });
      const sync = () => format && s.setAttribute('aria-valuetext', format(+s.value));
      s.addEventListener('input', () => { sync(); onInput?.(+s.value); });
      sync(); rows.push(wrap(label, s, hint));
      s.update = (v) => { s.value = v; sync(); };
      return s;
    },
    select(label, options, onChange, { value, hint } = {}) {
      const s = document.createElement('select');
      for (const o of options) {
        const [v, t] = Array.isArray(o) ? o : [o, o];
        s.append(new Option(t, v, false, v === value));
      }
      s.addEventListener('change', () => onChange?.(s.value));
      rows.push(wrap(label, s, hint));
      return s;
    },
    checkbox(label, checked, onChange, { hint } = {}) {
      const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
      c.addEventListener('change', () => onChange?.(c.checked));
      const row = wrap(label, c, hint); row.classList.add('inline'); rows.push(row);
      return c;
    },
    text(content) {
      const p = document.createElement('p'); p.textContent = content; root.append(p); rows.push(p);
      return p;
    },
    clear() { rows.splice(0).forEach((r) => r.remove()); },
  };
  return api;
}

// The same "start sound first" hint in every mode: `Press "Start sound", then <next>`.
export function soundHint(panel, sound, next) {
  if (sound.started) return null;
  const p = panel.text(`Press "Start sound", then ${next}`);
  p.classList.add('hint');
  return p;
}

// Polite live region; repeated calls within `minGap` ms are coalesced so screen readers keep up.
// Urgent text goes to a second, fixed assertive region (created next to `region`): screen readers only honour
// the aria-live value a region had when they first saw it, so one region cannot switch politeness.
export function createDescribe(region, { minGap = 400 } = {}) {
  let last = 0, timer = null, pending = '', target = region;
  region.setAttribute('aria-live', 'polite');
  const loud = document.createElement('div');
  loud.className = region.className; loud.setAttribute('aria-live', 'assertive'); loud.setAttribute('aria-atomic', 'true');
  region.after(loud);
  function flush() {
    timer = null; last = performance.now();
    const el = target, other = el === region ? loud : region;
    el.textContent = ''; other.textContent = '';
    // Re-set on next frame so identical text is still announced.
    requestAnimationFrame(() => { el.textContent = pending; });
  }
  return function describe(text, { urgent = false } = {}) {
    pending = String(text);
    target = urgent ? loud : region;
    const wait = minGap - (performance.now() - last);
    if (wait <= 0 && !timer) flush();
    else if (!timer) timer = setTimeout(flush, Math.max(0, wait));
  };
}

// Move already-created panel controls (or their rows) into a collapsed <details> group placed where the first one was.
export function fold(summary, controls, { open = false } = {}) {
  const rows = controls.map((c) => c.closest?.('.control') || c);
  const d = document.createElement('details');
  d.open = open;
  const sm = document.createElement('summary'); sm.textContent = summary;
  rows[0].before(d); d.append(sm, ...rows);
  return d;
}

// Hover throttle: ready(force) is true at most once every `ms` milliseconds (always when force is set),
// so fast sweeps do not pile up notes and announcements.
export function throttle(ms = 150, now = () => performance.now()) {
  let last = -Infinity;
  return (force = false) => {
    const t = now();
    if (!force && t - last < ms) return false;
    last = t;
    return true;
  };
}

// The shared "Timbre" menu plus a "Single voice" menu shown only when 'single' is chosen.
// options: [[id, label], ...]; instruments: id -> { label }. onChange({ timbre, single }) runs on every change.
export function timbreControl(panel, { options, value, single, instruments, onChange }) {
  const state = { timbre: value, single: single ?? Object.keys(instruments)[0] };
  const timbre = panel.select('Timbre', options, (v) => { state.timbre = v; row.hidden = v !== 'single'; onChange?.({ ...state }); },
    { value: state.timbre });
  const singleSel = panel.select('Single voice', Object.keys(instruments).map((k) => [k, instruments[k]?.label || k]),
    (v) => { state.single = v; onChange?.({ ...state }); }, { value: state.single });
  const row = singleSel.closest('.control');
  row.hidden = state.timbre !== 'single';
  return { timbre, single: singleSel };
}
