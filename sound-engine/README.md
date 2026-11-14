# Gravitunes sound engine

A generic Web Audio sound engine that turns data into sound. Pure JS ES modules (no build step), a Python helper for writing scores and streaming live events, and two browser pages (a score player and a voice playground).

## Quick start

JavaScript (a page inside `sound-engine/`, served over http, for example `python3 -m http.server`):
```html
<button id="go">Play</button>
<script type="module">
  import { createEngine } from "./js/index.js";
  const engine = createEngine();
  document.getElementById("go").onclick = async () => {
    await engine.start();                      // needs a user gesture
    engine.play({ step: 0, dur: 1 });          // step 0 = middle C
    engine.play({ value: 0.7, t: 0.5, dur: 1 }); // `value` is mapped to a pitch
  };
</script>
```
Python (from the repo root):
```bash
pip install -e sound-engine/python
python3 - <<'PY'
from gravitunes_sound import Score
s = Score(title="Hello", scale="pentatonic-major")
for i, v in enumerate([3, 9, 5, 12]): s.note(t=i * 0.5, value=v, range=(0, 12), dur=0.5)
s.save("hello.score.json")
PY
python3 -m gravitunes_sound serve   # then open http://localhost:8000/player.html and load hello.score.json
```

## Running things

```bash
pip install -e sound-engine/python            # add the live extra for the bridge: pip install -e "sound-engine/python[live]"
python -m gravitunes_sound serve              # static files on :8000 and, with websockets, a live relay on ws://localhost:8765
```
- http://localhost:8000/playground.html: a simple page for playing with sound, meant for anyone. Big Play / Stop at the top (Play holds the current note; Stop or Escape stops everything). Tone: harmonics sliders and bell-like extra tones with a live wave and overtone picture. Volume shape: a draggable attack/decay/sustain/release graph with a Volume slider, quick shapes (Pluck, Pad, Organ, Bell-like swell) and labelled sliders as the keyboard equivalent. Notes: tuning and scale pickers (the scale list only offers scales that fit the tuning; choosing slendro or pelog also switches to the Saron sound once). Listen: play the scale up or down, a chord, or hold the current note. Every sound uses the tone as currently set, and notes already sounding (held Play/Space notes, pads, runs, chords) follow tone changes live, at most once per animation frame. Sound: Mono (default, both ears the same) or Stereo, which shows Left/right (this tone), Balance (whole sound) and Width (spread notes by pitch). Shortcuts (listed on the page, can be turned off): hold Space to play the current note, H to start/stop a held note, arrows to move the current note by one scale note, Escape to stop, letter keys on the keyboard pads. A closed "For developers" section at the bottom shows the tone as numbers to paste into `engine.voice(name, settings)`; score files and the live bridge are on `player.html`. Open `playground.html#selftest` to run a built-in check (logs `SELFTEST ok` or `SELFTEST fail: ...`). All URLs are relative, so it also works at `/sound-engine/playground.html` from a server rooted at the repo root.
- http://localhost:8000/player.html: load a score file and play it, connect to the live bridge. `player.html?score=URL` loads a score at startup.
- http://localhost:8000/tests/browser/smoke.html: in-browser smoke test of the real engine.
- http://localhost:8000/tests/browser/realtime.html: real-time test (real AudioContext, records the live output) that holds an organ note in the Synth lab, drags harmonic sliders and checks the spectrum changes with no level dip or click (`REALTIME ok`). After updating the engine, hard-reload pages (Cmd+Shift+R / Ctrl+Shift+R): `python3 -m http.server` lets Chrome reuse cached ES modules.
- `examples/`: `minimal-js.html`, `play-score.html` (plays `storms.score.json`, can download a WAV), `score_from_python.py`, `live_from_python.py`, `make_storms_score.py`.

`python -m gravitunes_sound validate FILE...` checks score files against the schema. `serve` options: `--port` (8000), `--ws-port` (8765); if a port is busy it says so and suggests another. `Score.preview()` falls back to one free port if 8000 is busy and reuses it for later previews.

In the playground, computer letter keys play pads only while keyboard focus is on a pad (Tab into the keyboard); elsewhere they do nothing. Space, H and arrow shortcuts never fire while typing in a box.

## JavaScript API

Everything is exported from `js/index.js`. Exact signatures are in the JSDoc of each module; `CONTRACTS.md` is the contract.

