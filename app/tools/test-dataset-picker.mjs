// Browser check of the Dataset picker: for every mode (or dist file) with a picker, choosing each offered
// dataset (a mouse-style change) must reload with it and change the title, colour bar and map pixels.
// Needs a Chrome with --remote-debugging-port and, for served pages, a static server at the repo root:
//   python3 -m http.server 8731 &   chrome --headless=new --remote-debugging-port=9477 &
//   node app/tools/test-dataset-picker.mjs 9477 http://127.0.0.1:8731/app/mode.html?mode=ozone-probe ...
//   node app/tools/test-dataset-picker.mjs 9477 file:///.../dist/layered-maps.html ...
const [port, ...urls] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tab() {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let n = 0; const pend = {};
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params = {}) => new Promise((r) => { const id = ++n; pend[id] = r; ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const close = () => fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
  return { send, evalJs, close };
}

// Waits for the mode to load, then reports what is shown.
const SNAPSHOT = `
  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && !document.querySelector('#dataset-title')?.textContent && !document.querySelector('#status')?.textContent) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1500));
  const sel = document.querySelector('#dataset-picker select');
  const c = document.querySelector('#map canvas') || document.querySelector('canvas');
  let px = null;
  try { px = c.toDataURL().length + ':' + c.toDataURL().slice(-200); } catch {}
  return { title: document.querySelector('#dataset-title')?.textContent, status: document.querySelector('#status')?.textContent,
    bar: document.querySelector('#colorbar')?.src?.slice(-120), options: sel ? [...sel.options].map((o) => o.value) : [], value: sel?.value, px };`;

let fail = 0;
for (const url of urls) {
  const { send, evalJs, close } = await tab();
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url }); await sleep(1000);
  const first = await evalJs(SNAPSHOT);
  const seen = [first];
  console.log(`${url}\n  offers [${first.options.join(', ')}], showing ${first.value}: ${first.title}${first.status ? ` (${first.status})` : ''}`);
  for (const id of first.options.filter((v) => v !== first.value)) {
    await evalJs(`const s = document.querySelector('#dataset-picker select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change'));`);
    await sleep(1500);
    const now = await evalJs(SNAPSHOT);
    const ok = now.value === id && now.title && !now.status && seen.every((s) => s.title !== now.title && s.bar !== now.bar && s.px !== now.px);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} -> ${id}: ${now.title || now.status}`);
    if (!ok) fail++;
    seen.push(now);
  }
  await close();
}
if (fail) { console.error(`${fail} dataset switch(es) failed`); process.exit(1); }
console.log('dataset picker ok');
process.exit(0);
