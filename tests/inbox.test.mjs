import test from "node:test";
import assert from "node:assert/strict";
import {
  isActive, sourceKind, keep, drop,
  counts, overview, levelOf,
} from "../inbox.js";

const card = (o = {}) => ({ id: "x", type: "word", text: "t", box: 0, reviews: 0, due: 0, created: 0, tags: [], ...o });

test("isActive: legacy and weird status values count as active", () => {
  for (const s of [undefined, "", "foo", null, 5]) assert.equal(isActive(card({ status: s })), true);
  const legacy = card();
  delete legacy.status;
  assert.equal(isActive(legacy), true);
  assert.equal(isActive(card({ status: "inbox" })), false);
  assert.equal(isActive(card({ status: "archived" })), false);
});

test("sourceKind: one rule for manual / shared / agent", () => {
  assert.equal(sourceKind(card()), "manual");
  assert.equal(sourceKind(card({ source: "" })), "manual");
  assert.equal(sourceKind(card({ source: "manual" })), "manual");
  assert.equal(sourceKind(card({ source: "shared" })), "shared");
  assert.equal(sourceKind(card({ source: "claude" })), "agent");
  assert.equal(sourceKind(card({ source: "gemini" })), "agent");
  assert.equal(sourceKind(null), "manual");
});

test("overview counts any non-manual, non-shared source as agent (same as the library filter)", () => {
  const o = overview([card({ source: "gemini" }), card({ source: "claude" }), card({ source: "manual" })]);
  assert.deepEqual(o.bySource, { agent: 2, manual: 1, shared: 0 });
});

test("keep removes status without mutating", () => {
  const c = card({ status: "inbox", text: "hi" });
  const k = keep(c);
  assert.equal("status" in k, false);
  assert.equal(k.text, "hi");
  assert.equal(c.status, "inbox");
  assert.equal("status" in keep(card()), false);
});

test("drop sets status archived without mutating", () => {
  const c = card({ status: "inbox" });
  assert.equal(drop(c).status, "archived");
  assert.equal(c.status, "inbox");
  assert.notEqual(drop(c), c);
});

test("levelOf", () => {
  assert.equal(levelOf(card()), "new");
  assert.equal(levelOf(card({ reviews: 3, box: 0 })), "weak");
  assert.equal(levelOf(card({ reviews: 3, box: 1 })), "weak");
  assert.equal(levelOf(card({ reviews: 3, box: 3 })), "learning");
  assert.equal(levelOf(card({ reviews: 3, box: 5 })), "mastered");
});

test("counts", () => {
  const items = [
    card(), // never
    card({ reviews: 2, box: 1 }), // weak
    card({ reviews: 2, box: 5 }), // mastered
    card({ reviews: 2, box: 3, status: "foo" }), // learning, active
    card({ status: "inbox", reviews: 2, box: 5 }),
    card({ status: "archived", reviews: 2, box: 0 }),
  ];
  assert.deepEqual(counts(items), { active: 4, inbox: 1, archived: 1, mastered: 1, weak: 1, never: 1 });
  assert.deepEqual(counts([]), { active: 0, inbox: 0, archived: 0, mastered: 0, weak: 0, never: 0 });
  assert.deepEqual(counts(undefined), { active: 0, inbox: 0, archived: 0, mastered: 0, weak: 0, never: 0 });
});

test("overview over active cards", () => {
  const now = 1000;
  const items = [
    card({ type: "word", source: "claude", tags: ["a", "b"], due: 500 }),
    card({ type: "phrase", source: "manual", tags: ["a"], due: 1000, reviews: 1, box: 1 }),
    card({ type: "sentence", source: "shared", tags: ["c"], due: 2000, reviews: 1, box: 5 }),
    card({ type: "word", tags: ["a", "b", "z"], due: 1, reviews: 1, box: 2 }), // no source -> manual
    card({ type: "word", source: "claude", tags: ["a"], status: "inbox", due: 1 }), // ignored
    card({ type: "word", tags: ["a"], status: "archived", due: 1 }), // ignored
  ];
  const o = overview(items, 8, now);
  assert.equal(o.total, 4);
  assert.deepEqual(o.byType, { word: 2, phrase: 1, sentence: 1 });
  assert.deepEqual(o.byLevel, { new: 1, weak: 1, learning: 1, mastered: 1 });
  assert.deepEqual(o.bySource, { agent: 1, manual: 2, shared: 1 });
  assert.deepEqual(o.topTags, [{ tag: "a", count: 3 }, { tag: "b", count: 2 }, { tag: "c", count: 1 }, { tag: "z", count: 1 }]);
  assert.equal(o.dueNow, 3);
});

test("overview topN, empty input, missing tags and due", () => {
  const items = [card({ tags: ["a", "b", "c"] }), card({ tags: undefined, due: undefined })];
  assert.equal(overview(items, 2).topTags.length, 2);
  assert.equal(overview(items, 0).topTags.length, 0);
  const e = overview([]);
  assert.equal(e.total, 0);
  assert.deepEqual(e.topTags, []);
  assert.equal(e.dueNow, 0);
  assert.equal(overview(null).total, 0);
  assert.equal(typeof overview(items).dueNow, "number");
});

