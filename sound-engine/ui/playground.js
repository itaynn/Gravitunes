import { createEngine, PRESETS, BUILTIN_TUNINGS, BUILTIN_SCALES, createScale } from "../js/index.js";
import { announce, errMsg } from "./common.js";

const $ = (id) => document.getElementById(id);
const N_HARM = 24, N_SHOWN = 8;
const engine = createEngine({ output: "mono" }); // the page starts in mono; the Sound choice switches to stereo
// Every sound on this page uses the voice "custom", which applyVoice() re-registers on every change.
// engine.play resolves the voice when a note starts, and playScore resolves it per note as it schedules
// (about 0.25 s ahead), so pads, runs, chords, shortcuts and the Play button always use the current tone.
const VOICE = "custom";

// ---------- tone state ----------
const state = { harmonics: Array(N_HARM).fill(0), partials: [], adsr: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3 }, amp: 0.5, pan: 0, detune: 0 };
state.harmonics[0] = 1;
const round = (x) => Math.round(x * 1000) / 1000;

function voiceDef() {
  const h = state.harmonics.map(round);
  while (h.length > 1 && h[h.length - 1] === 0) h.pop();
  const def = { harmonics: h };
  if (state.partials.length) def.partials = state.partials.map((p) => {
    const o = { ratio: p.ratio, amp: p.amp };
    if (p.decay > 0) o.decay = p.decay;
    return o;
  });
  def.envelope = { ...state.adsr };
  def.amp = state.amp; def.pan = state.pan;
  if (state.detune) def.detune = state.detune;
  return def;
}

let voiceErr = "";
function applyVoice() {
  const def = voiceDef();
  try { engine.voice(VOICE, def); voiceErr = ""; }
  catch (e) { if (errMsg(e) !== voiceErr) announce(`That tone can't be played: ${errMsg(e)}`); voiceErr = errMsg(e); }
  $("outjson").value = JSON.stringify(def, null, 2);
  scheduleLive();
  drawEnvelope();
}

// Notes already sounding (Play, Space, pads, runs and chords) follow every tone change: harmonics,
// extra tones, sustain, volume and left/right. Updates are batched to one per animation frame so
// dragging a slider doesn't flood the audio graph.
let livePending = false;
const live = { updates: 0 }; // debug counter, read by the selftest
function scheduleLive() {
  if (livePending) return;
  livePending = true;
  const run = () => { if (livePending) { livePending = false; pushLive(); } };
  requestAnimationFrame(run); setTimeout(run, 50); // whichever comes first (frames pause in hidden tabs)
}
function pushLive() {
  if (voiceErr || !engine.activeCount) return;
  try { engine.voice(VOICE, voiceDef(), { live: true }); } catch { return; }
  for (const r of held.values()) r.h?.set?.({ amp: state.amp, pan: state.pan }, 0.03);
  live.updates++;
}

// ---------- sliders ----------
function slider(parent, { id, label, min, max, step, get, set, fmt = (v) => String(v) }) {
  const wrap = document.createElement("div"); wrap.className = "field";
  wrap.innerHTML = `<label for="${id}">${label}</label><output for="${id}"></output><input type="range" id="${id}" min="${min}" max="${max}" step="${step}">`;
  const inp = wrap.querySelector("input"), out = wrap.querySelector("output");
  const sync = () => { inp.value = get(); out.textContent = fmt(+inp.value); };
  inp.addEventListener("input", () => { set(+inp.value); out.textContent = fmt(+inp.value); applyVoice(); });
  parent.append(wrap);
  return sync;
}
const syncs = [];
for (let i = 0; i < N_HARM; i++)
  syncs.push(slider($(i < N_SHOWN ? "harmonics" : "harmonics2"), { id: `h${i}`, label: i ? `Harmonic ${i + 1}` : "Harmonic 1 (the note itself)", min: 0, max: 1, step: 0.01,
    get: () => state.harmonics[i], set: (v) => { state.harmonics[i] = v; }, fmt: (v) => v.toFixed(2) }));
const fmtTime = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);
const adsrBox = $("env");
const E = (key, label, max, step) => syncs.push(slider(adsrBox, { id: key, label, min: 0, max, step, get: () => state.adsr[key], set: (v) => { state.adsr[key] = v; },
  fmt: key === "sustain" ? (v) => `${Math.round(v * 100)}%` : fmtTime }));
E("attack", "Attack (start)", 3, 0.005); E("decay", "Decay (fall)", 4, 0.01);
E("sustain", "Sustain (held level)", 1, 0.01); E("release", "Release (fade after letting go)", 5, 0.01);
// ---------- mono / stereo ----------
const stereoBox = $("stereo");
syncs.push(slider(stereoBox, { id: "balance", label: "Balance (whole sound, left/right)", min: -1, max: 1, step: 0.01,
  get: () => engine.balance, set: (v) => engine.setBalance(v),
  fmt: (v) => (Math.abs(v) < 0.005 ? "center" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "left" : "right"}`) }));
syncs.push(slider(stereoBox, { id: "width", label: "Width (spread notes: low left, high right)", min: 0, max: 1, step: 0.01,
  get: () => engine.width, set: (v) => engine.setWidth(v), fmt: (v) => (v < 0.005 ? "off" : `${Math.round(v * 100)}%`) }));
for (const r of document.querySelectorAll('input[name="output"]')) r.addEventListener("change", () => {
  if (!r.checked) return;
  engine.setOutput(r.value);
  stereoBox.hidden = r.value !== "stereo";
  announce(r.value === "stereo" ? "Stereo. Left/right, balance and width controls are shown." : "Mono. Both ears hear the same sound.");
});
syncs.push(slider(stereoBox, { id: "pan", label: "Left / right (this tone)", min: -1, max: 1, step: 0.01, get: () => state.pan, set: (v) => { state.pan = v; },
  fmt: (v) => (Math.abs(v) < 0.005 ? "center" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "left" : "right"}`) }));
