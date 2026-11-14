import { createEngine, PRESETS, BUILTIN_TUNINGS, BUILTIN_SCALES } from "../js/index.js";
import { announce, errMsg, mountScorePlayer, mountBridgePanel } from "./common.js";

const $ = (id) => document.getElementById(id);
const N_HARM = 24;
const engine = createEngine();

// ---------- voice state ----------
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
const vname = () => $("vname").value.trim().replace(/[^\w-]/g, "_") || "myvoice";

function applyVoice() {
  const def = voiceDef();
  try { engine.voice("custom", def); engine.voice(vname(), def); } catch (e) { announce(`Voice error: ${errMsg(e)}`); }
  const json = JSON.stringify(def, null, 2);
  $("outjson").value = json;
  $("outjs").value = `engine.voice(${JSON.stringify(vname())}, ${json});`;
  const py = [`harmonics=${JSON.stringify(def.harmonics)}`];
  if (def.partials) py.push(`partials=${JSON.stringify(def.partials)}`);
  for (const k of ["attack", "decay", "sustain", "release"]) py.push(`${k}=${def.envelope[k]}`);
  $("outpy").value = `s.voice(${JSON.stringify(vname())},\n    ${py.join(",\n    ")})` +
    `\n# amp=${def.amp} and pan=${def.pan} are per-note: s.note(..., amp=${def.amp}, pan=${def.pan})`;
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
  syncs.push(slider($("harmonics"), { id: `h${i}`, label: i ? `Harmonic ${i + 1}` : "Harmonic 1 (fundamental)", min: 0, max: 1, step: 0.01,
    get: () => state.harmonics[i], set: (v) => { state.harmonics[i] = v; }, fmt: (v) => v.toFixed(2) }));
const adsrBox = $("env");
const E = (id, label, key, max, step) => syncs.push(slider(adsrBox, { id, label, min: 0, max, step, get: () => state.adsr[key], set: (v) => { state.adsr[key] = v; }, fmt: (v) => v.toFixed(2) + (key === "sustain" ? "" : " s") }));
E("attack", "Attack", "attack", 3, 0.005); E("decay", "Decay", "decay", 4, 0.01);
E("sustain", "Sustain level", "sustain", 1, 0.01); E("release", "Release", "release", 5, 0.01);
syncs.push(slider(adsrBox, { id: "amp", label: "Amplitude", min: 0, max: 1, step: 0.01, get: () => state.amp, set: (v) => { state.amp = v; }, fmt: (v) => v.toFixed(2) }));
syncs.push(slider(adsrBox, { id: "pan", label: "Pan (left -1 to right 1)", min: -1, max: 1, step: 0.01, get: () => state.pan, set: (v) => { state.pan = v; }, fmt: (v) => v.toFixed(2) }));

// ---------- partials ----------
function renderPartials(focus) {
  const tb = $("partials"); tb.innerHTML = "";
  state.partials.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><label class="sr-only" for="pr${i}">Partial ${i + 1} ratio</label><input type="number" id="pr${i}" min="0.01" step="0.01" value="${p.ratio}"></td>
      <td><label class="sr-only" for="pa${i}">Partial ${i + 1} amplitude</label><input type="number" id="pa${i}" min="0" max="10" step="0.05" value="${p.amp}"></td>
      <td><label class="sr-only" for="pd${i}">Partial ${i + 1} decay seconds</label><input type="number" id="pd${i}" min="0" step="0.1" value="${p.decay || ""}"></td>
      <td><button type="button" aria-label="Remove partial ${i + 1}">Remove</button></td>`;
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
      applyVoice(); announce(`Removed partial ${i + 1}. ${state.partials.length} remaining.`);
    });
    tb.append(tr);
  });
  $("nopartials").hidden = state.partials.length > 0;
  tb.closest("table").hidden = !state.partials.length;
  if (focus) $(focus)?.focus();
}
$("addpartial").addEventListener("click", () => {
  state.partials.push({ ratio: 2.76, amp: 0.4, decay: 0 });
  renderPartials(`pr${state.partials.length - 1}`); applyVoice(); announce(`Added partial ${state.partials.length}.`);
});

// ---------- presets ----------
const presetSel = $("preset");
presetSel.innerHTML = `<option value="">(custom)</option>` + Object.keys(PRESETS).map((n) => `<option value="${n}">${n[0].toUpperCase() + n.slice(1)}</option>`).join("");
function loadPreset(name) {
  const p = PRESETS[name]; if (!p) return;
  state.harmonics = Array.from({ length: N_HARM }, (_, i) => p.harmonics[i] ?? 0);
  state.partials = (p.partials ?? []).map((q) => ({ ratio: q.ratio, amp: q.amp ?? 1, decay: q.decay ?? 0 }));
  state.adsr = { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3, ...p.envelope };
  state.amp = p.amp ?? 0.5; state.pan = p.pan ?? 0; state.detune = p.detune ?? 0;
  syncs.forEach((f) => f()); renderPartials(); applyVoice();
  announce(`Loaded preset ${name}.`);
}
presetSel.addEventListener("change", () => loadPreset(presetSel.value));
$("vname").addEventListener("input", applyVoice);

// ---------- tuning & scale ----------
let sclText = null, kbmText = null, direction = "up", scaleName = "";
const tuningSel = $("tuning");
const tunings = [...BUILTIN_TUNINGS, "edo:19", "edo:24", "edo:31"];
tuningSel.innerHTML = tunings.map((t) => `<option>${t}</option>`).join("") + `<option value="__scl" hidden>Loaded .scl file</option>`;
const scaleSel = $("scale");
const scales = BUILTIN_SCALES.length ? BUILTIN_SCALES : ["major", "minor", "pentatonic-major", "yaman", "bhairav", "yaman-22", "bhairav-22"];
scaleSel.innerHTML = `<option value="">None (all steps)</option>` + scales.map((s) => `<option>${s}</option>`).join("");

async function applyTuning() {
  try {
    const v = tuningSel.value;
    engine.setScale(null); // re-applied below; a scale may not fit the new tuning's size
    await engine.setTuning(v === "__scl" ? { scl: sclText, ...(kbmText ? { kbm: kbmText } : {}) } : v);
    const t = engine.tuning;
    $("tinfo").textContent = `${t.name ?? v}: ${t.size} steps per period. Step 0 is ${t.freq(0).toFixed(2)} Hz.`;
    announce(`Tuning ${t.name ?? v}, ${t.size} steps per period.`);
    applyScale(true);
    buildKeyboard();
  } catch (e) { announce(`Tuning error: ${errMsg(e)}`); $("tinfo").textContent = `Tuning error: ${errMsg(e)}`; }
}
function applyScale(quiet) {
  try { engine.setScale(scaleName || null); if (!quiet) announce(scaleName ? `Scale ${scaleName}` : "No scale"); }
  catch (e) {
    announce(`Scale error: ${errMsg(e)}. Scale set to none.`); $("tinfo").textContent = `Scale error: ${errMsg(e)}`;
    scaleName = ""; scaleSel.value = "";
    try { engine.setScale(null); } catch { /* ignore */ }
  }
  markScale();
}
tuningSel.addEventListener("change", applyTuning);
scaleSel.addEventListener("change", () => { scaleName = scaleSel.value; applyScale(); });
document.querySelectorAll("input[name=dir]").forEach((r) => r.addEventListener("change", () => { direction = r.value; markScale(); announce(direction === "up" ? "Ascending notes marked" : "Descending notes marked"); }));
function fileInto(inputId, setter, label) {
  $(inputId).addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setter(await f.text());
    if (!sclText) return announce(`${label} loaded. Now load a .scl file.`);
    const opt = tuningSel.querySelector("[value=__scl]"); opt.hidden = false; opt.textContent = `Loaded ${f.name}`;
    tuningSel.value = "__scl"; applyTuning();
  });
}
fileInto("scl", (t) => { sclText = t; }, ".scl file"); fileInto("kbm", (t) => { kbmText = t; }, ".kbm file");

// ---------- keyboard ----------
const KEYS = "zxcvbnm,./asdfghjkl;'qwertyuiop[]".split("");
const kb = $("keyboard");
let pads = [];
const held = new Map();
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
      `<span>${lab ? lab + " " : ""}Step ${step}</span><small>${ok ? hz.toFixed(1) + " Hz" : "unmapped"}</small>`;
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
    if (sc) { try { inS = sc.quantize(step, { direction }) === step; } catch { inS = false; } }
    if (inS) b.dataset.scale = "1"; else delete b.dataset.scale;
    const where = sc ? (inS ? ", in scale" : ", outside scale") : "";
    b.setAttribute("aria-label", `${b._lab ? b._lab + ", " : ""}step ${step}, ${Number.isFinite(b._hz) ? b._hz.toFixed(1) + " hertz" : "unmapped"}${where}`);
  });
}
async function noteOn(step, src) {
  if (held.has(src)) return;
  const rec = { stopped: false, step }; held.set(src, rec);
  pads[step]?.setAttribute("data-on", "");
  try {
    await startAudio();
    if (rec.stopped) return;
    rec.h = engine.play({ step, voice: "custom" });
    announce(`Step ${step}, ${engine.tuning.freq(step).toFixed(1)} hertz`);
  } catch (e) { announce(`Could not play: ${errMsg(e)}`); }
}
function noteOff(src) {
  const rec = held.get(src); if (!rec) return;
  rec.stopped = true; rec.h?.stop(); held.delete(src);
  if (![...held.values()].some((r) => r.step === rec.step)) pads[rec.step]?.removeAttribute("data-on");
}
// Computer keys play only while focus is inside the keyboard (WCAG 2.1.4: no page-wide character shortcuts).
kb.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const i = KEYS.indexOf(e.key.toLowerCase());
  if (i >= 0 && i < pads.length && !pads[i].disabled) { e.preventDefault(); noteOn(i, "c" + e.key.toLowerCase()); }
});
kb.addEventListener("keyup", (e) => noteOff("c" + e.key.toLowerCase()));
const releaseComputerKeys = () => [...held.keys()].filter((k) => k[0] === "c").forEach(noteOff);
kb.addEventListener("focusout", (e) => { if (!kb.contains(e.relatedTarget)) releaseComputerKeys(); });
window.addEventListener("blur", () => [...held.keys()].forEach(noteOff));

// ---------- listen: scale runs, chord, single note ----------
// Dev hook: open playground.html#selftest to click the Listen buttons (yaman asc/desc, chord, note) and
// console.log "SELFTEST ok" or "SELFTEST fail: ...". Used for headless checks.
let run = null;
const num = (id, lo, hi, dflt) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; };
const period = () => engine.scale?.period ?? engine.tuning.size;
const octOffset = () => Math.round(num("lt-oct", -2, 2, 0)) * period();
const playable = (steps) => steps.filter((s) => Number.isFinite(engine.tuning.freq(s)));
// One period (or more) of steps plus the top note, in playing order, using the scale's up or down set.
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
function setRunning(on, label) {
  $("lt-stop").disabled = !on;
  if (label) announce(label);
}
async function listenPlay(kind) {
  try {
    await startAudio();
    run?.stop(0.02);
    const gap = 1 / num("lt-tempo", 0.5, 16, 3), dur = gap * num("lt-len", 0.1, 4, 0.9);
    let events, label;
    if (kind === "chord") {
      const steps = chordSteps(), amp = Math.min(1, 0.9 / Math.sqrt(steps.length));
      events = steps.map((step) => ({ t: 0, step, dur: Math.max(dur, 1), amp, voice: "custom" }));
      label = `Chord of ${steps.length} notes`;
    } else {
      const steps = runSteps(kind);
      events = steps.map((step, i) => ({ t: i * gap, step, dur, voice: "custom" }));
      label = `${engine.scale?.name ?? "All steps"} ${kind === "up" ? "ascending" : "descending"}, ${steps.length} notes`;
    }
    if (!events.length) return announce("No playable notes for this tuning.");
    const mine = run = engine.playScore({ version: 1, events });
    setRunning(true, label);
    mine.ended.then(() => { if (run === mine) { run = null; setRunning(false); } });
    await mine.ready;
  } catch (e) { setRunning(false); announce(`Could not play: ${errMsg(e)}`); throw e; }
}
async function listenNote() {
  try {
    await startAudio();
    const n = Math.round(parseFloat($("lt-n").value) || 0), mode = document.querySelector("input[name=lt-mode]:checked").value;
    const sc = engine.scale, deg = mode === "degree" && sc;
    const step = (deg ? sc.degree(n) : n) + octOffset(), hz = engine.tuning.freq(step);
    if (!Number.isFinite(hz)) return announce(`Step ${step} is unmapped in this tuning.`);
    engine.play({ step, voice: "custom", dur: 1 });
    announce(`${deg ? `Degree ${n}, ` : mode === "degree" ? "No scale selected, using raw step. " : ""}Step ${step}, ${hz.toFixed(1)} Hz`);
  } catch (e) { announce(`Could not play: ${errMsg(e)}`); throw e; }
}
$("lt-up").addEventListener("click", () => listenPlay("up").catch(() => {}));
$("lt-down").addEventListener("click", () => listenPlay("down").catch(() => {}));
$("lt-chord").addEventListener("click", () => listenPlay("chord").catch(() => {}));
$("lt-note").addEventListener("click", () => listenNote().catch(() => {}));
$("lt-stop").addEventListener("click", () => { run?.stop(); run = null; engine.stopAll(); setRunning(false, "Stopped"); });

// ---------- audio start & analyser ----------
let analyser = null, started = null;
function startAudio() {
  started ??= engine.start().then(() => {
    analyser = engine.context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.6;
    engine.master.connect(analyser);
    $("start").hidden = true; announce("Audio started");
    startDrawing();
  });
  started.catch(() => { started = null; });
  return started;
}
$("start").addEventListener("click", () => startAudio().catch((e) => announce(`Audio error: ${errMsg(e)}`)));
document.addEventListener("pointerdown", () => startAudio().catch(() => {}), { once: true });

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
  const td = new Float32Array(2048); analyser.getFloatTimeDomainData(td);
  const live = td.some((v) => Math.abs(v) > 0.001);
  const parts = partialList(), total = parts.reduce((t, p) => t + p.a, 0) || 1;
  w.fillStyle = bg; w.fillRect(0, 0, wc.width, wc.height); w.strokeStyle = col; w.lineWidth = 2 * dpr; w.beginPath();
  for (let x = 0; x < wc.width; x++) {
    let v;
    if (live) v = td[Math.floor((x / wc.width) * 1024)] * 1.6;
    else { const ph = (x / wc.width) * 4 * Math.PI; v = 0.9 * parts.reduce((t, p) => t + p.a * Math.sin(ph * p.r), 0) / total; }
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
    const f0 = engine.tuning.freq(9) || 440, pk = Math.max(1e-6, ...parts.map((p) => p.a));
    for (const p of parts) {
      const x = (p.r * f0 / 8000) * sc.width; if (x > sc.width) continue;
      const h = (p.a / pk) * sc.height * 0.9; s.fillRect(x - 2 * dpr, sc.height - h, 4 * dpr, h);
    }
  }
}
let timer = null;
function startDrawing() {
  const slow = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const loop = () => { try { draw(); } catch { /* ignore */ } timer = slow ? setTimeout(loop, 250) : requestAnimationFrame(loop); };
  clearTimeout(timer); loop();
}

// ---------- export ----------
document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
  const ta = $(b.dataset.copy); ta.select();
  try { await navigator.clipboard.writeText(ta.value); announce("Copied to clipboard"); } catch { announce("Press Control C to copy the selected text"); }
}));
$("dljson").addEventListener("click", () => {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([$("outjson").value], { type: "application/json" })), download: `${vname()}.json` });
  document.body.append(a); a.click(); a.remove(); announce("Voice JSON downloaded");
});

// ---------- score + bridge ----------
mountScorePlayer($("score"), engine, { getVoices: () => ({ custom: voiceDef(), [vname()]: voiceDef() }) });
mountBridgePanel($("bridge"), engine);

// ---------- init ----------
loadPreset("organ");
presetSel.value = "organ";
applyTuning();

if (location.hash === "#selftest") {
  (async () => {
    try {
      scaleSel.value = "yaman"; scaleSel.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 500));
      if (engine.scale?.name !== "yaman") throw new Error("yaman not selected");
      await listenPlay("up"); await listenPlay("down"); await listenPlay("chord");
      $("lt-n").value = "-3"; await listenNote(); $("lt-stop").click();
      console.log("SELFTEST ok");
    } catch (e) { console.log(`SELFTEST fail: ${errMsg(e)}`); }
  })();
}
