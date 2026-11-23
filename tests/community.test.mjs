import assert from "node:assert/strict";
import * as C from "../community.js";

let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };
const item = (o) => ({ id: "x" + Math.random().toString(36).slice(2, 7), type: "word", text: "t", meaning: "m", example: "", note: "", original: "", sourceId: "", source: "claude", tags: [], box: 3, due: 1, created: 1, reviews: 9, ...o });
const card = (o) => ({ cardId: "c" + Math.random().toString(36).slice(2, 7), rev: 1, type: "word", text: "t", meaning: "m", example: "", note: "", original: "", sourceId: "", tags: [], ...o });
const bytes = s => new TextEncoder().encode(s).length;

ok("collection ids are 22 URL-safe characters", () => {
  assert.match(C.newCollectionId(), /^[A-Za-z0-9_-]{22}$/);
  assert.equal(C.newCollectionId(() => new Uint8Array(16)), "AAAAAAAAAAAAAAAAAAAAAA");
});
ok("constants match the data model", () => {
  assert.deepEqual([C.MAX_CARDS, C.MAX_PUBLIC, C.PACK_BYTES, C.MAX_PACKS], [3000, 20, 200000, 50]);
  assert.deepEqual(C.REASONS, ["spam", "offensive", "copyright", "wrong", "other"]);
  for (const r of C.REASONS) assert.ok(C.REASON_LABEL[r], r);
});

ok("cleanMeta trims and reads tags from a string", () => {
  const r = C.cleanMeta({ title: "  IELTS words  ", description: " Từ vựng hay ", tags: "#IELTS, work  travel,,#work", ownerName: " Tiến " });
  assert.equal(r.ok, true); assert.deepEqual(r.errors, []);
  assert.deepEqual(r.meta, { title: "IELTS words", description: "Từ vựng hay", tags: ["ielts", "work", "travel"], ownerName: "Tiến" });
});
ok("cleanMeta reads tags from an array, strips '#', lowercases and dedupes", () => {
  const r = C.cleanMeta({ title: "a", ownerName: "b", tags: ["#API", "api", " Dev ", "", "##x"] });
  assert.deepEqual(r.meta.tags, ["api", "dev", "x"]);
  assert.deepEqual(C.cleanMeta({ title: "a", ownerName: "b" }).meta.tags, []);
});
ok("cleanMeta reports missing and too long fields in Vietnamese, and clips meta", () => {
  const empty = C.cleanMeta({});
  assert.equal(empty.ok, false); assert.equal(empty.errors.length, 2);
  assert.ok(empty.errors.some(e => e.includes("tên bộ thẻ"))); assert.ok(empty.errors.some(e => e.includes("tên hiển thị")));
  const long = C.cleanMeta({ title: "a".repeat(81), description: "d".repeat(501), ownerName: "o".repeat(41),
    tags: Array.from({ length: 9 }, (_, i) => "t" + i).concat("x".repeat(31)) });
  assert.equal(long.ok, false); assert.equal(long.errors.length, 5);
  assert.equal(long.meta.title.length, 80); assert.equal(long.meta.description.length, 500); assert.equal(long.meta.ownerName.length, 40);
  assert.equal(long.meta.tags.length, 8); assert.ok(long.meta.tags.every(x => x.length <= 30));
  const edge = C.cleanMeta({ title: "a".repeat(80), description: "d".repeat(500), ownerName: "o".repeat(40), tags: Array.from({ length: 8 }, (_, i) => i + "x".repeat(29)) });
  assert.equal(edge.ok, true, edge.errors.join());
});

ok("toPublicCards skips inbox and archived cards and never leaks progress", () => {
  const out = C.toPublicCards([item({ id: "A", box: 5, reviews: 9 }), item({ id: "B", status: "inbox" }), item({ id: "C", status: "archived" })]);
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]).sort(), ["cardId", "example", "meaning", "note", "original", "rev", "sourceId", "tags", "text", "type"]);
  assert.equal(out[0].cardId, "A"); assert.equal(out[0].rev, 1);
});
ok("toPublicCards includes the original sentence and note only when asked", () => {
  const src = [item({ original: "câu gốc", note: "ghi chú" })];
  assert.equal(C.toPublicCards(src)[0].original, ""); assert.equal(C.toPublicCards(src)[0].note, "");
  const both = C.toPublicCards(src, { original: true, note: true })[0];
  assert.equal(both.original, "câu gốc"); assert.equal(both.note, "ghi chú");
});
ok("toPublicCards keeps sourceId only when the sentence is published too", () => {
  const s = item({ id: "S", type: "sentence", text: "sent", meaning: "câu" }), p = item({ id: "P", type: "phrase", text: "ph", meaning: "cụm", sourceId: "S" });
  assert.equal(C.toPublicCards([s, p]).find(x => x.cardId === "P").sourceId, "S");
  assert.equal(C.toPublicCards([p]).find(x => x.cardId === "P").sourceId, "");
  assert.equal(C.toPublicCards([{ ...s, status: "archived" }, p]).find(x => x.cardId === "P").sourceId, "", "an archived sentence is not published");
});

