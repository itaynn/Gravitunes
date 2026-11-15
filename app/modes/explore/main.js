// Explore: one dataset at a time (ozone, carbon monoxide, nitrogen oxides or rain, chosen with the Data menu).
// What you see is what you hear: the map, colour bar and sound all come from ctx.dataset, played with that
// dataset's own recorded instrument and pitch range (layers.js). A click, tap or arrow key picks a place (marked
// on the map) and plays it; Play animates the map and plays that place's value as a melody, one note per frame.
// The mouse only announces. (Merges the former Ozone probe and Layered maps.)
import { formatLatLon as where } from '../../core/geo.js';
import { scaleControl } from '../../core/scale-control.js';
import { throttle } from '../../core/ui.js';
import { layerFor, noteFor } from './layers.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  const layer = layerFor(dataset.id);
  let last = null;   // the picked place
  const DEFAULT = { lat: 28.6, lon: 77.2, name: 'New Delhi' };   // a hotspot for every dataset, used when nothing is picked
  const desc = document.getElementById('mode-desc');
  if (desc) desc.textContent = `Pick a place, press Play: hear how its ${layer.name} changes over time.`;
  const offMark = viewer?.addOverlay((g, v) => {
    if (!last) return;
    const [x, y] = v.toPixel(last.lat, last.lon), r = Math.max(5, v.canvas.width / 220);
    g.save(); g.lineWidth = r / 2.5;
    g.strokeStyle = '#000'; g.beginPath(); g.arc(x, y, r + 2, 0, 7); g.stroke();
    g.strokeStyle = '#ffd400'; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
    g.fillStyle = '#ffd400'; g.beginPath(); g.arc(x, y, r / 3, 0, 7); g.fill(); g.restore();
  });
  let scale = 'pentatonic-major';
  sound.loadSamples?.([layer.sample]);   // until it loads (or if it can't), the note is synthesized
  scaleControl(panel, { value: scale, describe, sound, onChange: (v) => { scale = v; } });
  panel.button('Describe', () => {
    if (!last) describe('Click the map or use the arrow keys first.');
    else probe(last, { force: true, play: true, pick: false });
  });

  // Throttled (150 ms) so a fast sweep does not pile up notes or announcements.
  const ready = throttle(150);
  const speak = throttle(5000);   // text summary during playback, at most every 5 s
  function probe(p, { announce = true, force = false, play = false, pick = play, prefix = '' } = {}) {
    const { lat, lon } = p;
    if (pick) { last = { lat, lon }; viewer?.redraw(); }
    if (!ready(force, () => probe(p, { announce, force, play, pick, prefix }))) return;
    const value = dataset.valueAt(lat, lon, time.now());
    const n = value == null ? null : noteFor(layer, dataset.norm(value), lon / 180, scale);
    if (play && n) sound.play(n);
    if (announce) describe(`${prefix}${layer.name} ${dataset.format(value)}, near ${where(lat, lon)}`);
  }

  // Mouse hover: text only. Arrow keys (keyboard: true), clicks and taps also play.
  const offHover = input.onHover((p) => probe(p, { play: !!p.keyboard, pick: !!p.keyboard }));
  const offClick = input.onClick((p) => probe(p, { force: true, play: true }));
  // Play: the picked place (or the default) plays one note per frame, so its value over time is a melody.
  const offPlay = time.onPlayState((playing) => {
    if (!playing || last) return;
    last = { lat: DEFAULT.lat, lon: DEFAULT.lon }; viewer?.redraw();
    describe(`No place picked: playing ${DEFAULT.name}. Click the map or use the arrow keys to pick another.`);
  });
  const offFrame = time.onFrame(() => {
    if (time.playing) {
      if (last) probe(last, { announce: speak(), force: true, play: true, pick: false, prefix: `${time.label()}: ` });
      return;
    }
    if (last) probe(last, { force: true, pick: false, prefix: `${time.label()}: ` });
    else describe(time.label());
  });
  describe(`Explore ready: ${layer.name}. Pick a place with a click or the arrow keys, then press Play to hear how it changes; choose another dataset with the Data menu.`);
  return () => { offHover(); offClick(); offFrame(); offPlay(); offMark?.(); };
}