// Volume sits next to the graph (static markup).
{
  const inp = $("amp"), out = $("ampout");
  syncs.push(() => { inp.value = state.amp; out.textContent = `${Math.round(state.amp * 100)}%`; });
  inp.addEventListener("input", () => { state.amp = +inp.value; out.textContent = `${Math.round(state.amp * 100)}%`; applyVoice(); });
}
const syncAll = () => syncs.forEach((f) => f());

// ---------- extra (inharmonic) tones ----------
function renderPartials(focus) {
  const tb = $("partials"); tb.innerHTML = "";
  state.partials.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><label class="sr-only" for="pr${i}">Extra tone ${i + 1} pitch ratio</label><input type="number" id="pr${i}" min="0.01" step="0.01" value="${p.ratio}"></td>
      <td><label class="sr-only" for="pa${i}">Extra tone ${i + 1} loudness</label><input type="number" id="pa${i}" min="0" max="10" step="0.05" value="${p.amp}"></td>
      <td><label class="sr-only" for="pd${i}">Extra tone ${i + 1} fade time in seconds</label><input type="number" id="pd${i}" min="0" step="0.1" value="${p.decay || ""}"></td>
      <td><button type="button" aria-label="Remove extra tone ${i + 1}">Remove</button></td>`;
    const bind = (sel, key) => tr.querySelector(sel).addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) p[key] = v; else if (key === "decay") p.decay = 0;
      if (!(p.ratio > 0)) p.ratio = 1;
      applyVoice();
    });
    bind(`#pr${i}`, "ratio"); bind(`#pa${i}`, "amp"); bind(`#pd${i}`, "decay");
    tr.querySelector("button").addEventListener("click", () => {
      state.partials.splice(i, 1);
      renderPartials(state.partials.length ? `pr${Math.min(i, state.partials.length - 1)}` : "addpartial");
      applyVoice(); announce(`Removed extra tone ${i + 1}. ${state.partials.length} left.`);
    });
    tb.append(tr);
  });
  $("nopartials").hidden = state.partials.length > 0;
  tb.closest("table").hidden = !state.partials.length;
  if (focus) $(focus)?.focus();
}
$("addpartial").addEventListener("click", () => {
  state.partials.push({ ratio: 2.76, amp: 0.4, decay: 0 });
  renderPartials(`pr${state.partials.length - 1}`); applyVoice(); announce(`Added extra tone ${state.partials.length}.`);
});

// ---------- starting sounds ----------
const cap = (n) => n[0].toUpperCase() + n.slice(1);
const presetSel = $("preset");
presetSel.innerHTML = `<option value="">(your own)</option>` + Object.keys(PRESETS).map((n) => `<option value="${n}">${cap(n)}</option>`).join("");
function loadPreset(name, quiet) {
  const p = PRESETS[name]; if (!p) return;
  state.harmonics = Array.from({ length: N_HARM }, (_, i) => p.harmonics[i] ?? 0);
  state.partials = (p.partials ?? []).map((q) => ({ ratio: q.ratio, amp: q.amp ?? 1, decay: q.decay ?? 0 }));
  state.adsr = { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3, ...p.envelope };
  state.amp = p.amp ?? 0.5; state.pan = p.pan ?? 0; state.detune = p.detune ?? 0;
  presetSel.value = name;
  syncAll(); renderPartials(); applyVoice();
  if (!quiet) announce(`Sound ${cap(name)} loaded.`);
}
presetSel.addEventListener("change", () => loadPreset(presetSel.value));
// Any manual edit makes it "your own" sound.
document.querySelectorAll("#harmonics, #harmonics2, #partials").forEach((el) => el.addEventListener("input", () => { presetSel.value = ""; }));

