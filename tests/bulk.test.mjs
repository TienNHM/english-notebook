import test from "node:test";
import assert from "node:assert/strict";
import {
  normTag, addTag, removeTag, setStatus, removeIds, renameTag,
  findDuplicates, mergeGroup, leeches, tagStats, dupKey,
} from "../bulk.js";

const card = (id, o = {}) => ({ id, type: "word", text: id, meaning: "m", tags: [], box: 0, reviews: 0, created: 1, ...o });
const frozen = list => { list.forEach(c => Object.freeze(c)); return Object.freeze(list); };

test("normTag lowercases, trims, strips # and limits length", () => {
  assert.equal(normTag("  #Work "), "work");
  assert.equal(normTag("##A"), "a");
  assert.equal(normTag("x".repeat(60)).length, 40);
  assert.equal(normTag(""), "");
  assert.equal(normTag(null), "");
  assert.equal(normTag("#"), "");
});

test("addTag adds once, keeps identity of untouched cards, is idempotent", () => {
  const items = frozen([card("a"), card("b", { tags: ["x"] }), card("c")]);
  const r = addTag(items, ["a", "b", "zzz"], "#X");
  assert.deepEqual(r.items.map(c => c.tags), [["x"], ["x"], []]);
  assert.equal(r.items[1], items[1]);
  assert.equal(r.items[2], items[2]);
  assert.deepEqual(r.changed.map(c => c.id), ["a"]);
  const again = addTag(r.items, ["a", "b"], "x");
  assert.equal(again.changed.length, 0);
  assert.equal(again.items[0], r.items[0]);
  assert.deepEqual(items[0].tags, []);
});

test("addTag with empty tag, empty input and unknown ids does nothing", () => {
  const items = [card("a")];
  assert.equal(addTag(items, ["a"], "  #").changed.length, 0);
  assert.deepEqual(addTag([], ["a"], "x"), { items: [], changed: [], removedIds: [] });
  assert.equal(addTag(items, ["nope"], "x").changed.length, 0);
  assert.equal(addTag(items, new Set(["a"]), "x").changed.length, 1);
  assert.equal(addTag(items, undefined, "x").changed.length, 0);
});

test("removeTag removes only where present and is idempotent", () => {
  const items = frozen([card("a", { tags: ["x", "y"] }), card("b")]);
  const r = removeTag(items, ["a", "b"], "X");
  assert.deepEqual(r.items[0].tags, ["y"]);
  assert.equal(r.items[1], items[1]);
  assert.equal(r.changed.length, 1);
  assert.equal(removeTag(r.items, ["a", "b"], "x").changed.length, 0);
});

test("setStatus archives, restores (field dropped) and validates", () => {
  const items = frozen([card("a"), card("b", { status: "inbox" }), card("c", { status: "archived" })]);
  const r = setStatus(items, ["a", "b", "c", "none"], "archived");
  assert.deepEqual(r.items.map(c => c.status), ["archived", "archived", "archived"]);
  assert.deepEqual(r.changed.map(c => c.id), ["a", "b"]);
  assert.equal(r.items[2], items[2]);
  const back = setStatus(r.items, ["a"], "");
  assert.equal("status" in back.items[0], false);
  assert.equal(setStatus(items, ["a"], "").changed.length, 0);
  assert.equal(setStatus(items, ["b"], "inbox").changed.length, 0);
  assert.throws(() => setStatus(items, ["a"], "weird"), RangeError);
  assert.deepEqual(setStatus([], ["a"], "inbox").items, []);
});

test("removeIds deletes, reports removed ids, unknown ids ignored", () => {
  const items = frozen([card("a"), card("b"), card("c")]);
  const r = removeIds(items, ["a", "ghost"]);
  assert.deepEqual(r.items.map(c => c.id), ["b", "c"]);
  assert.deepEqual(r.removedIds, ["a"]);
  assert.equal(r.items[0], items[1]);
  assert.equal(r.changed.length, 0);
  assert.equal(items.length, 3);
  assert.deepEqual(removeIds([], ["a"]), { items: [], changed: [], removedIds: [] });
  const again = removeIds(r.items, ["a"]);
  assert.deepEqual(again.removedIds, []);
});

test("deleting a sentence keeps its children but clears sourceId", () => {
  const items = frozen([
    card("s", { type: "sentence" }),
    card("w1", { sourceId: "s" }),
    card("w2", { sourceId: "s" }),
    card("w3", { sourceId: "other" }),
  ]);
  const r = removeIds(items, ["s"]);
  assert.deepEqual(r.items.map(c => c.id), ["w1", "w2", "w3"]);
  assert.ok(r.items.slice(0, 2).every(c => !c.sourceId));
  assert.deepEqual(r.changed.map(c => c.id), ["w1", "w2"]);
  assert.equal(r.items[2], items[3]);
  assert.equal(items[1].sourceId, "s");
});

test("deleting a sentence and its child together does not report the child as changed", () => {
  const items = [card("s", { type: "sentence" }), card("w", { sourceId: "s" })];
  const r = removeIds(items, ["s", "w"]);
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.removedIds.sort(), ["s", "w"]);
});

test("renameTag renames, merges into existing tag and dedupes", () => {
  const items = frozen([
    card("a", { tags: ["old", "keep"] }),
    card("b", { tags: ["old", "new"] }),
    card("c", { tags: ["keep"] }),
  ]);
  const r = renameTag(items, "#Old", "NEW");
  assert.deepEqual(r.items[0].tags, ["new", "keep"]);
  assert.deepEqual(r.items[1].tags, ["new"]);
  assert.equal(r.items[2], items[2]);
  assert.equal(r.changed.length, 2);
  assert.equal(renameTag(r.items, "old", "new").changed.length, 0);
  assert.equal(renameTag(items, "old", "old").changed.length, 0);
  assert.equal(renameTag(items, "old", "").changed.length, 0);
  assert.deepEqual(renameTag([], "a", "b").items, []);
});

