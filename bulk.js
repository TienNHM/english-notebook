// Pure helpers for bulk editing and cleanup of the card list.
// Nothing here touches the DOM, storage or the network, and no input is ever mutated.
// Cards that do not change keep their object identity in the returned arrays.

import { isActive } from "./inbox.js";

const MAX_TAG = 40;

/** Normalize a tag: lowercase, trimmed, no leading '#', max 40 chars. Returns "" when empty/invalid. */
export function normTag(t) {
  if (typeof t !== "string") return "";
  let s = t.trim().toLowerCase();
  s = s.replace(/^#+/, "").trim();
  return s.slice(0, MAX_TAG).trim();
}

const toSet = ids => (ids instanceof Set ? ids : new Set(Array.isArray(ids) ? ids : []));
const tagsOf = c => (Array.isArray(c.tags) ? c.tags : []);

function dedupe(list) {
  return [...new Set(list)];
}

/** Apply fn to the cards whose id is in `ids`; fn returns the same card when nothing changed. */
function mapSelected(items, ids, fn) {
  const list = Array.isArray(items) ? items : [];
  const set = toSet(ids);
  const changed = [];
  const out = list.map(c => {
    if (!c || !set.has(c.id)) return c;
    const next = fn(c);
    if (next !== c) changed.push(next);
    return next;
  });
  return { items: out, changed, removedIds: [] };
}

export function addTag(items, ids, tag) {
  const t = normTag(tag);
  if (!t) return mapSelected(items, [], c => c);
  return mapSelected(items, ids, c => (tagsOf(c).includes(t) ? c : { ...c, tags: [...tagsOf(c), t] }));
}

export function removeTag(items, ids, tag) {
  const t = normTag(tag);
  if (!t) return mapSelected(items, [], c => c);
  return mapSelected(items, ids, c => (tagsOf(c).includes(t) ? { ...c, tags: tagsOf(c).filter(x => x !== t) } : c));
}

/** status: "archived" | "inbox" | "" (active). The field is dropped for active cards. */
export function setStatus(items, ids, status) {
  if (status !== "archived" && status !== "inbox" && status !== "") {
    throw new RangeError("invalid status: " + status);
  }
  return mapSelected(items, ids, c => {
    if ((c.status || "") === status) return c;
    if (status === "") {
      const { status: _drop, ...rest } = c;
      return rest;
    }
    return { ...c, status };
  });
}

/**
 * Delete cards by id. Children of a deleted card (sourceId === deleted id) stay as standalone
 * cards, but their sourceId is cleared; those cards are reported in `changed`.
 */
export function removeIds(items, ids) {
  const list = Array.isArray(items) ? items : [];
  const set = toSet(ids);
  const present = new Set();
  for (const c of list) if (c && set.has(c.id)) present.add(c.id);
  const changed = [];
  const out = [];
  for (const c of list) {
    if (c && present.has(c.id)) continue;
    if (c && c.sourceId && present.has(c.sourceId)) {
      const { sourceId: _drop, ...rest } = c;
      const next = { ...rest, sourceId: "" };
      changed.push(next);
      out.push(next);
    } else out.push(c);
  }
  return { items: out, changed, removedIds: [...present] };
}

/** Rename a tag everywhere; merges into 'to' when it already exists and dedupes. */
export function renameTag(items, from, to) {
  const list = Array.isArray(items) ? items : [];
  const f = normTag(from);
  const t = normTag(to);
  if (!f || !t || f === t) return { items: list.slice(), changed: [], removedIds: [] };
  const changed = [];
  const out = list.map(c => {
    if (!c || !tagsOf(c).includes(f)) return c;
    const next = { ...c, tags: dedupe(tagsOf(c).map(x => (x === f ? t : x))) };
    changed.push(next);
    return next;
  });
  return { items: out, changed, removedIds: [] };
}

/** Type-agnostic comparison key: lowercase, no diacritics, collapsed spaces, no trailing punctuation. */
export function dupKey(text) {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.,;:!?…'"”’)\]]+$/u, "")
    .trim();
}

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Keeper order: highest box, then most reviews, then oldest created.
function betterKeeper(a, b) {
  const ba = num(a.box) ?? 0, bb = num(b.box) ?? 0;
  if (ba !== bb) return ba > bb;
  const ra = num(a.reviews) ?? 0, rb = num(b.reviews) ?? 0;
  if (ra !== rb) return ra > rb;
  const ca = num(a.created), cb = num(b.created);
  if (ca !== null && cb !== null) return ca < cb;
  if (ca !== null) return true;
  if (cb !== null) return false;
  return String(a.created ?? "") < String(b.created ?? "");
}

/** Groups (size >= 2) of cards sharing the same key. Linear time: one Map pass. */
export function findDuplicates(items) {
  const map = new Map();
  for (const c of Array.isArray(items) ? items : []) {
    if (!c) continue;
    const key = dupKey(c.text);
    if (!key) continue;
    const g = map.get(key);
    if (g) g.push(c);
    else map.set(key, [c]);
  }
  const groups = [];
  for (const [key, cards] of map) {
    if (cards.length < 2) continue;
    let keeper = cards[0];
    for (let i = 1; i < cards.length; i++) if (betterKeeper(cards[i], keeper)) keeper = cards[i];
    groups.push({ key, cards, keeper });
  }
  return groups;
}

/** Merge a duplicate group into its keeper: tags unioned, empty note/example/original filled, different meanings joined with " / ", lapses = max. */
export function mergeGroup(group) {
  const cards = Array.isArray(group) ? group : group?.cards || [];
  if (!cards.length) return { keep: null, removeIds: [] };
  let keeper = Array.isArray(group) ? null : group.keeper;
  if (!keeper || !cards.includes(keeper)) {
    keeper = cards[0];
    for (let i = 1; i < cards.length; i++) if (betterKeeper(cards[i], keeper)) keeper = cards[i];
  }
  const keep = { ...keeper };
  let tags = [...tagsOf(keeper)];
  for (const c of cards) {
    if (c === keeper) continue;
    tags = tags.concat(tagsOf(c));
    for (const f of ["note", "example", "original"]) {
      if (!keep[f] && c[f]) keep[f] = c[f];
    }
  }
  keep.tags = dedupe(tags);
  // Homographs ("light" = ánh sáng / nhẹ) share a key: never lose a different meaning, append it to the keeper.
  const seen = new Set([dupKey(keep.meaning)]);
  const meanings = [keep.meaning];
  for (const c of cards) {
    if (c === keeper || typeof c.meaning !== "string" || !c.meaning.trim()) continue;
    const k = dupKey(c.meaning);
    if (seen.has(k)) continue;
    seen.add(k);
    meanings.push(c.meaning.trim());
  }
  if (meanings.length > 1) keep.meaning = meanings.filter(m => typeof m === "string" && m.trim()).join(" / ");
  const lapses = Math.max(...cards.map(c => num(c.lapses) ?? 0));
  if (lapses > 0) keep.lapses = lapses;
  const removeIds = cards.filter(c => c !== keeper && c.id !== keeper.id).map(c => c.id);
  return { keep, removeIds };
}

/** Active cards the user keeps forgetting (lapses >= threshold), worst first. */
export function leeches(items, threshold = 4) {
  return (Array.isArray(items) ? items : [])
    .filter(c => c && isActive(c) && (num(c.lapses) ?? 0) >= threshold)
    .sort((a, b) => (num(b.lapses) ?? 0) - (num(a.lapses) ?? 0));
}

/** Tag usage over active cards, most used first (ties by name). */
export function tagStats(items) {
  const counts = new Map();
  for (const c of Array.isArray(items) ? items : []) {
    if (!c || !isActive(c)) continue;
    for (const t of new Set(tagsOf(c))) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}
