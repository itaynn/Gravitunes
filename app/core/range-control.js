// The shared pitch range: "Low" and "High" menus (note names, C1..C7) in the control bar. Every pitch mapping in the
// mode reads range.low / range.high (semitones from C4). Kept in localStorage and announced ("Range C2 to E6").
import { RANGE_NOTES, LOW_SEMIS, HIGH_SEMIS, noteName, fixRange } from './scales.js';

const KEY = 'gravitunes-range';

function initial() {
  try {
    const [l, h] = JSON.parse(localStorage.getItem(KEY) || 'null') || [];
    if (RANGE_NOTES.includes(l) && RANGE_NOTES.includes(h)) return fixRange(l, h);
  } catch {}
  return [LOW_SEMIS, HIGH_SEMIS];
}

// panel: a createPanel() (its .bar when present); onChange({ low, high }) is called on every change.
// Returns { low, high, selects: [lowSel, highSel] }; low/high always hold the current values.
export function rangeControl(panel, { describe, onChange } = {}) {
  const [low, high] = initial();
  const range = { low, high, selects: [] };
  const opts = RANGE_NOTES.map((n) => [String(n), noteName(n)]);
  const host = panel.bar || panel;
  const set = (which) => (v) => {
    const n = Number(v);
    [range.low, range.high] = fixRange(which === 'low' ? n : range.low, which === 'high' ? n : range.high, which);
    lowSel.value = String(range.low); highSel.value = String(range.high);
    try { localStorage.setItem(KEY, JSON.stringify([range.low, range.high])); } catch {}
    onChange?.(range);
    describe?.(`Range ${noteName(range.low)} to ${noteName(range.high)}`);
  };
  const lowSel = host.select('Low', opts, set('low'), { value: String(low), hint: 'Lowest note any sound plays.' });
  const highSel = host.select('High', opts, set('high'), { value: String(high), hint: 'Highest note any sound plays.' });
  lowSel.setAttribute('aria-label', 'Lowest note');
  highSel.setAttribute('aria-label', 'Highest note');
  range.selects = [lowSel, highSel];
  return range;
}
