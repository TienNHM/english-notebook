// Sharing a vocabulary vault between two accounts. Pure helpers: no DOM and no network (cloud.js does the Firestore part).
//
// How it works: the owner publishes a snapshot of some of their cards under an unguessable id (a "share").
// Another signed-in user opens the link, previews it and imports a COPY. Learning progress is never part of a share.

export const MAX_ITEMS = 1000;          // cards per share (also enforced by the Firestore rules)
export const EXPIRY_DAYS = [7, 30, 90]; // allowed lifetimes of a link
export const TYPES = ["word", "phrase", "sentence"];
const LIMITS = { text: 500, meaning: 1000, example: 1000, note: 1000, original: 1000, tag: 40, tags: 10 };

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// 16 random bytes (128 bits) as 22 URL-safe characters. Nobody can guess one, so the id itself is the "password" of the link.
export function newShareId(getRandom = n => crypto.getRandomValues(new Uint8Array(n))) {
  const b = getRandom(16);
  let out = "";
  for (let i = 0; i < 16; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  return out.slice(0, 22);
}

// Accepts a full link (…?import=ID), or just the code. Returns the id or null.
export function parseShareInput(input) {
  const s = String(input ?? "").trim();
  const m = s.match(/[?&#]import=([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/) || s.match(/^([A-Za-z0-9_-]{22})$/);
  return m ? m[1] : null;
}

export const shareLink = (base, id) => `${base}${base.includes("?") ? "&" : "?"}import=${id}`;

// ---------- choosing and cleaning what to share ----------
// filter = { types: ["word", ...], tags: [..] }. An empty list means "all".
export function pickItems(items, { types = [], tags = [] } = {}) {
  return items.filter(i =>
    (!types.length || types.includes(i.type)) &&
    (!tags.length || (i.tags || []).some(t => tags.includes(t))));
}

const clip = (v, n) => String(v ?? "").trim().slice(0, n);

// What leaves the account: card content only. Never box, due, reviews, created, source or any other field.
// opts.original / opts.note decide whether the (possibly private) source sentence and note are included.
export function toShared(items, { original = false, note = false } = {}) {
  const ids = new Set(items.map(i => i.id));
  const out = [];
  for (const i of items) {
    if (!TYPES.includes(i.type) || !clip(i.text, 1) || !clip(i.meaning, 1)) continue;
    out.push({
      id: String(i.id),
      type: i.type,
      text: clip(i.text, LIMITS.text),
      meaning: clip(i.meaning, LIMITS.meaning),
      example: clip(i.example, LIMITS.example),
      note: note ? clip(i.note, LIMITS.note) : "",
      original: original ? clip(i.original, LIMITS.original) : "",
      sourceId: i.sourceId && ids.has(i.sourceId) ? String(i.sourceId) : "", // keep the link to the sentence only if the sentence is shared too
      tags: (Array.isArray(i.tags) ? i.tags : []).map(t => clip(t, LIMITS.tag)).filter(Boolean).slice(0, LIMITS.tags),
    });
  }
  return out;
}

export function tagCounts(items) {
  const m = new Map();
  for (const i of items) for (const t of i.tags || []) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// ---------- importing ----------
const keyOf = i => `${i.type}|${String(i.text).trim().toLowerCase()}`;

// Turns a share into new cards for the importing account. Nothing is changed in `existing`.
// - cards that already exist (same type and text) are skipped by default, and a shared expression
//   whose sentence already exists is attached to that existing sentence;
// - every new card gets a fresh id, box 0 and "due now": the importer starts learning them from scratch.
export function planImport(shared, existing, { skipDuplicates = true, tag = true } = {}, now = Date.now(), makeId = counterId(now)) {
  const have = new Map(existing.map(i => [keyOf(i), i]));
  const idMap = new Map();      // shared id -> id in the importing account
  const fresh = [];
  let skipped = 0;
  for (const s of shared) {
    if (!TYPES.includes(s.type) || !String(s.text ?? "").trim() || !String(s.meaning ?? "").trim()) continue;
    const dup = have.get(keyOf(s));
    if (dup && skipDuplicates) { idMap.set(s.id, dup.id); skipped++; continue; }
    const id = makeId();
    idMap.set(s.id, id);
    fresh.push({ s, id });
  }
  const added = fresh.map(({ s, id }, n) => ({
    id, type: s.type, text: String(s.text).trim(), meaning: String(s.meaning).trim(),
    example: String(s.example ?? ""), note: String(s.note ?? ""), original: String(s.original ?? ""),
    sourceId: s.sourceId && idMap.get(s.sourceId) ? idMap.get(s.sourceId) : "",
    source: "shared",
    tags: [...new Set([...(Array.isArray(s.tags) ? s.tags : []), ...(tag ? ["shared"] : [])])],
    box: 0, due: now, created: now - n, reviews: 0,
  }));
  const byType = Object.fromEntries(TYPES.map(t => [t, added.filter(a => a.type === t).length]));
  return { added, skipped, byType, total: shared.length };
}

function counterId(now) {
  let n = 0;
  return () => `s${now.toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function expiresAt(days, now = Date.now()) {
  if (!EXPIRY_DAYS.includes(days)) throw new Error("bad expiry");
  return now + days * 86400000;
}
