// Shared UI helpers for player.html and playground.html. No dependencies.
import { renderScore, toWav, validateScore, normalizeScore, connectBridge, DEFAULT_BRIDGE_URL } from "../js/index.js";

const $ = (root, sel) => root.querySelector(sel);
export const fmtTime = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}` : "unknown");

/** Announce text to screen readers via the page's #announcer (aria-live=polite). */
export function announce(msg) {
  const el = document.getElementById("announcer");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = msg; }, 30);
}

export function errMsg(e) { return e?.message ?? String(e); }

/**
 * Score loader + transport. Builds a labelled file input, drop area, info list, Play/Stop, Download WAV.
 * opts.getVoices(): extra voices passed to render; opts.autoUrl: score URL to load at startup.
 */
export function mountScorePlayer(container, engine, opts = {}) {
  container.innerHTML = `
    <div class="drop" data-drop>
      <div class="field"><label for="${container.id}-file">Score file (.json)</label>
      <input type="file" id="${container.id}-file" accept=".json,application/json"></div>
      <p>or drop a score file here, or load from a URL:</p>
      <div class="row"><div class="field"><label for="${container.id}-url">Score URL</label>
        <input type="url" id="${container.id}-url" size="40" placeholder="https://… or ./score.json"></div>
        <button type="button" data-loadurl>Load URL</button></div>
    </div>
    <p role="status" data-msg></p>
    <dl class="info"><dt>Title</dt><dd data-title>none loaded</dd><dt>Duration</dt><dd data-dur>-</dd><dt>Events</dt><dd data-count>-</dd></dl>
    <div class="row"><button type="button" class="primary" data-play disabled>Play</button>
      <button type="button" data-stop disabled>Stop</button>
      <button type="button" data-wav disabled>Download WAV</button></div>`;
  const q = (s) => $(container, s);
  let score = null, playing = null;
  const msg = (t, bad) => { const m = q("[data-msg]"); m.textContent = t; m.className = bad ? "bad" : ""; announce(t); };
  const setButtons = () => {
    q("[data-play]").disabled = !score || !!playing; q("[data-stop]").disabled = !playing; q("[data-wav]").disabled = !score;
  };

  function setScore(obj, label) {
    let errors = [];
    try { const v = validateScore(obj); if (!v.valid) errors = v.errors; } catch { /* validator unavailable */ }
    if (errors.length) { score = null; setButtons(); return msg(`Invalid score: ${errors.slice(0, 5).join("; ")}`, true); }
    score = obj;
    let dur;
    try { dur = normalizeScore(obj).duration; } catch {
      dur = Math.max(0, ...(obj.events ?? []).map((e) => (e.t ?? 0) + (e.dur ?? e.duration ?? 0)));
    }
    q("[data-title]").textContent = obj.title || label || "Untitled";
    q("[data-dur]").textContent = fmtTime(dur);
    q("[data-count]").textContent = String((obj.events ?? []).length);
    setButtons();
    msg(`Loaded ${obj.title || label || "score"}: ${(obj.events ?? []).length} events, ${fmtTime(dur)}.`);
  }
  async function fromText(text, label) {
    try { setScore(JSON.parse(text), label); } catch (e) { score = null; setButtons(); msg(`Could not read score: ${errMsg(e)}`, true); }
  }
  async function fromURL(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await fromText(await r.text(), url.split("/").pop());
    } catch (e) { msg(`Could not load ${url}: ${errMsg(e)}`, true); }
  }
  const fromFile = async (f) => f && fromText(await f.text(), f.name);

  q(`input[type=file]`).addEventListener("change", (e) => fromFile(e.target.files[0]));
  q("[data-loadurl]").addEventListener("click", () => { const u = q("input[type=url]").value.trim(); if (u) fromURL(u); });
  const drop = q("[data-drop]");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); fromFile(e.dataTransfer.files[0]); });

  q("[data-play]").addEventListener("click", async () => {
    try {
      await engine.start();
      const p = engine.playScore(score);
      playing = p; setButtons(); announce("Playing");
      p.ended.then(() => { if (playing === p) { playing = null; setButtons(); announce("Finished"); } }, (e) => { playing = null; setButtons(); msg(errMsg(e), true); });
      await p.ready;
    } catch (e) { playing = null; setButtons(); msg(`Playback failed: ${errMsg(e)}`, true); }
  });
  q("[data-stop]").addEventListener("click", () => { playing?.stop(0.05); playing = null; setButtons(); announce("Stopped"); });
  q("[data-wav]").addEventListener("click", async () => {
    const b = q("[data-wav]"); b.disabled = true; msg("Rendering WAV...");
    try {
      const buf = await renderScore(score, { voices: opts.getVoices?.() ?? {} });
      const url = URL.createObjectURL(toWav(buf));
      const a = Object.assign(document.createElement("a"), { href: url, download: `${(score.title ?? "score").replace(/[^\w.-]+/g, "_")}.wav` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      msg("WAV downloaded.");
    } catch (e) { msg(`WAV render failed: ${errMsg(e)}`, true); }
    setButtons();
  });

  const qs = new URLSearchParams(location.search).get("score");
  if (opts.autoUrl ?? qs) fromURL(opts.autoUrl ?? qs);
  return { fromURL, fromText };
}

/** Live bridge panel: URL input, Connect/Disconnect, status text, incoming-message log. */
export function mountBridgePanel(container, engine) {
  container.innerHTML = `
    <div class="row"><div class="field"><label for="${container.id}-url">Bridge URL</label>
      <input id="${container.id}-url" value="${DEFAULT_BRIDGE_URL}" size="28"></div>
      <button type="button" data-conn>Connect</button></div>
    <p>Status: <span class="status" data-s="closed" data-status>Disconnected</span></p>
    <p class="bad" data-err hidden></p>
    <p id="${container.id}-loglabel">Incoming messages</p>
    <ol class="log" role="log" aria-live="off" aria-labelledby="${container.id}-loglabel" tabindex="0" data-log></ol>`;
  const btn = $(container, "[data-conn]"), st = $(container, "[data-status]"), log = $(container, "[data-log]"), errEl = $(container, "[data-err]");
  let errCount = 0;
  const onerror = (text) => {
    errCount++;
    errEl.hidden = false;
    errEl.textContent = `Errors: ${errCount}. Last: ${text.replace(/^bridge: /, "")}`;
    announce(`Bridge error: ${text.replace(/^bridge: /, "")}`);
  };
  let bridge = null;
  const label = { connecting: "Connecting", open: "Connected", closed: "Disconnected", error: "Error" };
  const onstatus = (s, d) => {
    st.dataset.s = s; st.textContent = label[s] + (d ? ` (${d})` : "");
    btn.textContent = bridge ? "Disconnect" : "Connect";
    announce(`Bridge ${st.textContent}`);
  };
  const onmessage = (m) => {
    const li = document.createElement("li");
    li.textContent = JSON.stringify(m).slice(0, 160);
    log.prepend(li); while (log.children.length > 50) log.lastChild.remove();
  };
  btn.addEventListener("click", async () => {
    if (bridge) { bridge.close(); bridge = null; onstatus("closed"); return; }
    try {
      await engine.start();
      errCount = 0; errEl.hidden = true; errEl.textContent = "";
      bridge = connectBridge(engine, $(container, "input").value.trim() || DEFAULT_BRIDGE_URL, { onstatus, onmessage, onerror });
      btn.textContent = "Disconnect";
    } catch (e) { bridge = null; onstatus("error", errMsg(e)); }
  });
}