ok("contentHash is 8 hex characters, stable, and ignores cardId and rev", () => {
  const a = card({ text: "triển khai", meaning: "deploy", tags: ["work"] });
  const h = C.contentHash(a);
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.equal(C.contentHash({ ...a }), h);
  assert.equal(C.contentHash({ ...a, cardId: "other", rev: 7 }), h);
  for (const k of ["type", "text", "meaning", "example", "note", "original", "sourceId"]) assert.notEqual(C.contentHash({ ...a, [k]: a[k] + "x" }), h, k);
  assert.notEqual(C.contentHash({ ...a, tags: ["work", "x"] }), h);
  assert.equal(C.contentHash({}), C.contentHash({ type: "", text: "", meaning: "", example: "", note: "", original: "", sourceId: "", tags: [] }));
});
ok("contentHash matches a known FNV-1a value (so it never drifts)", () => {
  // FNV-1a 32 over the UTF-8 bytes of the JSON content. Learners store this hash, so these values must never change.
  assert.equal(C.contentHash({}), "d1d8c051");
  assert.equal(C.contentHash({ type: "word", text: "triển khai", meaning: "deploy", tags: ["work"] }), "7338d3fa");
});

ok("planPublish keeps a small set in one pack with the exact byte size", () => {
  const cards = [card({ text: "a" }), card({ text: "b" })];
  const p = C.planPublish(cards);
  assert.equal(p.count, 2); assert.equal(p.packs.length, 1);
  assert.deepEqual(p.packRevs, { 0: 1 });
  assert.equal(p.packs[0].bytes, bytes(JSON.stringify(p.packs[0].cards)));
});
ok("planPublish packs by UTF-8 bytes, not string length (Vietnamese text)", () => {
  // each "ệ" is 1 char but 3 bytes: 30 cards of 9000 chars = 27000 bytes of text each
  const cards = Array.from({ length: 30 }, (_, i) => card({ cardId: "v" + i, text: "x", meaning: "ệ".repeat(9000) }));
  assert.ok(JSON.stringify(cards).length < C.PACK_BYTES * 2, "by string length it would fit in 2 packs");
  const p = C.planPublish(cards);
  assert.ok(p.packs.length >= 5, `got ${p.packs.length} packs`);
  for (const pk of p.packs) { assert.equal(pk.bytes, bytes(JSON.stringify(pk.cards))); assert.ok(pk.bytes <= C.PACK_BYTES); }
  assert.deepEqual(C.unpack(p.packs.map((pk, n) => ({ n, cards: pk.cards }))).map(c => c.cardId), cards.map(c => c.cardId), "input order kept");
  assert.deepEqual(Object.keys(p.packRevs), p.packs.map((_, n) => String(n)));
});
ok("planPublish fills a pack up to exactly PACK_BYTES and no further", () => {
  const base = card({ cardId: "a", meaning: "" });
  const size = n => bytes(JSON.stringify({ ...base, meaning: "m".repeat(n) }));
  const half = (C.PACK_BYTES - 3) / 2; // "[" + a + "," + b + "]"
  const pad = Math.floor(half) - size(0);
  const a = { ...base, cardId: "a", meaning: "m".repeat(pad) }, b = { ...base, cardId: "b", meaning: "m".repeat(pad) };
  const extra = C.PACK_BYTES - 3 - bytes(JSON.stringify(a)) - bytes(JSON.stringify(b)); // 0 or 1 byte left
  b.meaning += "m".repeat(extra);
  const exact = C.planPublish([a, b]);
  assert.equal(exact.packs.length, 1); assert.equal(exact.packs[0].bytes, C.PACK_BYTES);
  const over = C.planPublish([a, { ...b, meaning: b.meaning + "m" }]);
  assert.equal(over.packs.length, 2); assert.ok(over.packs.every(pk => pk.bytes <= C.PACK_BYTES));
});
ok("planPublish throws on no cards, too many cards, too many packs or one huge card", () => {
  assert.throws(() => C.planPublish([]), /chưa có thẻ/);
  const many = Array.from({ length: 3001 }, (_, i) => card({ cardId: "m" + i }));
  assert.throws(() => C.planPublish(many), /3000/);
  assert.equal(C.planPublish(many.slice(0, 3000)).count, 3000);
  // 51 cards that each need their own pack
  const big = Array.from({ length: 51 }, (_, i) => card({ cardId: "b" + i, meaning: "m".repeat(150000) }));
  assert.throws(() => C.planPublish(big), /50/);
  assert.equal(C.planPublish(big.slice(0, 50)).packs.length, 50);
  assert.throws(() => C.planPublish([card({ meaning: "ệ".repeat(70000) })]), /quá dài/);
});
ok("planPublish puts at most 1000 cards in a pack", () => {
  const tiny = Array.from({ length: 2500 }, (_, i) => card({ cardId: String(i), text: "a", meaning: "b" }));
  const p = C.planPublish(tiny);
  assert.deepEqual(p.packs.map(pk => pk.cards.length), [1000, 1000, 500]);
});
ok("planPublish does not change its input", () => {
  const cards = [card({ cardId: "a", rev: 1 })]; const snap = JSON.stringify(cards);
  C.planPublish(cards, { packs: [{ cards: [{ ...cards[0], text: "old", rev: 4 }] }], packRevs: { 0: 2 } });
  assert.equal(JSON.stringify(cards), snap);
});
ok("planPublish bumps revs only for what changed since the previous publish", () => {
  // two packs of 2 cards each (cards ~70 KB, so 3 do not fit in a pack)
  const fat = "m".repeat(70000);
  const v1 = [card({ cardId: "a", meaning: fat }), card({ cardId: "b", meaning: fat }), card({ cardId: "c", meaning: fat + "c" }), card({ cardId: "d", meaning: fat + "d" })];
  const first = C.planPublish(v1);
  const layout = first.packs.map(pk => pk.cards.map(c => c.cardId));
  assert.deepEqual(layout, [["a", "b"], ["c", "d"]]);
  assert.deepEqual(first.packRevs, Object.fromEntries(layout.map((_, n) => [n, 1])));
  // pretend an earlier publish already bumped some revs
  const prev = { packs: first.packs.map(pk => ({ cards: pk.cards.map(c => ({ ...c, rev: 3 })) })), packRevs: Object.fromEntries(layout.map((_, n) => [n, 5])) };
  // edit the LAST card and add a new one at the end
  const v2 = v1.map(c => (c.cardId === "d" ? { ...c, text: "edited" } : c)).concat(card({ cardId: "e", meaning: fat }));
  const next = C.planPublish(v2, prev);
  const revOf = id => next.packs.flatMap(pk => pk.cards).find(c => c.cardId === id).rev;
  assert.equal(revOf("a"), 3, "unchanged card keeps its rev"); assert.equal(revOf("b"), 3); assert.equal(revOf("c"), 3);
  assert.equal(revOf("d"), 4, "edited card gets rev + 1");
  assert.equal(revOf("e"), 1, "a new card starts at 1");
  const last = layout.length - 1;
  for (let n = 0; n < last; n++) assert.equal(next.packRevs[n], 5, `pack ${n} unchanged keeps its rev`);
  assert.equal(next.packRevs[last], 6, "the pack with the edited card gets rev + 1");
  for (let n = layout.length; n < next.packs.length; n++) assert.equal(next.packRevs[n], 1, "a new pack starts at 1");
  assert.ok(next.packs.length > layout.length, "the new card needed a new pack");
});
ok("planPublish with an identical previous publish changes no rev", () => {
  const cards = [card({ cardId: "a", text: "x" }), card({ cardId: "b", text: "y" })];
  const first = C.planPublish(cards);
  const again = C.planPublish(cards, { packs: first.packs, packRevs: first.packRevs });
  assert.deepEqual(again.packRevs, first.packRevs);
  assert.deepEqual(again.packs[0].cards.map(c => c.rev), [1, 1]);
  // removing a card changes the pack list, so the pack rev goes up
  assert.deepEqual(C.planPublish(cards.slice(0, 1), { packs: first.packs, packRevs: first.packRevs }).packRevs, { 0: 2 });
});