// ---------- volume shape (envelope) graph ----------
const SHAPES = {
  pluck: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.2 },
  pad: { attack: 0.6, decay: 0.5, sustain: 0.8, release: 1.5 },
  organ: { attack: 0.02, decay: 0.05, sustain: 0.9, release: 0.15 },
  swell: { attack: 1.2, decay: 1.5, sustain: 0.3, release: 2.5 },
};
const SHAPE_NAMES = { pluck: "Pluck", pad: "Pad", organ: "Organ", swell: "Bell-like swell" };
document.querySelectorAll("[data-shape]").forEach((b) => b.addEventListener("click", () => {
  state.adsr = { ...SHAPES[b.dataset.shape] }; syncAll(); applyVoice();
  announce(`${SHAPE_NAMES[b.dataset.shape]} shape. ${envSummary()}`);
}));
// Geometry (SVG user units). Time is drawn on a square-root scale per segment so short times stay visible.
const G = { x0: 12, k: 80, hold: 80, top: 14, bot: 166 };
const LIM = { attack: 3, decay: 4, release: 5 };
const geo = () => {
  const a = state.adsr, xa = G.x0 + G.k * Math.sqrt(a.attack), xd = xa + G.k * Math.sqrt(a.decay), xh = xd + G.hold;
  return { xa, xd, xh, xr: xh + G.k * Math.sqrt(a.release) };
};
const yOf = (lvl) => G.bot - lvl * (G.bot - G.top);
// Envelope level over each segment, matching the engine (linear attack, exponential decay/release).
function shapePoints(scale) {
  const a = state.adsr, g = geo(), pts = [[G.x0, yOf(0)]], N = 40;
  pts.push([g.xa, yOf(scale)]);
  const decayAt = (t) => a.sustain + (1 - a.sustain) * Math.exp(-3 * t / Math.max(0.001, a.decay));
  for (let i = 1; i <= N; i++) { const t = a.decay * (i / N) ** 2; pts.push([g.xa + G.k * Math.sqrt(t), yOf(scale * decayAt(t))]); }
  const lv = decayAt(a.decay);
  pts.push([g.xh, yOf(scale * lv)]);
  for (let i = 1; i <= N; i++) { const t = a.release * (i / N) ** 2; pts.push([g.xh + G.k * Math.sqrt(t), yOf(scale * lv * Math.exp(-5 * t / Math.max(0.001, a.release)))]); }
  pts.push([g.xr, yOf(0)]);
  return pts;
}
const svg = $("envgraph"), SVGNS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.append(e); return e; };
el("line", { x1: G.x0, y1: G.bot, x2: 590, y2: G.bot, class: "axis" });
const fill = el("path", { class: "env-fill" }), outline = el("path", { class: "env-line" });
const lblHeld = el("text", { class: "env-txt", y: 184 }), lblGo = el("text", { class: "env-txt", y: 184 }), lblStart = el("text", { class: "env-txt", x: G.x0, y: 184 });
lblStart.textContent = "press"; lblHeld.textContent = "held"; lblGo.textContent = "let go";
const playhead = el("line", { class: "playhead", y1: G.top - 6, y2: G.bot, visibility: "hidden" });
const handles = {};
for (const h of ["attack", "decay", "release"]) handles[h] = el("circle", { r: 9, class: "handle", "data-h": h });
function envSummary() {
  const a = state.adsr;
  return `Attack ${fmtTime(a.attack)}, decay ${fmtTime(a.decay)}, sustain ${Math.round(a.sustain * 100)}%, release ${fmtTime(a.release)}, volume ${Math.round(state.amp * 100)}%.`;
}
function drawEnvelope() {
  const g = geo(), d = (pts) => "M" + pts.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join("L");
  outline.setAttribute("d", d(shapePoints(1)));
  fill.setAttribute("d", d(shapePoints(state.amp)) + "Z");
  const set = (h, x, y) => { handles[h].setAttribute("cx", x.toFixed(1)); handles[h].setAttribute("cy", y.toFixed(1)); };
  set("attack", g.xa, yOf(1)); set("decay", g.xd, yOf(state.adsr.sustain)); set("release", g.xr, yOf(0));
  lblHeld.setAttribute("x", g.xd + 4); lblGo.setAttribute("x", g.xh);
  $("envsum").textContent = envSummary();
}
const stepRound = (v, st) => Math.round(v / st) * st;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Move one handle to SVG point (x, y): the drag logic, also used by the selftest. */
function dragHandle(h, x, y) {
  const g = geo(), a = state.adsr, sq = (dx) => (Math.max(0, dx) / G.k) ** 2;
  if (h === "attack") a.attack = round(clamp(stepRound(sq(x - G.x0), 0.005), 0, LIM.attack));
  if (h === "decay") { a.decay = round(clamp(stepRound(sq(x - g.xa), 0.01), 0, LIM.decay)); a.sustain = round(clamp(stepRound((G.bot - y) / (G.bot - G.top), 0.01), 0, 1)); }
  if (h === "release") a.release = round(clamp(stepRound(sq(x - g.xh), 0.01), 0, LIM.release));
  syncAll(); applyVoice();
}
function svgPoint(e) {
  const m = svg.getScreenCTM(); if (!m) return null;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return [p.x, p.y];
}
let dragging = null;
svg.addEventListener("pointerdown", (e) => {
  const h = e.target?.dataset?.h; if (!h) return;
  e.preventDefault(); dragging = h;
  try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
});
svg.addEventListener("pointermove", (e) => { if (!dragging) return; const p = svgPoint(e); if (p) dragHandle(dragging, p[0], p[1]); });
const endDrag = () => { if (dragging) { dragging = null; announce(envSummary()); } };
for (const ev of ["pointerup", "pointercancel"]) svg.addEventListener(ev, endDrag);
// Playhead: follows the most recent note through attack/decay, waits in "held", then runs the release.
let ph = null; // { t0, rel }
function drawPlayhead() {
  if (!ph || !started) return playhead.setAttribute("visibility", "hidden");
  const now = engine.context.currentTime, a = state.adsr, g = geo();
  let x;
  if (ph.rel === null || now < ph.rel) {
    const t = now - ph.t0;
    x = t < a.attack ? G.x0 + G.k * Math.sqrt(t) : t < a.attack + a.decay ? g.xa + G.k * Math.sqrt(t - a.attack) : g.xd + Math.min(G.hold - 4, (t - a.attack - a.decay) * 20);
  } else {
    const t = now - ph.rel;
    if (t > a.release) { ph = null; return playhead.setAttribute("visibility", "hidden"); }
    x = g.xh + G.k * Math.sqrt(t);
  }
  playhead.setAttribute("x1", x.toFixed(1)); playhead.setAttribute("x2", x.toFixed(1)); playhead.setAttribute("visibility", "visible");
}
function markStart(h, dur) {
  if (!started) return;
  const t0 = engine.context.currentTime, a = state.adsr;
  ph = { t0, rel: dur !== undefined ? t0 + dur : a.sustain === 0 ? t0 + a.attack + a.decay * 2 : null, h };
}
function markRelease(h) { if (ph && ph.h === h && ph.rel === null) ph.rel = engine.context.currentTime; }

