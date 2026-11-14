// bridge.js — browser client for the live bridge (python -m gravitunes_sound serve).
// Messages are JSON: an event, an array of events, { score }, or { cmd: "stopAll"|"setTuning"|"setScale"|"voice", ... }.
export const DEFAULT_BRIDGE_URL = "ws://localhost:8765";

/**
 * Connect an engine to the live bridge. Reconnects automatically.
 * @param {ReturnType<import("./engine.js").createEngine>} engine
 * @param {string} [url]
 * @param {{reconnect?:boolean, onstatus?:(status:"connecting"|"open"|"closed"|"error", detail?:string)=>void,
 *   onmessage?:(msg:any)=>void, onerror?:(message:string, msg:any)=>void}} [opts]
 *   onerror: called (and console.error logged) for every message the engine could not play, including
 *   errors that happen later (a score whose tuning fails to load). One bad item in an array doesn't stop the rest.
 * @returns {{readonly status:string, send(msg:any):void, close():void}}
 */
export function connectBridge(engine, url = DEFAULT_BRIDGE_URL, opts = {}) {
  const { reconnect = true, onstatus, onmessage, onerror } = opts;
  if (typeof WebSocket === "undefined") throw new Error("connectBridge needs a browser (WebSocket is not available).");
  let ws = null, status = "connecting", closed = false, delay = 1000, timer = null;
  const setStatus = (s, d) => { status = s; try { onstatus?.(s, d); } catch (e) { console.error(e); } };

  const report = (err, msg) => {
    const text = `bridge: could not play message: ${err?.message ?? String(err)}`;
    console.error(text, msg);
    try { onerror?.(text, msg); } catch (e) { console.error(e); }
  };

  // Play one message; errors (sync or async) are reported, never thrown.
  function handle(msg) {
    if (Array.isArray(msg)) { msg.forEach(handle); return; }
    try {
      const r = dispatch(msg);
      const later = r && typeof r.then === "function" ? r : r?.ready; // setTuning → Promise; playScore → { ready }
      later?.catch?.((err) => report(err, msg));
    } catch (err) { report(err, msg); }
  }

  function dispatch(msg) {
    if (!msg || typeof msg !== "object") throw new Error("expected a JSON object or array");
    if (msg.score) return engine.playScore(msg.score);
    switch (msg.cmd) {
      case undefined: return engine.send(msg);
      case "stopAll": return engine.stopAll(msg.fade);
      case "setTuning": return engine.setTuning(msg.spec);
      case "setScale": return engine.setScale(msg.spec ?? null);
      case "voice": return engine.voice(msg.name, msg.def);
      case "hello": return; // relay greeting
      default: throw new Error(`unknown cmd "${msg.cmd}" (expected stopAll, setTuning, setScale, voice)`);
    }
  }

  function open() {
    setStatus("connecting", url);
    ws = new WebSocket(url);
    ws.onopen = () => { delay = 1000; setStatus("open", url); };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { report(new Error("not JSON"), e.data); return; }
      try { onmessage?.(msg); } catch (err) { console.error(err); }
      handle(msg);
    };
    ws.onerror = () => setStatus("error", `cannot reach ${url} — is "python -m gravitunes_sound serve" running?`);
    ws.onclose = () => {
      if (closed) return setStatus("closed");
      setStatus("closed", `retrying in ${delay / 1000}s`);
      if (reconnect) { timer = setTimeout(open, delay); delay = Math.min(delay * 2, 8000); }
    };
  }
  open();

  return {
    get status() { return status; },
    send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); },
    close() { closed = true; clearTimeout(timer); ws?.close(); },
  };
}
