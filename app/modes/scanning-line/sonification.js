import "../../core/switcher.js";
import { rainStrength, scaleMidi, midiHz, midiName } from "../../core/imerg.js";

(() => {
  "use strict";

  const PITCH_BANDS = 88;
  // The 88 image bands share a C major scale from C2 to C5 (22 notes, 4 bands each): no shrill highs.
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
  const SCALE_NOTES = scaleMidi(MAJOR_STEPS, 36, 22);
  const bandMidi = (band) => SCALE_NOTES[Math.floor((band * SCALE_NOTES.length) / PITCH_BANDS)];
  const COLUMN_COUNT = 3600;
  const PROGRESS_INTERVAL_MS = 25;
  const AUDIO_START_LEAD_SECONDS = 0.05;
  const NOTE_ATTACK_SECONDS = 0.008;
  const NOTE_RELEASE_SECONDS = 0.08;
  const ACTIVE_THRESHOLD = 0.12;

  const image = document.querySelector("#sonification-source");
  const canvas = document.querySelector("#score-canvas");
  const context = canvas.getContext("2d");
  const playButton = document.querySelector("#chord-play-button");
  const playLabel = document.querySelector("#chord-play-label");
  const stopButton = document.querySelector("#chord-stop-button");
  const passDurationControl = document.querySelector("#pass-duration");
  const passDurationOutput = document.querySelector("#pass-duration-output");
  const progress = document.querySelector("#column-progress");
  const playhead = document.querySelector("#score-playhead");
  const status = document.querySelector("#sonification-status");

  const score = new Float32Array(COLUMN_COUNT * PITCH_BANDS);
  let audioContext = null;
  let masterGain = null;
  let column = 0;
  let progressTimer = 0;
  let playing = false;
  let initialized = false;
  let passScheduled = false;
  let passDurationSeconds = 0;
  let columnInterval = 0;
  let playbackStartTime = 0;
  let lastStatusColumn = 0;
  const activeNotes = new Set();

  function setStatus(message) {
    status.textContent = message;
  }

  const noteName = midiName;

  function drawScore() {
    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = "#07111b";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    context.save();
    context.font = "12px 'DM Mono', monospace";
    context.textBaseline = "middle";
    for (let row = 0; row <= PITCH_BANDS; row += 1) {
      const y = (row / PITCH_BANDS) * height;
      const bandFromBottom = PITCH_BANDS - row - 1;
      const midiNote = bandMidi(bandFromBottom);
      const isOctaveBoundary = midiNote % 12 === 0 && (bandFromBottom === 0 || bandMidi(bandFromBottom - 1) !== midiNote);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.strokeStyle = isOctaveBoundary ? "rgba(241, 247, 252, 0.42)" : "rgba(241, 247, 252, 0.13)";
      context.lineWidth = isOctaveBoundary || row === 0 || row === PITCH_BANDS ? 1.5 : 1;
      context.stroke();

      if (row < PITCH_BANDS && isOctaveBoundary) {
        const labelY = y + height / PITCH_BANDS / 2;
        context.fillStyle = "rgba(5, 10, 17, 0.85)";
        context.fillRect(0, y, 34, height / PITCH_BANDS);
        context.fillStyle = "#f4f4ed";
        context.font = "9px 'DM Mono', monospace";
        context.fillText(noteName(midiNote), 4, labelY);
      }
    }

    for (let line = 1; line < 12; line += 1) {
      const x = (line / 12) * width;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.strokeStyle = "rgba(241, 247, 252, 0.15)";
      context.lineWidth = 1;
      context.stroke();
    }
    context.restore();
  }

  function buildScore() {
    if (initialized) return;
    const scoreCanvas = document.createElement("canvas");
    scoreCanvas.width = image.naturalWidth;
    scoreCanvas.height = image.naturalHeight;
    const scoreContext = scoreCanvas.getContext("2d", { willReadFrequently: true });
    if (!scoreContext) throw new Error("The browser could not create an image sampling canvas.");

    scoreContext.drawImage(image, 0, 0);
    const pixels = scoreContext.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data;
    const rowHeight = image.naturalHeight / PITCH_BANDS;

    for (let y = 0; y < image.naturalHeight; y += 1) {
      const pitchBand = Math.min(PITCH_BANDS - 1, Math.floor((image.naturalHeight - y - 1) / rowHeight));
      for (let x = 0; x < image.naturalWidth; x += 1) {
        const pixel = (y * image.naturalWidth + x) * 4;
        const colorStrength = rainStrength(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2], pixels[pixel + 3]);
        if (colorStrength === 0) continue;
        const scoreIndex = x * PITCH_BANDS + pitchBand;
        score[scoreIndex] = Math.max(score[scoreIndex], colorStrength);
      }
    }

    drawScore();
    initialized = true;
    playButton.disabled = false;
    playLabel.textContent = "Play sound";
    setStatus("Ready. Press Play to hear the map from west to east: low notes are the south, high notes the north, louder means heavier rain.");
  }

  function updateProgress() {
    progress.textContent = `${column.toLocaleString()} / ${COLUMN_COUNT.toLocaleString()} COLUMNS`;
    playhead.style.left = `${(column / COLUMN_COUNT) * 100}%`;
  }

  function scheduleContinuousPass() {
    playbackStartTime = audioContext.currentTime + AUDIO_START_LEAD_SECONDS;
    const passEndTime = playbackStartTime + passDurationSeconds;
    const polyphonyByColumn = new Float32Array(COLUMN_COUNT);

    for (let columnIndex = 0; columnIndex < COLUMN_COUNT; columnIndex += 1) {
      let noteCount = 0;
      const scoreOffset = columnIndex * PITCH_BANDS;
      for (let band = 0; band < PITCH_BANDS; band += 1) {
        if (score[scoreOffset + band] >= ACTIVE_THRESHOLD) noteCount += 1;
      }
      polyphonyByColumn[columnIndex] = noteCount > 0 ? 1 / Math.sqrt(noteCount) : 0;
    }

    for (let band = 0; band < PITCH_BANDS; band += 1) {
      const curve = new Float32Array(COLUMN_COUNT + 1);
      let envelope = 0;
      let hasNotes = false;
      for (let columnIndex = 0; columnIndex < COLUMN_COUNT; columnIndex += 1) {
        const strength = score[columnIndex * PITCH_BANDS + band];
        const target = strength >= ACTIVE_THRESHOLD
          ? strength * 0.12 * polyphonyByColumn[columnIndex]
          : 0;
        const timeConstant = target > envelope ? NOTE_ATTACK_SECONDS : NOTE_RELEASE_SECONDS;
        envelope = target + (envelope - target) * Math.exp(-columnInterval / timeConstant);
        curve[columnIndex] = envelope;
        if (envelope > 0.0001) hasNotes = true;
      }
      if (!hasNotes) continue;

      const oscillator = audioContext.createOscillator();
      const noteGain = audioContext.createGain();
      const midiNote = bandMidi(band);
      const frequency = midiHz(midiNote);

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, playbackStartTime);
      oscillator.detune.setValueAtTime(-4, playbackStartTime);
      oscillator.detune.linearRampToValueAtTime(0, playbackStartTime + 0.04);
      noteGain.gain.setValueAtTime(0, playbackStartTime - 0.001);
      noteGain.gain.setValueCurveAtTime(curve, playbackStartTime, passDurationSeconds);
      oscillator.connect(noteGain);
      noteGain.connect(masterGain);
      const voice = { oscillator, gain: noteGain };
      oscillator.onended = () => activeNotes.delete(voice);
      activeNotes.add(voice);
      oscillator.start(playbackStartTime);
      oscillator.stop(passEndTime + 0.02);
    }
    passScheduled = true;
  }

  function finishPlayback() {
    playing = false;
    passScheduled = false;
    window.clearInterval(progressTimer);
    column = COLUMN_COUNT;
    playLabel.textContent = "Replay chords";
    playButton.querySelector(".button-icon").textContent = "▶";
    stopButton.disabled = true;
    passDurationControl.disabled = false;
    updateProgress();
    setStatus("Finished · all 3,600 columns played.");
  }

  function updatePlaybackProgress() {
    if (!playing) return;

    const now = audioContext.currentTime;
    column = Math.min(COLUMN_COUNT, Math.max(0, Math.floor((now - playbackStartTime) / columnInterval)));
    updateProgress();
    if (column - lastStatusColumn >= 180 || column === COLUMN_COUNT) {
      lastStatusColumn = column;
      setStatus(`Playing column ${column.toLocaleString()} of ${COLUMN_COUNT.toLocaleString()} · continuous sound pass.`);
    }

    if (now >= playbackStartTime + passDurationSeconds) finishPlayback();
  }

  function silenceActiveNotes() {
    const now = audioContext.currentTime;
    for (const { oscillator, gain } of activeNotes) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.012);
      oscillator.stop(now + 0.05);
    }
  }

  async function togglePlayback() {
    if (playing) {
      playing = false;
      window.clearInterval(progressTimer);
      await audioContext.suspend();
      column = Math.min(COLUMN_COUNT, Math.max(0, Math.floor((audioContext.currentTime - playbackStartTime) / columnInterval)));
      updateProgress();
      playLabel.textContent = "Resume sound";
      playButton.querySelector(".button-icon").textContent = "▶";
      setStatus(`Paused at column ${column.toLocaleString()} of ${COLUMN_COUNT.toLocaleString()}.`);
      return;
    }

    try {
      if (!initialized) throw new Error("The NASA frame is not ready yet.");
      if (!audioContext) {
        audioContext = new AudioContext();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.45;
        masterGain.connect(audioContext.destination);
      }
      await audioContext.resume();
      if (!passScheduled) {
        if (column >= COLUMN_COUNT) column = 0;
        passDurationSeconds = Number(passDurationControl.value);
        columnInterval = passDurationSeconds / COLUMN_COUNT;
        lastStatusColumn = column;
        scheduleContinuousPass();
      }
      playing = true;
      playLabel.textContent = "Pause sound";
      playButton.querySelector(".button-icon").textContent = "Ⅱ";
      stopButton.disabled = false;
      passDurationControl.disabled = true;
      setStatus(`Playing a continuous tone pass · ${formatPassDuration(passDurationSeconds)}.`);
      updatePlaybackProgress();
      progressTimer = window.setInterval(updatePlaybackProgress, PROGRESS_INTERVAL_MS);
    } catch (error) {
      playing = false;
      setStatus("Could not start audio playback. Check browser audio permissions and try again.");
      console.error("Could not start the precipitation sonification:", error);
    }
  }

  async function stopPlayback() {
    playing = false;
    window.clearInterval(progressTimer);
    if (audioContext?.state === "suspended") await audioContext.resume();
    if (audioContext) silenceActiveNotes();
    passScheduled = false;
    column = 0;
    playLabel.textContent = "Play sound";
    playButton.querySelector(".button-icon").textContent = "▶";
    stopButton.disabled = true;
    passDurationControl.disabled = false;
    updateProgress();
    setStatus("Stopped · ready to play all 3,600 columns from the beginning.");
  }

  function updatePassDurationLabel() {
    passDurationOutput.value = formatPassDuration(Number(passDurationControl.value));
    passDurationOutput.textContent = passDurationOutput.value;
  }

  function formatPassDuration(seconds) {
    return seconds === 60 ? "1 min" : `${seconds} sec`;
  }

  playButton.addEventListener("click", togglePlayback);
  // Space anywhere (not in fields or on buttons) = Play/Pause.
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey || playButton.disabled) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(t?.tagName) || t?.isContentEditable) return;
    e.preventDefault();
    togglePlayback();
  });
  stopButton.addEventListener("click", stopPlayback);
  passDurationControl.addEventListener("input", updatePassDurationLabel);
  image.addEventListener("load", () => {
    try {
      buildScore();
    } catch (error) {
      playButton.disabled = true;
      setStatus("Could not read the NASA frame to build the chord grid.");
      console.error("Could not build the precipitation chord grid:", error);
    }
  }, { once: true });
  image.addEventListener("error", () => {
    playButton.disabled = true;
    setStatus("Could not load the NASA frame. Check the local data file and reload.");
    console.error("Could not load the precipitation frame:", image.src);
  }, { once: true });

  updatePassDurationLabel();
  updateProgress();
  if (image.complete && image.naturalWidth > 0) {
    try {
      buildScore();
    } catch (error) {
      playButton.disabled = true;
      setStatus("Could not read the NASA frame to build the chord grid.");
      console.error("Could not build the precipitation chord grid:", error);
    }
  }
})();