// ---------- tuning & scale ----------
let sclText = null, kbmText = null, scaleName = "";
const tuningSel = $("tuning");
const TUNING_NAMES = { "12tet": "Western (12 equal steps)", just5: "Just intonation (12 pure steps)", shruti22: "Indian 22 shruti",
  slendro: "Gamelan slendro (5 steps)", pelog: "Gamelan pelog (7 steps)", "edo:19": "19 equal steps", "edo:24": "Quarter tones (24 steps)", "edo:31": "31 equal steps" };
const tunings = [...BUILTIN_TUNINGS, "edo:19", "edo:24", "edo:31"];
tuningSel.innerHTML = tunings.map((t) => `<option value="${t}">${TUNING_NAMES[t] ?? t}</option>`).join("") + `<option value="__scl" hidden>Your tuning file</option>`;
const scaleSel = $("scale");
// Period (steps per repeat) of each built-in scale, so the picker only offers scales that fit the tuning.
const SCALE_PERIOD = Object.fromEntries(BUILTIN_SCALES.filter((s) => s !== "chromatic").map((s) => [s, createScale(s).period]));
const scaleLabel = (s) => s.split("-").map(cap).join(" ").replace(/ 22$/, " (22 shruti)");
function fillScales() {
  const size = engine.tuning.size, fits = Object.keys(SCALE_PERIOD).filter((s) => SCALE_PERIOD[s] === size);
  scaleSel.innerHTML = `<option value="">All notes</option>` + fits.map((s) => `<option value="${s}">${scaleLabel(s)}</option>`).join("");
  if (!fits.includes(scaleName)) scaleName = "";
  scaleSel.value = scaleName;
  return fits;
}
const GAMELAN = new Set(["slendro", "pelog"]);
let gamelanVoiceOffered = false;
async function applyTuning() {
  try {
    const v = tuningSel.value;
    engine.setScale(null); // re-applied below; a scale may not fit the new tuning's size
    await engine.setTuning(v === "__scl" ? { scl: sclText, ...(kbmText ? { kbm: kbmText } : {}) } : v);
    const t = engine.tuning, fits = fillScales();
    let extra = "";
    if (GAMELAN.has(v)) {
      if (!scaleName) { scaleName = v === "pelog" ? "pelog-nem" : "slendro"; scaleSel.value = scaleName; }
      if (!gamelanVoiceOffered) { gamelanVoiceOffered = true; loadPreset("saron", true); extra = " Switched the sound to Saron, a gamelan metal bar."; }
    }
    $("tinfo").textContent = `${TUNING_NAMES[v] ?? t.name ?? v}: ${t.size} notes, then the pattern repeats ${Math.abs(t.periodCents - 1200) < 0.01 ? "an octave higher" : `${Math.round(t.periodCents)} cents higher (a slightly stretched octave)`}. ${fits.length} matching scales.`;
    applyScale(true);
    buildKeyboard();
    announce(`Tuning ${TUNING_NAMES[v] ?? t.name ?? v}, ${t.size} notes.${scaleName ? ` Scale ${scaleLabel(scaleName)}.` : ""}${extra}`);
  } catch (e) { announce(`Tuning problem: ${errMsg(e)}`); $("tinfo").textContent = `Tuning problem: ${errMsg(e)}`; }
}
function applyScale(quiet) {
  try { engine.setScale(scaleName || null); if (!quiet) announce(scaleName ? `Scale ${scaleLabel(scaleName)}` : "All notes"); }
  catch (e) {
    announce(`Scale problem: ${errMsg(e)}. Using all notes.`);
    scaleName = ""; scaleSel.value = "";
    try { engine.setScale(null); } catch { /* ignore */ }
  }
  markScale(); showCurrent();
}
tuningSel.addEventListener("change", applyTuning);
scaleSel.addEventListener("change", () => { scaleName = scaleSel.value; applyScale(); });
function fileInto(inputId, setter, label) {
  $(inputId).addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setter(await f.text());
    if (!sclText) return announce(`${label} loaded. Now choose a tuning file.`);
    const opt = tuningSel.querySelector("[value=__scl]"); opt.hidden = false; opt.textContent = `Your file ${f.name}`;
    tuningSel.value = "__scl"; applyTuning();
  });
}
fileInto("scl", (t) => { sclText = t; }, "Tuning file"); fileInto("kbm", (t) => { kbmText = t; }, "Keyboard map");

