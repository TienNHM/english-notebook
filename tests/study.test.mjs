import assert from "node:assert/strict";
import { practiceSet, levelSegments, badgeCounts, PRACTICE_CAP, LEECH_THRESHOLD } from "../study.js";

let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };
const card = (id, extra = {}) => ({ id, type: "word", text: id, meaning: id, tags: [], box: 0, reviews: 0, source: "manual", ...extra });

ok("constants", () => { assert.equal(PRACTICE_CAP, 100); assert.equal(LEECH_THRESHOLD, 4); });

ok("practiceSet keeps active cards only, in order", () => {
  const r = practiceSet([card("a"), card("b", { status: "inbox" }), card("c", { status: "archived" }), card("d")]);
  assert.deepEqual(r.cards.map(c => c.id), ["a", "d"]);
  assert.equal(r.total, 2); assert.equal(r.capped, false);
});
ok("practiceSet caps at 100 and says so", () => {
  const many = Array.from({ length: 250 }, (_, i) => card("x" + i));
  const r = practiceSet(many);
  assert.equal(r.cards.length, 100); assert.equal(r.total, 250); assert.equal(r.capped, true);
  assert.equal(r.cards[0].id, "x0");
});
ok("practiceSet custom cap, empty and bad input", () => {
  assert.equal(practiceSet([card("a"), card("b")], 1).cards.length, 1);
  assert.deepEqual(practiceSet([]), { cards: [], total: 0, capped: false });
  assert.deepEqual(practiceSet(null), { cards: [], total: 0, capped: false });
  assert.equal(practiceSet([card("a")], 0).capped, true);
});
ok("practiceSet does not mutate its input", () => {
  const src = [card("a"), card("b", { status: "inbox" })];
  practiceSet(src); assert.equal(src.length, 2);
});

ok("levelSegments gives shares and labels", () => {
  const s = levelSegments({ new: 1, weak: 1, learning: 2, mastered: 4 }, 8);
  assert.deepEqual(s.map(x => x.key), ["mastered", "learning", "weak", "new"]);
  assert.equal(s[0].pct, 50); assert.equal(s[0].label, "Đã thuộc"); assert.equal(s[1].pct, 25);
  assert.equal(s.reduce((a, x) => a + x.count, 0), 8);
});
ok("levelSegments with no cards has zero shares", () => {
  const s = levelSegments({}, 0);
  assert.ok(s.every(x => x.count === 0 && x.pct === 0));
});

ok("badgeCounts counts active cards only", () => {
  const items = [
    card("a", { type: "sentence", box: 5, source: "claude", tags: ["x", "y"] }),
    card("b", { box: 2, tags: ["y"] }),
    card("c", { type: "sentence", box: 5, source: "claude", tags: ["z"], status: "inbox" }),
    card("d", { box: 5, status: "archived" }),
  ];
  assert.deepEqual(badgeCounts(items), { items: 2, sentences: 1, maxBox: 5, tags: 2, agent: 1, box5: 1 });
});
ok("badgeCounts on empty input", () => {
  assert.deepEqual(badgeCounts([]), { items: 0, sentences: 0, maxBox: 0, tags: 0, agent: 0, box5: 0 });
  assert.deepEqual(badgeCounts(undefined), { items: 0, sentences: 0, maxBox: 0, tags: 0, agent: 0, box5: 0 });
});

console.log(`\n${t} tests passed`);

ok("badgeCounts counts every agent source (same rule as the library filter and the overview)", () => {
  const items = [{ id: "a", source: "claude" }, { id: "b", source: "gemini" }, { id: "c", source: "manual" }, { id: "d", source: "shared" }, { id: "e" }];
  assert.equal(badgeCounts(items).agent, 2);
});
