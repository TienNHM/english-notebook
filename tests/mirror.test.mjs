import test from "node:test";
import assert from "node:assert/strict";
import { MIRROR_KEY, readMirror, writeMirror, clearMirror, newPending, addPending, takePending } from "../mirror.js";

const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };

test("write then read returns the same uid and items", () => {
  const s = store();
  assert.equal(writeMirror(s, "u1", [{ id: "a" }]), true);
  assert.deepEqual(readMirror(s), { uid: "u1", items: [{ id: "a" }] });
});
test("missing, corrupt or wrong-shaped data gives null", () => {
  const s = store();
  assert.equal(readMirror(s), null);
  s.setItem(MIRROR_KEY, "{oops"); assert.equal(readMirror(s), null);
  s.setItem(MIRROR_KEY, JSON.stringify({ uid: "", items: [] })); assert.equal(readMirror(s), null);
  s.setItem(MIRROR_KEY, JSON.stringify({ uid: "u", items: "x" })); assert.equal(readMirror(s), null);
});
test("a full or blocked storage does not throw", () => {
  const bad = { setItem() { throw new Error("quota"); }, getItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  assert.equal(writeMirror(bad, "u", []), false);
  assert.equal(readMirror(bad), null);
  clearMirror(bad);
});
test("clearMirror removes it", () => {
  const s = store(); writeMirror(s, "u", []); clearMirror(s);
  assert.equal(readMirror(s), null);
});
test("pending edits: last write wins, delete cancels put, take empties", () => {
  const p = newPending();
  addPending(p, [{ id: "a", v: 1 }, { id: "b" }]);
  addPending(p, [{ id: "a", v: 2 }], ["b", "c"]);
  const out = takePending(p);
  assert.deepEqual(out.put, [{ id: "a", v: 2 }]);
  assert.deepEqual(out.del.sort(), ["b", "c"]);
  assert.deepEqual(takePending(p), { put: [], del: [] });
});
test("put after delete brings the card back", () => {
  const p = newPending();
  addPending(p, [], ["a"]); addPending(p, [{ id: "a" }]);
  assert.deepEqual(takePending(p), { put: [{ id: "a" }], del: [] });
});
