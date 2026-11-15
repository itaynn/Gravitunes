const preview = document.querySelector("#preview");
const directions = [...document.querySelectorAll(".direction")];
const captions = {
  cinema: "01 / AFTER DARK — An immersive, cinematic listen.",
  signal: "02 / SIGNAL ROOM — A crisp, instrument-like radar console.",
  field: "03 / FIELD NOTES — An editorial atlas of weather.",
};
const descriptions = {
  cinema: "After dark",
  signal: "Signal room",
  field: "Field notes",
};
const video = document.querySelector("#map-video");
const loading = document.querySelector("#map-loading");
const hint = document.querySelector("#map-hint");
const selection = document.querySelector("#selection-status");
const playButton = document.querySelector("#play-button");
const playLabel = document.querySelector("#play-label");
const playIcon = document.querySelector("#play-icon");
const stopButton = document.querySelector("#stop-button");
const introButton = document.querySelector("#intro-audio");
const tutorial = document.querySelector("#tutorial-backdrop");
const tutorialStep = document.querySelector("#tutorial-step");
const tutorialTitle = document.querySelector("#tutorial-title");
const tutorialCopy = document.querySelector("#tutorial-copy");
const tutorialNext = document.querySelector("#next-tutorial");
const progress = [...document.querySelectorAll(".tutorial-progress i")];
const controls = document.querySelector("#hidden-controls");
const controlsToggle = document.querySelector("#controls-toggle");

const tutorialSlides = [
  ["Find a moving storm.", "Move your pointer over the map. Each storm has its own sound."],
  ["Choose your storm.", "Click a glowing marker to keep listening to that storm."],
  ["Listen to the day.", "Press Space to play its journey through the day. Press Space again to stop."],
];
let currentStep = 0;
let selectedStorm = null;
let playing = false;
let introUtterance = null;

function showTutorial() {
  currentStep = 0;
  updateTutorial();
  tutorial.hidden = false;
  tutorial.querySelector("#tutorial-close").focus();
}

function updateTutorial() {
  const [title, copy] = tutorialSlides[currentStep];
  tutorialStep.textContent = `QUICK LISTENING GUIDE · 0${currentStep + 1} / 03`;
  tutorialTitle.textContent = title;
  tutorialCopy.textContent = copy;
  tutorialNext.innerHTML = currentStep === tutorialSlides.length - 1 ? "Got it <span>✓</span>" : "Next <span>→</span>";
  progress.forEach((dot, i) => dot.classList.toggle("is-current", i <= currentStep));
}

function advanceTutorial() {
  if (tutorial.hidden) return;
  if (currentStep === tutorialSlides.length - 1) {
    tutorial.hidden = true;
    playButton.focus();
    return;
  }
  currentStep += 1;
  updateTutorial();
}

function setPlaying(next) {
  playing = next;
  playLabel.textContent = playing ? "Pause the day" : "Play the day";
  playIcon.textContent = playing ? "Ⅱ" : "▶";
  stopButton.disabled = !playing;
  selection.classList.toggle("is-playing", playing);
  selection.lastElementChild.textContent = playing
    ? `Playing ${selectedStorm ? `storm ${selectedStorm}` : "the whole map"}`
    : selectedStorm ? `Storm ${selectedStorm} selected` : "Choose a storm to begin";
}

function speakIntro() {
  if (!("speechSynthesis" in window)) {
    introButton.querySelector("small").textContent = "Audio intro unavailable";
    return;
  }
  window.speechSynthesis.cancel();
  introUtterance = new SpeechSynthesisUtterance("Hear the storm. Press Space to play the tutorial.");
  introUtterance.rate = 0.9;
  introUtterance.onstart = () => introButton.classList.add("is-speaking");
  introUtterance.onend = () => introButton.classList.remove("is-speaking");
  introUtterance.onerror = () => introButton.classList.remove("is-speaking");
  window.speechSynthesis.speak(introUtterance);
}

directions.forEach((button) => {
  button.addEventListener("click", () => {
    directions.forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    preview.className = `preview theme-${button.dataset.theme}`;
    document.querySelector("#direction-caption").textContent = captions[button.dataset.theme];
  });
});

document.querySelectorAll(".storm-point").forEach((button) => {
  button.addEventListener("click", () => {
    selectedStorm = button.dataset.storm;
    document.querySelectorAll(".storm-point").forEach((point) => point.classList.toggle("is-selected", point === button));
    hint.textContent = `Storm ${selectedStorm} selected · press Space to listen`;
    selection.lastElementChild.textContent = `Storm ${selectedStorm} selected`;
  });
  button.addEventListener("pointerenter", () => {
    hint.textContent = `Storm ${button.dataset.storm} · moving precipitation`;
  });
  button.addEventListener("pointerleave", () => {
    hint.textContent = selectedStorm ? `Storm ${selectedStorm} selected · press Space to listen` : "Move across the map. Find a storm.";
  });
});

playButton.addEventListener("click", () => setPlaying(!playing));
stopButton.addEventListener("click", () => setPlaying(false));
introButton.addEventListener("click", speakIntro);
tutorialNext.addEventListener("click", advanceTutorial);
document.querySelector("#tutorial-close").addEventListener("click", () => { tutorial.hidden = true; });
tutorial.addEventListener("click", (event) => {
  if (event.target === tutorial) tutorial.hidden = true;
});

controlsToggle.addEventListener("click", () => {
  controls.open = !controls.open;
  controlsToggle.setAttribute("aria-expanded", String(controls.open));
  controlsToggle.lastElementChild.textContent = controls.open ? "−" : "＋";
});
controls.addEventListener("toggle", () => {
  controlsToggle.setAttribute("aria-expanded", String(controls.open));
  controlsToggle.lastElementChild.textContent = controls.open ? "−" : "＋";
});

document.querySelector("#fullscreen-button").addEventListener("click", async () => {
  if (!document.fullscreenElement) await preview.requestFullscreen();
  else await document.exitFullscreen();
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat || event.target.matches("input, select, textarea")) return;
  if (event.target === introButton) {
    event.preventDefault();
    showTutorial();
    return;
  }
  if (tutorial.hidden && event.target.matches("button, summary")) return;
  event.preventDefault();
  if (!tutorial.hidden) {
    advanceTutorial();
    return;
  }
  if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) setPlaying(!playing);
});

video.addEventListener("loadeddata", () => {
  loading.hidden = true;
  video.play().catch(() => { loading.hidden = false; loading.textContent = "PRESS PLAY TO LOAD THE MAP"; });
});
video.addEventListener("canplay", () => { loading.hidden = true; });
video.addEventListener("error", () => {
  loading.textContent = "MAP PREVIEW UNAVAILABLE";
});
if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) loading.hidden = true;
