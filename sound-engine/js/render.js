// render.js — render a score to audio with OfflineAudioContext, using the same engine code.
import { createEngine } from "./engine.js";
import { normalizeScore } from "./score.js";

/**
 * Render a score to an AudioBuffer.
 * @param {Object|string} score  score object or JSON text
 * @param {{sampleRate?:number, channels?:number, tail?:number, voices?:Object<string,Object>, a4?:number}} [opts]
 *   tail: seconds added after the last note ends so releases ring out (default 3).
 *   voices: extra named voices (e.g. designed in the playground) available to the score.
 * @returns {Promise<AudioBuffer>}
 */
export async function renderScore(score, opts = {}) {
  const { sampleRate = 44100, channels = 2, tail = 3, voices = {}, a4 } = opts;
  const OAC = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!OAC) throw new Error("renderScore needs OfflineAudioContext (run it in a browser).");
  if (typeof score === "string") score = JSON.parse(score);
  const { duration } = normalizeScore(score);
  const length = Math.max(1, Math.ceil((duration + tail) * sampleRate));
  const ctx = new OAC({ numberOfChannels: channels, length, sampleRate });
  const engine = createEngine({ context: ctx, polyphony: Infinity, a4 });
  for (const [name, def] of Object.entries(voices)) engine.voice(name, def);
  const p = engine.playScore(score, { at: 0 });
  await p.ready;
  return ctx.startRendering();
}

/**
 * Encode audio as 16-bit PCM WAV bytes. Works in Node too (no DOM needed).
 * @param {{numberOfChannels:number, sampleRate:number, length:number, getChannelData(i:number):Float32Array}} buffer
 * @returns {ArrayBuffer}
 */
export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
  const data = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i));
  const bytes = 44 + n * ch * 2;
  const out = new ArrayBuffer(bytes), v = new DataView(out);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, bytes - 8, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
  return out;
}

/** @param {AudioBuffer} buffer @returns {Blob} audio/wav */
export function toWav(buffer) {
  return new Blob([encodeWav(buffer)], { type: "audio/wav" });
}

/** Render a score and trigger a browser download of the WAV. */
export async function downloadWav(score, filename, opts) {
  const obj = typeof score === "string" ? JSON.parse(score) : score;
  const name = filename ?? `${(obj.title ?? "score").replace(/[^\w.-]+/g, "_")}.wav`;
  const url = URL.createObjectURL(toWav(await renderScore(obj, opts)));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
