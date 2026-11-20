import assert from "node:assert/strict";
import { level, LEVELS, SORTS, normView, applyView, highlightParts, countsByScope, normSavedViews, addSavedView, removeSavedView, SAVED_VIEWS_KEY } from "../library-view.js";
let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };
const mk = (id, o = {}) => ({ id, type: "phrase", text: "t" + id, meaning: "m" + id, example: "", note: "", original: "", sourceId: "", source: "manual", tags: [], box: 0, due: 1000, created: 1000, reviews: 0, ...o });
const ids = a => a.map(i => i.id);

ok("level derives from reviews and box", () => {
  assert.equal(level(mk("a")), "new");
  assert.equal(level(mk("a", { reviews: 3, box: 0 })), "weak");
  assert.equal(level(mk("a", { reviews: 3, box: 1 })), "weak");
  assert.equal(level(mk("a", { reviews: 3, box: 3 })), "learning");
  assert.equal(level(mk("a", { reviews: 3, box: 5 })), "mastered");
  assert.deepEqual(LEVELS, ["new", "weak", "learning", "mastered"]);
  assert.equal(SORTS.length, 5); assert.equal(SAVED_VIEWS_KEY, "english-notebook-saved-views");
});
ok("normView fills defaults and rejects unknown values", () => {
  assert.deepEqual(normView(), { scope: "library", type: "", tag: "", query: "", level: "", source: "", sort: "newest" });
  const v = normView({ scope: "x", type: "verb", level: "pro", source: "web", sort: "zzz", tag: " #Work ", query: "  hi " });
  assert.deepEqual(v, { scope: "library", type: "", tag: "work", query: "hi", level: "", source: "", sort: "newest" });
  assert.equal(normView({ tag: "a".repeat(50) }).tag.length, 40);
});
ok("scope: no status is active; inbox and archived are separate", () => {
  const l = [mk("a"), mk("b", { status: "inbox" }), mk("c", { status: "archived" }), mk("d", { status: "" })];
  assert.deepEqual(ids(applyView(l, {})).sort(), ["a", "d"]);
  assert.deepEqual(ids(applyView(l, { scope: "inbox" })), ["b"]);
  assert.deepEqual(ids(applyView(l, { scope: "archived" })), ["c"]);
  assert.deepEqual(countsByScope(l), { library: 2, inbox: 1, archived: 1 });
});
ok("filters: type, tag, level, source", () => {
  const l = [mk("a", { type: "word", tags: ["git"] }), mk("b", { source: "claude", reviews: 2, box: 0 }), mk("c", { source: "shared", reviews: 2, box: 5 }), mk("d", { source: "mcp" })];
  assert.deepEqual(ids(applyView(l, { type: "word" })), ["a"]);
  assert.deepEqual(ids(applyView(l, { tag: "git" })), ["a"]);
  assert.deepEqual(ids(applyView(l, { level: "weak" })), ["b"]);
  assert.deepEqual(ids(applyView(l, { level: "mastered" })), ["c"]);
  assert.deepEqual(ids(applyView(l, { level: "new" })).sort(), ["a", "d"]);
  assert.deepEqual(ids(applyView(l, { source: "agent" })).sort(), ["b", "d"]);
  assert.deepEqual(ids(applyView(l, { source: "shared" })), ["c"]);
  assert.deepEqual(ids(applyView(l, { source: "manual" })), ["a"]);
  assert.deepEqual(ids(applyView(l, { type: "word", level: "weak" })), []);
});
ok("search: all fields and tags, case and diacritic insensitive", () => {
  const l = [mk("a", { text: "Café" }), mk("b", { meaning: "nhật ký" }), mk("c", { example: "A Rollback" }), mk("d", { note: "undo" }),
    mk("e", { original: "gốc đây" }), mk("f", { tags: ["deploy"] }), mk("g", { text: "ăn ơ" })];
  assert.deepEqual(ids(applyView(l, { query: "cafe" })), ["a"]);
  assert.deepEqual(ids(applyView(l, { query: "CAFÉ" })), ["a"]);
  assert.deepEqual(ids(applyView(l, { query: "nhat ky" })), ["b"]);
  assert.deepEqual(ids(applyView(l, { query: "rollback" })), ["c"]);
  assert.deepEqual(ids(applyView(l, { query: "undo" })), ["d"]);
  assert.deepEqual(ids(applyView(l, { query: "goc day" })), ["e"]);
  assert.deepEqual(ids(applyView(l, { query: "đây" })), ["e"]);
  assert.deepEqual(ids(applyView(l, { query: "deploy" })), ["f"]);
  assert.deepEqual(ids(applyView(l, { query: "an o" })), ["g"]);
  assert.deepEqual(ids(applyView(l, { query: "zzz" })), []);
});
ok("search cache follows in-place edits", () => {
  const c = mk("a", { text: "one" });
  assert.equal(applyView([c], { query: "two" }).length, 0);
  c.text = "two";
  assert.equal(applyView([c], { query: "two" }).length, 1);
});
ok("sorts and stable ties", () => {
  const l = [mk("a", { created: 1, due: 30, text: "banana" }), mk("b", { created: 3, due: 10, text: "Apple", reviews: 1, box: 0 }),
    mk("c", { created: 2, due: 10, text: "Élan", reviews: 1, box: 3 }), mk("d", { created: 4, due: 20, text: "cherry", reviews: 1, box: 5 })];
  assert.deepEqual(ids(applyView(l, { sort: "newest" })), ["d", "b", "c", "a"]);
  assert.deepEqual(ids(applyView(l, { sort: "oldest" })), ["a", "c", "b", "d"]);
  assert.deepEqual(ids(applyView(l, { sort: "due" })), ["b", "c", "d", "a"]);   // b/c tie -> newer first
  assert.deepEqual(ids(applyView(l, { sort: "level" })), ["b", "a", "c", "d"]);  // weak, new, learning, mastered
  assert.deepEqual(ids(applyView(l, { sort: "az" })), ["b", "a", "d", "c"]);     // Apple banana cherry Elan
  const before = ids(l); applyView(l, { sort: "az" }); assert.deepEqual(ids(l), before);
  assert.notEqual(applyView(l, {}), l);
});
ok("highlightParts basics", () => {
  assert.deepEqual(highlightParts("hello", ""), [{ t: "hello", hit: false }]);
  assert.deepEqual(highlightParts("Hello World", "world"), [{ t: "Hello ", hit: false }, { t: "World", hit: true }]);
  assert.deepEqual(highlightParts("abc", "zzz"), [{ t: "abc", hit: false }]);
  assert.deepEqual(highlightParts("", "a"), [{ t: "", hit: false }]);
});
ok("highlightParts: diacritics keep the original string", () => {
  const p = highlightParts("Một quả đào ngọt", "dao");
  assert.equal(p.map(x => x.t).join(""), "Một quả đào ngọt");
  assert.deepEqual(p.filter(x => x.hit).map(x => x.t), ["đào"]);
  assert.deepEqual(highlightParts("café", "CAFE"), [{ t: "café", hit: true }]);
  const dec = "café ok";   // decomposed e + acute
  const d = highlightParts(dec, "cafe");
  assert.equal(d.map(x => x.t).join(""), dec);
  assert.equal(d[0].hit, true);
});
ok("highlightParts: regex characters and overlaps", () => {
  assert.deepEqual(highlightParts("a.b (c) [d]*", "(c)"), [{ t: "a.b ", hit: false }, { t: "(c)", hit: true }, { t: " [d]*", hit: false }]);
  assert.deepEqual(highlightParts("a.b axb", "a.b"), [{ t: "a.b", hit: true }, { t: " axb", hit: false }]);
  const o = highlightParts("aaaa", "aaa");
  assert.equal(o.map(x => x.t).join(""), "aaaa"); assert.ok(o.every(x => x.hit));
  const m = highlightParts("ab ab", "ab");
  assert.deepEqual(m.map(x => x.hit), [true, false, true]);
  assert.equal(highlightParts("<b>x</b>", "x").map(x => x.t).join(""), "<b>x</b>");
});
ok("saved views: limits, unique names, add/remove", () => {
  const v = { type: "word" };
  let l = addSavedView([], " Từ yếu ", v);
  assert.deepEqual(l.map(x => x.name), ["Từ yếu"]); assert.equal(l[0].view.type, "word"); assert.equal(l[0].view.sort, "newest");
  l = addSavedView(l, "Từ yếu", { type: "phrase" });
  assert.equal(l.length, 1); assert.equal(l[0].view.type, "phrase");
  assert.equal(addSavedView(l, "   ", v).length, 1);
  assert.equal(addSavedView([], "x".repeat(40), v)[0].name.length, 24);
  let big = []; for (let i = 0; i < 20; i++) big = addSavedView(big, "v" + i, v);
  assert.equal(big.length, 12);
  assert.equal(normSavedViews(Array.from({ length: 30 }, (_, i) => ({ name: "n" + i, view: {} }))).length, 12);
  assert.deepEqual(normSavedViews([{ name: "a" }, { name: "a" }, null, { name: "" }, "x"]).map(x => x.name), ["a"]);
  assert.deepEqual(normSavedViews("bad"), []);
  assert.deepEqual(removeSavedView(l, "Từ yếu"), []);
  assert.equal(removeSavedView(l, "nope").length, 1);
});
ok("3,000 cards: applyView is fast", () => {
  const big = Array.from({ length: 3000 }, (_, i) => mk("x" + i, { text: "Thử nghiệm " + i, meaning: "ý nghĩa " + i, created: i, reviews: i % 3, box: i % 6, tags: ["t" + (i % 7)] }));
  applyView(big, { query: "nghiem" });   // warm the cache
  const t0 = performance.now();
  const r = applyView(big, { query: "NGHIEM 29", sort: "level" });
  const ms = performance.now() - t0;
  assert.ok(r.length > 0); assert.ok(ms < 100, "took " + ms);
  console.log("  3000 cards:", ms.toFixed(2), "ms");
});
console.log(t + " tests passed");
