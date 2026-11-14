import test from "node:test";
import assert from "node:assert/strict";
import { connectBridge } from "../../js/bridge.js";

// Minimal fake WebSocket: the test pushes messages with fake.receive(obj).
class FakeWS {
  constructor() { FakeWS.last = this; queueMicrotask(() => this.onopen?.()); }
  receive(obj) { this.onmessage({ data: typeof obj === "string" ? obj : JSON.stringify(obj) }); }
  close() {}
}

test("bridge reports errors (sync, async, non-JSON) and keeps going through arrays", async () => {
  globalThis.WebSocket = FakeWS;
  const played = [], errors = [];
  const engine = {
    send(ev) { if (ev.bad) throw new Error("bad event"); played.push(ev.step); },
    playScore() { return { ready: Promise.reject(new Error("tuning failed")), ended: Promise.resolve() }; },
    setTuning() { return Promise.reject(new Error("no such tuning")); },
  };
  const origError = console.error; console.error = () => {};
  try {
    const b = connectBridge(engine, "ws://x", { reconnect: false, onerror: (m) => errors.push(m) });
    const ws = FakeWS.last;
    ws.receive([{ step: 1 }, { bad: true }, { step: 2 }]);
    ws.receive({ score: { version: 1, events: [] } });
    ws.receive({ cmd: "setTuning", spec: "nope" });
    ws.receive({ cmd: "frobnicate" });
    ws.receive("{not json");
    await new Promise((r) => setTimeout(r, 10));
    b.close();
  } finally { console.error = origError; delete globalThis.WebSocket; }
  assert.deepEqual(played, [1, 2]);
  const all = errors.join("\n");
  for (const re of [/bad event/, /tuning failed/, /no such tuning/, /unknown cmd/, /not JSON/]) assert.match(all, re);
  assert.equal(errors.length, 5);
});
