// engine.js — Web Audio engine. OWNER: engine fork.
// The engine works in Hz; tuning/scale (pure modules) turn steps and data values into Hz.
import { resolveVoice, harmonicsToWave, validateVoiceDef, PRESETS } from "./voices.js";
import { createTuning, resolveTuning } from "./tuning.js";
import { createScale } from "./scale.js";
import { normalizeEvent, normalizeScore, resolvePitch, directionTracker } from "./score.js";
import { connectBridge as connectBridgeImpl } from "./bridge.js";

const STEAL_FADE = 0.015;       // seconds, fade for a stolen voice
const LOOKAHEAD = 0.25;         // seconds scheduled ahead during score playback
const TICK_MS = 50;

/**
 * Create a sound engine.
 * @param {{polyphony?:number, masterGain?:number, tuning?:any, scale?:any, context?:BaseAudioContext, a4?:number, destination?:AudioNode}} [opts]
 */
export function createEngine(opts = {}) {
  const { polyphony = 32, masterGain = 0.8, a4 = 440, tuning: tuningSpec = "12tet" } = opts;
  let scaleSpec = opts.scale ?? null;
  if (!(Number.isInteger(polyphony) && polyphony > 0) && polyphony !== Infinity)
    throw new Error(`createEngine: polyphony must be a positive integer, got ${polyphony}`);

  let ctx = opts.context ?? null;
  let master = null, limiter = null;
  let tuning = null, scale = null;
  let pendingTuning = needsFetch(tuningSpec) ? tuningSpec : null; // URLs are loaded by start()
  const registry = {};                     // user voices
  const active = new Set();                // live note handles
  const byId = new Map();                  // event id -> handle
  const players = new Set();               // running score players
  const liveDirection = directionTracker(); // up/down for live `value` events (per id, else global)
  let nextHandleId = 1;

  function ensureContext() {
    if (!ctx) {
      const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AC) throw new Error("No Web Audio API here. Run in a browser, or pass { context } to createEngine (e.g. an OfflineAudioContext).");
      ctx = new AC({ latencyHint: "interactive" });
    }
    if (!master) {
      master = ctx.createGain();
      master.gain.value = masterGain;
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 3; limiter.ratio.value = 20;
      limiter.attack.value = 0.001; limiter.release.value = 0.2;
      // The compressor reacts in ~1 ms, so sudden peaks from dense data can slip past it.
      // A gentle soft clipper after it guarantees the output never exceeds ±1.
      const clipper = ctx.createWaveShaper();
      clipper.curve = softClipCurve();
      clipper.oversample = "2x";
      master.connect(limiter).connect(clipper).connect(opts.destination ?? ctx.destination);
    }
    return ctx;
  }

  function getTuning() {
    if (!tuning) {
      if (pendingTuning) throw new Error("engine: the tuning is still loading. Await engine.start() or engine.setTuning(...) before playing.");
      tuning = createTuning(tuningSpec, { a4 });
    }
    return tuning;
  }
  function getScale() {
    if (scale === null && scaleSpec !== null && scaleSpec !== undefined) scale = createScale(scaleSpec, getTuning());
    return scale;
  }

  function pitchCtx(extra = {}) {
    return { tuning: extra.tuning ?? getTuning(), scale: extra.scale !== undefined ? extra.scale : getScale(),
      valueRange: extra.valueRange ?? [0, 1], a4 };
  }

  // ---------------------------------------------------------------- notes
  function steal(when) {
    const live = [...active].filter((h) => h._endTime > when);
    if (live.length < polyphony) return;
    // oldest first; prefer ones already releasing
    live.sort((a, b) => (b._releasing - a._releasing) || (a._start - b._start));
    for (let i = 0; i <= live.length - polyphony; i++) live[i]._kill(when);
  }

  /**
   * Start one note. Returns a handle { id, voice, stop(time?), set(params, ramp?), ended }.
   * @param {Object} event  see CONTRACTS.md; `t` = seconds from now, `at` = absolute context time
   * @param {Object} [scope] internal: per-score registry/tuning/scale/valueRange and a time base
   */
  function play(event, scope = {}) {
    if (event == null || typeof event !== "object")
      throw new Error('engine.play: expected an event object like { note: "C4" } or { freq: 440, dur: 1 }');
    const { at, ...rest } = event;
    let ev = scope.normalized ? event : normalizeEvent(rest, { path: "play" });
    if (ev.type !== "note") return send(ev, { ...scope, normalized: true });
    if (!scope.score && ev.value !== undefined) ev = { ...ev, direction: liveDirection(ev) };
    const c = ensureContext();
    if (at !== undefined && !(typeof at === "number" && at >= 0))
      throw new Error(`engine.play: at must be an absolute AudioContext time >= 0 (seconds), got ${at}`);
    const start = Math.max(c.currentTime, at ?? (scope.base ?? c.currentTime) + (ev.t ?? 0));

    const voiceDef = resolveVoice(ev.voice ?? "sine",
      { harmonics: ev.harmonics, partials: ev.partials, envelope: ev.envelope },
      scope.registry ?? registry);
    const amp = ev.amp ?? voiceDef.amp;
    const pan = ev.pan ?? voiceDef.pan;
    const pc = pitchCtx(scope);
    const freq = resolvePitch(ev, pc);
    const env = voiceDef.envelope;

    if (ev.id !== undefined && byId.has(ev.id)) byId.get(ev.id).stop(start);
    steal(start);

    // graph: oscillators -> [partial gains] -> level -> env -> panner -> master
    const level = c.createGain();
    level.gain.value = amp * levelNorm(voiceDef);
    const envGain = c.createGain();
    envGain.gain.value = 0;
    const panner = c.createStereoPanner ? c.createStereoPanner() : null;
    level.connect(envGain);
    if (panner) { panner.pan.value = clamp(pan, -1, 1); envGain.connect(panner).connect(master); }
    else envGain.connect(master);

    const oscs = []; // { osc, ratio }
    const extraGains = [];
    if (voiceDef.harmonics.some((h) => h !== 0)) {
      const o = c.createOscillator();
      if (voiceDef.harmonics.length === 1) o.type = "sine";
      else o.setPeriodicWave(harmonicsToWave(c, voiceDef.harmonics));
      o.frequency.value = freq; o.detune.value = voiceDef.detune;
      o.connect(level); oscs.push({ osc: o, ratio: 1 });
    }
    for (const p of voiceDef.partials) {
      if (freq * p.ratio >= c.sampleRate / 2) continue; // above Nyquist: skip, avoids aliasing
      const o = c.createOscillator();
      o.type = "sine"; o.frequency.value = freq * p.ratio; o.detune.value = voiceDef.detune;
      const g = c.createGain(); g.gain.value = p.amp ?? 1;
      if (p.decay) {
        g.gain.setValueAtTime(p.amp ?? 1, start);
        g.gain.setTargetAtTime(0, start, p.decay / 3);
      }
      o.connect(g).connect(level); oscs.push({ osc: o, ratio: p.ratio }); extraGains.push(g);
    }
    if (!oscs.length) throw new Error("engine.play: the voice has no sound (all harmonics are 0 and no partials)");

    const atk = Math.max(0.002, env.attack);
    const sus = clamp(env.sustain, 0, 1);
    scheduleEnvelope(envGain.gain);

    // glide
    if (ev.glide) {
      const g = ev.glide;
      const toDir = typeof g.to === "number" ? undefined : g.to.direction ?? (g.to.value !== undefined && ev.value !== undefined
        ? (g.to.value >= ev.value ? "up" : "down") : ev.direction);
      const target = typeof g.to === "number" ? g.to : resolvePitch({ ...g.to, direction: toDir }, pc);
      const gStart = start + (g.at ?? 0), gEnd = gStart + Math.max(0.001, g.time ?? (ev.dur ?? 1));
      for (const { osc, ratio } of oscs) {
        osc.frequency.setValueAtTime(freq * ratio, gStart);
        osc.frequency.exponentialRampToValueAtTime(target * ratio, gEnd);
      }
    }

    for (const { osc } of oscs) osc.start(start);

    let resolveEnded;
    const ended = new Promise((r) => (resolveEnded = r));
    const handle = {
      id: ev.id ?? `n${nextHandleId++}`,
      voice: voiceDef.name,
      freq,
      ended,
      _start: start,
      _endTime: Infinity,
      _releasing: false,      // a release is scheduled (it may not have begun yet)
      _releaseAt: undefined,  // absolute time the release begins
      _value: ev.value,       // last data value, to tell up from down for set({value})
      /** True once the release has actually begun (a release scheduled for later doesn't count). */
      get _stopped() { return handle._releaseAt !== undefined && c.currentTime >= handle._releaseAt; },
      _kill(when, fade = STEAL_FADE) { stopAt(when, Math.max(0.005, fade), false); },
      /**
       * Release the note at `time` (absolute context time; default now). An explicit stop replaces
       * a release that is scheduled but has not begun yet (e.g. from `dur`), earlier or later.
       */
      stop(time) { stopAt(time ?? c.currentTime, Math.max(0.005, env.release), true); },
      /**
       * Change a sounding note. params: { amp|amplitude, freq|note|step|value, pan, direction }.
       * Works until the release begins; a set scheduled at/after the release start is ignored.
       * @param {Object} params @param {number} [ramp=0.05] seconds @param {number} [when] absolute time
       */
      set(params = {}, ramp = 0.05, when) {
        const t0 = Math.max(c.currentTime, when ?? c.currentTime), t1 = t0 + Math.max(0.005, ramp);
        if (handle._releaseAt !== undefined && t0 >= handle._releaseAt) return handle;
        const a = params.amp ?? params.amplitude;
        if (a !== undefined) {
          if (!(a >= 0 && a <= 1)) throw new Error(`handle.set: amp must be 0..1, got ${a}`);
          rampTo(level.gain, a * levelNorm(voiceDef), t0, t1);
        }
        if (params.pan !== undefined && panner) rampTo(panner.pan, clamp(params.pan, -1, 1), t0, t1);
        if (["freq", "note", "step", "value"].some((k) => params[k] !== undefined)) {
          let p = params;
          if (p.value !== undefined && p.direction === undefined && p.freq === undefined && p.note === undefined && p.step === undefined)
            p = { ...p, direction: handle._value === undefined || p.value >= handle._value ? "up" : "down" };
          if (p.value !== undefined) handle._value = p.value;
          const f = resolvePitch(p, pc);
          handle.freq = f;
          for (const { osc, ratio } of oscs) rampTo(osc.frequency, f * ratio, t0, t1, true);
        }
        return handle;
      },
    };

    // Attack -> decay to sustain. Re-run when a pending release is replaced.
    function scheduleEnvelope(p) {
      p.setValueAtTime(0, start);
      p.linearRampToValueAtTime(1, start + atk);
      p.setTargetAtTime(Math.max(sus, 0), start + atk, Math.max(0.001, env.decay) / 3);
    }

    /** replace: true lets this (explicit) stop override a release that has not begun yet, even a later one. */
    function stopAt(time, release, replace) {
      const t = Math.max(time, c.currentTime);
      const prev = handle._releaseAt;
      if (prev !== undefined) {
        if (c.currentTime >= prev) return;            // release already running
        if (!replace && t >= prev) return;            // keep the earlier pending release
        if (t === prev) return;
      }
      const p = envGain.gain;
      if (prev !== undefined) { // undo the pending release and rebuild the envelope up to the new one
        p.cancelScheduledValues(Math.min(start, c.currentTime));
        scheduleEnvelope(p);
      }
      handle._releasing = true; handle._releaseAt = t;
      if (t < start) { // stopped before it started: silence entirely
        p.cancelScheduledValues(0); p.setValueAtTime(0, c.currentTime);
      } else if (p.cancelAndHoldAtTime) {
        p.cancelAndHoldAtTime(t);
      } else {
        p.cancelScheduledValues(t);
        p.setValueAtTime(p.value, t);
      }
      p.setTargetAtTime(0, Math.max(t, start), release / 5);
      const end = Math.max(t, start) + release + 0.05;
      handle._endTime = end;
      for (const { osc } of oscs) { try { osc.stop(end); } catch { /* already stopped */ } }
    }

    oscs[0].osc.onended = () => {
      for (const { osc } of oscs) osc.disconnect();
      for (const g of extraGains) g.disconnect();
      level.disconnect(); envGain.disconnect(); panner?.disconnect();
      active.delete(handle);
      if (byId.get(handle.id) === handle) byId.delete(handle.id);
      resolveEnded();
    };

    active.add(handle);
    byId.set(handle.id, handle);
    // A scheduled release (from dur, or self-ending sustain-0 voices) does not block set() before it begins.
    if (ev.dur !== undefined) stopAt(start + ev.dur, Math.max(0.005, env.release), false);
    else if (sus === 0) stopAt(start + atk + Math.max(0.01, env.decay) * 2, Math.max(0.005, env.release), false);
    return handle;
  }

  /** Dispatch any normalized-or-raw event: note → play, set → handle.set, stop → handle.stop. */
  function send(event, scope = {}) {
    const ev0 = scope.normalized ? event : normalizeEvent(event, { path: "send" });
    if (ev0.type === "note") return play(ev0, { ...scope, normalized: true });
    const h = byId.get(ev0.id);
    if (!h) return undefined; // ids that already ended are ignored on purpose (data streams outlive notes)
    const c = ensureContext();
    let ev = ev0;
    if (!scope.score && ev.type === "set" && ev.value !== undefined) ev = { ...ev, direction: liveDirection(ev) };
    const when = (scope.base ?? c.currentTime) + (ev.t ?? 0);
    if (ev.type === "stop") h.stop(when);
    else if (ev.type === "set") h.set(ev, ev.ramp ?? 0.05, when);
    return h;
  }

  // ---------------------------------------------------------------- scores
  /**
   * Play a score (object or JSON string). Returns { stop(), ended, ready }.
   * The score's own tuning/scale/voices apply only to that score.
   */
  function playScore(score, { at } = {}) {
    if (typeof score === "string") {
      try { score = JSON.parse(score); } catch (e) { throw new Error(`playScore: the score is not valid JSON (${e.message})`); }
    }
    const s = normalizeScore(score);
    const c = ensureContext();
    for (const [name, def] of Object.entries(s.voices ?? {})) validateVoiceDef(def, `score.voices.${name}`);
    let resolveEnded;
    const ended = new Promise((r) => (resolveEnded = r));
    const player = { stopped: false, handles: new Set(), timer: null, finish: () => resolveEnded() };

    const ready = (async () => {
      const t = s.tuning !== undefined ? await resolveTuning(s.tuning, { a4 }) : getTuning();
      const sc = s.scale !== undefined ? (s.scale === null ? null : createScale(s.scale, t)) : (s.tuning !== undefined ? null : getScale());
      const scope = { normalized: true, score: true, registry: Object.assign(Object.create(registry), s.voices ?? {}), // live: engine.voice() changes reach later notes
        tuning: t, scale: sc, valueRange: s.valueRange,
        base: at ?? c.currentTime + 0.1 };
      if (player.stopped) return;
      players.add(player);
      let i = 0;
      // Offline contexts don't advance in real time: schedule everything at once.
      const all = typeof OfflineAudioContext !== "undefined" && c instanceof OfflineAudioContext;
      const pump = () => {
        if (player.stopped) return;
        const horizon = c.currentTime + LOOKAHEAD - scope.base;
        while (i < s.events.length && (all || s.events[i].t <= horizon)) {
          // normalizeScore already gave notes without an id a default dur, and value events a direction.
          const ev = s.events[i++];
          try {
            const h = send(ev, scope);
            if (h && ev.type === "note") player.handles.add(h);
          } catch (e) { console.warn(`playScore: skipped events[${i - 1}]: ${e.message}`); }
        }
        if (i >= s.events.length) {
          clearInterval(player.timer); player.timer = null;
          Promise.all([...player.handles].map((h) => h.ended)).then(() => { players.delete(player); resolveEnded(); });
        }
      };
      pump();
      if (i < s.events.length) player.timer = setInterval(pump, TICK_MS);
    })();
    ready.catch(() => resolveEnded());

    return {
      ready, ended, duration: s.duration,
      stop(fade = 0.05) {
        player.stopped = true;
        if (player.timer) clearInterval(player.timer);
        for (const h of player.handles) h._kill(ensureContext().currentTime, fade);
        players.delete(player); resolveEnded();
      },
    };
  }

  // ---------------------------------------------------------------- public object
  const engine = {
    get context() { return ensureContext(); },
    get master() { ensureContext(); return master; },
    get limiter() { ensureContext(); return limiter; },
    get tuning() { return getTuning(); },
    get scale() { return getScale(); },
    get activeCount() { return active.size; },
    PRESETS,

    /** Resume audio (call from a click/keypress) and finish loading the tuning. */
    async start() {
      const c = ensureContext();
      if (c.state === "suspended" && c.resume) await c.resume();
      if (pendingTuning) await engine.setTuning(pendingTuning);
      return engine;
    },
    play: (event) => play(event),
    send: (event) => send(event),
    playScore,
    handle: (id) => byId.get(id),

    /** engine.voice(name) → resolved def; engine.voice(name, def) defines/overrides. */
    voice(name, def) {
      if (typeof name !== "string" || !name) throw new Error('engine.voice: give a name, e.g. engine.voice("snow", { harmonics: [1, 0.3] })');
      if (def === undefined) return resolveVoice(name, {}, registry);
      validateVoiceDef(def, `voice "${name}"`);
      registry[name] = { ...def };
      resolveVoice(name, {}, registry); // fail now on a bad `extends`
      return engine;
    },
    voices: () => [...new Set([...Object.keys(PRESETS), ...Object.keys(registry)])],

    /** @param {any} spec name | .scl text | URL | {scl,kbm} | {type:"edo",n} | Tuning */
    async setTuning(spec) {
      const t = await resolveTuning(spec, { a4 });
      // Build the scale first so an incompatible scale (e.g. "major" on 22 steps) leaves everything unchanged.
      const sc = scaleSpec !== null && scaleSpec !== undefined ? createScale(scaleSpec, t) : null;
      tuning = t; pendingTuning = null; scale = sc;
      return t;
    },
    /** @param {any} spec name | {up,down,period,vadi,samvadi} | null */
    setScale(spec) {
      scaleSpec = spec;
      scale = spec === null || spec === undefined ? null : createScale(spec, getTuning());
      return scale;
    },

    stopAll(fade = 0.05) {
      for (const p of [...players]) { p.stopped = true; if (p.timer) clearInterval(p.timer); players.delete(p); p.finish(); }
      const now = ctx ? ctx.currentTime : 0;
      for (const h of [...active]) h._kill(now, fade);
    },

    connectBridge(url, o) { return connectBridgeImpl(engine, url, o); },
  };
  return engine;
}

