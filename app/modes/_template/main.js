// Minimal mode: the value under the cursor becomes a note in the current scale.
// Copy this folder to start a new idea. See app/README.md for the ctx reference.
export default function start(ctx) {
  const off = ctx.input.onHover(({ lat, lon }) => {
    const v = ctx.dataset.valueAt(lat, lon, ctx.time.now());
    if (v == null || Number.isNaN(v)) return;
    ctx.sound.play({ value: v, range: ctx.dataset.range, duration: 0.3 });
    ctx.describe(`${v.toFixed(1)} ${ctx.dataset.units}`);
  });
  return () => off();
}
