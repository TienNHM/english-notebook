import assert from "node:assert/strict";
import { PAGE_SIZE, buildIndex, filterItems, nextShown, pageInfo } from "../paging.js";
let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };
const mk = (id, o = {}) => ({ id, type: "phrase", text: "t" + id, meaning: "m" + id, example: "", note: "", original: "", sourceId: "", tags: [], ...o });
const items = [mk("a", { type: "sentence", text: "Check the logs", tags: ["work"] }), mk("b", { sourceId: "a", text: "check", tags: ["work", "git"] }),
  mk("c", { sourceId: "a", text: "logs", meaning: "nhật ký" }), mk("d", { type: "word", example: "A Rollback happened", note: "undo" })];

ok("buildIndex: byId and the number of kids per sentence", () => {
  const { byId, kids } = buildIndex(items);
  assert.equal(byId.get("c").text, "logs"); assert.equal(byId.size, 4);
  assert.equal(kids.get("a"), 2); assert.equal(kids.get("b"), undefined);
});
ok("buildIndex on a large list is a single pass (fast)", () => {
  const big = Array.from({ length: 20000 }, (_, i) => mk("x" + i, { sourceId: i ? "x0" : "" }));
  const t0 = Date.now(); const { kids } = buildIndex(big);
  assert.equal(kids.get("x0"), 19999); assert.ok(Date.now() - t0 < 200);
});
ok("filterItems: type, tag and query (query matches text, meaning, example, note, original)", () => {
  assert.equal(filterItems(items, {}).length, 4);
  assert.deepEqual(filterItems(items, { type: "sentence" }).map(i => i.id), ["a"]);
  assert.deepEqual(filterItems(items, { tag: "git" }).map(i => i.id), ["b"]);
  assert.deepEqual(filterItems(items, { query: "nhật" }).map(i => i.id), ["c"]);
  assert.deepEqual(filterItems(items, { query: "rollback" }).map(i => i.id), ["d"]);
  assert.deepEqual(filterItems(items, { query: "undo" }).map(i => i.id), ["d"]);
  assert.deepEqual(filterItems(items, { tag: "work", query: "check" }).map(i => i.id), ["a", "b"]);
  assert.deepEqual(filterItems(items, { type: "word", tag: "work" }), []);
});
ok("nextShown grows by one page and stops at the total", () => {
  assert.equal(PAGE_SIZE, 40);
  assert.equal(nextShown(40, 1000), 80); assert.equal(nextShown(980, 1000), 1000); assert.equal(nextShown(1000, 1000), 1000);
  assert.equal(nextShown(0, 10), 10); assert.equal(nextShown(-5, 100), 40); assert.equal(nextShown(40, 1000, 25), 65);
});
ok("pageInfo for the footer", () => {
  assert.deepEqual(pageInfo(40, 1000), { shown: 40, total: 1000, more: true, next: 40 });
  assert.deepEqual(pageInfo(990, 1000), { shown: 990, total: 1000, more: true, next: 10 });
  assert.deepEqual(pageInfo(1000, 1000), { shown: 1000, total: 1000, more: false, next: 0 });
  assert.deepEqual(pageInfo(40, 12), { shown: 12, total: 12, more: false, next: 0 });
  assert.deepEqual(pageInfo(40, 0), { shown: 0, total: 0, more: false, next: 0 });
});
console.log(`\n${t} tests passed`);
