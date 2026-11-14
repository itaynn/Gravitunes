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
const h = engine.play(event);         // → handle { id, voice, stop(time?), set({amp,freq,step,note,value,direction,pan}, ramp=0.05), ended: Promise }
engine.voice(name, def);              // define/override a voice; def may use { extends: "bell" }
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
- **Pitch priority:** `freq` > `note` > `step` > `value`. A `note` is always 12-TET from `a4`. A `step` goes through `tuning.freq` and is *not* quantized by the scale. A `value` maps through `scale.fromValue` over `range ?? score.valueRange ?? [0, 1]`, using the scale's `up` or `down` set per `direction`.
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
- Built-in scales have a fixed period (12; 22 for `*-22`); `createScale` throws if the tuning's size differs. `chromatic` follows the tuning.
- A note `id` reused while the old note is still sounding stops the old note.
- `set`/`stop` events for an id that has already ended are silently ignored, because data streams can outlive notes.
- `presets/*.json` are generated from `PRESETS` in `voices.js`, which is the source of truth.
