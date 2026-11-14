# Sound engine contracts

Internal contract for everyone building `sound-engine/`. Users should read `README.md`. Exact signatures are in the JSDoc of each `js/*.js` file. The score format is defined in `schema/score.schema.json`.

## Module ownership
| Module | Pure? | Owner |
|---|---|---|
| `js/units.js`, `scala.js`, `tuning.js`, `scale.js`, `score.js` | yes (no AudioContext) | logic worker, tests in `tests/js/` |
| `js/engine.js`, `voices.js`, `render.js`, `bridge.js`, `presets/*.json` | Web Audio | engine fork |
| `python/gravitunes_sound/` | stdlib | Python worker |
| `playground.html`, `player.html` | UI | playground worker |
| `index.js`, `schema/`, this file | — | parent (change only by agreement) |

## JS API
```js
const engine = createEngine({ polyphony: 32, masterGain: 0.8, tuning: "12tet", scale: null, a4: 440, context });
await engine.start();                 // resumes the AudioContext; call from a user gesture
const h = engine.play(event);         // → handle { id, voice, stop(time?), set({amp,freq,step,note,value,direction,pan,harmonics,partials,envelope,voice}, ramp=0.05), ended: Promise }
engine.voice(name, def);              // define/override a voice; def may use { extends: "bell" }
engine.voice(name, def, { live: true }); // also apply the timbre to sounding notes of that voice (score notes only if the score doesn't define it)
engine.setOutput("mono"|"stereo"); engine.setBalance(x, ramp=0.05); engine.setWidth(x, ramp=0.05); // + getters output/balance/width; createEngine({output, balance, width})
engine.setLimits({ maxFreq, maxNoteFreq, noteLimit });   // + getters; createEngine({ maxFreq: 5000, maxNoteFreq: 1050, noteLimit: "fold" })
engine.setRolloff(false | true | { freq: 2500, slope: 6 });  // + getter rolloff; createEngine({ rolloff })
await engine.loadSample(url);         // AudioBuffer for sample voices (relative to sampleBase = data/earth/instruments/)
await engine.loadLibrary(id, { name, sample: true });  // registers sound-engine/library/presets/<id>.json as a voice
engine.voice(name);                   // → resolved VoiceDef
engine.voices();                      // → string[]
await engine.setTuning(spec);         // name | scl text | URL | {scl,kbm} | {type:"edo",n} | Tuning
engine.setScale(spec);                // name | {up,down,period,vadi,samvadi} | null
engine.tuning; engine.scale;          // current Tuning / Scale objects
const p = engine.playScore(score, { at });  // → { stop(fade?), ended: Promise, ready: Promise, duration }
engine.handle(id);                    // → live handle for an event id, or undefined
engine.send(event);                   // dispatch any event: note → play, set → handle.set, stop → handle.stop
engine.stopAll(fade = 0.05);          // also resolves running playScore().ended
engine.master;                        // GainNode (master gain) → DynamicsCompressor (limiter) → destination
engine.context;                       // the AudioContext (created lazily on first use)
engine.connectBridge(url?, { onstatus, onmessage, onerror });  // live bridge client → { status, send, close }; onerror(text, msg) per failed message
// render.js: renderScore(score, { sampleRate, tail, voices }) → AudioBuffer; encodeWav(buf) → ArrayBuffer; toWav(buf) → Blob; downloadWav(score, name)
```