// ---------- notes that sound (pads, current note, Play) ----------
const held = new Map(); // source -> { step, h, stopped }
let pads = [];
async function noteOn(step, src) {
  if (held.has(src)) return;
  const rec = { stopped: false, step }; held.set(src, rec);
  pads[step]?.setAttribute("data-on", "");
  try {
    await startAudio();
    if (rec.stopped) return;
    rec.h = engine.play({ step, voice: VOICE });
    markStart(rec.h);
    rec.h.ended.then(() => { if (held.get(src) === rec) { held.delete(src); unmark(rec.step); if (src === "play") setPlayPressed(false); } });
    announce(`${noteName(step)}, ${engine.tuning.freq(step).toFixed(1)} hertz`);
  } catch (e) { held.delete(src); unmark(step); announce(`Could not play: ${errMsg(e)}`); }
}
const unmark = (step) => { if (![...held.values()].some((r) => r.step === step)) pads[step]?.removeAttribute("data-on"); };
function noteOff(src) {
  const rec = held.get(src); if (!rec) return;
  rec.stopped = true; if (rec.h) { rec.h.stop(); markRelease(rec.h); } held.delete(src);
  unmark(rec.step);
}
const noteName = (step) => { const t = engine.tuning, lab = t.labels?.[((step % t.size) + t.size) % t.size]; return `${lab ? `Tone ${lab}, ` : ""}step ${step}`; };

// ---------- keyboard pads ----------
const KEYS = "zxcvbnm,./asdfghjkl;'qwertyuiop[]".split("");
const kb = $("keyboard");
function buildKeyboard() {
  const t = engine.tuning, n = 2 * t.size + 1;
  kb.innerHTML = ""; pads = [];
  for (let step = 0; step < n; step++) {
    const hz = t.freq(step);
    const b = document.createElement("button"); b.type = "button"; b.dataset.step = step;
    const lab = t.labels?.[((step % t.size) + t.size) % t.size];
    const ok = Number.isFinite(hz);
    b.disabled = !ok;
    b.innerHTML = (KEYS[step] ? `<span class="k" aria-hidden="true">${KEYS[step].toUpperCase()}</span>` : "") +
      `<span>${lab ? lab + " · " : ""}${step}</span><small>${ok ? hz.toFixed(1) + " Hz" : "no note"}</small>`;
    b._hz = hz; b._lab = lab;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); noteOn(step, "p" + e.pointerId); });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, (e) => noteOff("p" + e.pointerId));
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    b.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) noteOn(step, "f" + step); } });
    b.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); noteOff("f" + step); } });
    kb.append(b); pads.push(b);
  }
  markScale();
}
function markScale() {
  const sc = engine.scale;
  pads.forEach((b) => {
    const step = +b.dataset.step; let inS = false;
    if (sc) { try { inS = sc.quantize(step) === step; } catch { inS = false; } }
    if (inS) b.dataset.scale = "1"; else delete b.dataset.scale;
    const where = sc ? (inS ? ", in scale" : ", outside scale") : "";
    b.setAttribute("aria-label", `${b._lab ? `tone ${b._lab}, ` : ""}step ${step}, ${Number.isFinite(b._hz) ? b._hz.toFixed(1) + " hertz" : "no note"}${where}`);
  });
}
// Letter keys play pads only while focus is inside the keyboard (WCAG 2.1.4: no page-wide character shortcuts).
kb.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const i = KEYS.indexOf(e.key.toLowerCase());
  if (i >= 0 && i < pads.length && !pads[i].disabled) { e.preventDefault(); noteOn(i, "c" + e.key.toLowerCase()); }
});
kb.addEventListener("keyup", (e) => noteOff("c" + e.key.toLowerCase()));
const releaseComputerKeys = () => [...held.keys()].filter((k) => k[0] === "c").forEach(noteOff);
kb.addEventListener("focusout", (e) => { if (!kb.contains(e.relatedTarget)) releaseComputerKeys(); });
window.addEventListener("blur", () => [...held.keys()].filter((k) => k !== "play").forEach(noteOff));