test("findDuplicates is type-agnostic, diacritic-insensitive and ignores trailing punctuation", () => {
  const items = [
    card("1", { text: "Café", type: "word", box: 1 }),
    card("2", { text: "  cafe  ", type: "phrase", box: 3 }),
    card("3", { text: "How   are you?", type: "sentence" }),
    card("4", { text: "how are you", type: "phrase", reviews: 5 }),
    card("5", { text: "unique" }),
    card("6", { text: "" }),
    card("7", { text: "" }),
  ];
  const groups = findDuplicates(items);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].cards.map(c => c.id), ["1", "2"]);
  assert.equal(groups[0].keeper.id, "2");
  assert.equal(groups[1].keeper.id, "4");
  assert.ok(groups.every(g => g.cards.length >= 2));
  assert.deepEqual(findDuplicates([]), []);
});

test("keeper tie-breaks: box, then reviews, then oldest created", () => {
  const g = findDuplicates([
    card("a", { text: "x", box: 2, reviews: 1, created: 5 }),
    card("b", { text: "x", box: 2, reviews: 3, created: 9 }),
    card("c", { text: "x", box: 2, reviews: 3, created: 2 }),
  ])[0];
  assert.equal(g.keeper.id, "c");
});

test("findDuplicates handles Vietnamese diacritics", () => {
  const g = findDuplicates([card("a", { text: "Đường phố" }), card("b", { text: "duong pho" })]);
  assert.equal(g.length, 1);
});

test("mergeGroup unions tags, fills empty fields, lists removeIds, does not mutate", () => {
  const a = card("a", { text: "x", box: 3, tags: ["t1"], note: "" });
  const b = card("b", { text: "X.", tags: ["t1", "t2"], note: "nb", example: "eb", original: "ob" });
  const c = card("c", { text: "x", tags: ["t3"], note: "nc", example: "ec" });
  const [g] = findDuplicates(Object.freeze([a, b, c]));
  const m = mergeGroup(g);
  assert.equal(m.keep.id, "a");
  assert.deepEqual(m.keep.tags, ["t1", "t2", "t3"]);
  assert.equal(m.keep.note, "nb");
  assert.equal(m.keep.example, "eb");
  assert.equal(m.keep.original, "ob");
  assert.deepEqual(m.removeIds, ["b", "c"]);
  assert.deepEqual(a.tags, ["t1"]);
  const keeperWithNote = mergeGroup({ cards: [card("k", { note: "mine", box: 4 }), card("o", { note: "other" })] });
  assert.equal(keeperWithNote.keep.note, "mine");
  assert.deepEqual(mergeGroup({ cards: [] }), { keep: null, removeIds: [] });
});

test("leeches: active only, threshold, sorted by lapses desc", () => {
  const items = [
    card("a", { lapses: 4 }),
    card("b", { lapses: 9 }),
    card("c", { lapses: 3 }),
    card("d", { lapses: 7, status: "archived" }),
    card("e", { lapses: 5, status: "inbox" }),
    card("f"),
  ];
  assert.deepEqual(leeches(items).map(c => c.id), ["b", "a"]);
  assert.deepEqual(leeches(items, 3).map(c => c.id), ["b", "a", "c"]);
  assert.deepEqual(leeches([]), []);
});

test("tagStats counts active cards only, sorted by count desc", () => {
  const items = [
    card("a", { tags: ["work", "x"] }),
    card("b", { tags: ["work"] }),
    card("c", { tags: ["x", "x"] }),
    card("d", { tags: ["work"], status: "archived" }),
    card("e"),
  ];
  assert.deepEqual(tagStats(items), [{ tag: "work", count: 2 }, { tag: "x", count: 2 }]);
  assert.deepEqual(tagStats([]), []);
});

test("duplicate scan over 3,000 cards is fast (not O(n^2))", () => {
  const items = [];
  for (let i = 0; i < 3000; i++) items.push(card("id" + i, { text: "Word " + (i % 1500) + "." }));
  const t0 = performance.now();
  const groups = findDuplicates(items);
  const ms = performance.now() - t0;
  assert.equal(groups.length, 1500);
  assert.ok(groups.every(g => g.cards.length === 2));
  assert.ok(ms < 500, "took " + ms + "ms");
});

test("mergeGroup keeps a different meaning (homographs) and the highest lapses", () => {
  const a = card("a", { text: "light", meaning: "ánh sáng", box: 2, lapses: 1 });
  const b = card("b", { text: "Light", meaning: "nhẹ", box: 0, lapses: 3 });
  const c = card("c", { text: "light", meaning: "Anh sang." });
  const { keep, removeIds } = mergeGroup({ cards: [a, b, c], keeper: a });
  assert.equal(keep.meaning, "ánh sáng / nhẹ"); // "Anh sang." is the same meaning after normalization
  assert.equal(keep.lapses, 3);
  assert.deepEqual(removeIds.sort(), ["b", "c"]);
  assert.equal(a.meaning, "ánh sáng"); // input untouched
});

test("mergeGroup leaves identical meanings alone and adds no lapses field when nobody has any", () => {
  const { keep } = mergeGroup({ cards: [card("a", { box: 1 }), card("b")] });
  assert.equal(keep.meaning, "m");
  assert.equal("lapses" in keep, false);
});

test("dupKey ignores trailing quotes and brackets (same rule as the import)", () => {
  assert.equal(dupKey('hello"'), dupKey("hello"));
  assert.equal(dupKey("(hello)"), "(hello");
  assert.equal(dupKey("Hello!?"), "hello");
});
