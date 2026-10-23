import assert from "node:assert/strict";
import * as V from "../vault.js";

let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };
const item = (o) => ({ id: "x" + Math.random().toString(36).slice(2, 7), type: "word", text: "t", meaning: "m", example: "", note: "", original: "", sourceId: "", source: "claude", tags: [], box: 3, due: 1, created: 1, reviews: 9, ...o });

ok("share ids are 22 URL-safe characters and do not repeat", () => {
  const ids = new Set(Array.from({ length: 2000 }, () => V.newShareId()));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{22}$/);
});
ok("a fixed random source gives a known id (so the encoding is stable)", () => {
  assert.equal(V.newShareId(() => new Uint8Array(16)), "AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(V.newShareId(() => new Uint8Array(16).fill(255)), "_____________________w".slice(0, 22));
});
ok("parseShareInput reads a link, a code, and ignores junk", () => {
  const id = "AbCdEfGhIjKlMnOpQrStUv";
  assert.equal(V.parseShareInput(id), id);
  assert.equal(V.parseShareInput(`  ${id}  `), id);
  assert.equal(V.parseShareInput(`https://english-notebook.tiennhm.io.vn/?import=${id}`), id);
  assert.equal(V.parseShareInput(`https://x.y/?source=pwa&import=${id}&tab=add`), id);
  assert.equal(V.parseShareInput(`https://x.y/?import=${id}EXTRA`), null, "a longer token is not a valid id");
  for (const bad of ["", null, undefined, "short", "https://x.y/", `${id.slice(0, 21)}!`]) assert.equal(V.parseShareInput(bad), null, String(bad));
});
ok("shareLink adds the import parameter", () => {
  assert.equal(V.shareLink("https://a.b/", "ID"), "https://a.b/?import=ID");
  assert.equal(V.shareLink("https://a.b/?x=1", "ID"), "https://a.b/?x=1&import=ID");
});
ok("pickItems filters by type and tag, and empty filters mean all", () => {
  const a = item({ type: "word", tags: ["work"] }), b = item({ type: "phrase", tags: ["api"] }), c = item({ type: "sentence", tags: ["work", "api"] });
  const all = [a, b, c];
  assert.equal(V.pickItems(all).length, 3);
  assert.deepEqual(V.pickItems(all, { types: ["word", "sentence"] }), [a, c]);
  assert.deepEqual(V.pickItems(all, { tags: ["api"] }), [b, c]);
  assert.deepEqual(V.pickItems(all, { types: ["sentence"], tags: ["api"] }), [c]);
  assert.deepEqual(V.pickItems(all, { tags: ["nope"] }), []);
});
ok("toShared never leaks progress or other fields", () => {
  const out = V.toShared([item({ text: "deploy", meaning: "triển khai", box: 5, reviews: 40, due: 123, source: "claude", secret: "x" })]);
  assert.deepEqual(Object.keys(out[0]).sort(), ["example", "id", "meaning", "note", "original", "sourceId", "tags", "text", "type"]);
  for (const k of ["box", "due", "reviews", "created", "source", "secret"]) assert.ok(!(k in out[0]), k);
});
ok("original sentences and notes are left out unless asked for", () => {
  const src = [item({ text: "a", meaning: "b", original: "câu gốc riêng tư", note: "ghi chú riêng tư" })];
  assert.equal(V.toShared(src)[0].original, ""); assert.equal(V.toShared(src)[0].note, "");
  assert.equal(V.toShared(src, { original: true })[0].original, "câu gốc riêng tư");
  assert.equal(V.toShared(src, { note: true })[0].note, "ghi chú riêng tư");
});
ok("a link to a sentence is kept only when the sentence is shared too", () => {
  const s = item({ id: "S", type: "sentence", text: "sent", meaning: "câu" }), p = item({ id: "P", type: "phrase", text: "ph", meaning: "cụm", sourceId: "S" });
  assert.equal(V.toShared([s, p]).find(x => x.id === "P").sourceId, "S");
  assert.equal(V.toShared([p]).find(x => x.id === "P").sourceId, "");
});
ok("toShared drops broken cards and clips long text and too many tags", () => {
  const out = V.toShared([item({ text: "", meaning: "x" }), item({ text: "x", meaning: "" }), item({ type: "weird", text: "x", meaning: "y" }),
    item({ text: "a".repeat(900), meaning: "m", tags: Array.from({ length: 30 }, (_, i) => "tag" + i + "x".repeat(60)) })]);
  assert.equal(out.length, 1); assert.equal(out[0].text.length, 500); assert.equal(out[0].tags.length, 10); assert.ok(out[0].tags.every(g => g.length <= 40));
});
ok("tagCounts sorts by use", () => {
  assert.deepEqual(V.tagCounts([item({ tags: ["b", "a"] }), item({ tags: ["a"] }), item({ tags: [] })]), [["a", 2], ["b", 1]]);
});
ok("planImport makes fresh cards that start learning from scratch", () => {
  const shared = V.toShared([item({ id: "S", type: "sentence", text: "Sent", meaning: "câu", tags: ["work"] }), item({ id: "P", type: "phrase", text: "Phr", meaning: "cụm", sourceId: "S" })]);
  const r = V.planImport(shared, [], { tag: true }, 1000);
  assert.equal(r.added.length, 2); assert.equal(r.skipped, 0);
  for (const a of r.added) { assert.equal(a.box, 0); assert.equal(a.reviews, 0); assert.equal(a.due, 1000); assert.equal(a.source, "shared"); assert.ok(a.tags.includes("shared")); assert.ok(!["S", "P"].includes(a.id)); }
  const [s, p] = [r.added.find(a => a.type === "sentence"), r.added.find(a => a.type === "phrase")];
  assert.equal(p.sourceId, s.id, "the phrase is linked to the NEW sentence id");
  assert.deepEqual(r.byType, { word: 0, phrase: 1, sentence: 1 });
});
ok("planImport skips duplicates and attaches a shared phrase to the sentence you already have", () => {
  const mine = [item({ id: "MINE", type: "sentence", text: "sent", meaning: "câu của tôi" })];
  const shared = [{ id: "S", type: "sentence", text: "Sent", meaning: "x", tags: [], sourceId: "" }, { id: "P", type: "phrase", text: "Phr", meaning: "cụm", tags: [], sourceId: "S" }];
  const r = V.planImport(shared, mine, { skipDuplicates: true });
  assert.equal(r.skipped, 1); assert.equal(r.added.length, 1);
  assert.equal(r.added[0].sourceId, "MINE");
  assert.equal(V.planImport(shared, mine, { skipDuplicates: false }).added.length, 2);
});
ok("planImport can leave out the #shared tag and never creates duplicate ids", () => {
  const shared = Array.from({ length: 500 }, (_, i) => ({ id: "i" + i, type: "word", text: "w" + i, meaning: "m", tags: ["x"], sourceId: "" }));
  const r = V.planImport(shared, [], { tag: false });
  assert.ok(r.added.every(a => !a.tags.includes("shared")));
  assert.equal(new Set(r.added.map(a => a.id)).size, 500);
});
ok("planImport ignores invalid shared cards and does not change the inputs", () => {
  const shared = [{ id: "a", type: "word", text: "ok", meaning: "ok" }, { id: "b", type: "evil", text: "x", meaning: "y" }, { id: "c", type: "word", text: " ", meaning: "y" }];
  const existing = [item({ text: "keep" })]; const snap = JSON.stringify([shared, existing]);
  assert.equal(V.planImport(shared, existing).added.length, 1);
  assert.equal(JSON.stringify([shared, existing]), snap);
});
ok("expiresAt only allows the offered lifetimes", () => {
  assert.equal(V.expiresAt(30, 0), 30 * 86400000);
  assert.throws(() => V.expiresAt(365));
});
console.log(`\n${t} tests passed`);
