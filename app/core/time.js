// ctx.time: frame index t in [0, count-1]. play/pause/scrub; onFrame(fn) fires after a frame is loaded.

export function createTime(dataset, viewer) {
  const listeners = new Set();
  let t = 0, timer = null, fps = 2, busy = false;

  async function seek(n) {
    n = ((Math.round(n) % dataset.count) + dataset.count) % dataset.count;
    const f = await dataset.load(n);
    t = n;
    viewer.setImage(f.im);
    listeners.forEach((fn) => fn(t));
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
      timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try { await seek(t + 1); } finally { busy = false; }
      }, 1000 / fps);
    },
    pause() { clearInterval(timer); timer = null; },
    setSpeed(f) { fps = f; if (timer) { time.pause(); time.play(); } },
    onFrame(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return time;
}