// ---------------------------------------------------------------- helpers
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function looksLikeUrl(s) { return typeof s === "string" && !s.includes("\n") && (/^(https?:|\.{0,2}\/)/.test(s) || /\.(scl|kbm)$/i.test(s)); }
function needsFetch(spec) { return looksLikeUrl(spec) || (spec && typeof spec === "object" && (looksLikeUrl(spec.scl) || looksLikeUrl(spec.kbm))); }

/** RMS-based normalization so timbres with many partials aren't much louder than a sine. */
function levelNorm(v) {
  const sq = v.harmonics.reduce((s, a) => s + a * a, 0) + v.partials.reduce((s, p) => s + (p.amp ?? 1) ** 2, 0);
  return 1 / Math.max(1, Math.sqrt(sq) * 1.4);
}

function rampTo(param, value, t0, t1, exponential = false) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t0);
  else { param.cancelScheduledValues(t0); param.setValueAtTime(param.value, t0); }
  if (exponential && value > 0) param.exponentialRampToValueAtTime(value, t1);
  else param.linearRampToValueAtTime(value, t1);
}

/** Linear below 0.7, then a smooth tanh knee that approaches (but never exceeds) 1. */
function softClipCurve(n = 4096) {
  const curve = new Float32Array(n), knee = 0.7;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return curve;
}