```js
import { createEngine, renderScore, downloadWav } from "./js/index.js";
const engine = createEngine({ polyphony: 32, masterGain: 0.8, tuning: "12tet", scale: null, a4: 440, context });
await engine.start();                       // resume the AudioContext (user gesture)
const h = engine.play(event);               // handle: { id, voice, stop(time?), set(params, ramp=0.05), ended }
h.set({ amp: 0.2, step: 7 }, 0.3);          // change a sounding note
h.set({ harmonics: [1, 0, 0.5] });          // change its timbre while it sounds (also partials, envelope, voice: "bell" or a def)
h.stop();
engine.voice("snow", { extends: "bell", harmonics: [1, 0.3] });  // define a voice; engine.voice("snow") reads it
engine.voice("snow", def, { live: true });  // ...and apply the new timbre to every "snow" note sounding now
engine.setOutput("mono");                   // "mono": both ears identical (pan/balance/width ignored) | "stereo" (default)
engine.setBalance(-0.3);                    // shift the whole output left/right (-1..1); pan positions one note
engine.setWidth(0.5);                       // stereo spread by pitch, 0..1: low notes left, high notes right
engine.voices();                            // names of all voices
await engine.setTuning("just5");            // name | .scl text | URL | {scl,kbm} | {type:"edo",n:19}
engine.setScale("yaman");                   // name | {up,down,period,vadi,samvadi} | null
const p = engine.playScore(score, { at });  // { stop(fade?), ended, ready, duration }
engine.send({ type: "set", id: "a", amp: 0.1 });  // dispatch note | set | stop
engine.handle("a");                         // live handle for an id
engine.stopAll();
engine.connectBridge("ws://localhost:8765", { onstatus: (s) => console.log(s) });
const buf = await renderScore(score, { sampleRate: 44100, tail: 3 });  // offline AudioBuffer
await downloadWav(score, "out.wav");        // render and download
```
Other exports: `PRESETS`, `parseScl`, `parseKbm`, `createTuning`, `createScale`, `BUILTIN_TUNINGS`, `BUILTIN_SCALES`, `validateScore`, `normalizeScore`, `encodeWav`, `toWav`, `noteToFreq`, `dbToAmp`, and more (see `js/index.js`).

Built-in voices: `sine` (default), `organ`, `bell`, `hollow`, `bright`, `pad`, `pluck`. `presets/*.json` are generated copies.

In `engine.play`, `t` is seconds from now and `at` is an absolute `AudioContext` time. A note with no `dur` holds until `handle.stop()`. A reused `id` stops the earlier note. `set`/`stop` for an ended id are ignored silently. `h.set()` works until the note's release actually begins (a `dur` release still in the future does not block it); an explicit `h.stop(time)` replaces a release that has not begun yet, whether earlier or later. `engine.stopAll()` also resolves the `ended` promise of running scores.

Live timbre: `h.set({ harmonics, partials, envelope, voice })` changes a sounding note's sound. Harmonics crossfade to a new oscillator over 10–50 ms (started in phase when the pitch hasn't moved), because switching the wave instantly clicks; partials are matched by position (amps and ratios ramp, added ones fade in, removed ones fade out); loudness stays matched; a new `sustain` reaches a held note. `amp`/`pan` of a voice are not changed on sounding notes (set them directly). Bad input throws the same helpful errors as `engine.voice`.

Output: `createEngine({ output: "stereo" | "mono", balance: 0, width: 0 })`; `engine.output`, `engine.balance`, `engine.width` read them back. Balance shifts everything; pan positions one note. In mono, every note is centered and balance is ignored, at the same loudness as a centered stereo note.

`engine.connectBridge(url, { onstatus, onmessage, onerror })`: `onerror(text, msg)` is called (and `console.error` logged) for every message that could not be played, including later failures such as a score whose tuning fails to load. A bad item in an array does not stop the rest.

### Gentler highs: caps, rolloff, low-pass

