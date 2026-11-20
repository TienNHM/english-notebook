import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDuplicateGroup, undoCards, restoreCards, reviveCards } from "../cleanup.js";
import { findDuplicates } from "../bulk.js";

const card = (id, o = {}) => ({ id, type: "word", text: "x", meaning: "m", tags: [], box: 0, reviews: 0, created: 1, ...o });

test("mergeDuplicateGroup keeps the best card, unions tags, re-points children", () => {
  const a = card("a", { text: "Find out", box: 3, tags: ["x"], created: 5 });
  const b = card("b", { text: "find out.", box: 1, tags: ["y"], note: "n", created: 6 });
  const kid = card("k", { text: "other", sourceId: "b", created: 7 });
  const items = [a, b, kid];
  const [g] = findDuplicates(items);
  const r = mergeDuplicateGroup(items, g);
  assert.deepEqual(r.removedIds, ["b"]);
  assert.deepEqual(r.items.map(c => c.id), ["a", "k"]);
  const keep = r.items.find(c => c.id === "a");
  assert.deepEqual(keep.tags, ["x", "y"]);
  assert.equal(keep.note, "n");
  assert.equal(r.items.find(c => c.id === "k").sourceId, "a");
  assert.deepEqual(r.changed.map(c => c.id).sort(), ["a", "k"]);
  assert.equal(items.length, 3);                 // input untouched
  assert.equal(kid.sourceId, "b");
});

test("mergeDuplicateGroup with nothing to merge is a no-op", () => {
  const items = [card("a")];
  const r = mergeDuplicateGroup(items, { cards: [items[0]], keeper: items[0] });
  assert.deepEqual(r, { items, changed: [], removedIds: [] });
});

test("undoCards returns the original versions of changed and removed cards", () => {
  const a = card("a"), b = card("b"), c = card("c");
  const res = { changed: [{ ...a, tags: ["t"] }], removedIds: ["b", "zzz"] };
  assert.deepEqual(undoCards([a, b, c], res), [a, b]);
  assert.deepEqual(undoCards([a], null), []);
});

test("restoreCards replaces by id, re-adds removed cards and sorts newest first", () => {
  const a = card("a", { created: 3 }), b = card("b", { created: 9 });
  const cur = [{ ...a, status: "archived" }];
  const r = restoreCards(cur, [a, b]);
  assert.deepEqual(r.map(c => c.id), ["b", "a"]);
  assert.equal(r[1].status, undefined);
  assert.deepEqual(restoreCards(cur, []).map(c => c.id), ["a"]);
});

test("reviveCards gives removed cards new ids and re-points their children", () => {
  const parent = card("p"), kid = card("k", { sourceId: "p" }), other = card("o");
  let n = 0;
  const r = reviveCards([parent, kid, other], ["p"], () => "new" + ++n);
  assert.deepEqual(r.map(c => c.id), ["new1", "k", "o"]);
  assert.equal(r[1].sourceId, "new1");
  assert.equal(r[2], other);                      // untouched cards keep identity
  assert.equal(kid.sourceId, "p");                // input untouched
  assert.deepEqual(reviveCards([parent], [], () => "x"), [parent]);
});

test("mergeDuplicateGroup clears the keeper's own sourceId when its parent is merged away", () => {
  const parent = card("p", { text: "Good morning", type: "sentence", box: 0, created: 1 });
  const child = card("c", { text: "good morning", sourceId: "p", box: 4, created: 2 });
  const items = [parent, child];
  const g = findDuplicates(items)[0];
  const res = mergeDuplicateGroup(items, g);
  assert.deepEqual(res.removedIds, ["p"]);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].id, "c");
  assert.equal(res.items[0].sourceId, "");
  assert.equal(res.changed[0].sourceId, "");
  assert.equal(child.sourceId, "p"); // input untouched
});
