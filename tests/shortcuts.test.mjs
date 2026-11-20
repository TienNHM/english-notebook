import assert from "node:assert/strict";
import { resolveKey, isTypingTarget, CHORD_MS, GO_TABS } from "../shortcuts.js";

let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };
const k = (key, extra = {}) => ({ key, ...extra });

ok("single keys map to actions", () => {
  assert.deepEqual(resolveKey(k("/")).action, { type: "search" });
  assert.deepEqual(resolveKey(k("n")).action, { type: "add" });
  assert.deepEqual(resolveKey(k("Escape")).action, { type: "escape" });
  assert.deepEqual(resolveKey(k("?", { shiftKey: true })).action, { type: "help" });
  assert.equal(resolveKey(k("x")).action, null);
});
ok("g then a letter switches tab", () => {
  for (const [letter, tab] of Object.entries(GO_TABS)) {
    const a = resolveKey(k("g"), { g: 0 }, 1000);
    assert.equal(a.action, null);
    assert.equal(a.state.g, 1000);
    assert.deepEqual(resolveKey(k(letter), a.state, 1500).action, { type: "tab", tab });
  }
});
ok("g chord expires and resets", () => {
  const a = resolveKey(k("g"), { g: 0 }, 1000);
  assert.equal(resolveKey(k("l"), a.state, 1000 + CHORD_MS + 1).action, null);
  const b = resolveKey(k("x"), a.state, 1100);
  assert.equal(b.state.g, 0);
});
ok("Shift alone keeps a pending g, so g then ? still works", () => {
  const a = resolveKey(k("g"), { g: 0 }, 1000);
  assert.equal(resolveKey(k("Shift"), a.state, 1100).state.g, 1000);
});
ok("modifier combos are ignored", () => {
  assert.equal(resolveKey(k("n", { ctrlKey: true })).action, null);
  assert.equal(resolveKey(k("/", { metaKey: true })).action, null);
  assert.equal(resolveKey(k("n", { altKey: true })).action, null);
});
ok("typing targets", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "search" }), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget(null), false);
});
console.log(`\n${t} tests passed`);