High pitches and overtones are tiring to listen to, so by default the engine keeps them down:
- `maxNoteFreq` (default 1050 Hz, about C6): a higher note drops by octaves (`noteLimit: "fold"`), or `"clamp"` pins it, `"off"` allows anything.
- `maxFreq` (default 5000 Hz): no harmonic or partial above it; components fade out smoothly between 4000 and 5000 Hz, also while a note glides. The same fade at the Nyquist limit prevents aliasing in fast upward glides.
- `rolloff` (default 6 dB per octave above 2500 Hz): bright voices are softened as they go up.
- `lowpass`: a real per-note low-pass filter (Hz) on a voice, an event or `handle.set({ lowpass: 800 }, 0.2)`.
```js
const engine = createEngine({ maxFreq: 5000, maxNoteFreq: 1050, noteLimit: "fold", rolloff: { freq: 2500, slope: 6 } });
engine.setLimits({ maxFreq: Infinity });   // turn the overtone cap off
engine.play({ note: "C3", voice: "bright", lowpass: 900 });
```

### Real instruments (sound library)

`sound-engine/library/manifest.json` lists open-licensed recordings (CC0, CC BY, CC BY-SA). Download and analyse them, then load one as a voice:
```bash
python3 sound-engine/library/fetch.py            # -> data/earth/instruments/<id>/ and LICENSES.md (about 31 MB)
uv venv .venv && uv pip install --python .venv/bin/python numpy scipy soundfile
.venv/bin/python analysis/scripts/instrument-analysis/analyze.py   # -> <id>.trim.wav and library/presets/<id>.json
```
```js
await engine.loadLibrary("marimba");          // a sample voice if the recording is there, else its analysed overtones
engine.play({ note: "C3", voice: "marimba", dur: 1 });
```
The playground lists them under "Or a real instrument". Credit the recordings as in `data/earth/instruments/LICENSES.md`; CC BY-SA ones are share-alike.

## Python API

```python
from gravitunes_sound import Score, validate, live

s = Score(title=None, tuning=None, scale=None, tempo=None, value_range=None)
s.voice("rain", harmonics=[1, .5, .25], attack=.02, release=.4)   # also extends=, partials=, envelope={...}
s.note(t=0.0, step=7, voice="rain", amp=.6, dur=.4, id="a")      # any event field is a keyword
s.set(t=1.5, id="a", amp=.2)
s.stop(t=2.0, id="a")
s.notes([{"t": 0, "step": 0}, {"t": 1, "step": 4}])              # add many event dicts
s.to_dict(); s.validate()      # validate() returns a list of error strings, [] if fine
s.save("out/x.score.json")     # validates, creates folders
s.preview()                    # serve and open player.html with this score
validate(a_dict)               # list of error strings
```
numpy scalars and arrays are converted to plain JSON; NaN and inf raise `ValueError` with the event index. Live (needs `websockets`):
```python
live.connect("ws://localhost:8765")   # optional; the first send connects to the default URL
live.play(step=0, dur=0.5)
live.play(id="wind", step=0, voice="pad")   # holds until stopped
live.set("wind", step=4, ramp=0.3)
live.stop("wind")
live.score(s)                          # a Score or dict
live.stop_all()
live.close()
```

## Score format

A score is JSON (`schema/score.schema.json`; Python bundles a copy in `python/gravitunes_sound/data/`).
```json
{
  "version": 1,
  "title": "Storms",
  "tempo": 120,
  "tuning": "12tet",
  "scale": "pentatonic-major",
  "valueRange": [0, 50],
  "voices": { "rain": { "harmonics": [1, 0.5, 0.25], "envelope": { "attack": 0.02, "release": 0.4 } } },
  "events": [
    { "t": 0, "id": "storm-38", "value": 12.3, "voice": "rain", "amp": 0.6 },
    { "type": "set", "t": 1.5, "id": "storm-38", "amp": 0.2 },
    { "type": "stop", "t": 2, "id": "storm-38" }
  ]
}
```
Top level: `version` (must be 1) and `events` are required. `title`, `tempo`, `tuning`, `scale`, `valueRange`, `voices` are optional.

Event fields: `type` (`note` default, `set`, `stop`), `t`, `id`, one pitch field (`freq` Hz, `note` like `"C#4"`, `step`, `value`), `range`, `direction` (`"up"`/`"down"`, see below), `voice`, `amp` (0 to 1, alias `amplitude`), `dur` (alias `duration`), `pan` (-1 to 1), inline `harmonics` / `partials` / `envelope`, `glide` (`{to, time, at}`, where `to` is Hz or an object with at least one of `freq`, `note`, `step`, `value`), and `ramp` (seconds, for `set`). Unset fields fall back to the voice, then to defaults (`amp` 0.5, `pan` 0). A note without `dur` and without `id` lasts 1 beat when `tempo` is set, else 1 s; a note with an `id` and no `dur` holds until a `stop` for that id.