// ---------- current note ----------
const num = (id, lo, hi, dflt) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; };
const period = () => engine.scale?.period ?? engine.tuning.size;
// Octave shift 0 starts one period below middle C (C3 in 12-TET): low-to-mid notes are easier on the ear.
const octOffset = () => (Math.round(num("lt-oct", -2, 2, 0)) - 1) * period();
const curIndex = () => Math.round(parseFloat($("lt-n").value) || 0);
/** The current note as a tuning step: scale note number n (or tuning step n with "All notes"), plus octave shift. */
function currentStep() {
  const n = curIndex(), sc = engine.scale;
  return (sc ? sc.degree(n) : n) + octOffset();
}
function showCurrent() {
  const step = currentStep(), hz = engine.tuning.freq(step);
  $("curinfo").textContent = `Current note: ${noteName(step)}, ${Number.isFinite(hz) ? hz.toFixed(1) + " Hz" : "no note here"}.`;
}
$("lt-n").addEventListener("input", () => { showCurrent(); retuneHeld(); });
$("lt-oct").addEventListener("input", () => { showCurrent(); retuneHeld(); });
function retuneHeld() {
  const step = currentStep(); if (!Number.isFinite(engine.tuning.freq(step))) return;
  for (const src of ["play", "space", "cur"]) { const r = held.get(src); if (r?.h) { r.h.set({ step }, 0.03); unmark(r.step); r.step = step; pads[step]?.setAttribute("data-on", ""); } }
}
function moveCurrent(by) {
  $("lt-n").value = curIndex() + by;
  showCurrent(); retuneHeld();
  const step = currentStep(), hz = engine.tuning.freq(step);
  announce(`Note ${curIndex()}: ${noteName(step)}, ${Number.isFinite(hz) ? hz.toFixed(1) + " hertz" : "no note"}`);
}
function playCurrent(src) {
  const step = currentStep();
  if (!Number.isFinite(engine.tuning.freq(step))) { announce(`There is no note at step ${step} in this tuning.`); return false; }
  noteOn(step, src); return true;
}
// "Hold to play" button: pointer or Space/Enter held.
const cur = $("cur");
cur.addEventListener("pointerdown", (e) => { e.preventDefault(); cur.setPointerCapture?.(e.pointerId); playCurrent("cur"); });
for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) cur.addEventListener(ev, () => noteOff("cur"));
cur.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) playCurrent("cur"); } });
cur.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); noteOff("cur"); } });
cur.addEventListener("blur", () => noteOff("cur"));

// ---------- big Play / Stop ----------
const playBtn = $("play");
function setPlayPressed(on) { playBtn.setAttribute("aria-pressed", String(on)); playBtn.textContent = on ? "Playing (press to stop)" : "Play"; }
function togglePlay() {
  if (held.has("play")) { noteOff("play"); setPlayPressed(false); announce("Note stopped"); return; }
  if (playCurrent("play")) setPlayPressed(true);
}
playBtn.addEventListener("click", togglePlay);
function stopEverything() {
  run?.stop(0.02); run = null;
  for (const src of [...held.keys()]) noteOff(src);
  engine.stopAll(); setPlayPressed(false); ph = null;
  announce("Stopped");
}
$("stop").addEventListener("click", stopEverything);

// ---------- page shortcuts ----------
const isField = (t) => t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));
const onPage = (t) => !t || t === document.body || t === document.documentElement;
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (e.key === "Escape") { stopEverything(); return; } // never blocks Escape's own job (closing a menu)
  if (!$("sc-on").checked || isField(t) || t === cur) return;
  const inKb = kb.contains(t), inListen = $("listen").contains(t);
  if (e.key === " ") {
    if (!onPage(t)) return; // Space keeps activating whatever button has focus
    e.preventDefault(); if (!e.repeat) playCurrent("space");
  } else if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(e.key)) {
    if (!(onPage(t) || inListen || inKb || t === playBtn)) return;
    e.preventDefault(); moveCurrent(e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1);
  } else if ((e.key === "h" || e.key === "H") && !inKb && !e.repeat) {
    e.preventDefault(); togglePlay();
  }
});
document.addEventListener("keyup", (e) => { if (e.key === " ") noteOff("space"); });
$("sc-on").addEventListener("change", (e) => announce(e.target.checked ? "Shortcuts on" : "Shortcuts off. Escape still stops everything."));

// ---------- listen: scale runs and chord ----------
let run = null, lastScore = null;
const playable = (steps) => steps.filter((s) => Number.isFinite(engine.tuning.freq(s)));
function runSteps(dir) {
  const sc = engine.scale, periods = Math.round(num("lt-per", 1, 3, 1));
  const len = sc ? sc[dir].length : engine.tuning.size;
  const steps = Array.from({ length: len * periods + 1 }, (_, i) => (sc ? sc.degree(i, { direction: dir }) : i) + octOffset());
  return playable(dir === "down" ? steps.reverse() : steps);
}
function chordSteps() {
  const sc = engine.scale;
  return playable(Array.from({ length: sc ? sc.up.length : engine.tuning.size }, (_, i) => (sc ? sc.degree(i, { direction: "up" }) : i) + octOffset()));
}
async function listenPlay(kind) {
  try {
    await startAudio();
    run?.stop(0.02);
    const gap = 1 / num("lt-tempo", 0.5, 16, 3), dur = gap * num("lt-len", 0.1, 4, 0.9);
    let events, label;
    if (kind === "chord") {
      const steps = chordSteps(), amp = Math.min(1, 0.9 / Math.sqrt(steps.length)) * (state.amp / 0.5);
      events = steps.map((step) => ({ t: 0, step, dur: Math.max(dur, 1), amp: Math.min(1, amp), voice: VOICE }));
      label = `Chord of ${steps.length} notes`;
    } else {
      const steps = runSteps(kind);
      events = steps.map((step, i) => ({ t: i * gap, step, dur, voice: VOICE }));
      label = `${engine.scale ? scaleLabel(engine.scale.name) : "All notes"} ${kind === "up" ? "going up" : "going down"}, ${steps.length} notes`;
    }
    if (!events.length) return announce("No notes to play in this tuning.");
    // No score-level voices: notes look up "custom" in the engine as they are scheduled, so tone edits apply mid-run.
    lastScore = { version: 1, events };
    const mine = run = engine.playScore(lastScore);
    markStart(null, events[0].dur);
    announce(label);
    mine.ended.then(() => { if (run === mine) run = null; });
    await mine.ready;
  } catch (e) { announce(`Could not play: ${errMsg(e)}`); throw e; }
}
$("lt-up").addEventListener("click", () => listenPlay("up").catch(() => {}));
$("lt-down").addEventListener("click", () => listenPlay("down").catch(() => {}));
$("lt-chord").addEventListener("click", () => listenPlay("chord").catch(() => {}));
$("lt-stop").addEventListener("click", stopEverything);

