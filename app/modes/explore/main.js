// Explore: one dataset at a time (ozone, carbon monoxide, nitrogen oxides or rain, chosen with the Data menu).
// What you see is what you hear: the map, colour bar and sound all come from ctx.dataset, played with that
// dataset's own recorded instrument and pitch range (layers.js). The mouse only announces; a click, tap,
// arrow key or the timeline's Play makes sound. (Merges the former Ozone probe and Layered maps.)
import { formatLatLon as where } from '../../core/geo.js';
import { scaleControl } from '../../core/scale-control.js';
import { throttle } from '../../core/ui.js';
import { layerFor, noteFor } from './layers.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe } = ctx;
  const layer = layerFor(dataset.id);
  let last = null, lastFreq = null;
  let scale = 'pentatonic-major';
  sound.loadSamples?.([layer.sample]);   // until it loads (or if it can't), the note is synthesized
  scaleControl(panel, { value: scale, describe, sound, onChange: (v) => { scale = v; lastFreq = null; } });
  panel.button('Describe', () => {
    if (!last) describe('Click the map or use the arrow keys first.');
    else probe(last, { force: true, play: true });
  });

  // Throttled (150 ms) so a fast sweep does not pile up notes or announcements.
  const ready = throttle(150);
  const speak = throttle(5000);   // text summary during playback, at most every 5 s
  function probe(p, { announce = true, force = false, play = false, onlyChanged = false, prefix = '' } = {}) {
    const { lat, lon } = p;
    last = { lat, lon };
    if (!ready(force || onlyChanged, () => probe(p, { announce, force, play, onlyChanged, prefix }))) return;
    const value = dataset.valueAt(lat, lon, time.now());
    const n = value == null ? null : noteFor(layer, dataset.norm(value), lon / 180, scale);
    if (play && n && !(onlyChanged && lastFreq === n.freq)) { lastFreq = n.freq; sound.play(n); }
    if (announce) describe(`${prefix}${layer.name} ${dataset.format(value)}, near ${where(lat, lon)}`);
  }

  // Mouse hover: text only. Arrow keys (keyboard: true), clicks and taps also play.
  const offHover = input.onHover((p) => probe(p, { play: !!p.keyboard }));
  const offClick = input.onClick((p) => probe(p, { force: true, play: true }));
  const offFrame = time.onFrame(() => {
    if (time.playing) {
      if (last) probe(last, { announce: speak(), play: true, onlyChanged: true, prefix: `${time.label()}: ` });
      return;
    }
    if (last) probe(last, { force: true, prefix: `${time.label()}: ` });
    else describe(time.label());
  });
  describe(`Explore ready: ${layer.name}. Click the map or use the arrow keys to hear a spot; choose another dataset with the Data menu.`);
  return () => { offHover(); offClick(); offFrame(); };
}
