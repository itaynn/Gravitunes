#!/usr/bin/env node
// Renders the spoken lines of "Hear the storm" to mp3 files with Microsoft Edge's neural voices (edge-tts).
// hear.js plays ./audio/<name>.mp3 when it exists and falls back to the browser's speech otherwise.
//
// The lines are read from app/modes/storm-picker/hear.js (LINES and each slide's `say`), so after changing any
// of them, run this again:
//
//   pip install edge-tts
//   node app/tools/make-voice.mjs                     # every line
//   node app/tools/make-voice.mjs intro tutorial-2    # only these
//
// Env: VOICE (default en-US-AvaNeural), RATE (e.g. "-5%"), EDGE_TTS (path to the edge-tts command).

import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const modeDir = join(here, "../modes/storm-picker");
const src = readFileSync(join(modeDir, "hear.js"), "utf8");

// Pull an object/array literal out of hear.js and evaluate it (it holds only strings and numbers).
function literal(start, open, close) {
  const at = src.indexOf(start);
  if (at < 0) throw new Error(`hear.js: "${start}" not found`);
  const from = src.indexOf(open, at);
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === open) depth += 1;
    else if (src[i] === close && --depth === 0) return new Function(`return ${src.slice(from, i + 1)};`)();
  }
  throw new Error(`hear.js: "${start}" is not closed`);
}

const lines = { ...literal("const LINES =", "{", "}") };
literal("const SLIDES =", "[", "]").forEach((slide, i) => {
  if (slide.say) lines[`tutorial-${i + 1}`] = slide.say;
});

const only = process.argv.slice(2);
const voice = process.env.VOICE || "en-US-AvaNeural";
const rate = process.env.RATE || "+0%";
const bin = process.env.EDGE_TTS || "edge-tts";
const outDir = join(modeDir, "audio");
mkdirSync(outDir, { recursive: true });

for (const [name, text] of Object.entries(lines)) {
  if (only.length && !only.includes(name)) continue;
  const file = join(outDir, `${name}.mp3`);
  execFileSync(bin, ["--voice", voice, `--rate=${rate}`, "--text", text, "--write-media", file], { stdio: "inherit" });
  console.log(`${name}.mp3  ←  ${text}`);
}
