// "Cộng đồng": public collections of cards. Pure helpers: no DOM and no network (cloud.js does the Firestore part).
//
// How it works: an owner publishes a PUBLIC collection (a copy of some cards, split into "packs" of at most PACK_BYTES).
// Other signed-in users browse it, star it, report it, or copy the cards into their own notebook ("Học bộ này").
// Every published card has a cardId and a rev, and a copied card keeps a link to it (src), so a later phase can sync updates.
// Keep the limits here in sync with firestore.rules.

import { newShareId, pickItems, toShared, TYPES } from "./vault.js";

export const MAX_CARDS = 3000, MAX_PUBLIC = 20, PACK_BYTES = 200000, MAX_PACKS = 50;
export const PACK_CARDS = 1000; // the rules also allow at most 1000 cards in one pack
export const LIMITS = { title: 80, description: 500, ownerName: 40, tags: 8, tag: 30, reportNote: 300, preview: 30 };
export const REASONS = ["spam", "offensive", "copyright", "wrong", "other"];
export const REASON_LABEL = { spam: "Spam", offensive: "Nội dung xúc phạm", copyright: "Vi phạm bản quyền", wrong: "Sai nhiều", other: "Khác" };

// Same 22-character URL-safe id as a share link.
export const newCollectionId = getRandom => newShareId(getRandom);

const enc = new TextEncoder();
const byteLen = s => enc.encode(s).length;
const str = v => String(v ?? "");
// like vault's clip: trim, cut to n characters, never leave half an emoji at the end
const cut = (v, n) => str(v).trim().slice(0, n).replace(/[\uD800-\uDBFF]$/, "");
const posInt = v => (Number.isInteger(v) && v > 0 ? v : 0);
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);