Voices: `extends`, `harmonics` (list of amplitudes for partials 1, 2, 3...), `partials` (`[{ratio, amp, decay}]` for inharmonic sounds, `amp` 0 to 10), `envelope` (`attack`, `decay`, `release` 0 to 60 s, `sustain` 0 to 1), `amp`, `pan`, `detune` (cents, -1200 to 1200). The same limits apply to inline event timbres, and are checked by the schema, the JS validator and the engine.

Tuning objects need one of `type` (`12tet`, `edo` with `n`, `just5`, `shruti22`), `scl`, `ratios` or `cents`; unknown fields are rejected. The JS validator (`validateScore`) and the Python one (schema-driven) are checked against the same corpus, `tests/fixtures/validation-corpus.json`.

Pitch priority: `freq` > `note` > `step` > `value`. A `note` is always 12-TET from `a4`.

### value and range
`value` is a data number. It is mapped linearly from `range` (event) or else `valueRange` (score) or else `[0, 1]`, clamped, onto three periods of the scale, from two periods below middle C to one above (C2 to C5 in 12-TET, so mid-range data lands around C3 to C4; high notes tire the ear), then snapped to the nearest allowed scale step. With no scale, every step is allowed.

Direction (for ragas whose up and down notes differ): a note or `set` with `value` uses the scale's `down` set if its value is lower than the previous one, else `up`. "Previous" is the previous value for the same `id` (for an id's first value, and for events without an id: the previous value event in the score, in time order). `"direction": "up"|"down"` on the event overrides this. Live events (`engine.play`/`send`, the bridge) are tracked the same way across the engine's stream; `handle.set({value})` compares with that note's last value.

### tempo
If `tempo` (BPM) is set, `t`, `dur`, `glide.time` and `glide.at` are in beats. Otherwise they are seconds.

### set / stop by id
A note with an `id` and no `dur` keeps sounding (no default length). Later `set` events with the same `id` change `amp`, `pan`, `freq`, `note`, `step` or `value`, gliding over `ramp` seconds (default 0.05). A `stop` event ends it (release phase included). Use one `id` per tracked object, for example a storm.

## Tunings and Scala

`tuning` is `"12tet"`, `"just5"`, `"shruti22"`, `"slendro"`, `"pelog"`, `"edo:N"` (such as `"edo:19"`), `.scl` file text, a URL or path ending in `.scl` (fetched by the browser), or an object: `{scl, kbm}` (text or URLs), `{type: "edo", n}`, `{ratios: [...]}`, `{cents: [...]}`, each with optional `refStep`, `refFreq`, `a4`.

Step convention: step 0 is middle C (261.6256 Hz) in every tuning, so in 12-TET step 9 is A4 (440 Hz) and step 7 is G4. Steps are counted in the tuning's own notes, so in 19-EDO step 19 is one octave up. A `.kbm` keyboard map or `refStep` / `refFreq` can move the reference. Example `.scl` and `.kbm` files are in `presets/`.

Gamelan: `"slendro"` (5 steps) and `"pelog"` (7 steps) are Javanese gamelan tunings. They do not repeat at an exact octave: the period is stretched (1210 and 1220 cents), so step 5 of slendro is a little above twice step 0. There is no standard gamelan tuning (every set is tuned on its own); the built-in values are rounded, representative numbers in the range of published averages over many gamelans, not one instrument, and not checked against a single citable measurement: treat them as representative. `presets/slendro.scl` and `presets/pelog.scl` hold the same values so you can edit them. The `saron` (metallophone) and `gong` voices fit them; both use a slightly detuned doubled partial for the slow beating ("ombak") of gamelan instruments.
```js
await engine.setTuning({ scl: sclText, kbm: kbmText });
engine.play({ step: 5, dur: 1 });
```

## Scales and ragas