ok("unpack orders packs by n, whatever order they come in", () => {
  const docs = [{ n: "2", cards: [{ cardId: "e" }] }, { n: "0", cards: [{ cardId: "a" }, { cardId: "b" }] }, { n: "10", cards: [{ cardId: "z" }] }, { n: "1", cards: [{ cardId: "c" }] }];
  assert.deepEqual(C.unpack(docs).map(c => c.cardId), ["a", "b", "c", "e", "z"]);
  assert.deepEqual(C.unpack([]), []);
  assert.deepEqual(C.unpack([{ n: 0 }]), []);
});

ok("planCopy makes fresh cards with a link to the source card", () => {
  const cards = C.toPublicCards([item({ id: "S", type: "sentence", text: "Sent", meaning: "câu", tags: ["work"] }), item({ id: "P", type: "phrase", text: "Phr", meaning: "cụm", sourceId: "S" })]);
  const r = C.planCopy("CID", cards, [], {}, 1000);
  assert.equal(r.added.length, 2); assert.equal(r.skipped, 0); assert.equal(r.total, 2);
  for (const a of r.added) {
    assert.equal(a.box, 0); assert.equal(a.reviews, 0); assert.equal(a.due, 1000);
    assert.equal(a.source, "community"); assert.ok(a.tags.includes("community")); assert.ok(!["S", "P"].includes(a.id));
  }
  const [s, p] = [r.added.find(a => a.type === "sentence"), r.added.find(a => a.type === "phrase")];
  assert.deepEqual(s.tags, ["work", "community"]);
  assert.equal(p.sourceId, s.id, "the phrase is linked to the NEW sentence id");
  assert.deepEqual(s.src, { cid: "CID", cardId: "S", rev: 1, hash: C.contentHash(cards[0]) });
  assert.deepEqual(p.src, { cid: "CID", cardId: "P", rev: 1, hash: C.contentHash(cards[1]) });
});
ok("planCopy keeps the published rev in the link", () => {
  const r = C.planCopy("CID", [card({ cardId: "a", rev: 4, text: "x" })], []);
  assert.equal(r.added[0].src.rev, 4);
});
ok("planCopy skips duplicates and links an expression to the sentence you already have", () => {
  const mine = [item({ id: "MINE", type: "sentence", text: "sent", meaning: "câu của tôi" })];
  const cards = [card({ cardId: "S", type: "sentence", text: " Sent ", meaning: "x" }), card({ cardId: "P", type: "phrase", text: "Phr", meaning: "cụm", sourceId: "S" })];
  const r = C.planCopy("CID", cards, mine);
  assert.equal(r.skipped, 1); assert.equal(r.added.length, 1);
  assert.equal(r.added[0].sourceId, "MINE");
  assert.equal(C.planCopy("CID", cards, mine, { skipDuplicates: false }).added.length, 2);
  assert.equal(C.planCopy("CID", [card({ type: "phrase", text: "sent", meaning: "m" })], mine).added.length, 1, "same text but another type is not a duplicate");
});
ok("planCopy ignores invalid cards, makes unique ids and does not change its inputs", () => {
  const cards = [card({ cardId: "a", text: "ok" }), card({ cardId: "b", type: "evil" }), card({ cardId: "c", text: " " }), card({ cardId: "d", meaning: "" })];
  const existing = [item({ text: "keep" })]; const snap = JSON.stringify([cards, existing]);
  const r = C.planCopy("CID", cards, existing);
  assert.equal(r.added.length, 1); assert.equal(r.total, 4);
  assert.equal(JSON.stringify([cards, existing]), snap);
  const many = Array.from({ length: 500 }, (_, i) => card({ cardId: "i" + i, text: "w" + i }));
  assert.equal(new Set(C.planCopy("CID", many, []).added.map(a => a.id)).size, 500);
  let n = 0; assert.equal(C.planCopy("CID", [card({ text: "q" })], [], {}, 5, () => "id" + n++).added[0].id, "id0");
});
ok("planCopy does not add the community tag twice", () => {
  assert.deepEqual(C.planCopy("CID", [card({ tags: ["community", "x"] })], []).added[0].tags, ["community", "x"]);
});

