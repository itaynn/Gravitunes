import "../../core/switcher.js";
import { rainFromColor, rainLevel as rainWords, scaleMidi, midiHz } from "../../core/imerg.js";

(() => {
  "use strict";

  const WORLD_WIDTH = 960;
  const WORLD_HEIGHT = 540;
  const FIELD_WIDTH = 160;
  const FIELD_HEIGHT = 90;
  const FIELD_SIZE = FIELD_WIDTH * FIELD_HEIGHT;
  const SAMPLE_INTERVAL = 125;
  const MAX_VIDEO_LOAD_RETRIES = 2;
  const MAX_SPEED = 900;
  const MIN_SURFACE_HEIGHT = 0.035;
  const MIN_SURFACE_SLOPE = 0.00015;
  const SURFACE_ACCELERATION = 380;

  const video = document.querySelector("#weather-video");
  const canvas = document.querySelector("#game-layer");
  const context = canvas.getContext("2d");
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = FIELD_WIDTH;
  sampleCanvas.height = FIELD_HEIGHT;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });

  const resetButton = document.querySelector("#reset-button");
  const videoButton = document.querySelector("#video-button");
  const videoLabel = document.querySelector("#video-label");
  const soundButton = document.querySelector("#sound-button");
  const soundLabel = document.querySelector("#sound-label");
  const surfaceForceControl = document.querySelector("#surface-force-control");
  const surfaceForceOutput = document.querySelector("#surface-force-output");
  const surfaceFrictionControl = document.querySelector("#surface-friction-control");
  const surfaceFrictionOutput = document.querySelector("#surface-friction-output");
  const stormVolumeControl = document.querySelector("#storm-volume-control");
  const stormVolumeOutput = document.querySelector("#storm-volume-output");
  const motionVolumeControl = document.querySelector("#motion-volume-control");
  const motionVolumeOutput = document.querySelector("#motion-volume-output");
  const pitchResponseControl = document.querySelector("#pitch-response-control");
  const pitchResponseOutput = document.querySelector("#pitch-response-output");
  const pitchSourceControl = document.querySelector("#pitch-source-control");
  const loudnessSourceControl = document.querySelector("#loudness-source-control");
  const scaleControl = document.querySelector("#scale-control");
  const waveformControl = document.querySelector("#waveform-control");
  const harmonyControl = document.querySelector("#harmony-control");
  const stormTextureControl = document.querySelector("#storm-texture-control");
  const stereoControl = document.querySelector("#stereo-control");
  const prompt = document.querySelector("#stage-prompt");
  const status = document.querySelector("#interaction-status");
  const frameLabel = document.querySelector("#frame-label");

  const rawField = new Float32Array(FIELD_SIZE);
  const heightField = new Float32Array(FIELD_SIZE);
  let hasField = false;
  let lastSample = 0;
  let previousTimestamp = 0;
  let animationId = 0;
  let videoLoadRetries = 0;
  let videoRetryTimer = 0;
  let ball = null;
  let simulation = "waiting";
  let userPausedVideo = false;
  let surfaceForce = Number(surfaceForceControl.value);
  let surfaceFriction = Number(surfaceFrictionControl.value);
  let stormVolume = Number(stormVolumeControl.value) / 100;
  let motionVolume = Number(motionVolumeControl.value) / 100;
  let pitchResponse = Number(pitchResponseControl.value);
  let audioContext = null;
  let audioNodes = null;
  let soundEnabled = false;
  const soundSettings = {
    pitchSource: pitchSourceControl.value,
    loudnessSource: loudnessSourceControl.value,
    scale: scaleControl.value,
    waveform: waveformControl.value,
    harmony: harmonyControl.value,
    stormTexture: stormTextureControl.value,
    stereo: stereoControl.value,
  };
  const SCALES = {
    "pentatonic-major": [0, 2, 4, 7, 9],
    "pentatonic-minor": [0, 3, 5, 7, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    "whole-tone": [0, 2, 4, 6, 8, 10],
  };
  const SCALE_NOTES = Object.fromEntries(Object.entries(SCALES).map(([name, steps]) => [
    name,
    Array.from({ length: 25 }, (_, i) => i + 48).filter((midi) => steps.includes(midi % 12)),
  ]));
  const HARMONY_RATIOS = { octave: 0.5, fifth: 2 / 3, third: 0.8, off: 1 };
  const STORM_TEXTURES = {
    rain: { cutoff: 360, waveform: "sine", rumble: 48 },
    rumble: { cutoff: 180, waveform: "triangle", rumble: 42 },
    wind: { cutoff: 340, waveform: "sawtooth", rumble: 70 },
  };

  function setAudioTarget(parameter, value, timeConstant = 0.08) {
    parameter.setTargetAtTime(value, audioContext.currentTime, timeConstant);
  }

  function applyStormTexture() {
    if (!audioNodes) return;
    const texture = STORM_TEXTURES[soundSettings.stormTexture];
    setAudioTarget(audioNodes.stormFilter.frequency, texture.cutoff);
    audioNodes.stormRumble.type = texture.waveform;
    setAudioTarget(audioNodes.stormRumble.frequency, texture.rumble);
  }

  function createAudioGraph() {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("Web Audio is not supported by this browser.");
    }

    const audio = new AudioContextConstructor();
    const masterGain = audio.createGain();
    masterGain.gain.value = 0;
    const masterPanner = audio.createStereoPanner();
    masterGain.connect(masterPanner);
    masterPanner.connect(audio.destination);

    const noiseBuffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i += 1) {
      noise[i] = Math.random() * 2 - 1;
    }
    const noiseSource = audio.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    const stormFilter = audio.createBiquadFilter();
    stormFilter.type = "lowpass";
    stormFilter.frequency.value = STORM_TEXTURES[soundSettings.stormTexture].cutoff;
    stormFilter.Q.value = 0.7;
    const stormGain = audio.createGain();
    stormGain.gain.value = 0;
    noiseSource.connect(stormFilter);
    stormFilter.connect(stormGain);
    stormGain.connect(masterGain);
    noiseSource.start();

    const stormRumble = audio.createOscillator();
    stormRumble.type = STORM_TEXTURES[soundSettings.stormTexture].waveform;
    stormRumble.frequency.value = STORM_TEXTURES[soundSettings.stormTexture].rumble;
    const rumbleGain = audio.createGain();
    rumbleGain.gain.value = 0.08;
    stormRumble.connect(rumbleGain);
    rumbleGain.connect(stormGain);
    stormRumble.start();

    const toneGain = audio.createGain();
    toneGain.gain.value = 0;
    toneGain.connect(masterGain);
    const tone = audio.createOscillator();
    tone.type = soundSettings.waveform;
    tone.frequency.value = 180;
    tone.connect(toneGain);
    tone.start();

    const harmonyGain = audio.createGain();
    harmonyGain.gain.value = 0.22;
    harmonyGain.connect(toneGain);
    const harmony = audio.createOscillator();
    harmony.type = soundSettings.waveform;
    harmony.frequency.value = 90;
    harmony.connect(harmonyGain);
    harmony.start();

    audioContext = audio;
    audioNodes = { masterGain, masterPanner, stormGain, stormFilter, stormRumble, tone, harmony, toneGain, harmonyGain };
  }

  async function toggleSound() {
    try {
      if (!audioContext) createAudioGraph();
      if (soundEnabled) {
        soundEnabled = false;
        soundLabel.textContent = "Sound off";
        soundButton.setAttribute("aria-pressed", "false");
        audioNodes.masterGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.04);
        return;
      }

      await audioContext.resume();
      soundEnabled = true;
      soundLabel.textContent = "Sound on";
      soundButton.setAttribute("aria-pressed", "true");
      audioNodes.masterGain.gain.setTargetAtTime(0.8, audioContext.currentTime, 0.04);
    } catch (error) {
      soundEnabled = false;
      soundLabel.textContent = "Retry sound";
      soundButton.setAttribute("aria-pressed", "false");
      setStatus("Audio could not be started in this browser.");
      console.error("Could not start the precipitation sound effects:", error);
    }
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function rainFrequency(rain, speedRatio, accelerationRatio) {
    const source = {
      rain: rain,
      speed: speedRatio,
      slope: accelerationRatio,
    }[soundSettings.pitchSource];
    const responsive = Math.pow(clamp01(source), 1 / pitchResponse);
    const notes = SCALE_NOTES[soundSettings.scale];
    const index = Math.round(responsive * (notes.length - 1));
    return midiHz(notes[index]);
  }

  const rainLevel = (rain) => rainWords(rain, MIN_SURFACE_HEIGHT);

  function describeSpot(x, y) {
    const ns = y < WORLD_HEIGHT / 3 ? "north" : y > (2 * WORLD_HEIGHT) / 3 ? "south" : "";
    const ew = x < WORLD_WIDTH / 3 ? "west" : x > (2 * WORLD_WIDTH) / 3 ? "east" : "";
    const area = ns || ew ? `${ns}${ns && ew ? "-" : ""}${ew} of the map` : "centre of the map";
    return `${area}, ${rainLevel(heightAt(x, y))}`;
  }

  function updateSounds(inStorm, speed, acceleration) {
    if (!audioContext || !audioNodes) return;

    const now = audioContext.currentTime;
    const speedRatio = Math.min(1, speed / MAX_SPEED);
    const slopeRatio = 1 - Math.exp(-acceleration / 1800);
    const accelerationRatio = 1 - Math.exp(-(acceleration * pitchResponse) / 1800);
    const rain = ball ? heightAt(ball.x, ball.y) : 0;
    const frequency = rainFrequency(rain, speedRatio, slopeRatio);
    const loudness = {
      motion: 0.025 + speedRatio * 0.18 + accelerationRatio * 0.035,
      rain: 0.025 + rain * 0.215,
      speed: 0.025 + speedRatio * 0.215,
      slope: 0.025 + slopeRatio * 0.215,
    }[soundSettings.loudnessSource];
    const harmonyRatio = HARMONY_RATIOS[soundSettings.harmony];
    audioNodes.tone.type = soundSettings.waveform;
    audioNodes.harmony.type = soundSettings.waveform;
    audioNodes.tone.frequency.setTargetAtTime(frequency, now, 0.06);
    audioNodes.harmony.frequency.setTargetAtTime(frequency * harmonyRatio, now, 0.06);
    audioNodes.harmonyGain.gain.setTargetAtTime(soundSettings.harmony === "off" ? 0 : 0.22, now, 0.08);
    audioNodes.masterPanner.pan.setTargetAtTime(
      soundSettings.stereo === "map" && ball ? (ball.x / WORLD_WIDTH) * 2 - 1 : 0,
      now,
      0.08,
    );
    audioNodes.toneGain.gain.setTargetAtTime(
      soundEnabled ? motionVolume * loudness : 0,
      now,
      0.08,
    );
    audioNodes.stormGain.gain.setTargetAtTime(
      soundEnabled && inStorm ? stormVolume * 0.22 : 0,
      now,
      inStorm ? 0.24 : 0.4,
    );
  }

  function setStatus(message) {
    status.textContent = message;
  }

  const colorToHeight = rainFromColor;

  function smoothField(source, target) {
    for (let y = 0; y < FIELD_HEIGHT; y += 1) {
      for (let x = 0; x < FIELD_WIDTH; x += 1) {
        let total = 0;
        let weight = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const sx = x + ox;
            const sy = y + oy;
            if (sx < 0 || sx >= FIELD_WIDTH || sy < 0 || sy >= FIELD_HEIGHT) continue;
            const kernel = ox === 0 && oy === 0 ? 4 : ox === 0 || oy === 0 ? 2 : 1;
            total += source[sy * FIELD_WIDTH + sx] * kernel;
            weight += kernel;
          }
        }
        target[y * FIELD_WIDTH + x] = total / weight;
      }
    }
  }

  function samplePrecipitation(timestamp) {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return;
    if (timestamp - lastSample < SAMPLE_INTERVAL) return;

    lastSample = timestamp;
    try {
      sampleContext.drawImage(video, 0, 0, FIELD_WIDTH, FIELD_HEIGHT);
      const pixels = sampleContext.getImageData(0, 0, FIELD_WIDTH, FIELD_HEIGHT).data;

      for (let i = 0; i < FIELD_SIZE; i += 1) {
        const pixel = i * 4;
        const x = i % FIELD_WIDTH;
        const y = Math.floor(i / FIELD_WIDTH);

        // The printed legend and timestamp are not precipitation features.
        if (y > FIELD_HEIGHT * 0.88 && x > FIELD_WIDTH * 0.42) {
          rawField[i] = 0;
          continue;
        }
        rawField[i] = colorToHeight(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]);
      }

      smoothField(rawField, heightField);
      hasField = true;
      frameLabel.textContent = video.paused ? "FIELD PAUSED" : "FIELD IN MOTION";
      if (simulation === "waiting") {
        setStatus("Precipitation field ready · place a ball on a raised slope to set it in motion.");
      }
    } catch (error) {
      video.pause();
      videoButton.disabled = true;
      setStatus("The video pixels could not be sampled. Serve the site over localhost and reload.");
      console.error("Could not sample the precipitation video:", error);
    }
  }

  function heightAt(x, y) {
    if (!hasField) return 0;
    const gx = Math.max(0, Math.min(FIELD_WIDTH - 1, (x / WORLD_WIDTH) * FIELD_WIDTH));
    const gy = Math.max(0, Math.min(FIELD_HEIGHT - 1, (y / WORLD_HEIGHT) * FIELD_HEIGHT));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(FIELD_WIDTH - 1, x0 + 1);
    const y1 = Math.min(FIELD_HEIGHT - 1, y0 + 1);
    const fx = gx - x0;
    const fy = gy - y0;
    const a = heightField[y0 * FIELD_WIDTH + x0];
    const b = heightField[y0 * FIELD_WIDTH + x1];
    const c = heightField[y1 * FIELD_WIDTH + x0];
    const d = heightField[y1 * FIELD_WIDTH + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  function downhillGradientAt(x, y) {
    const dx = WORLD_WIDTH / FIELD_WIDTH;
    const dy = WORLD_HEIGHT / FIELD_HEIGHT;
    const gradientX = (heightAt(x + dx, y) - heightAt(x - dx, y)) / (2 * dx);
    const gradientY = (heightAt(x, y + dy) - heightAt(x, y - dy)) / (2 * dy);
    const downhill = { x: -gradientX, y: -gradientY };
    if (Math.hypot(downhill.x, downhill.y) < MIN_SURFACE_SLOPE) return null;
    return downhill;
  }

  function placeBallAt(x, y) {
    const margin = 24;
    ball = {
      x: Math.max(margin, Math.min(WORLD_WIDTH - margin, x)),
      y: Math.max(margin, Math.min(WORLD_HEIGHT - margin, y)),
      vx: 0,
      vy: 0,
      rotation: 0,
    };
    simulation = "armed";
    resetButton.disabled = false;
    prompt.classList.add("is-hidden");
    setStatus(`Ball placed · ${describeSpot(ball.x, ball.y)} · waiting for a raised surface to reach it.`);
  }

  function setBallPosition(clientX, clientY) {
    const bounds = canvas.getBoundingClientRect();
    const x = ((clientX - bounds.left) / bounds.width) * WORLD_WIDTH;
    const y = ((clientY - bounds.top) / bounds.height) * WORLD_HEIGHT;
    placeBallAt(x, y);
  }

  function resetBall() {
    ball = null;
    simulation = "waiting";
    resetButton.disabled = true;
    prompt.textContent = "Click, or focus the map and press Enter, to place your ball";
    prompt.classList.remove("is-hidden");
    setStatus("Place a ball in the map · it will stay still until a raised surface reaches it.");
  }

  function drawBall() {
    if (!ball) return;
    const radius = 13;
    const drawY = ball.y;

    context.save();
    context.translate(ball.x, drawY);
    context.rotate(ball.rotation);

    context.beginPath();
    context.ellipse(2, radius + 5, radius * 1.08, radius * 0.34, 0, 0, Math.PI * 2);
    context.fillStyle = "rgba(0, 0, 0, 0.45)";
    context.filter = "blur(3px)";
    context.fill();
    context.filter = "none";

    const gradient = context.createRadialGradient(-5, -7, 2, 0, 0, radius + 2);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.38, "#e5f4c2");
    gradient.addColorStop(1, "#a9d84b");
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.shadowColor = "rgba(201, 239, 116, 0.82)";
    context.shadowBlur = 17;
    context.fill();
    context.shadowBlur = 0;
    context.lineWidth = 1.4;
    context.strokeStyle = "rgba(255, 255, 255, 0.84)";
    context.stroke();

    context.beginPath();
    context.arc(0, 0, radius * 0.59, 0, Math.PI * 1.18);
    context.strokeStyle = "rgba(29, 48, 15, 0.45)";
    context.lineWidth = 1.6;
    context.stroke();
    context.restore();

  }

  function draw(timestamp) {
    const elapsed = previousTimestamp ? Math.min((timestamp - previousTimestamp) / 1000, 0.04) : 0;
    previousTimestamp = timestamp;
    samplePrecipitation(timestamp);

    let acceleration = 0;
    let inStorm = false;
    if (ball && simulation !== "waiting" && hasField) {
      const height = heightAt(ball.x, ball.y);
      const downhill = height > MIN_SURFACE_HEIGHT ? downhillGradientAt(ball.x, ball.y) : null;
      if (downhill) {
        const accelerationScale = SURFACE_ACCELERATION * surfaceForce;
        ball.vx += downhill.x * accelerationScale * elapsed;
        ball.vy += downhill.y * accelerationScale * elapsed;
        acceleration = Math.hypot(downhill.x, downhill.y) * accelerationScale;
        inStorm = true;
        if (simulation !== "moving") {
          setStatus("Raised surface contact · accelerating downhill along the height gradient.");
        }
        simulation = "moving";
      }

      if (simulation === "moving") {
        const retention = Math.exp(-surfaceFriction * elapsed);
        ball.vx *= retention;
        ball.vy *= retention;

        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed > MAX_SPEED) {
          ball.vx = (ball.vx / speed) * MAX_SPEED;
          ball.vy = (ball.vy / speed) * MAX_SPEED;
        }

        ball.x += ball.vx * elapsed;
        ball.y += ball.vy * elapsed;
        ball.rotation += (ball.vx / 20) * elapsed;

        const radius = 13;
        if (ball.x < radius || ball.x > WORLD_WIDTH - radius) {
          ball.x = Math.max(radius, Math.min(WORLD_WIDTH - radius, ball.x));
          ball.vx *= -0.62;
        }
        if (ball.y < radius || ball.y > WORLD_HEIGHT - radius) {
          ball.y = Math.max(radius, Math.min(WORLD_HEIGHT - radius, ball.y));
          ball.vy *= -0.62;
        }
      }
    }
    updateSounds(inStorm, ball ? Math.hypot(ball.vx, ball.vy) : 0, acceleration);

    context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    drawBall();
    animationId = requestAnimationFrame(draw);
  }

  // No separate "start sound" step: the first click or key on the map starts the sound (a user gesture);
  // the Sound button stays as a mute because the ball keeps sounding on its own.
  let soundTouched = false;
  const autoSound = () => { if (!soundTouched) { soundTouched = true; if (!soundEnabled) toggleSound(); } };
  canvas.addEventListener("pointerdown", autoSound);
  canvas.addEventListener("keydown", autoSound);
  canvas.addEventListener("pointerdown", (event) => {
    if (simulation === "moving") return;
    event.preventDefault();
    setBallPosition(event.clientX, event.clientY);
  });

  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (simulation === "waiting") {
        placeBallAt(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
      }
      return;
    }

    if (ball && simulation === "moving" && event.key.startsWith("Arrow")) {
      event.preventDefault();
      setStatus(`Ball rolling · ${describeSpot(ball.x, ball.y)}. Press Reset to place it again.`);
      return;
    }
    if (!ball || simulation === "moving") return;
    const step = event.shiftKey ? 40 : 16;
    const offsets = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    placeBallAt(ball.x + offset[0], ball.y + offset[1]);
    setStatus(`Ball moved · ${describeSpot(ball.x, ball.y)}.`);
  });

  resetButton.addEventListener("click", resetBall);
  soundButton.addEventListener("click", () => { soundTouched = true; toggleSound(); });
  videoButton.addEventListener("click", async () => {
    if (video.paused) {
      userPausedVideo = false;
      try {
        await video.play();
        videoLabel.textContent = "Pause video";
        videoButton.querySelector(".play-icon").textContent = "Ⅱ";
        frameLabel.textContent = "FIELD IN MOTION";
      } catch (error) {
        setStatus("Video playback was blocked. Press the play control again to retry.");
        console.error("Could not play the precipitation video:", error);
      }
    } else {
      userPausedVideo = true;
      video.pause();
      videoLabel.textContent = "Play video";
      videoButton.querySelector(".play-icon").textContent = "▶";
      frameLabel.textContent = "FIELD PAUSED";
    }
  });

  // Space anywhere (not in fields or on buttons) = Play/Stop the video.
  addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey || videoButton.disabled) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(t?.tagName) || t?.isContentEditable) return;
    e.preventDefault();
    const wasPaused = video.paused;
    videoButton.click();
    setStatus(wasPaused ? "Playing" : "Stopped");
  });

  surfaceForceControl.addEventListener("input", () => {
    surfaceForce = Number(surfaceForceControl.value);
    surfaceForceOutput.value = `${surfaceForce.toFixed(1)}×`;
    surfaceForceOutput.textContent = surfaceForceOutput.value;
  });

  surfaceFrictionControl.addEventListener("input", () => {
    surfaceFriction = Number(surfaceFrictionControl.value);
    surfaceFrictionOutput.value = `${surfaceFriction.toFixed(2)} /s`;
    surfaceFrictionOutput.textContent = surfaceFrictionOutput.value;
  });

  stormVolumeControl.addEventListener("input", () => {
    stormVolume = Number(stormVolumeControl.value) / 100;
    stormVolumeOutput.value = `${stormVolumeControl.value}%`;
    stormVolumeOutput.textContent = stormVolumeOutput.value;
  });

  motionVolumeControl.addEventListener("input", () => {
    motionVolume = Number(motionVolumeControl.value) / 100;
    motionVolumeOutput.value = `${motionVolumeControl.value}%`;
    motionVolumeOutput.textContent = motionVolumeOutput.value;
  });

  pitchResponseControl.addEventListener("input", () => {
    pitchResponse = Number(pitchResponseControl.value);
    pitchResponseOutput.value = `${pitchResponse.toFixed(1)}×`;
    pitchResponseOutput.textContent = pitchResponseOutput.value;
  });

  pitchSourceControl.addEventListener("change", () => { soundSettings.pitchSource = pitchSourceControl.value; });
  loudnessSourceControl.addEventListener("change", () => { soundSettings.loudnessSource = loudnessSourceControl.value; });
  scaleControl.addEventListener("change", () => { soundSettings.scale = scaleControl.value; });
  waveformControl.addEventListener("change", () => { soundSettings.waveform = waveformControl.value; });
  harmonyControl.addEventListener("change", () => { soundSettings.harmony = harmonyControl.value; });
  stormTextureControl.addEventListener("change", () => {
    soundSettings.stormTexture = stormTextureControl.value;
    applyStormTexture();
  });
  stereoControl.addEventListener("change", () => { soundSettings.stereo = stereoControl.value; });

  video.addEventListener("loadeddata", () => {
    window.clearTimeout(videoRetryTimer);
    videoLoadRetries = 0;
    videoButton.disabled = false;
    frameLabel.textContent = "FIELD READY";
    prompt.textContent = "Click, or focus the map and press Enter, to place your ball";
    if (!ball) setStatus("Video ready · place a ball and wait for a raised surface to reach it.");
    if (!userPausedVideo) {
      video.play().catch((error) => {
        setStatus("Video ready · press Play video to start the precipitation field.");
        console.error("Could not autoplay the precipitation video:", error);
      });
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || userPausedVideo || !video.paused || video.error) return;
    video.play().catch((error) => {
      setStatus("Video playback stopped when returning to the page. Press Play video to resume.");
      console.error("Could not resume the precipitation video:", error);
    });
  });

  video.addEventListener("error", () => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) return;
    if (videoLoadRetries < MAX_VIDEO_LOAD_RETRIES) {
      videoLoadRetries += 1;
      frameLabel.textContent = "RETRYING VIDEO";
      setStatus(`Local video load failed · retrying (${videoLoadRetries}/${MAX_VIDEO_LOAD_RETRIES}).`);
      videoRetryTimer = window.setTimeout(() => video.load(), videoLoadRetries * 500);
      return;
    }

    videoButton.disabled = true;
    frameLabel.textContent = "VIDEO UNAVAILABLE";
    const sourcePath = new URL(video.getAttribute("src"), document.baseURI).pathname;
    setStatus(`Could not load the local video at ${sourcePath}. Check that the repository root is being served, then reload.`);
  });

  video.addEventListener("play", () => {
    videoLabel.textContent = "Pause video";
    videoButton.querySelector(".play-icon").textContent = "Ⅱ";
    if (ball && simulation !== "moving") {
      setStatus("Ball waiting · the moving precipitation field will set it in motion.");
    }
  });

  video.addEventListener("pause", () => {
    if (!video.error) {
      videoLabel.textContent = "Play video";
      videoButton.querySelector(".play-icon").textContent = "▶";
    }
  });

  video.addEventListener("timeupdate", () => {
    const seconds = Math.floor(video.currentTime);
    const duration = Number.isFinite(video.duration) ? Math.floor(video.duration) : 0;
    if (duration > 0) {
      const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      const total = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;
      frameLabel.textContent = `${elapsed} / ${total}`;
    }
  });

  video.load();
  if (!animationId) animationId = requestAnimationFrame(draw);
})();