// ---------- audio start & pictures ----------
let analyser = null, started = null;
function startAudio() {
  started ??= engine.start().then(() => {
    analyser = engine.context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.6;
    engine.master.connect(analyser);
  });
  started.catch(() => { started = null; });
  return started;
}
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function fit(c) {
  const r = devicePixelRatio || 1, w = Math.round(c.clientWidth * r), h = Math.round(c.clientHeight * r);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c.getContext("2d");
}
function partialList() {
  return [...state.harmonics.map((a, i) => ({ r: i + 1, a })), ...state.partials.map((p) => ({ r: p.ratio, a: p.amp }))].filter((p) => p.a > 0);
}
function draw() {
  const wc = $("wave"), sc = $("spec"), w = fit(wc), s = fit(sc);
  const col = css("--wave"), bg = css("--canvas"), dpr = devicePixelRatio || 1;
  let td = null;
  if (analyser) { td = new Float32Array(2048); analyser.getFloatTimeDomainData(td); }
  const live = td?.some((v) => Math.abs(v) > 0.001);
  const parts = partialList(), total = parts.reduce((t, p) => t + p.a, 0) || 1;
  w.fillStyle = bg; w.fillRect(0, 0, wc.width, wc.height); w.strokeStyle = col; w.lineWidth = 2 * dpr; w.beginPath();
  for (let x = 0; x < wc.width; x++) {
    let v;
    if (live) v = td[Math.floor((x / wc.width) * 1024)] * 1.6;
    else { const p = (x / wc.width) * 4 * Math.PI; v = 0.9 * parts.reduce((t, q) => t + q.a * Math.sin(p * q.r), 0) / total; }
    const y = wc.height / 2 - v * (wc.height / 2);
    x ? w.lineTo(x, y) : w.moveTo(x, y);
  }
  w.stroke();
  s.fillStyle = bg; s.fillRect(0, 0, sc.width, sc.height); s.fillStyle = col;
  if (live) {
    const f = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(f);
    const bins = Math.floor(8000 / (engine.context.sampleRate / analyser.fftSize)), bw = sc.width / bins;
    for (let i = 0; i < bins; i++) { const h = (f[i] / 255) * sc.height; s.fillRect(i * bw, sc.height - h, Math.max(1, bw), h); }
  } else {
    const f0 = 261.6, pk = Math.max(1e-6, ...parts.map((p) => p.a));
    for (const p of parts) {
      const x = (p.r * f0 / 8000) * sc.width; if (x > sc.width) continue;
      const h = (p.a / pk) * sc.height * 0.9; s.fillRect(x - 2 * dpr, sc.height - h, 4 * dpr, h);
    }
  }
  drawPlayhead();
}
const slow = matchMedia("(prefers-reduced-motion: reduce)").matches;
const loop = () => { try { draw(); } catch { /* ignore */ } slow ? setTimeout(loop, 250) : requestAnimationFrame(loop); };
document.addEventListener("pointerdown", () => startAudio().catch(() => {}), { once: true });

// ---------- developers ----------
document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
  const ta = $(b.dataset.copy); ta.select();
  try { await navigator.clipboard.writeText(ta.value); announce("Copied"); } catch { announce("Press Control C to copy the selected text"); }
}));

// ---------- init ----------
loadPreset("organ", true);
await applyTuning();
loop();