ok("planCopy cleans hostile cards: clips long text, keeps only string tags, makes ids strings", () => {
  const raw = { cardId: { x: 1 }, rev: "9", type: "word", text: "a".repeat(600000), meaning: "m".repeat(5000), example: "e".repeat(2000),
    note: 7, original: null, sourceId: ["S"], tags: [5, { o: 1 }, "b".repeat(5000), " ok ", "", null, ...Array.from({ length: 20 }, (_, i) => "t" + i)] };
  const [a] = C.planCopy("CID", [raw], [], {}, 1000).added;
  assert.equal(a.text.length, 500); assert.equal(a.meaning.length, 1000); assert.equal(a.example.length, 1000);
  assert.equal(a.note, "7"); assert.equal(a.original, ""); assert.equal(a.sourceId, "");
  assert.ok(a.tags.every(t => typeof t === "string"), "only string tags");
  assert.equal(a.tags[0].length, 40); assert.equal(a.tags[1], "ok");
  assert.equal(a.tags.length, 11, "10 tags at most, plus community");
  assert.deepEqual(a.src, { cid: "CID", cardId: "", rev: 1, hash: C.contentHash(raw) });
});
ok("planCopy skips cards that are not objects and never links a card to itself", () => {
  const r = C.planCopy("CID", [null, 1, "x", [], card({ cardId: "s", type: "sentence", text: "S", sourceId: "s" })], []);
  assert.equal(r.added.length, 1); assert.equal(r.added[0].sourceId, "");
});
ok("cleanCard: null for broken cards, a clean copy otherwise", () => {
  for (const bad of [null, 5, "x", [], {}, card({ type: "evil" }), card({ text: { a: 1 } }), card({ meaning: "  " })]) assert.equal(C.cleanCard(bad), null);
  const c = card({ cardId: "a", text: " hi ", tags: ["x", 3] });
  assert.deepEqual(C.cleanCard(c), { ...c, text: "hi", tags: ["x"] });
});
ok("unpack drops elements that are not objects", () => {
  assert.deepEqual(C.unpack([{ n: 0, cards: [null, 1, { cardId: "a" }, [], "s"] }]).map(c => c.cardId), ["a"]);
});
ok("clipping never leaves half an emoji at the end", () => {
  const [p] = C.toPublicCards([item({ id: "A", text: "x".repeat(499) + "\u{1F600}" })]);
  assert.equal(p.text, "x".repeat(499));
  assert.equal(C.cleanMeta({ title: "y".repeat(79) + "\u{1F600}", ownerName: "o" }).meta.title, "y".repeat(79));
  assert.equal(C.cleanCard(card({ text: "z".repeat(499) + "\u{1F600}" })).text, "z".repeat(499));
});

