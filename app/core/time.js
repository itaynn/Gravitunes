// ctx.time: frame index t in [0, count-1]. play/pause/scrub; onFrame(fn) fires after a frame is loaded.

export function createTime(dataset, viewer) {
  const listeners = new Set(), stateListeners = new Set();
  const emitState = () => stateListeners.forEach((fn) => fn(!!timer));
  let t = 0, timer = null, fps = 2, busy = false;

  async function seek(n) {
    n = ((Math.round(n) % dataset.count) + dataset.count) % dataset.count;
    const f = await dataset.load(n);
    t = n;
    // Cross-fade between frames over most of one frame interval while playing (a short fade when scrubbing).
    viewer.setImage(f.im, { fade: timer ? Math.min(600, 0.8 * 1000 / fps) : 120 });
    listeners.forEach((fn) => fn(t));
    if (timer) for (let k = 1; k <= 3; k++) dataset.prefetch?.((t + k) % dataset.count);
  }
  function start() {
    timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try { await seek(t + 1); } finally { busy = false; }
    }, 1000 / fps);
  }
  const time = {
    now: () => t,
    count: dataset.count,
    date: (n = t) => dataset.timeOf(n),
    label(n = t) {
      return dataset.timeOf(n).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    },
    seek,
    step: (d = 1) => seek(t + d),
    get playing() { return !!timer; },
    play() {
      if (timer) return;
      start();
      emitState();
    },
    pause() { const was = !!timer; clearInterval(timer); timer = null; if (was) emitState(); },
    // Changing speed while playing restarts the interval only: no state event, so a play-state listener may call this.
    setSpeed(f) { if (f === fps) return; fps = f; if (timer) { clearInterval(timer); start(); } },
    get fps() { return fps; },
    // onPlayState(fn(playing)) fires when play/pause changes.
    onPlayState(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); },
    onFrame(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return time;
}