## Event normalization (`score.normalizeEvent`)
- `type` defaults to `"note"`. `set` and `stop` events need an `id`.
- Aliases: `amplitude` → `amp`, `duration` → `dur`. Both spellings are accepted everywhere.
- **Pitch priority:** `freq` > `note` > `step` > `value`. A `note` is always 12-TET from `a4`. A `step` goes through `tuning.freq` and is *not* quantized by the scale. A `value` maps through `scale.fromValue` over `range ?? score.valueRange ?? [0, 1]` onto steps `[-2 periods, +1 period]` by default (C2..C5 in 12-TET; `fromValue({low, high})` overrides), using the scale's `up` or `down` set per `direction`.
- **Direction:** explicit `direction` wins. Otherwise (`score.directionTracker`): compared with the previous value for the same `id`, else the previous value event overall (score: time order; live: the engine's event stream); lower → `"down"`, equal/higher/first → `"up"`. `normalizeScore` fills it in for note/set events with `value`.
- `glide.to` is Hz, or a `{freq|note|step|value}` object resolved the same way.
- Timing: in a score, `t` is seconds from score start. In `engine.play`, `t` is seconds from now, and `at` (play-only) is an absolute `AudioContext` time that wins over `t`. Negative values are errors.
- With `tempo` set, a score's `t`, `dur`, `glide.time` and `glide.at` are in beats. `normalizeScore` converts them to seconds.
- Fields left unset fall back to the voice definition, then to engine defaults (`amp` 0.5, `pan` 0). In scores, a note without `dur` and without `id` gets 1 beat with `tempo`, else 1 s (set by `normalizeScore`); a note with an `id` and no `dur` holds until its `stop`. In `engine.play` with no `dur`, the note holds until `handle.stop()`.
- Validation: `schema/score.schema.json` is the source of truth; `validateScore` (JS) must agree with it on `tests/fixtures/validation-corpus.json` (run by both the node and Python tests). Voice limits (envelope times 0..60 s, partial amp 0..10, detune ±1200 cents) match `validateVoiceDef`.
- Merge order for timbre: `PRESETS[voice]` (default `"sine"`) ← `score.voices[voice]` / `engine.voice()` ← event fields.

## Step convention
Step 0 is middle C (261.6256 Hz) in every tuning unless `refStep`/`refFreq` or a `.kbm` say otherwise. In 12tet, step 9 = A4 = 440 Hz.

## Live bridge protocol
JSON text frames over `ws://localhost:8765`. Each message is one event object, an array of events, or `{ "score": {...} }` to play a whole score, or a command `{ "cmd": "stopAll" | "setTuning" | "setScale" | "voice", ... }` (`setTuning`/`setScale` take `spec`, and `voice` takes `name` and `def`). The relay rebroadcasts each message to every other client.

## Engine notes
- Polyphony: when a new note would go over the limit, the oldest note (one already releasing goes first) fades out over 15 ms. Rendering uses unlimited polyphony.
- Loudness: each voice's gain is divided by about the RMS of its partial amplitudes, so `amp` sounds roughly the same across timbres. A master gain (0.8) feeds a DynamicsCompressor used as a limiter (threshold −6 dB, ratio 20).
- A note with `sustain: 0` and no `dur` ends by itself after its decay. Otherwise a note with no `dur` holds until `stop()`.
- A release scheduled for the future (from `dur` or a sustain-0 voice) is not "stopped": `set` works until the release begins. An explicit `stop` replaces a release that has not begun (earlier or later); voice stealing only moves it earlier.
- Built-in scales have a fixed period (12; 22 for `*-22`; 5 for `slendro*`; 7 for `pelog*`); `createScale` throws if the tuning's size differs. `chromatic` follows the tuning.
- Tunings may have a period other than 1200 cents (`slendro` 1210, `pelog` 1220, any `.scl`); `freq`/`stepOf` follow `periodCents`.
- `playScore` resolves voices per note from the score's voices layered over the engine registry, so `engine.voice()` changes reach notes not yet scheduled (about 0.25 s ahead).
- A note `id` reused while the old note is still sounding stops the old note.
- `set`/`stop` events for an id that has already ended are silently ignored, because data streams can outlive notes.
- Live timbre (`handle.set` with harmonics/partials/envelope/voice): harmonics crossfade to a new oscillator over 10–50 ms (phase-aligned when the pitch never moved) instead of `setPeriodicWave`, which clicks (smoke test: raw switch jump 0.29 vs steady 0.09; crossfade 0.060 vs 0.060). Partials match by index. The level gain ramps to the new normalization. A new sustain applies after the attack if no release is scheduled. Voice `amp`/`pan` are not re-applied. Ramps that start "now" set the current value explicitly; `cancelAndHoldAtTime(now)` after a finished ramp clicked in Chrome.
- Output chain: notes → master gain → balance (StereoPanner) → limiter → soft clipper. `output: "mono"` forces every note pan and the balance to 0. `width` adds `width × clamp(log2(f/C4)/2, −1, 1)` to each note's pan (stereo only). Balance shifts everything; pan positions one note.
- `presets/*.json` are generated from `PRESETS` in `voices.js`, which is the source of truth.
- **Frequency caps (all pitch fields: freq, note, step, value, glide targets, set).** The fundamental is limited to `maxNoteFreq` (default 1050 Hz, about C6): `noteLimit: "fold"` (default) drops it by octaves, `"clamp"` pins it, `"off"` disables. Every harmonic and partial gets the gain `capFade(f, min(maxFreq, Nyquist))`: 1 below 0.8x the cap, a raised-cosine fade to 0 at the cap (default `maxFreq` 5000 Hz; `Infinity` leaves only the Nyquist fade). Glides automate these gains along the pitch path (24 linear segments), so components crossing the cap or Nyquist fade out (or in) smoothly; `set` ramps them with the pitch. Partials with their own `decay` keep their decay curve and are only capped at note start.
- **Rolloff.** On top of the cap, a pitch-tracking rolloff of `slope` dB/octave above `freq` (default 6 dB/oct above 2500 Hz) softens bright voices at high pitches. Loudness normalization uses the unattenuated amplitudes, so high notes come out a little quieter.
- **lowpass.** Optional cutoff in Hz (20..20000) on a voice, an event, or `handle.set({ lowpass })` (null turns it off). Each note has a BiquadFilter (lowpass, Q 0.707) between its level gain and envelope; without `lowpass` it sits at Nyquist. `set` ramps the cutoff exponentially over `ramp`. An event/set cutoff wins over the voice's; a live voice change moves it only when no event/set cutoff was given.
- **Sample voices.** A voice with `sample: { url, f0, loop?, loopStart?, loopEnd?, gain? }` plays a recording (AudioBufferSourceNode, `playbackRate = freq / f0`, follows glides and `set` pitch) once `engine.loadSample(url)` has finished; until then the voice's harmonics/partials play. Recordings are not rolled off or capped (only maxNoteFreq applies). Level: scaled so the recording's RMS is near a synth voice's. Timbre `set` on a sample note throws. `sample` is not in the score schema (define sample voices with `engine.voice` / `engine.loadLibrary`).
- **Library.** `sound-engine/library/manifest.json` lists open-licensed recordings; `library/fetch.py` downloads them to `data/earth/instruments/<id>/` and writes `LICENSES.md`; `analysis/scripts/instrument-analysis/analyze.py` writes trimmed `<id>.trim.wav` files and `library/presets/<id>.json` (voice + `sample` + `source`) and `presets/index.json`.