ok("cleanReport checks the reason and the note", () => {
  assert.deepEqual(C.cleanReport({ reason: "spam", note: "  quảng cáo  " }), { ok: true, reason: "spam", note: "quảng cáo", error: "" });
  assert.deepEqual(C.cleanReport({ reason: "other" }), { ok: true, reason: "other", note: "", error: "" });
  const bad = C.cleanReport({ reason: "hack", note: "x" });
  assert.equal(bad.ok, false); assert.equal(bad.reason, ""); assert.match(bad.error, /lý do/);
  assert.equal(C.cleanReport({ reason: "wrong", note: "n".repeat(300) }).ok, true);
  const long = C.cleanReport({ reason: "wrong", note: "n".repeat(301) });
  assert.equal(long.ok, false); assert.equal(long.note.length, 300); assert.match(long.error, /300/);
  assert.equal(C.cleanReport().ok, false);
});

ok("normCollection fills safe defaults for a broken doc", () => {
  const n = C.normCollection(null, "ID");
  assert.deepEqual(n, { id: "ID", owner: "", ownerName: "Ẩn danh", title: "(Chưa đặt tên)", description: "", tags: [], count: 0, packs: 0,
    status: "hidden", stars: 0, createdAt: 0, updatedAt: 0, includes: { original: false, note: false } });
  const odd = C.normCollection({ status: "weird", stars: -3, count: "12", packs: 1.7, tags: ["a", 3, "", "b"], includes: { original: "yes", note: true } }, "X");
  assert.equal(odd.status, "hidden"); assert.equal(odd.stars, 0); assert.equal(odd.count, 12); assert.equal(odd.packs, 1);
  assert.deepEqual(odd.tags, ["a", "b"]); assert.deepEqual(odd.includes, { original: false, note: true });
});
ok("normCollection keeps a good doc as it is", () => {
  const d = { owner: "u1", ownerName: "Tiến", title: "IELTS", description: "mô tả", tags: ["ielts"], count: 120, packs: 1, status: "public", stars: 5,
    createdAt: 10, updatedAt: 20, includes: { original: true, note: false } };
  assert.deepEqual(C.normCollection(d, "CID"), { id: "CID", ...d });
});

console.log(`\n${t} tests passed`);