A scale limits which steps `value` may use. Built-in: `chromatic`, `major`, `minor`, `ionian`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `aeolian`, `locrian`, `pentatonic-major`, `pentatonic-minor`, `harmonic-minor`, and the ragas `yaman`, `bhairav` (12-TET degrees) and `yaman-22`, `bhairav-22` (for `shruti22`). For gamelan: `slendro`, `slendro-nem`, `slendro-sanga`, `slendro-manyura` (for the `slendro` tuning; the pathets share all 5 notes and differ only in their emphasized tones, stored as `vadi`/`samvadi`) and `pelog`, `pelog-lima`, `pelog-nem` (tones 1 2 3 5 6), `pelog-barang` (tones 2 3 5 6 7) for the `pelog` tuning. A custom scale is an object:
```js
engine.setScale({ name: "yaman", up: [0, 2, 4, 6, 9, 11], down: [0, 2, 4, 6, 7, 9, 11], period: 12, vadi: 4, samvadi: 11 });
```
`up` is used for rising values, `down` for falling ones (ragas differ going up and down; see Direction above). `vadi` and `samvadi` mark the two emphasized degrees (metadata). `period` defaults to the tuning size for custom scales. Built-in scales have a fixed period (12, 22 for the `-22` ragas, 5 for slendro, 7 for pelog) and throw a clear error with a tuning of another size (for example `major` with `shruti22` or `edo:19`); use `chromatic` or a scale defined for that many steps. Note: a scale only maps `value`. An event with `step`, `note` or `freq` is not quantized.

## Live bridge protocol

`python -m gravitunes_sound serve` runs a relay on `ws://localhost:8765`. Messages are JSON text frames, each one of: an event object; an array of events; `{ "score": {...} }` to play a whole score; or a command `{ "cmd": "stopAll" | "setTuning" | "setScale" | "voice", ... }` (`setTuning` and `setScale` take `spec`; `voice` takes `name` and `def`). The relay forwards each message to every other client. Errors playing a message are shown in the Live bridge panel (and announced), logged with `console.error`, and passed to `onerror`. The browser side connects from the Live bridge panel in `player.html` or with `engine.connectBridge(url)`, and must have pressed Start audio first. Python sends with `gravitunes_sound.live`.

## Recipes

Continuous value to pitch (a scale keeps it musical):
```python
s = Score(scale="pentatonic-major", value_range=(-10, 40))
for t, temp in enumerate(temperatures): s.note(t=t * 0.25, value=temp, dur=0.25)
```
Category to voice:
```python
voices = {"rain": "pluck", "hail": "bell", "snow": "pad"}
for t, kind in events: s.note(t=t, step=0, voice=voices[kind], dur=0.5)
```
Intensity to loudness and brightness. Louder is `amp`; brighter is more upper harmonics, set per event:
```python
for t, x in enumerate(intensity):   # x in 0..1
    s.note(t=t * 0.2, step=4, amp=0.2 + 0.7 * x, harmonics=[1] + [x ** k for k in range(1, 6)], dur=0.2)
```
An evolving sound per tracked object (`id`, `set`, `stop`):
```python
s.note(t=0, id="storm-7", value=12, voice="pad", amp=0.2)       # no dur: holds
s.set(t=2, id="storm-7", value=30, amp=0.5, ramp=1.0)           # follows the data
s.stop(t=6, id="storm-7")
```
The same works live: `live.play(id=..., ...)`, `live.set(id, ...)`, `live.stop(id)`.

### Testing the live bridge by hand

The sandbox used to build this could not open ports, so the bridge was not run end to end. To check it:
1. `pip install -e "sound-engine/python[live]"`, then `python -m gravitunes_sound serve` (static files on :8000, relay on ws://localhost:8765).
2. Open http://localhost:8000/player.html, press Start audio, then Connect in the Live bridge panel (status should say connected).
3. In another terminal: `python sound-engine/examples/live_from_python.py`. You should hear notes; errors show in the Live bridge panel.
4. Headless check instead of step 2: run this while step 3 plays; every message from the example should print as JSON.
   ```bash
   python3 -c "import asyncio, websockets
async def main():
    async with websockets.connect('ws://localhost:8765') as ws:
        async for m in ws: print(m)
asyncio.run(main())"
   ```

## Testing

```bash
node --test sound-engine/tests/                                              # pure JS modules and WAV encoding
PYTHONPATH=sound-engine/python python3 -m unittest discover sound-engine/python/tests   # Python package and schema sync
python -m gravitunes_sound serve   # then open http://localhost:8000/tests/browser/smoke.html (shows pass/fail per check)
```
If you edit `schema/score.schema.json`, copy it to `python/gravitunes_sound/data/score.schema.json`; a test fails if they differ.
