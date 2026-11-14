(() => {
  "use strict";

  const ANALYSIS_WIDTH = 900;
  const ANALYSIS_HEIGHT = 450;
  const PIXEL_COUNT = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;
  const SNAPSHOT_COUNT = 48;
  const SEQUENCE_DURATION_MS = 12_500;
  const SETTINGS_STORAGE_KEY = "storm-watch.settings.v1";
  const SNAPSHOT_PATH = "../../../data/nasa-svs/4285/imergert_alpha.2026-11-07T";
  const PREPROCESSED_PATH = "./data/preprocessed-tracks.json";

  const canvas = document.querySelector("#storm-map");
  const context = canvas.getContext("2d");
  const image = document.querySelector("#snapshot-image");
  const list = document.querySelector("#storm-list");
  const selectionHint = document.querySelector("#selection-hint");
  const frameClock = document.querySelector("#frame-clock");
  const stormCount = document.querySelector("#storm-count");
  const status = document.querySelector("#tracker-status");
  const timeline = document.querySelector("#timeline");
  const timelineLabel = document.querySelector("#timeline-label");
  const playButton = document.querySelector("#play-sequence");
  const playLabel = document.querySelector("#play-label");
  const previousButton = document.querySelector("#previous-frame");
  const nextButton = document.querySelector("#next-frame");
  const settingsPanel = document.querySelector(".tracker-settings");
  const settingControls = [...document.querySelectorAll("[data-setting]")];

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = ANALYSIS_WIDTH;
  sourceCanvas.height = ANALYSIS_HEIGHT;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });

  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = ANALYSIS_WIDTH;
  overlayCanvas.height = ANALYSIS_HEIGHT;
  const overlayContext = overlayCanvas.getContext("2d");

  const settings = {
    minimumArea: 200,
    alphaThreshold: 16,
    gapRadius: 1,
    seedRedness: 140,
    seedMergeDistance: 36,
    colorTolerance: 100,
    maximumMotion: 56,
    overlapThreshold: 0.1,
    mergeThreshold: 0.2,
    matchConfidence: 0.3,
    memoryFrames: 2,
  };
  const frameNames = Array.from({ length: SNAPSHOT_COUNT }, (_, index) => {
    const hour = String(Math.floor(index / 2)).padStart(2, "0");
    const minute = index % 2 === 0 ? "00" : "30";
    return `${SNAPSHOT_PATH}${hour}:${minute}:00Z.png`;
  });

  let analyzedFrames = [];
  let currentFrameIndex = 0;
  let selectedStormId = null;
  let nextStormId = 1;
  let playbackAnimationFrame = 0;
  let playbackStartedAt = 0;
  let rebuildTimer = 0;
  let rebuildVersion = 0;
  let isPlaying = false;
  let settingsStorageWarning = "";
  let preprocessedMode = false;

  function setStatus(message) {
    status.textContent = settingsStorageWarning ? `${message} · ${settingsStorageWarning}` : message;
  }

  function isValidStoredValue(control, value) {
    if (control.type !== "range") {
      return [...control.options].some((option) => option.value === value);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const min = Number(control.min);
    const max = Number(control.max);
    const step = Number(control.step) || 1;
    const stepsFromMin = (value - min) / step;
    return value >= min && value <= max && Math.abs(stepsFromMin - Math.round(stepsFromMin)) < 1e-8;
  }

  function loadSavedSettings() {
    let serialized;
    try {
      serialized = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    } catch (error) {
      console.error("Could not read storm tracker settings from browser storage.", error);
      settingsStorageWarning = "Settings could not be loaded from browser storage";
      return;
    }
    if (serialized === null) return;

    let saved;
    try {
      saved = JSON.parse(serialized);
    } catch (error) {
      console.error("Saved storm tracker settings are not valid JSON.", error);
      settingsStorageWarning = "Saved settings were invalid; defaults are in use";
      return;
    }
    if (!saved || saved.version !== 1 || typeof saved.values !== "object" || saved.values === null) {
      console.error("Saved storm tracker settings have an unsupported format.");
      settingsStorageWarning = "Saved settings were invalid; defaults are in use";
      return;
    }

    for (const control of settingControls) {
      const value = saved.values[control.dataset.setting];
      if (value === undefined) continue;
      if (!isValidStoredValue(control, value)) {
        console.error(`Ignoring invalid saved value for storm tracker setting "${control.dataset.setting}".`);
        settingsStorageWarning = "Some saved settings were invalid; defaults are in use";
        continue;
      }
      control.value = String(value);
    }
  }

  function saveSettings() {
    const values = {};
    for (const control of settingControls) {
      values[control.dataset.setting] = control.type === "range"
        ? Number(control.value)
        : control.value;
    }
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values }));
      settingsStorageWarning = "";
    } catch (error) {
      console.error("Could not save storm tracker settings to browser storage.", error);
      settingsStorageWarning = "Settings could not be saved in this browser";
    }
  }

  function updateSettingLabels() {
    for (const control of settingControls) {
      const output = document.querySelector(`#${control.id}-output`);
      const value = Number(control.value);
      const settingName = control.dataset.setting;
      settings[settingName] = ["overlapThreshold", "mergeThreshold", "matchConfidence"].includes(settingName)
        ? value / 100
        : control.type === "range"
          ? value
          : control.value;
      if (control.id === "minimum-area") output.value = `${value} px`;
      else if (control.id === "alpha-threshold") output.value = `${value} / 255`;
      else if (control.id === "gap-radius") output.value = `${value} px`;
      else if (control.id === "seed-redness") output.value = `${value} / 255`;
      else if (control.id === "seed-merge-distance") output.value = `${value} px`;
      else if (control.id === "color-tolerance") output.value = `${value} RGB`;
      else if (control.id === "maximum-motion") output.value = `${value} px`;
      else if (control.id === "overlap-threshold" || control.id === "merge-threshold" || control.id === "match-confidence") {
        output.value = `${value}%`;
      } else if (control.id === "memory-frames") output.value = `${value} frames`;
      output.textContent = output.value;
    }
  }

  function morphPass(source, radius, horizontal, dilate) {
    const target = new Uint8Array(PIXEL_COUNT);
    if (radius === 0) return source.slice();
    const lineLength = horizontal ? ANALYSIS_WIDTH : ANALYSIS_HEIGHT;
    const lineCount = horizontal ? ANALYSIS_HEIGHT : ANALYSIS_WIDTH;
    for (let line = 0; line < lineCount; line += 1) {
      let sum = 0;
      const at = (position) => horizontal
        ? line * ANALYSIS_WIDTH + position
        : position * ANALYSIS_WIDTH + line;
      for (let position = -radius; position <= radius; position += 1) {
        if (position >= 0 && position < lineLength) sum += source[at(position)];
      }
      for (let position = 0; position < lineLength; position += 1) {
        const expected = radius * 2 + 1;
        target[at(position)] = dilate ? Number(sum > 0) : Number(sum === expected);
        const remove = position - radius;
        const add = position + radius + 1;
        if (remove >= 0) sum -= source[at(remove)];
        if (add < lineLength) sum += source[at(add)];
      }
    }
    return target;
  }

  function closeGaps(mask, radius) {
    if (radius === 0) return mask;
    const dilated = morphPass(morphPass(mask, radius, true, true), radius, false, true);
    return morphPass(morphPass(dilated, radius, true, false), radius, false, false);
  }

  function rgbDistance(first, second) {
    return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
  }

  function stormCoreStrength(red, green, blue) {
    const hue = stormCoreHue(red, green, blue);
    if (hue === null) return 0;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    return Math.round(((max - min) / max) * 255);
  }

  function stormCoreFocusWeight(red, green, blue) {
    const hue = stormCoreHue(red, green, blue);
    const brightness = Math.max(red, green, blue);
    if (hue === null || brightness < 48) return 0;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    return stormCoreStrength(red, green, blue) * (255 - luminance) / 255;
  }

  function stormCoreHue(red, green, blue) {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    if (max === 0 || max === min) return null;
    const delta = max - min;
    let hue;
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
    hue = (hue + 360) % 360;
    const isRedCore = hue <= 25 || hue >= 335;
    const isBlueCore = hue >= 185 && hue <= 275;
    return isRedCore ? "red" : isBlueCore ? "blue" : null;
  }

  function pushCandidate(heap, candidate) {
    heap.push(candidate);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent].cost <= candidate.cost) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = candidate;
  }

  function popCandidate(heap) {
    const first = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && heap[right].cost < heap[left].cost ? right : left;
        if (heap[child].cost >= last.cost) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = last;
    }
    return first;
  }

  function extractComponents(imageData, frameIndex) {
    const mask = new Uint8Array(PIXEL_COUNT);
    const pixels = imageData.data;
    const redness = new Uint8Array(PIXEL_COUNT);
    for (let index = 0; index < PIXEL_COUNT; index += 1) {
      const offset = index * 4;
      mask[index] = Number(pixels[offset + 3] >= settings.alphaThreshold);
      redness[index] = stormCoreStrength(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    }

    const filteredMask = closeGaps(mask, settings.gapRadius);
    const labels = new Uint32Array(PIXEL_COUNT);
    const seedMask = new Uint8Array(PIXEL_COUNT);
    for (let index = 0; index < PIXEL_COUNT; index += 1) {
      seedMask[index] = Number(filteredMask[index] && redness[index] >= settings.seedRedness);
    }

    const visitedSeeds = new Uint8Array(PIXEL_COUNT);
    const queue = new Int32Array(PIXEL_COUNT);
    const seedPatches = [];
    for (let start = 0; start < PIXEL_COUNT; start += 1) {
      if (!seedMask[start] || visitedSeeds[start]) continue;
      let head = 0;
      let tail = 0;
      let sumX = 0;
      let sumY = 0;
      let sumRed = 0;
      let sumGreen = 0;
      let sumBlue = 0;
      let weightedX = 0;
      let weightedY = 0;
      let totalFocusWeight = 0;
      const patchPixels = [];
      visitedSeeds[start] = 1;
      queue[tail++] = start;
      while (head < tail) {
        const pixelIndex = queue[head++];
        const offset = pixelIndex * 4;
        const x = pixelIndex % ANALYSIS_WIDTH;
        const y = Math.floor(pixelIndex / ANALYSIS_WIDTH);
        sumX += x;
        sumY += y;
        sumRed += pixels[offset];
        sumGreen += pixels[offset + 1];
        sumBlue += pixels[offset + 2];
        const focusWeight = stormCoreFocusWeight(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
        weightedX += x * focusWeight;
        weightedY += y * focusWeight;
        totalFocusWeight += focusWeight;
        patchPixels.push(pixelIndex);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextX >= ANALYSIS_WIDTH || nextY < 0 || nextY >= ANALYSIS_HEIGHT) continue;
            const next = nextY * ANALYSIS_WIDTH + nextX;
            if (!seedMask[next] || visitedSeeds[next]) continue;
            visitedSeeds[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      seedPatches.push({
        pixels: patchPixels,
        area: tail,
        x: totalFocusWeight ? weightedX / totalFocusWeight : sumX / tail,
        y: totalFocusWeight ? weightedY / totalFocusWeight : sumY / tail,
        strength: totalFocusWeight,
        color: [sumRed / tail, sumGreen / tail, sumBlue / tail],
        coreHue: stormCoreHue(pixels[start * 4], pixels[start * 4 + 1], pixels[start * 4 + 2]),
      });
    }

    const seedParents = seedPatches.map((_, index) => index);
    function findSeed(index) {
      while (seedParents[index] !== index) {
        seedParents[index] = seedParents[seedParents[index]];
        index = seedParents[index];
      }
      return index;
    }
    for (let first = 0; first < seedPatches.length; first += 1) {
      for (let second = first + 1; second < seedPatches.length; second += 1) {
        const a = seedPatches[first];
        const b = seedPatches[second];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > settings.seedMergeDistance) continue;
        const colorDifference = rgbDistance(a.color, b.color);
        const crossCore = a.coreHue !== b.coreHue;
        if (!crossCore && colorDifference > settings.colorTolerance) continue;
        const rootA = findSeed(first);
        const rootB = findSeed(second);
        if (rootA !== rootB) seedParents[rootB] = rootA;
      }
    }

    const seedGroups = new Map();
    for (let index = 0; index < seedPatches.length; index += 1) {
      const root = findSeed(index);
      if (!seedGroups.has(root)) {
        seedGroups.set(root, { pixels: [], corePoints: [], area: 0, sumX: 0, sumY: 0, colorSum: [0, 0, 0] });
      }
      const group = seedGroups.get(root);
      const seed = seedPatches[index];
      for (const pixel of seed.pixels) group.pixels.push(pixel);
      group.corePoints.push({ x: seed.x, y: seed.y, strength: seed.strength, hue: seed.coreHue });
      group.area += seed.area;
      group.sumX += seed.x * seed.area;
      group.sumY += seed.y * seed.area;
      for (let channel = 0; channel < 3; channel += 1) group.colorSum[channel] += seed.color[channel] * seed.area;
    }

    const components = [];
    const heap = [];
    const bestCosts = new Float64Array(PIXEL_COUNT);
    bestCosts.fill(Number.POSITIVE_INFINITY);
    const colorTolerance = Math.max(1, settings.colorTolerance);

    function enqueueNeighbors(component, pixelIndex, cost) {
      const x = pixelIndex % ANALYSIS_WIDTH;
      const y = Math.floor(pixelIndex / ANALYSIS_WIDTH);
      const meanColor = component.colorSum.map((sum) => sum / component.area);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= ANALYSIS_WIDTH || nextY < 0 || nextY >= ANALYSIS_HEIGHT) continue;
          const next = nextY * ANALYSIS_WIDTH + nextX;
          if (!filteredMask[next] || labels[next]) continue;
          const offset = next * 4;
          const colorDifference = rgbDistance(meanColor, [pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
          const nextCost = cost + Math.hypot(dx, dy) + colorDifference / colorTolerance;
          if (nextCost >= bestCosts[next]) continue;
          bestCosts[next] = nextCost;
          pushCandidate(heap, { cost: nextCost, pixel: next, label: component.label });
        }
      }
    }

    function drainFrontier() {
      while (heap.length) {
        const candidate = popCandidate(heap);
        const pixelIndex = candidate.pixel;
        if (labels[pixelIndex] || candidate.cost !== bestCosts[pixelIndex]) continue;
        const component = components[candidate.label - 1];
        labels[pixelIndex] = component.label;
        const x = pixelIndex % ANALYSIS_WIDTH;
        const y = Math.floor(pixelIndex / ANALYSIS_WIDTH);
        const offset = pixelIndex * 4;
        component.area += 1;
        component.sumX += x;
        component.sumY += y;
        component.colorSum[0] += pixels[offset];
        component.colorSum[1] += pixels[offset + 1];
        component.colorSum[2] += pixels[offset + 2];
        component.minX = Math.min(component.minX, x);
        component.minY = Math.min(component.minY, y);
        component.maxX = Math.max(component.maxX, x);
        component.maxY = Math.max(component.maxY, y);
        component.pixels.push(pixelIndex);
        enqueueNeighbors(component, pixelIndex, candidate.cost);
      }
    }

    function addSeedGroup(group) {
      const label = components.length + 1;
      const component = {
        label,
        area: group.area,
        sumX: group.sumX,
        sumY: group.sumY,
        colorSum: group.colorSum.slice(),
        minX: ANALYSIS_WIDTH,
        minY: ANALYSIS_HEIGHT,
        maxX: 0,
        maxY: 0,
        pixels: [],
        corePoints: group.corePoints ?? [],
        frameIndex,
        id: null,
        lineageIds: [],
        lineageAnchors: [],
        vx: 0,
        vy: 0,
        missed: 0,
      };
      for (const pixel of group.pixels) {
        labels[pixel] = label;
        component.pixels.push(pixel);
        const x = pixel % ANALYSIS_WIDTH;
        const y = Math.floor(pixel / ANALYSIS_WIDTH);
        component.minX = Math.min(component.minX, x);
        component.minY = Math.min(component.minY, y);
        component.maxX = Math.max(component.maxX, x);
        component.maxY = Math.max(component.maxY, y);
      }
      components.push(component);
      for (const pixel of group.pixels) enqueueNeighbors(component, pixel, 0);
    }

    for (const group of seedGroups.values()) {
      addSeedGroup({
        ...group,
        colorSum: group.colorSum,
      });
    }
    drainFrontier();

    for (let start = 0; start < PIXEL_COUNT; start += 1) {
      if (!filteredMask[start] || labels[start]) continue;
      let head = 0;
      let tail = 0;
      let strongestCorePixel = start;
      visitedSeeds[start] = 1;
      queue[tail++] = start;
      while (head < tail) {
        const pixelIndex = queue[head++];
        if (redness[pixelIndex] > redness[strongestCorePixel]) strongestCorePixel = pixelIndex;
        const x = pixelIndex % ANALYSIS_WIDTH;
        const y = Math.floor(pixelIndex / ANALYSIS_WIDTH);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextX >= ANALYSIS_WIDTH || nextY < 0 || nextY >= ANALYSIS_HEIGHT) continue;
            const next = nextY * ANALYSIS_WIDTH + nextX;
            if (!filteredMask[next] || labels[next] || visitedSeeds[next]) continue;
            visitedSeeds[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      const offset = strongestCorePixel * 4;
      addSeedGroup({
        pixels: [strongestCorePixel],
        corePoints: [{
          x: strongestCorePixel % ANALYSIS_WIDTH,
          y: Math.floor(strongestCorePixel / ANALYSIS_WIDTH),
          strength: stormCoreFocusWeight(pixels[offset], pixels[offset + 1], pixels[offset + 2]),
          hue: stormCoreHue(pixels[offset], pixels[offset + 1], pixels[offset + 2]),
        }],
        area: 1,
        sumX: strongestCorePixel % ANALYSIS_WIDTH,
        sumY: Math.floor(strongestCorePixel / ANALYSIS_WIDTH),
        colorSum: [pixels[offset], pixels[offset + 1], pixels[offset + 2]],
      });
      drainFrontier();
    }

    const keptComponents = [];
    const filteredLabels = new Uint32Array(PIXEL_COUNT);
    for (const component of components) {
      if (component.area < settings.minimumArea) continue;
      component.x = component.sumX / component.area;
      component.y = component.sumY / component.area;
      component.meanColor = component.colorSum.map((sum) => sum / component.area);
      const coreWeight = component.corePoints.reduce((sum, point) => sum + point.strength, 0);
      component.maxCoreStrength = component.corePoints.reduce(
        (strongest, point) => Math.max(strongest, point.strength),
        0,
      );
      if (coreWeight > 0) {
        component.coreX = component.corePoints.reduce((sum, point) => sum + point.x * point.strength, 0) / coreWeight;
        component.coreY = component.corePoints.reduce((sum, point) => sum + point.y * point.strength, 0) / coreWeight;
      } else {
        component.coreX = component.x;
        component.coreY = component.y;
      }
      component.pixels = Int32Array.from(component.pixels);
      component.label = keptComponents.length + 1;
      for (const pixel of component.pixels) filteredLabels[pixel] = component.label;
      keptComponents.push(component);
    }

    return { components: keptComponents, labels: filteredLabels };
  }

  function awaitImage(url) {
    return new Promise((resolve, reject) => {
      const frame = new Image();
      frame.onload = () => resolve(frame);
      frame.onerror = () => reject(new Error(`Could not load snapshot: ${url}`));
      frame.src = url;
    });
  }

  function wrapX(x) {
    return (x % ANALYSIS_WIDTH + ANALYSIS_WIDTH) % ANALYSIS_WIDTH;
  }

  function signedHorizontalDelta(fromX, toX) {
    const difference = wrapX(toX - fromX);
    return difference > ANALYSIS_WIDTH / 2 ? difference - ANALYSIS_WIDTH : difference;
  }

  function horizontalDistance(firstX, secondX) {
    return Math.abs(signedHorizontalDelta(firstX, secondX));
  }

  function predictedIntersection(source, currentLabels) {
    const deltaFrames = Math.max(1, source.missed + 1);
    const dx = Math.round(source.vx * deltaFrames);
    const dy = Math.round(source.vy * deltaFrames);
    const counts = new Map();
    for (const pixel of source.pixels) {
      const x = wrapX(pixel % ANALYSIS_WIDTH + dx);
      const y = Math.floor(pixel / ANALYSIS_WIDTH) + dy;
      if (y < 0 || y >= ANALYSIS_HEIGHT) continue;
      const currentLabel = currentLabels[y * ANALYSIS_WIDTH + x];
      if (currentLabel) counts.set(currentLabel, (counts.get(currentLabel) ?? 0) + 1);
    }
    return counts;
  }

  function closestCorePoint(component, x, y, usedPoints = null) {
    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestScore = Number.POSITIVE_INFINITY;
    const strongestPoint = component.maxCoreStrength;
    for (const point of component.corePoints) {
      if (usedPoints?.has(point)) continue;
      const distance = Math.hypot(horizontalDistance(x, point.x), point.y - y);
      const strengthBonus = strongestPoint
        ? settings.maximumMotion * 0.15 * point.strength / strongestPoint
        : 0;
      const score = distance - strengthBonus;
      if (score < closestScore) {
        closest = point;
        closestDistance = distance;
        closestScore = score;
      }
    }
    return closest ? { point: closest, distance: closestDistance } : null;
  }

  function makeCandidate(source, target, overlapCount) {
    const elapsedFrames = Math.max(1, source.missed + 1);
    const predictedX = (source.coreX ?? source.x) + source.vx * elapsedFrames;
    const predictedY = (source.coreY ?? source.y) + source.vy * elapsedFrames;
    const matchedCore = closestCorePoint(target, predictedX, predictedY);
    const corePoint = matchedCore?.point ?? { x: target.x, y: target.y, strength: 0 };
    const distance = matchedCore?.distance
      ?? Math.hypot(horizontalDistance(predictedX, target.x), target.y - predictedY);
    const motionGate = settings.maximumMotion * Math.sqrt(elapsedFrames);
    const associatedCore = matchedCore && distance <= motionGate
      ? corePoint
      : { x: wrapX(predictedX), y: predictedY, strength: 0 };
    const overlap = overlapCount / Math.max(1, Math.min(source.area, target.area));
    const areaSimilarity = Math.exp(-Math.abs(Math.log(target.area / source.area)));
    const coreSimilarity = Math.exp(-distance / motionGate);
    const colorSimilarity = Math.exp(-rgbDistance(source.meanColor, target.meanColor) / (settings.colorTolerance * 2));
    const confidence = overlap * 0.3 + coreSimilarity * 0.42 + areaSimilarity * 0.14 + colorSimilarity * 0.14;
    if (confidence < settings.matchConfidence || (overlap < settings.overlapThreshold && distance > motionGate)) return null;
    return {
      source, target, overlap, distance, confidence, predictedX, predictedY,
      corePoint: associatedCore,
    };
  }

  function createStormId(parentId = null, frameIndex = currentFrameIndex) {
    const id = nextStormId++;
    return { id, parentId, firstFrame: frameIndex };
  }

  function updateAnchor(anchors, id, component, source) {
    const old = anchors.find((anchor) => anchor.id === id);
    const elapsedFrames = source ? Math.max(1, source.missed + 1) : 1;
    const vx = source
      ? signedHorizontalDelta(source.coreX ?? source.x, component.coreX) / elapsedFrames
      : 0;
    const vy = source ? (component.coreY - (source.coreY ?? source.y)) / elapsedFrames : 0;
    if (old) {
      old.x = component.coreX;
      old.y = component.coreY;
      old.vx = vx;
      old.vy = vy;
    } else {
      anchors.push({ id, x: component.coreX, y: component.coreY, vx, vy });
    }
  }

  function associateFrames(previous, current, labels, frameIndex, missingSources) {
    const sources = [...previous, ...missingSources];
    const labelToComponent = new Map(current.map((component) => [component.label, component]));
    const candidates = [];
    for (const source of sources) {
      const intersections = predictedIntersection(source, labels);
      for (const [label, overlapCount] of intersections) {
        const target = labelToComponent.get(label);
        if (!target) continue;
        const candidate = makeCandidate(source, target, overlapCount);
        if (candidate) candidates.push(candidate);
      }

      const predictedX = (source.coreX ?? source.x) + source.vx * (source.missed + 1);
      const predictedY = (source.coreY ?? source.y) + source.vy * (source.missed + 1);
      const gate = settings.maximumMotion * Math.sqrt(source.missed + 1);
      for (const target of current) {
        if (intersections.has(target.label)) continue;
        if (Math.hypot(horizontalDistance(predictedX, target.coreX), target.coreY - predictedY) > gate) continue;
        const candidate = makeCandidate(source, target, 0);
        if (candidate) candidates.push(candidate);
      }
    }
    candidates.sort((a, b) => b.confidence - a.confidence);

    const matchedTargets = new Set();
    const matchedSources = new Set();
    for (const candidate of candidates) {
      if (matchedTargets.has(candidate.target) || matchedSources.has(candidate.source)) continue;
      candidate.target.primaryMatch = candidate;
      matchedTargets.add(candidate.target);
      matchedSources.add(candidate.source);
    }

    const candidatesByTarget = new Map();
    const candidatesBySource = new Map();
    for (const candidate of candidates) {
      if (!candidatesByTarget.has(candidate.target)) candidatesByTarget.set(candidate.target, []);
      if (!candidatesBySource.has(candidate.source)) candidatesBySource.set(candidate.source, []);
      candidatesByTarget.get(candidate.target).push(candidate);
      candidatesBySource.get(candidate.source).push(candidate);
    }

    const splitAnchors = new Map();
    for (const [source, sourceCandidates] of candidatesBySource) {
      const children = [...new Set(sourceCandidates
        .filter((candidate) => candidate.overlap >= settings.overlapThreshold)
        .map((candidate) => candidate.target))];
      if (children.length < 2 || source.lineageAnchors.length < 2) continue;
      const possibilities = [];
      for (const target of children) {
        for (const anchor of source.lineageAnchors) {
          const elapsedFrames = source.missed + 1;
          const predictedX = anchor.x + anchor.vx * elapsedFrames;
          const predictedY = anchor.y + anchor.vy * elapsedFrames;
          const matchedCore = closestCorePoint(target, predictedX, predictedY);
          if (!matchedCore) continue;
          const { point: corePoint, distance } = matchedCore;
          if (distance <= settings.maximumMotion * 2) {
            possibilities.push({ target, anchor, source, distance, predictedX, predictedY, elapsedFrames, corePoint });
          }
        }
      }
      possibilities.sort((a, b) => a.distance - b.distance);
      const usedTargets = new Set();
      const usedAnchors = new Set();
      for (const possibility of possibilities) {
        if (usedTargets.has(possibility.target) || usedAnchors.has(possibility.anchor.id)) continue;
        splitAnchors.set(possibility.target, possibility);
        usedTargets.add(possibility.target);
        usedAnchors.add(possibility.anchor.id);
      }
    }

    const usedIds = new Set();
    for (const target of current) {
      const primary = target.primaryMatch;
      const mergeSources = (candidatesByTarget.get(target) ?? [])
        .filter((candidate) =>
          candidate.source !== primary?.source
          && !matchedSources.has(candidate.source)
          && candidate.overlap >= settings.mergeThreshold
          && (candidatesBySource.get(candidate.source) ?? []).every((other) =>
            other.target === target || other.confidence <= candidate.confidence
          ),
        )
        .map((candidate) => candidate.source);
      const allSources = [...new Set([primary?.source, ...mergeSources].filter(Boolean))];
      const splitMatch = splitAnchors.get(target);

      if (primary) {
        target.coreX = primary.corePoint.x;
        target.coreY = primary.corePoint.y;
      }
      if (splitMatch && !mergeSources.length) {
        const { anchor, source, elapsedFrames, corePoint } = splitMatch;
        target.id = anchor.id;
        target.lineageIds = [...source.lineageIds];
        target.lineageAnchors = source.lineageAnchors.map((item) => ({
          ...item,
          x: item.x + item.vx * elapsedFrames,
          y: item.y + item.vy * elapsedFrames,
        }));
        target.coreX = corePoint.x;
        target.coreY = corePoint.y;
        target.parentId = null;
        target.vx = signedHorizontalDelta(anchor.x, target.coreX) / elapsedFrames;
        target.vy = (target.coreY - anchor.y) / elapsedFrames;
        const restoredAnchor = target.lineageAnchors.find((item) => item.id === anchor.id);
        if (restoredAnchor) {
          restoredAnchor.x = target.coreX;
          restoredAnchor.y = target.coreY;
          restoredAnchor.vx = target.vx;
          restoredAnchor.vy = target.vy;
        }
      } else if (allSources.length) {
        const primarySource = primary?.source ?? allSources[0];
        const dt = primarySource.missed + 1;
        if (!primary) {
          const predictedX = (primarySource.coreX ?? primarySource.x) + primarySource.vx * dt;
          const predictedY = (primarySource.coreY ?? primarySource.y) + primarySource.vy * dt;
          const sourceCandidate = (candidatesByTarget.get(target) ?? [])
            .find((candidate) => candidate.source === primarySource);
          const matchedCore = sourceCandidate?.corePoint ?? closestCorePoint(target, predictedX, predictedY)?.point;
          if (matchedCore) {
            target.coreX = matchedCore.x;
            target.coreY = matchedCore.y;
          }
        }
        target.id = primarySource.id;
        target.parentId = primarySource.parentId ?? null;
        target.lineageIds = [...new Set(allSources.flatMap((source) => source.lineageIds))];
        target.lineageAnchors = [];
        const assignedCorePoints = new Set();
        for (const source of allSources) {
          for (const anchor of source.lineageAnchors) {
            if (!target.lineageAnchors.some((item) => item.id === anchor.id)) {
              const dt = source.missed + 1;
              const predictedX = wrapX(anchor.x + anchor.vx * dt);
              const predictedY = anchor.y + anchor.vy * dt;
              const matchedCore = closestCorePoint(target, predictedX, predictedY, assignedCorePoints);
              const motionGate = settings.maximumMotion * Math.sqrt(dt);
              const canFollowCore = matchedCore && matchedCore.distance <= motionGate;
              if (canFollowCore) assignedCorePoints.add(matchedCore.point);
              const anchorX = canFollowCore ? matchedCore.point.x : predictedX;
              const anchorY = canFollowCore ? matchedCore.point.y : predictedY;
              const anchorYIndex = Math.round(anchorY);
              const anchorXIndex = Math.round(anchorX) % ANALYSIS_WIDTH;
              if (!canFollowCore && (anchorYIndex < 0 || anchorYIndex >= ANALYSIS_HEIGHT
                || labels[anchorYIndex * ANALYSIS_WIDTH + anchorXIndex] !== target.label)) {
                continue;
              }
              target.lineageAnchors.push({
                ...anchor,
                x: anchorX,
                y: anchorY,
                vx: canFollowCore ? signedHorizontalDelta(anchor.x, matchedCore.point.x) / dt : anchor.vx,
                vy: canFollowCore ? (matchedCore.point.y - anchor.y) / dt : anchor.vy,
              });
            }
          }
        }
        target.vx = signedHorizontalDelta(primarySource.coreX ?? primarySource.x, target.coreX) / dt;
        target.vy = (target.coreY - (primarySource.coreY ?? primarySource.y)) / dt;
        if (target.lineageIds.length === 1) {
          updateAnchor(target.lineageAnchors, target.id, target, primarySource);
        }
        for (const source of mergeSources) {
          matchedSources.add(source);
          const meta = stormRegistry.get(source.id);
          if (meta) meta.mergedInto = target.id;
        }
        if (mergeSources.length) {
          const meta = stormRegistry.get(target.id);
          if (meta) meta.merges += 1;
        }
      } else {
        const meta = createStormId(null, frameIndex);
        stormRegistry.set(meta.id, { ...meta, lastFrame: frameIndex, merges: 0, mergedInto: null });
        target.id = meta.id;
        target.parentId = null;
        target.lineageIds = [meta.id];
        target.lineageAnchors = [{ id: meta.id, x: target.coreX, y: target.coreY, vx: 0, vy: 0 }];
        target.vx = 0;
        target.vy = 0;
      }

      if (usedIds.has(target.id)) {
        const previousId = target.id;
        const meta = createStormId(target.id, frameIndex);
        stormRegistry.set(meta.id, { ...meta, lastFrame: frameIndex, merges: 0, mergedInto: null });
        target.parentId = previousId;
        target.id = meta.id;
        target.lineageIds = [...new Set([...target.lineageIds, previousId, meta.id])];
        target.lineageAnchors.push({ id: meta.id, x: target.coreX, y: target.coreY, vx: target.vx, vy: target.vy });
      }
      usedIds.add(target.id);
      target.frameIndex = frameIndex;
      target.missed = 0;

      const record = stormRegistry.get(target.id);
      if (record) {
        record.lastFrame = frameIndex;
        record.mergedInto = null;
      }
      for (const lineageId of target.lineageIds) {
        const lineage = stormRegistry.get(lineageId);
        if (lineage) lineage.lastFrame = frameIndex;
      }
    }

    const nextMissing = [];
    for (const source of sources) {
      if (matchedSources.has(source)) continue;
      const missed = source.missed + 1;
      if (missed > settings.memoryFrames) continue;
      nextMissing.push({
        ...source,
        missed,
        frameIndex,
      });
    }
    return nextMissing;
  }

  const stormRegistry = new Map();

  function formatTime(index) {
    const hour = String(Math.floor(index / 2)).padStart(2, "0");
    return `${hour}:${index % 2 === 0 ? "00" : "30"} UTC`;
  }

  async function rebuildAnalysis() {
    window.clearTimeout(rebuildTimer);
    stopSequence();
    preprocessedMode = false;
    updateSettingLabels();
    const version = ++rebuildVersion;
    analyzedFrames = [];
    nextStormId = 1;
    stormRegistry.clear();
    selectedStormId = null;
    setStatus("Rebuilding storm clusters and tracks across 48 snapshots…");
    list.replaceChildren();

    try {
      let missingSources = [];
      let previous = [];
      for (let frameIndex = 0; frameIndex < SNAPSHOT_COUNT; frameIndex += 1) {
        if (version !== rebuildVersion) return;
        setStatus(`Analyzing snapshot ${frameIndex + 1} of ${SNAPSHOT_COUNT} · ${formatTime(frameIndex)}.`);
        const frameImage = await awaitImage(frameNames[frameIndex]);
        sourceContext.clearRect(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        sourceContext.drawImage(frameImage, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        const imageData = sourceContext.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        const extracted = extractComponents(imageData, frameIndex);
        let frameMissingSources = [];
        if (frameIndex > 0) {
          missingSources = associateFrames(previous, extracted.components, extracted.labels, frameIndex, missingSources);
          frameMissingSources = missingSources;
        } else {
          for (const component of extracted.components) {
            const meta = createStormId(null, frameIndex);
            stormRegistry.set(meta.id, { ...meta, lastFrame: 0, merges: 0, mergedInto: null });
            component.id = meta.id;
            component.lineageIds = [meta.id];
            component.lineageAnchors = [{ id: meta.id, x: component.coreX, y: component.coreY, vx: 0, vy: 0 }];
          }
        }
        analyzedFrames.push({ ...extracted, missingSources: frameMissingSources });
        previous = extracted.components;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }

      if (version !== rebuildVersion) return;
      timeline.disabled = false;
      previousButton.disabled = false;
      nextButton.disabled = false;
      playButton.disabled = false;
      currentFrameIndex = Math.min(currentFrameIndex, SNAPSHOT_COUNT - 1);
      renderFrame(currentFrameIndex);
      setStatus(`Tracking ready · ${stormRegistry.size} storm identities across ${SNAPSHOT_COUNT} half-hourly snapshots.`);
    } catch (error) {
      setStatus("Could not analyze the NASA snapshots. Check the bundled data files and reload.");
      console.error("Could not analyze storm snapshots:", error);
    }
  }

  function stormColor(id) {
    const hue = (id * 137.508) % 360;
    return { hue, rgb: `hsl(${hue} 96% 62%)` };
  }

  function renderStormList(components) {
    list.replaceChildren();
    stormCount.textContent = `${components.length} DETECTED`;
    if (!components.length) {
      const empty = document.createElement("p");
      empty.className = "empty-storm-list";
      empty.textContent = "No storms meet the current area and mask thresholds in this snapshot.";
      list.append(empty);
      return;
    }

    const sorted = [...components].sort((a, b) => b.area - a.area);
    for (const component of sorted) {
      const button = document.createElement("button");
      button.className = "storm-option";
      button.type = "button";
      button.setAttribute("role", "listitem");
      const isSelectedFamily = selectedStormId === component.id || component.lineageIds.includes(selectedStormId);
      button.setAttribute("aria-pressed", String(isSelectedFamily));
      const color = stormColor(isSelectedFamily ? selectedStormId : component.id);
      button.style.setProperty("--storm-color", color.rgb);
      const title = document.createElement("span");
      title.className = "storm-option-title";
      title.textContent = `Storm ${isSelectedFamily ? selectedStormId : component.id}`;
      const detail = document.createElement("span");
      detail.className = "storm-option-detail";
      const merged = component.lineageIds.length > 1 ? ` · ${component.lineageIds.length} linked tracks` : "";
      const currentPart = isSelectedFamily && component.id !== selectedStormId
        ? ` · current part ${component.id}`
        : "";
      detail.textContent = `${component.area.toLocaleString()} analysis px${merged}${currentPart}`;
      const swatch = document.createElement("span");
      swatch.className = "storm-swatch";
      swatch.setAttribute("aria-hidden", "true");
      button.append(swatch, title, detail);
      button.addEventListener("click", () => {
        selectedStormId = component.id;
        selectionHint.textContent = `Following Storm ${component.id} · every part of its merged family stays highlighted after a split.`;
        renderFrame(currentFrameIndex);
      });
      list.append(button);
    }
  }

  function renderFrame(index) {
    if (!analyzedFrames[index]) return;
    currentFrameIndex = index;
    image.src = frameNames[index];
    frameClock.textContent = `2026-11-07 · ${formatTime(index)}`;
    timeline.value = String(index);
    timelineLabel.value = `${formatTime(index)} · ${index + 1} / ${SNAPSHOT_COUNT}`;
    timelineLabel.textContent = timelineLabel.value;
    const components = analyzedFrames[index].components;
    const activeLineageIds = new Set(components.flatMap((component) => component.lineageIds));
    const remembered = analyzedFrames[index].missingSources.filter((source) =>
      selectedStormId !== null
      && (source.id === selectedStormId || source.lineageIds.includes(selectedStormId))
      && !activeLineageIds.has(source.id),
    );
    const selectionPresent = selectedStormId !== null && activeLineageIds.has(selectedStormId);
    renderStormList(components);
    selectionHint.textContent = selectedStormId
      ? remembered.length
        ? `Following Storm ${selectedStormId} · temporarily below the area cutoff; showing its predicted position for ${remembered[0].missed} snapshot${remembered[0].missed === 1 ? "" : "s"}.`
        : selectionPresent
          ? `Following Storm ${selectedStormId} · every part of its merged family stays highlighted after a split.`
          : `Storm ${selectedStormId} is not detected in this snapshot; its tracking memory has expired.`
      : "Choose a storm to follow it; if storms merge and split, every part of the family stays highlighted.";
    drawFrame(image, components, analyzedFrames[index].missingSources);
  }

  function drawFrame(frameImage, components, missingSources = []) {
    if (!frameImage.complete || !frameImage.naturalWidth) {
      frameImage.onload = () => drawFrame(frameImage, components, missingSources);
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frameImage, 0, 0, canvas.width, canvas.height);
    const selected = selectedStormId === null
      ? []
      : components.filter((component) => component.id === selectedStormId || component.lineageIds.includes(selectedStormId));
    const activeLineageIds = new Set(selected.flatMap((component) => component.lineageIds));
    const remembered = selectedStormId === null
      ? []
      : missingSources.filter((source) =>
        (source.id === selectedStormId || source.lineageIds.includes(selectedStormId))
        && !activeLineageIds.has(source.id),
      );
    if (preprocessedMode) {
      overlayContext.clearRect(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      function drawPolygons(component, fillAlpha, lineAlpha, dashed = false) {
        const { hue } = stormColor(selectedStormId ?? component.id);
        const color = hueToRgb(hue);
        overlayContext.beginPath();
        for (const polygon of component.polygons ?? []) {
          for (const ring of [polygon.outer, ...(polygon.holes ?? [])]) {
            if (!ring?.length) continue;
            overlayContext.moveTo(ring[0][0], ring[0][1]);
            for (let point = 1; point < ring.length; point += 1) {
              overlayContext.lineTo(ring[point][0], ring[point][1]);
            }
            overlayContext.closePath();
          }
        }
        overlayContext.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${fillAlpha})`;
        overlayContext.fill("evenodd");
        overlayContext.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${lineAlpha})`;
        overlayContext.lineWidth = dashed ? 1 : 1.5;
        overlayContext.setLineDash(dashed ? [5, 4] : []);
        overlayContext.stroke();
        overlayContext.setLineDash([]);
      }
      for (const component of selected) drawPolygons(component, 0.35, 0.98);
      for (const source of remembered) drawPolygons(source, 0.14, 0.62, true);
    } else {
      const overlay = overlayContext.createImageData(ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      function paintMask(component, alpha, edgeAlpha, dx = 0, dy = 0) {
        const { hue } = stormColor(selectedStormId ?? component.id);
        const color = hueToRgb(hue);
        const translated = [];
        const memberPixels = new Set();
        for (const pixel of component.pixels) {
          const x = wrapX(pixel % ANALYSIS_WIDTH + dx);
          const y = Math.floor(pixel / ANALYSIS_WIDTH) + dy;
          if (y < 0 || y >= ANALYSIS_HEIGHT) continue;
          const translatedPixel = y * ANALYSIS_WIDTH + x;
          translated.push(translatedPixel);
          memberPixels.add(translatedPixel);
        }
        for (const pixel of translated) {
          const offset = pixel * 4;
          overlay.data[offset] = color.r;
          overlay.data[offset + 1] = color.g;
          overlay.data[offset + 2] = color.b;
          overlay.data[offset + 3] = alpha;
          const x = pixel % ANALYSIS_WIDTH;
          const y = Math.floor(pixel / ANALYSIS_WIDTH);
          const westPixel = y * ANALYSIS_WIDTH + wrapX(x - 1);
          const eastPixel = y * ANALYSIS_WIDTH + wrapX(x + 1);
          const edge = y === 0 || y === ANALYSIS_HEIGHT - 1
            || !memberPixels.has(westPixel)
            || !memberPixels.has(eastPixel)
            || !memberPixels.has(pixel - ANALYSIS_WIDTH)
            || !memberPixels.has(pixel + ANALYSIS_WIDTH);
          if (edge) overlay.data[offset + 3] = edgeAlpha;
        }
      }
      for (const component of selected) paintMask(component, 92, 240);
      for (const source of remembered) {
        paintMask(source, 36, 140, Math.round(source.vx * source.missed), Math.round(source.vy * source.missed));
      }
      overlayContext.putImageData(overlay, 0, 0);
    }
    context.save();
    context.globalAlpha = 0.72;
    context.filter = "blur(5px)";
    context.drawImage(overlayCanvas, 0, 0, canvas.width, canvas.height);
    context.filter = "none";
    context.globalAlpha = 1;
    context.drawImage(overlayCanvas, 0, 0, canvas.width, canvas.height);
    context.restore();
    if (selectedStormId !== null) {
      const { rgb } = stormColor(selectedStormId);
      function drawCoreMarker(x, y) {
        const canvasX = x * canvas.width / ANALYSIS_WIDTH;
        const canvasY = y * canvas.height / ANALYSIS_HEIGHT;
        context.save();
        context.shadowBlur = 12;
        context.shadowColor = rgb;
        context.strokeStyle = "#fff";
        context.lineWidth = 3;
        context.beginPath();
        context.arc(canvasX, canvasY, 8, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = rgb;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(canvasX, canvasY, 8, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = "#fff";
        context.beginPath();
        context.arc(canvasX, canvasY, 2, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
      if (selected.length) {
        for (const component of selected) {
          const anchor = component.lineageAnchors.find((item) => item.id === selectedStormId);
          drawCoreMarker(anchor?.x ?? component.coreX, anchor?.y ?? component.coreY);
        }
      } else {
        for (const source of remembered) {
          const anchor = source.lineageAnchors?.find((item) => item.id === selectedStormId);
          drawCoreMarker(anchor?.x ?? source.coreX, anchor?.y ?? source.coreY);
        }
      }
    }
  }

  function hueToRgb(hue) {
    const chroma = 1;
    const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    const section = Math.floor(hue / 60);
    const values = [
      [chroma, x, 0], [x, chroma, 0], [0, chroma, x],
      [0, x, chroma], [x, 0, chroma], [chroma, 0, x],
    ][section];
    return { r: Math.round(values[0] * 255), g: Math.round(values[1] * 255), b: Math.round(values[2] * 255) };
  }

  function onMapClick(event) {
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * ANALYSIS_WIDTH);
    const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * ANALYSIS_HEIGHT);
    if (x < 0 || x >= ANALYSIS_WIDTH || y < 0 || y >= ANALYSIS_HEIGHT) return;
    const components = analyzedFrames[currentFrameIndex]?.components ?? [];
    const component = preprocessedMode
      ? [...components].reverse().find((item) => item.polygons?.some((polygon) =>
        pointInRing(x, y, polygon.outer)
        && !(polygon.holes ?? []).some((hole) => pointInRing(x, y, hole)),
      ))
      : components.find((item) => item.label === analyzedFrames[currentFrameIndex]?.labels[y * ANALYSIS_WIDTH + x]);
    if (!component) {
      selectedStormId = null;
      renderFrame(currentFrameIndex);
      return;
    }
    selectedStormId = component.id;
    renderFrame(currentFrameIndex);
  }

  function pointInRing(x, y, ring) {
    let inside = false;
    for (let first = 0, second = ring.length - 1; first < ring.length; second = first, first += 1) {
      const [x1, y1] = ring[first];
      const [x2, y2] = ring[second];
      if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  }

  async function loadPreprocessed() {
    try {
      const response = await fetch(PREPROCESSED_PATH);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.version !== 1 || data.frames?.length !== SNAPSHOT_COUNT || data.width !== ANALYSIS_WIDTH || data.height !== ANALYSIS_HEIGHT) {
        throw new Error("Preprocessed polygon data has an unsupported format.");
      }
      analyzedFrames = data.frames.map((frame) => ({
        components: frame.components,
        labels: null,
        missingSources: frame.missingSources ?? [],
      }));
      nextStormId = Math.max(0, ...data.tracks.map((track) => track.id)) + 1;
      preprocessedMode = true;
      timeline.disabled = false;
      previousButton.disabled = false;
      nextButton.disabled = false;
      playButton.disabled = false;
      renderFrame(currentFrameIndex);
      setStatus(`Offline CV tracks ready · ${data.summary.trackCount} identities across ${SNAPSHOT_COUNT} snapshots.`);
    } catch (error) {
      console.warn("Could not load offline storm polygons; analyzing snapshots in the browser instead.", error);
      rebuildAnalysis();
    }
  }

  function stopSequence() {
    isPlaying = false;
    window.cancelAnimationFrame(playbackAnimationFrame);
    playLabel.textContent = "Play snapshots";
    playButton.querySelector(".button-icon").textContent = "▶";
  }

  function startSequence() {
    if (isPlaying) {
      stopSequence();
      return;
    }
    renderFrame(0);
    isPlaying = true;
    playLabel.textContent = "Pause snapshots";
    playButton.querySelector(".button-icon").textContent = "Ⅱ";
    playbackStartedAt = performance.now();
    const advanceSequence = (timestamp) => {
      if (!isPlaying) return;
      const elapsed = Math.min(timestamp - playbackStartedAt, SEQUENCE_DURATION_MS);
      const nextIndex = Math.min(
        SNAPSHOT_COUNT - 1,
        Math.floor((elapsed / SEQUENCE_DURATION_MS) * SNAPSHOT_COUNT),
      );
      if (nextIndex !== currentFrameIndex) renderFrame(nextIndex);
      if (elapsed >= SEQUENCE_DURATION_MS) {
        stopSequence();
        return;
      }
      playbackAnimationFrame = window.requestAnimationFrame(advanceSequence);
    };
    playbackAnimationFrame = window.requestAnimationFrame(advanceSequence);
  }

  function scheduleRebuild() {
    saveSettings();
    updateSettingLabels();
    rebuildTimer = window.setTimeout(rebuildAnalysis, 250);
  }

  for (const control of settingControls) {
    control.addEventListener(control.tagName === "SELECT" ? "change" : "input", scheduleRebuild);
  }
  timeline.addEventListener("input", () => renderFrame(Number(timeline.value)));
  previousButton.addEventListener("click", () => renderFrame(Math.max(0, currentFrameIndex - 1)));
  nextButton.addEventListener("click", () => renderFrame(Math.min(SNAPSHOT_COUNT - 1, currentFrameIndex + 1)));
  playButton.addEventListener("click", startSequence);
  canvas.addEventListener("click", onMapClick);
  canvas.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Escape") {
      selectedStormId = null;
      renderFrame(currentFrameIndex);
    }
  });
  settingsPanel.addEventListener("toggle", () => {
    settingsPanel.querySelector(".settings-toggle").textContent = settingsPanel.open ? "−" : "+";
  });

  loadSavedSettings();
  updateSettingLabels();
  loadPreprocessed();
})();
