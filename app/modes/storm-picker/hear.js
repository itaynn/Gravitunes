// Hear the storm: the shell around the Sound lab (soundlab.js does all the sound and the map).
// This file only adds the intro, the tutorial, the "how the sound is made" card (I), the controls drawer,
// the week timeline and the spoken voice. Keys: ? opens the tutorial (Space or arrows move its slides); Space plays
// or stops the week (soundlab.js), and on the intro it skips straight in. I explains the sounds. Escape closes what is open.
(() => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const video = $("lab-video");
  const canvas = $("lab-canvas");

  // ---------- Voice: a recorded file in ./audio/<name>.mp3 when there is one, else the browser's speech ----------
  const missing = new Set();
  let voiceToken = 0;
  let currentAudio = null;

  function stopVoice() {
    voiceToken += 1;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function tts(text, done, token) {
    if (!("speechSynthesis" in window)) return done();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.onend = done;
    utterance.onerror = done;
    if (token === voiceToken) window.speechSynthesis.speak(utterance);
  }

  // Plays one line; onEnd runs once when it finishes (not when it is interrupted).
  function say(name, text, onEnd = () => {}) {
    stopVoice();
    const token = voiceToken;
    const done = () => { if (token === voiceToken) onEnd(); };
    if (missing.has(name)) return tts(text, done, token);
    const audio = new Audio(`./audio/${name}.mp3`);
    currentAudio = audio;
    let fell = false;
    const fallback = () => {
      if (fell || token !== voiceToken) return;
      fell = true;
      missing.add(name);
      currentAudio = null;
      tts(text, done, token);
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("error", fallback, { once: true });
    audio.play().catch(fallback);
  }

  const LINES = {
    intro: "Welcome to Hear the storm. Press the question mark key to play the tutorial, or Space to skip it.",
    details:
      "Here is how the sound is made. Moving from west to east moves the sound from your left ear to your right. " +
      "Further north, the pitch gets higher, and heavier rain or snow plays louder. Rain plays an organ and snow a glockenspiel. " +
      "While you are picking, you also hear the rain or the snowstorm itself; that stops when the week plays. " +
      "A spinning storm adds vibrato. A spreading storm adds overtones, and a gathering one adds undertones.",
  };

  // ---------- Intro ----------
  const introAudio = $("hts-intro-audio");

  function setIntroVoice(on) {
    introAudio.setAttribute("aria-pressed", on ? "true" : "false");
  }

  introAudio.addEventListener("click", () => {
    if (introAudio.getAttribute("aria-pressed") === "true") {
      stopVoice();
      setIntroVoice(false);
      return;
    }
    setIntroVoice(true);
    say("intro", LINES.intro, () => setIntroVoice(false));
  });

  function leaveIntro() {
    stopVoice();
    setIntroVoice(false);
    body.classList.remove("is-intro");
  }

  function skipIntro() {
    leaveIntro();
    canvas.focus({ preventScroll: true });
  }

  $("hts-skip").addEventListener("click", skipIntro);

  if (new URLSearchParams(window.location.search).get("intro") === "0") body.classList.remove("is-intro");

  // ---------- Tutorial: auto-advancing slides with a countdown on the current bar ----------
  const SLIDES = [
    {
      title: "Move to listen",
      hint: "TRY TO FIND A STORM",
      ms: 7000,
      say: "Move the mouse to listen, and try to find a storm. On the keyboard, the arrow keys move around the map.",
    },
    {
      title: "Click a storm",
      hint: "SPACE FOLLOWS ITS SOUND OVER TIME",
      ms: 9000,
      say: "Click on a storm to pick it, or press Enter on the map. Click it again to drop it. Then press Space to follow its sound over time, and Space again to stop.",
    },
    {
      title: "Press I",
      html: 'Press <span class="hts-i">I</span>',
      hint: "FOR MORE DETAILS ABOUT HOW THE SOUND IS MADE",
      ms: 6000,
      say: "Press I to hear more details about how the sounds are generated.",
    },
    { title: "Enjoy!", hint: "THE STORMS ARE ALL YOURS", ms: 0, say: "Enjoy!" },
  ];
  const LAST = SLIDES.length - 1;

  const card = $("hts-tutorial");
  const illus = $("hts-illus");
  const titleEl = $("hts-tut-title");
  const hintEl = $("hts-tut-hint");
  const segsEl = $("hts-segs");
  const leftEl = $("hts-left");
  const nextBtn = $("hts-next");

  const segs = SLIDES.map((slide, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hts-seg";
    button.setAttribute("aria-label", `Slide ${i + 1}: ${slide.title}`);
    button.innerHTML = "<i><b></b></i>";
    button.addEventListener("click", () => go(i));
    segsEl.append(button);
    return button.querySelector("b");
  });

  let step = 0;
  let elapsed = 0;
  let last = 0;
  let speaking = false;
  let tutorialOpen = false;
  let raf = 0;

  function render() {
    const slide = SLIDES[step];
    segs.forEach((fill, i) => {
      const done = i < step || (i === step && step === LAST);
      const pct = done ? 100 : i === step ? Math.min(100, (elapsed / slide.ms) * 100) : 0;
      fill.style.width = `${pct}%`;
      fill.parentElement.parentElement.toggleAttribute("aria-current", i === step);
    });
    leftEl.textContent = step === LAST ? "" : `${Math.max(0, Math.ceil((slide.ms - elapsed) / 1000))}s`;
  }

  function go(index) {
    step = Math.max(0, Math.min(LAST, index));
    elapsed = 0;
    const slide = SLIDES[step];
    illus.dataset.step = String(step);
    if (slide.html) titleEl.innerHTML = slide.html;
    else titleEl.textContent = slide.title;
    hintEl.textContent = slide.hint;
    nextBtn.textContent = step === LAST ? "Begin" : "Next";
    speaking = true;
    say(`tutorial-${step + 1}`, slide.say, () => { speaking = false; });
    render();
  }

  function tick(now) {
    if (!tutorialOpen) return;
    const dt = Math.min(100, now - last);
    last = now;
    if (step < LAST) {
      elapsed = Math.min(SLIDES[step].ms, elapsed + dt);
      // The bar fills on time; if the voice is still talking, the slide waits for it to finish.
      if (elapsed >= SLIDES[step].ms && !speaking) go(step + 1);
      else render();
    }
    raf = requestAnimationFrame(tick);
  }

  function startTutorial() {
    closeDetails(false);
    leaveIntro();
    body.classList.add("is-tutorial");
    card.hidden = false;
    tutorialOpen = true;
    go(0);
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    nextBtn.focus({ preventScroll: true });
  }

  function closeTutorial() {
    if (!tutorialOpen) return;
    tutorialOpen = false;
    cancelAnimationFrame(raf);
    stopVoice();
    card.hidden = true;
    body.classList.remove("is-tutorial");
    canvas.focus({ preventScroll: true });
  }

  function nextSlide() {
    if (step === LAST) closeTutorial();
    else go(step + 1);
  }

  function prevSlide() {
    if (step > 0) go(step - 1);
  }

  $("hts-start-tutorial").addEventListener("click", startTutorial);
  $("hts-tutorial-btn").addEventListener("click", startTutorial);
  $("hts-tut-close").addEventListener("click", closeTutorial);
  nextBtn.addEventListener("click", nextSlide);

  // ---------- I: how the sound is made ----------
  const details = $("hts-details");
  const detailsBtn = $("hts-details-btn");

  function openDetails() {
    closeTutorial();
    leaveIntro();
    details.hidden = false;
    say("details", LINES.details);
    $("hts-details-close").focus({ preventScroll: true });
  }

  function closeDetails(refocus = true) {
    if (details.hidden) return;
    details.hidden = true;
    stopVoice();
    if (refocus) canvas.focus({ preventScroll: true });
  }

  detailsBtn.addEventListener("click", () => (details.hidden ? openDetails() : closeDetails()));
  $("hts-details-close").addEventListener("click", () => closeDetails());

  // ---------- Controls drawer (hidden by default) ----------
  const drawer = $("hts-drawer");
  const controlsBtn = $("hts-controls-btn");
  const advanced = $("hts-adv");

  function setDrawer(open) {
    drawer.hidden = !open;
    body.classList.toggle("is-drawer", open);
    controlsBtn.setAttribute("aria-expanded", open ? "true" : "false");
    controlsBtn.setAttribute("aria-label", open ? "Hide sound controls" : "Show sound controls");
    if (open) $("hts-drawer-close").focus({ preventScroll: true });
    else controlsBtn.focus({ preventScroll: true });
  }

  controlsBtn.addEventListener("click", () => setDrawer(drawer.hidden));
  $("hts-drawer-close").addEventListener("click", () => setDrawer(false));
  advanced.addEventListener("toggle", () => drawer.classList.toggle("is-wide", advanced.open));

  // ---------- Keys ----------
  // Capture phase, so Space reaches the intro and the tutorial before soundlab.js uses it to play the week.
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = event.target.tagName;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(tag) || event.target.isContentEditable;

    if (event.key === "?" && !typing) {
      event.preventDefault();
      startTutorial();
      return;
    }

    if (tutorialOpen && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "ArrowRight") nextSlide();
      else prevSlide();
      return;
    }

    if (event.code === "Space") {
      const inCard = tutorialOpen && card.contains(event.target);
      if (typing || ((tag === "BUTTON" || tag === "SUMMARY") && !inCard)) return; // let the focused control handle it
      if (body.classList.contains("is-intro") || tutorialOpen) {
        // On the intro Space skips in; in the tutorial it moves to the next slide.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (tutorialOpen) nextSlide();
        else skipIntro();
      }
      return;
    }

    if (event.key === "Escape") {
      if (!details.hidden) closeDetails();
      else if (tutorialOpen) closeTutorial();
      else if (!drawer.hidden) setDrawer(false);
      else if (body.classList.contains("is-intro")) skipIntro();
      return;
    }

    if ((event.key === "i" || event.key === "I") && !typing) {
      event.preventDefault();
      if (details.hidden) openDetails();
      else closeDetails();
    }
  }, { capture: true });

  // ---------- Week timeline ----------
  const fill = $("hts-fill");
  const head = $("hts-head");
  const ticks = document.querySelectorAll(".hts-ticks span");
  let lastDay = -1;

  function timeline() {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      const p = Math.min(1, video.currentTime / video.duration);
      fill.style.width = `${p * 100}%`;
      head.style.left = `${p * 100}%`;
      const day = Math.min(6, Math.floor(p * 7));
      if (day !== lastDay) {
        ticks.forEach((t, i) => t.classList.toggle("is-now", i === day));
        lastDay = day;
      }
    }
    requestAnimationFrame(timeline);
  }
  requestAnimationFrame(timeline);
})();
