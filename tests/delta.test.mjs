import test from "node:test";
import assert from "node:assert/strict";
import { SYNC_KEY, FULL_EVERY, MARGIN, readSync, writeSync, clearSync, planSync, nextMarker, mergeDelta } from "../delta.js";

const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };
const H = 3600_000;

test("marker round trip, and bad data gives null", () => {
  const s = store();
  assert.equal(readSync(s), null);
  writeSync(s, { uid: "u", cursor: 5, fullAt: 3 });
  assert.deepEqual(readSync(s), { uid: "u", cursor: 5, fullAt: 3 });
  s.setItem(SYNC_KEY, "{x"); assert.equal(readSync(s), null);
  s.setItem(SYNC_KEY, JSON.stringify({ uid: "u", cursor: "a", fullAt: 1 })); assert.equal(readSync(s), null);
  writeSync(s, { uid: "u", cursor: 1, fullAt: 1 }); clearSync(s); assert.equal(readSync(s), null);
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  assert.equal(readSync(bad), null); writeSync(bad, {}); clearSync(bad);
});

test("planSync: delta only with a fresh marker for the same user and local cards", () => {
  const now = 100 * H, m = { uid: "u", cursor: 99 * H, fullAt: 90 * H };
  assert.deepEqual(planSync(m, "u", now, true), { mode: "delta", since: 99 * H - MARGIN });
  assert.equal(planSync(null, "u", now, true).mode, "full");
  assert.equal(planSync(m, "other", now, true).mode, "full");
  assert.equal(planSync(m, "u", now, false).mode, "full");                                  // nothing local to apply it to
  assert.equal(planSync(m, "u", 90 * H + FULL_EVERY, true).mode, "full");                   // a day old
  assert.equal(planSync({ ...m, fullAt: 101 * H }, "u", now, true).mode, "full");           // marker from the future
  assert.equal(planSync({ ...m, cursor: 1 }, "u", now, true).since, 0);                     // never negative
});

test("nextMarker: full read resets, delta only moves the cursor forward", () => {
  const full = nextMarker(null, { uid: "u", mode: "full", startedAt: 50, maxUpdated: 40 });
  assert.deepEqual(full, { uid: "u", fullAt: 50, cursor: 50 });
  assert.equal(nextMarker(null, { uid: "u", mode: "full", startedAt: 50, maxUpdated: 70 }).cursor, 70);
  const d1 = nextMarker(full, { uid: "u", mode: "delta", startedAt: 60, maxUpdated: 80 });
  assert.deepEqual(d1, { uid: "u", fullAt: 50, cursor: 80 });
  assert.equal(nextMarker(d1, { uid: "u", mode: "delta", startedAt: 70, maxUpdated: 10 }).cursor, 80);   // never goes back
  assert.equal(nextMarker(d1, { uid: "u", mode: "delta", startedAt: 70, maxUpdated: 0 }).fullAt, 50);
  assert.equal(nextMarker({ uid: "x", fullAt: 1, cursor: 1 }, { uid: "u", mode: "delta", startedAt: 9, maxUpdated: 0 }).fullAt, 9); // other user's marker ignored
});

test("mergeDelta: upsert, remove, keep the rest", () => {
  const items = [{ id: "a", text: "1" }, { id: "b", text: "2" }, { id: "c", text: "3" }];
  const out = mergeDelta(items, [{ id: "b", text: "2x" }, { id: "d", text: "4" }], ["c"]);
  assert.deepEqual(out.map(i => i.id).sort(), ["a", "b", "d"]);
  assert.equal(out.find(i => i.id === "b").text, "2x");
  assert.deepEqual(items.map(i => i.id), ["a", "b", "c"]);   // input not changed
  assert.deepEqual(mergeDelta(items, [], []).length, 3);
});
