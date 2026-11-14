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
// Returns the <select>.
export function scaleControl(panel, { value = 'pentatonic-major', onChange, describe, hint } = {}) {
  const start = initialScale(value);
  const ids = PLEASANT.includes(start) ? PLEASANT : [start, ...PLEASANT];
  const sel = panel.select('Scale', ids.map((id) => [id, SCALES[id].label]), (id) => {
    remember(id);
    onChange?.(id);
    describe?.(`Scale: ${SCALES[id].label}`);
  }, { value: start, hint: hint || 'Notes are picked from this scale. All of these sound calm when notes overlap.' });
  onChange?.(start);
  return sel;
}
