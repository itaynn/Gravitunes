// The shared "Scale" menu: the same pleasant scales and plain names in every mode.
// The choice is kept in the URL (?scale=) and in localStorage, and announced to screen readers.
import { SCALES, PLEASANT } from './scales.js';

const KEY = 'gravitunes-scale';

// Starting scale: ?scale= first, then the remembered choice, then the mode's own default.
export function initialScale(fallback) {
  const q = new URLSearchParams(location.search).get('scale');
  if (q && SCALES[q]) return q;
  try { const s = localStorage.getItem(KEY); if (s && SCALES[s]) return s; } catch {}
  return fallback;
}

function remember(id) {
  try { localStorage.setItem(KEY, id); } catch {}
  try {
    const u = new URL(location.href);
    u.searchParams.set('scale', id);
    history.replaceState(history.state, '', u);
  } catch {}
}

// panel: a createPanel(); onChange(id) is called at once with the starting scale and on every change.
// sound (optional): a createSound(); value-only notes then follow the menu (tuning first, then scale).
// own (optional): a label for an extra first option, value '' (onChange gets null), e.g. "Instrument's own";
// it is the default unless ?scale= or a remembered choice says otherwise. Returns the <select>.
export function scaleControl(panel, { value = 'pentatonic-major', onChange, describe, hint, sound, own } = {}) {
  const start = own ? initialScale('') : initialScale(value);
  const ids = !start || PLEASANT.includes(start) ? PLEASANT : [start, ...PLEASANT];
  const opts = ids.map((id) => [id, SCALES[id].label]);
  if (own) opts.unshift(['', own]);
  const apply = (id) => {
    if (id && sound?.useScale) sound.useScale(id).catch?.((e) => console.warn('[scale]', e.message));
    onChange?.(id || null);
  };
  // On mode pages the menu goes into the control bar (panel.bar), next to Volume.
  const sel = (panel.bar || panel).select('Scale', opts, (id) => {
    if (id) remember(id);
    apply(id);
    describe?.(`Scale: ${id ? SCALES[id].label : own}`);
  }, { value: start, hint: hint || 'Notes are picked from this scale. All of these sound calm when notes overlap.' });
  apply(start);
  return sel;
}
