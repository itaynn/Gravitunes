(() => {
  "use strict";

  const WORLD_WIDTH = 960;
  const WORLD_HEIGHT = 540;
  const FIELD_WIDTH = 160;
  const FIELD_HEIGHT = 90;
  const FIELD_SIZE = FIELD_WIDTH * FIELD_HEIGHT;
  const SAMPLE_INTERVAL = 125;
  const MAX_SPEED = 85;
  const COLOR_CONTACT_THRESHOLD = 0.12;
  const COLOR_CONTACT_RESET = 0.08;

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
  const impactControl = document.querySelector("#impact-control");
  const impactOutput = document.querySelector("#impact-output");
  const inertiaControl = document.querySelector("#inertia-control");
  const inertiaOutput = document.querySelector("#inertia-output");
  const prompt = document.querySelector("#stage-prompt");
  const status = document.querySelector("#interaction-status");
  const frameLabel = document.querySelector("#frame-label");

  const rawField = new Float32Array(FIELD_SIZE);
  const precipitationField = new Float32Array(FIELD_SIZE);
  let hasField = false;
  let lastSample = 0;
  let previousTimestamp = 0;
  let animationId = 0;
  let ball = null;
  let simulation = "waiting";
  let impactStrength = Number(impactControl.value);
  let inertiaHalfLife = Number(inertiaControl.value);

  function setStatus(message) {
    status.textContent = message;
  }

  function colorToIntensity(red, green, blue) {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const chroma = max - min;
    const brightness = max / 255;
    const saturation = max === 0 ? 0 : chroma / max;

    if (saturation < 0.38 || brightness < 0.15) return 0;

    let hue;
    if (chroma === 0) hue = 0;
    else if (max === red) hue = 60 * (((green - blue) / chroma) % 6);
    else if (max === green) hue = 60 * ((blue - red) / chroma + 2);
    else hue = 60 * ((red - green) / chroma + 4);
    if (hue < 0) hue += 360;

    let intensity;
    if (hue <= 190) {
      intensity = 1 - hue / 190;
    } else {
      intensity = Math.min(0.9, ((hue - 190) / 100) * 0.9);
    }
    return Math.max(0, Math.min(1, (0.12 + intensity * 0.88) * (0.55 + saturation * 0.45) * Math.min(1, brightness * 1.6)));
  }

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
        rawField[i] = colorToIntensity(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]);
      }

      smoothField(rawField, precipitationField);
      hasField = true;
      frameLabel.textContent = video.paused ? "FIELD PAUSED" : "FIELD IN MOTION";
      if (simulation === "waiting") {
        setStatus("Precipitation field ready · place a ball and wait for a colored edge.");
      }
    } catch (error) {
      video.pause();
      videoButton.disabled = true;
      setStatus("The video pixels could not be sampled. Serve the site over localhost and reload.");
      console.error("Could not sample the precipitation video:", error);
    }
  }

  function precipitationAt(x, y) {
    if (!hasField) return 0;
    const gx = Math.max(0, Math.min(FIELD_WIDTH - 1, (x / WORLD_WIDTH) * FIELD_WIDTH));
    const gy = Math.max(0, Math.min(FIELD_HEIGHT - 1, (y / WORLD_HEIGHT) * FIELD_HEIGHT));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(FIELD_WIDTH - 1, x0 + 1);
    const y1 = Math.min(FIELD_HEIGHT - 1, y0 + 1);
    const fx = gx - x0;
    const fy = gy - y0;
    const a = precipitationField[y0 * FIELD_WIDTH + x0];
    const b = precipitationField[y0 * FIELD_WIDTH + x1];
    const c = precipitationField[y1 * FIELD_WIDTH + x0];
    const d = precipitationField[y1 * FIELD_WIDTH + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  function precipitationEdgeNormalAt(x, y) {
    const dx = WORLD_WIDTH / FIELD_WIDTH;
    const dy = WORLD_HEIGHT / FIELD_HEIGHT;
    const gradientX = (precipitationAt(x + dx, y) - precipitationAt(x - dx, y)) / (2 * dx);
    const gradientY = (precipitationAt(x, y + dy) - precipitationAt(x, y - dy)) / (2 * dy);
    const magnitude = Math.hypot(gradientX, gradientY);
    if (magnitude < 0.0006) return null;
    return { x: gradientX / magnitude, y: gradientY / magnitude };
  }

  function placeBallAt(x, y) {
    const margin = 24;
    ball = {
      x: Math.max(margin, Math.min(WORLD_WIDTH - margin, x)),
      y: Math.max(margin, Math.min(WORLD_HEIGHT - margin, y)),
      vx: 0,
      vy: 0,
      rotation: 0,
      onColoredPatch: false,
      boostFlash: 0,
      boostAmount: 0,
    };
    simulation = "armed";
    resetButton.disabled = false;
    prompt.classList.add("is-hidden");
    setStatus("Ball placed · waiting for a precipitation edge.");
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
    prompt.textContent = "Click anywhere on the map to place your ball";
    prompt.classList.remove("is-hidden");
    setStatus("Place a ball in the map · it will stay still until precipitation reaches it.");
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

    if (ball.boostFlash > 0) {
      const progress = 1 - ball.boostFlash;
      context.save();
      context.beginPath();
      context.arc(ball.x, drawY, radius + 7 + progress * 24, 0, Math.PI * 2);
      context.strokeStyle = `rgba(201, 239, 116, ${ball.boostFlash * 0.8})`;
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = `rgba(245, 255, 215, ${ball.boostFlash})`;
      context.font = "600 12px 'DM Mono', monospace";
      context.textAlign = "center";
      context.fillText(`+${Math.round(ball.boostAmount)} MOMENTUM`, ball.x, drawY - radius - 16 - progress * 16);
      context.restore();
    }
  }

  function draw(timestamp) {
    const elapsed = previousTimestamp ? Math.min((timestamp - previousTimestamp) / 1000, 0.04) : 0;
    previousTimestamp = timestamp;
    samplePrecipitation(timestamp);

    if (ball && simulation !== "waiting" && hasField) {
      const colorStrength = precipitationAt(ball.x, ball.y);
      if (colorStrength > COLOR_CONTACT_THRESHOLD && !ball.onColoredPatch) {
        const edgeNormal = precipitationEdgeNormalAt(ball.x, ball.y);
        const impulse = (5 + colorStrength * 28) * impactStrength;
        if (edgeNormal) {
          ball.vx += edgeNormal.x * impulse;
          ball.vy += edgeNormal.y * impulse;
          simulation = "moving";
          ball.boostFlash = 1;
          ball.boostAmount = impulse;
          setStatus(`Precipitation edge contact · +${Math.round(impulse)} momentum`);
        } else {
          setStatus("Precipitation reached the ball · waiting for a clear edge direction.");
        }
        ball.onColoredPatch = true;
      } else if (colorStrength < COLOR_CONTACT_RESET) {
        ball.onColoredPatch = false;
      }

      if (simulation === "moving") {
        const retention = Math.pow(0.5, elapsed / inertiaHalfLife);
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
        ball.boostFlash = Math.max(0, ball.boostFlash - elapsed * 1.8);

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

    context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    drawBall();
    animationId = requestAnimationFrame(draw);
  }

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
    setStatus("Ball repositioned · waiting for a precipitation edge.");
  });

  resetButton.addEventListener("click", resetBall);
  videoButton.addEventListener("click", async () => {
    if (video.paused) {
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
      video.pause();
      videoLabel.textContent = "Play video";
      videoButton.querySelector(".play-icon").textContent = "▶";
      frameLabel.textContent = "FIELD PAUSED";
    }
  });

  impactControl.addEventListener("input", () => {
    impactStrength = Number(impactControl.value);
    impactOutput.value = `${impactStrength.toFixed(1)}×`;
    impactOutput.textContent = impactOutput.value;
  });

  inertiaControl.addEventListener("input", () => {
    inertiaHalfLife = Number(inertiaControl.value);
    inertiaOutput.value = `${inertiaHalfLife} s`;
    inertiaOutput.textContent = inertiaOutput.value;
  });

  video.addEventListener("loadeddata", () => {
    videoButton.disabled = false;
    frameLabel.textContent = "FIELD READY";
    prompt.textContent = "Click anywhere on the map to place your ball";
    if (!ball) setStatus("Video ready · place a ball and wait for a colored precipitation edge.");
    video.play().catch((error) => {
      setStatus("Video ready · press Play video to start the precipitation field.");
      console.error("Could not autoplay the precipitation video:", error);
    });
  });

  video.addEventListener("error", () => {
    videoButton.disabled = true;
    frameLabel.textContent = "VIDEO UNAVAILABLE";
    setStatus("Could not load the local video. Start the server from the repository root; see earth-jukebox/README.md.");
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