// ---------- collection details ----------
// Tags may come as an array or as text like "#IELTS, work  travel". Result: lowercase, no '#', no duplicates.
function splitTags(tags) {
  const raw = Array.isArray(tags) ? tags.map(str).join(",") : str(tags);
  const out = [];
  for (const t of raw.split(/[\s,]+/)) {
    const tag = t.replace(/^#+/, "").toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

// Checks what the owner typed. meta is always clipped to the limits; errors (Vietnamese) say what to fix.
export function cleanMeta({ title, description, tags, ownerName } = {}) {
  const errors = [];
  const t = str(title).trim(), d = str(description).trim(), o = str(ownerName).trim(), list = splitTags(tags);
  if (!t) errors.push("Hãy nhập tên bộ thẻ.");
  if (t.length > LIMITS.title) errors.push(`Tên bộ thẻ tối đa ${LIMITS.title} ký tự.`);
  if (d.length > LIMITS.description) errors.push(`Mô tả tối đa ${LIMITS.description} ký tự.`);
  if (!o) errors.push("Hãy nhập tên hiển thị.");
  if (o.length > LIMITS.ownerName) errors.push(`Tên hiển thị tối đa ${LIMITS.ownerName} ký tự.`);
  if (list.length > LIMITS.tags) errors.push(`Tối đa ${LIMITS.tags} tag.`);
  if (list.some(x => x.length > LIMITS.tag)) errors.push(`Mỗi tag tối đa ${LIMITS.tag} ký tự.`);
  const meta = {
    title: cut(t, LIMITS.title),
    description: cut(d, LIMITS.description),
    tags: list.slice(0, LIMITS.tags).map(x => cut(x, LIMITS.tag)),
    ownerName: cut(o, LIMITS.ownerName),
  };
  return { ok: errors.length === 0, errors, meta };
}

// ---------- published cards ----------
// Only active cards (no inbox, no archived), content only (vault.toShared). cardId = the owner's item id.
export function toPublicCards(items, { original = false, note = false } = {}) {
  return toShared(pickItems(items), { original, note }).map(({ id, ...c }) => ({
    cardId: id, rev: 1, type: c.type, text: c.text, meaning: c.meaning, example: c.example,
    note: c.note, original: c.original, sourceId: c.sourceId, tags: c.tags,
  }));
}

// FNV-1a 32-bit over the UTF-8 bytes of the card content. 8 hex characters. Ignores cardId and rev.
export function contentHash(c = {}) {
  const s = JSON.stringify([str(c.type), str(c.text), str(c.meaning), str(c.example), str(c.note), str(c.original), str(c.sourceId),
    Array.isArray(c.tags) ? c.tags.map(str) : []]);
  let h = 0x811c9dc5;
  for (const b of enc.encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

// Splits the cards into packs (in input order) so that JSON.stringify(pack.cards) is at most PACK_BYTES in UTF-8.
// With `previous` (an earlier publish: { packs: [{ cards }], packRevs }) the revs carry on:
// an unchanged card keeps its rev, an edited one gets rev + 1; a pack whose (cardId, rev) list is unchanged keeps its rev.
export function planPublish(cards, previous = null) {
  const count = cards.length;
  if (!count) throw new Error("Bộ thẻ chưa có thẻ nào.");
  if (count > MAX_CARDS) throw new Error(`Một bộ thẻ tối đa ${MAX_CARDS} thẻ (đang có ${count}).`);

  const prevPacks = previous && Array.isArray(previous.packs) ? previous.packs : [];
  const prevCards = new Map();
  for (const p of prevPacks) for (const c of p?.cards || []) if (!prevCards.has(c.cardId)) prevCards.set(c.cardId, c);

  // 1. revs first: a longer rev number can change the byte size
  const withRev = cards.map(c => {
    const old = prevCards.get(c.cardId);
    let rev = posInt(c.rev) || 1;
    if (old) rev = contentHash(old) === contentHash(c) ? posInt(old.rev) || 1 : (posInt(old.rev) || 1) + 1;
    return { ...c, rev };
  });

  // 2. greedy packing: bytes of "[a,b,c]" = 2 + sum of card bytes + commas
  const packs = [];
  let cur = [], curBytes = 2;
  for (const c of withRev) {
    const b = byteLen(JSON.stringify(c));
    if (b + 2 > PACK_BYTES) throw new Error(`Thẻ "${str(c.text).slice(0, 40)}" quá dài, không thể đăng.`);
    const next = curBytes + b + (cur.length ? 1 : 0);
    if (cur.length && (next > PACK_BYTES || cur.length >= PACK_CARDS)) {
      packs.push({ cards: cur, bytes: curBytes });
      cur = [c]; curBytes = 2 + b;
    } else { cur.push(c); curBytes = next; }
  }
  packs.push({ cards: cur, bytes: curBytes });
  if (packs.length > MAX_PACKS) throw new Error(`Bộ thẻ quá lớn: tối đa ${MAX_PACKS} gói dữ liệu.`);

  // 3. pack revs
  const prevRevs = (previous && previous.packRevs) || {};
  const sig = list => JSON.stringify((list || []).map(c => [c.cardId, c.rev]));
  const packRevs = {};
  packs.forEach((p, n) => {
    const old = prevPacks[n];
    if (!old) { packRevs[n] = 1; return; }
    const oldRev = posInt(prevRevs[n]) || 1;
    packRevs[n] = sig(old.cards) === sig(p.cards) ? oldRev : oldRev + 1;
  });
  return { packs, packRevs, count };
}

// Pack documents ({ n, cards }) in any order -> all cards in pack order (anything that is not an object is dropped).
export function unpack(packDocs) {
  return [...(packDocs || [])].sort((a, b) => Number(a.n) - Number(b.n))
    .flatMap(p => (Array.isArray(p.cards) ? p.cards.filter(isObj) : []));
}

// ---------- reading a card from someone else's pack ----------
// The rules cannot look inside a pack, so every card is checked and clipped here (same limits as vault.toShared)
// before it is shown or copied. null = not a usable card.
const CARD = { text: 500, meaning: 1000, example: 1000, note: 1000, original: 1000, tag: 40, tags: 10, id: 200 };
const txt = v => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
export function cleanCard(c) {
  if (!isObj(c) || !TYPES.includes(c.type)) return null;
  const text = cut(txt(c.text), CARD.text), meaning = cut(txt(c.meaning), CARD.meaning);
  if (!text || !meaning) return null;
  const cardId = cut(txt(c.cardId), CARD.id), sourceId = cut(txt(c.sourceId), CARD.id);
  return {
    cardId, rev: posInt(c.rev) || 1, type: c.type, text, meaning,
    example: cut(txt(c.example), CARD.example), note: cut(txt(c.note), CARD.note), original: cut(txt(c.original), CARD.original),
    sourceId: sourceId && sourceId !== cardId ? sourceId : "", // a card never links to itself
    tags: (Array.isArray(c.tags) ? c.tags : []).filter(t => typeof t === "string").map(t => cut(t, CARD.tag)).filter(Boolean).slice(0, CARD.tags),
  };
}

// ---------- copying a collection into my notebook ----------
const keyOf = i => `${i.type}|${str(i.text).trim().toLowerCase()}`;

// Like vault.planImport: duplicates (same type and text) are skipped by default, an expression whose sentence
// already exists is linked to that sentence, and new cards start from scratch. Each new card keeps a link to its source card.
// The cards come from other people: each one goes through cleanCard (src.hash is still the hash of the card as published).
export function planCopy(cid, cards, existing, { skipDuplicates = true } = {}, now = Date.now(), makeId = counterId(now)) {
  const have = new Map(existing.map(i => [keyOf(i), i]));
  const idMap = new Map(); // cardId -> id in my notebook
  const fresh = [];
  let skipped = 0;
  for (const raw of cards) {
    const c = cleanCard(raw);
    if (!c) continue;
    const dup = have.get(keyOf(c));
    if (dup && skipDuplicates) { idMap.set(c.cardId, dup.id); skipped++; continue; }
    const id = makeId();
    idMap.set(c.cardId, id);
    fresh.push({ c, id, hash: contentHash(raw) });
  }
  const added = fresh.map(({ c, id, hash }, n) => ({
    id, type: c.type, text: c.text, meaning: c.meaning,
    example: c.example, note: c.note, original: c.original,
    sourceId: c.sourceId && idMap.get(c.sourceId) ? idMap.get(c.sourceId) : "",
    source: "community",
    tags: [...new Set([...c.tags, "community"])],
    box: 0, due: now, created: now - n, reviews: 0,
    src: { cid, cardId: c.cardId, rev: c.rev, hash },
  }));
  return { added, skipped, total: cards.length };
}

function counterId(now) {
  let n = 0;
  return () => `c${now.toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- reports ----------
export function cleanReport({ reason, note } = {}) {
  const r = REASONS.includes(reason) ? reason : "";
  const n = str(note).trim();
  let error = "";
  if (!r) error = "Hãy chọn lý do báo cáo.";
  else if (n.length > LIMITS.reportNote) error = `Ghi chú tối đa ${LIMITS.reportNote} ký tự.`;
  return { ok: !error, reason: r, note: n.slice(0, LIMITS.reportNote), error };
}

// ---------- reading a collection doc ----------
const nat = v => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x > 0 ? x : 0; };

// Firestore data -> a safe object for the UI. Anything unknown becomes "hidden", so a broken doc is never shown as public.
export function normCollection(data, id) {
  const d = data && typeof data === "object" ? data : {};
  return {
    id: str(id ?? d.id),
    owner: str(d.owner),
    ownerName: str(d.ownerName).trim().slice(0, LIMITS.ownerName) || "Ẩn danh",
    title: str(d.title).trim().slice(0, LIMITS.title) || "(Chưa đặt tên)",
    description: str(d.description).slice(0, LIMITS.description),
    tags: (Array.isArray(d.tags) ? d.tags : []).filter(t => typeof t === "string" && t).slice(0, LIMITS.tags),
    count: nat(d.count), packs: nat(d.packs),
    status: d.status === "public" ? "public" : "hidden",
    stars: nat(d.stars), createdAt: nat(d.createdAt), updatedAt: nat(d.updatedAt),
    includes: { original: d.includes?.original === true, note: d.includes?.note === true },
  };
}