// Dev hook: playground.html#selftest exercises the page and logs "SELFTEST ok" or "SELFTEST fail: ...".
if (location.hash === "#selftest") {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const key = (type, k, target = document.body) => target.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
  (async () => {
    try {
      await startAudio();
      // runs, chord with yaman
      scaleSel.value = "yaman"; scaleSel.dispatchEvent(new Event("change"));
      ok(engine.scale?.name === "yaman", "yaman not selected");
      await listenPlay("up"); await listenPlay("down"); await listenPlay("chord");
      // runs use the CURRENT tone: change a harmonic mid-run and check the voice the next notes resolve
      await listenPlay("up");
      const h2 = $("h1"); h2.value = "0.37"; h2.dispatchEvent(new Event("input"));
      ok(engine.voice(VOICE).harmonics[1] === 0.37, "custom voice did not follow harmonic slider");
      ok(lastScore.events.every((e) => e.voice === VOICE) && !lastScore.voices, "run does not use the live custom voice");
      $("attack").value = "0.05"; $("attack").dispatchEvent(new Event("input"));
      ok(engine.voice(VOICE).envelope.attack === 0.05, "envelope slider not applied");
      $("amp").value = "0.6"; $("amp").dispatchEvent(new Event("input"));
      ok(engine.voice(VOICE).amp === 0.6, "volume not applied");
      // live timbre: hold Play, move a harmonic slider several times in one frame, the held note follows (batched)
      $("stop").click(); await wait(50);
      togglePlay(); await wait(80);
      const ph = held.get("play")?.h; ok(ph, "Play did not hold a note");
      const calls = []; const realSet = ph.set; ph.set = (p, ...r) => { calls.push(p); return realSet(p, ...r); };
      const before = live.updates;
      for (const v of ["0.1", "0.5", "0.9"]) { const s = $("h8"); s.value = v; s.dispatchEvent(new Event("input")); }
      await wait(120);
      ok(calls.some((p) => p.voice === VOICE), "held Play note's timbre was not updated live");
      ok(live.updates - before === 1, `slider updates not batched per frame (${live.updates - before} pushes)`);
      ok(engine.voice(VOICE).harmonics[8] === 0.9, "voice does not have the new 9th harmonic");
      // stereo controls: hidden in mono, shown in stereo
      ok(engine.output === "mono" && stereoBox.hidden, "page should start in mono with stereo controls hidden");
      $("out-stereo").click(); ok(engine.output === "stereo" && !stereoBox.hidden, "stereo choice did not switch");
      $("width").value = "0.5"; $("width").dispatchEvent(new Event("input")); ok(engine.width === 0.5, "width slider");
      $("out-mono").click(); ok(engine.output === "mono" && stereoBox.hidden, "mono choice did not switch back");
      togglePlay(); ok(!held.has("play"), "Play did not stop");
      // shortcuts: Space down/up on the page, arrows, H, Escape
      document.activeElement?.blur();
      key("keydown", " "); await wait(50);
      ok(held.has("space") && held.get("space").h, "Space did not start the current note");
      key("keyup", " "); ok(!held.has("space"), "Space release did not end the note");
      $("lt-n").value = "0"; key("keydown", "ArrowUp");
      ok(curIndex() === 1 && currentStep() === engine.scale.degree(1) - engine.scale.period, "ArrowUp did not move the current note");
      key("keydown", "ArrowDown"); ok(curIndex() === 0, "ArrowDown did not move back");
      key("keydown", "h"); await wait(50); ok(held.has("play"), "H did not start a held note");
      key("keydown", "Escape"); ok(!held.size && !run, "Escape did not stop everything");
      $("lt-n").value = "0"; $("lt-n").focus(); key("keydown", " ", $("lt-n")); ok(!held.has("space"), "Space fired inside a text box");
      $("lt-n").blur();
      // envelope graph drag via pointer events
      const hd = handles.decay, box = svg.getBoundingClientRect(), m = svg.getScreenCTM();
      const toScreen = (x, y) => new DOMPoint(x, y).matrixTransform(m);
      const target = toScreen(geo().xa + G.k * Math.sqrt(1), yOf(0.5));
      ok(box.width > 0, "graph not laid out");
      hd.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 0, clientY: 0 }));
      svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: target.x, clientY: target.y }));
      svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
      ok(Math.abs(+$("decay").value - 1) < 0.02 && Math.abs(+$("sustain").value - 0.5) < 0.02, `drag gave decay ${$("decay").value} sustain ${$("sustain").value}`);
      ok(engine.voice(VOICE).envelope.decay === +$("decay").value, "drag did not reach the voice");
      dragHandle("release", geo().xh + G.k * Math.sqrt(2), 0); ok(Math.abs(+$("release").value - 2) < 0.02, "release drag");
      // pelog + pelog-nem + gamelan voice, then a run
      tuningSel.value = "pelog"; await applyTuning();
      ok(engine.tuning.name === "pelog" && engine.tuning.periodCents === 1220, "pelog not set");
      ok([...scaleSel.options].every((o) => !o.value || SCALE_PERIOD[o.value] === 7), "scale list not filtered to 7-step scales");
      scaleSel.value = "pelog-nem"; scaleSel.dispatchEvent(new Event("change"));
      ok(engine.scale?.name === "pelog-nem", "pelog-nem not selected");
      ok(presetSel.value === "saron" && engine.voice(VOICE).partials.length === 4, "gamelan voice not loaded");
      await listenPlay("up");
      const steps = lastScore.events.map((e) => e.step);
      ok(steps.join() === "-7,-6,-5,-3,-2,0", `pelog-nem run steps ${steps}`);
      ok(Math.abs(engine.tuning.freq(7) / engine.tuning.freq(0) - Math.pow(2, 1220 / 1200)) < 1e-9, "stretched period");
      ok(pads.length === 15 && /Hz/.test(pads[3].textContent), "pads not rebuilt for pelog");
      await wait(300); $("stop").click();
      console.log("SELFTEST ok");
    } catch (e) { console.log(`SELFTEST fail: ${errMsg(e)}`); }
  })();
}
