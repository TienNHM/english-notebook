// Library view: scope, filters, search, sort, highlight and saved views. Pure functions (no DOM).
// Replaces the role of paging.js filterItems for the Library list.
import { levelOf, sourceKind } from "./inbox.js";
import { normTag } from "./bulk.js";
export const LEVELS = ["new", "weak", "learning", "mastered"];
export const SORTS = ["newest", "oldest", "due", "level", "az"];
export const SCOPES = ["library", "inbox", "archived"];
const TYPES = ["word", "phrase", "sentence"];
const SOURCES = ["agent", "manual", "shared"];
export const SAVED_VIEWS_KEY = "english-notebook-saved-views";
export const MAX_SAVED_VIEWS = 12, MAX_VIEW_NAME = 24;

// Derived level of a card (not stored): the one rule lives in inbox.js.
export const level = c => levelOf(c || {});

const MARKS = /[̀-ͯ]/;
const MARKS_G = /[̀-ͯ]/g;
// Fold one string: lower-case, strip combining marks, "đ" -> "d". Case- and diacritic-insensitive.
const fold = s => String(s ?? "").normalize("NFD").replace(MARKS_G, "").toLowerCase().replace(/đ/g, "d");

const scopeOf = c => c.status === "inbox" ? "inbox" : c.status === "archived" ? "archived" : "library";
const sourceOf = sourceKind;

export function countsByScope(items) {
  const n = { library: 0, inbox: 0, archived: 0 };
  for (const c of items || []) n[scopeOf(c)]++;
  return n;
}

const pick = (v, list, def) => list.includes(v) ? v : def;

export function normView(v) {
  v = v && typeof v === "object" ? v : {};
  return {
    scope: pick(v.scope, SCOPES, "library"),
    type: pick(v.type, TYPES, ""),
    tag: normTag(v.tag),
    query: typeof v.query === "string" ? v.query.trim() : "",
    level: pick(v.level, LEVELS, ""),
    source: pick(v.source, SOURCES, ""),
    sort: pick(v.sort, SORTS, "newest"),
  };
}

// Per-card search blob, cached. The raw fields are kept to detect an in-place edit.
const cache = new WeakMap();
const FIELDS = ["text", "meaning", "example", "note", "original"];
function blobOf(c) {
  const tags = (c.tags || []).join("\u0001");
  const hit = cache.get(c);
  if (hit && hit.tags === tags && FIELDS.every((f, k) => hit.raw[k] === c[f])) return hit.blob;
  const raw = FIELDS.map(f => c[f]);
  const blob = fold(raw.join("\u0001") + "\u0001" + tags);
  cache.set(c, { raw, tags, blob });
  return blob;
}

const LEVEL_RANK = { weak: 0, new: 1, learning: 2, mastered: 3 };
const byCreated = (a, b) => (b.created || 0) - (a.created || 0);

export function applyView(items, view, nowMs = Date.now()) {
  const v = normView(view), q = fold(v.query);
  const out = [];
  for (const c of items || []) {
    if (scopeOf(c) !== v.scope) continue;
    if (v.type && c.type !== v.type) continue;
    if (v.tag && !(c.tags || []).includes(v.tag)) continue;
    if (v.level && level(c) !== v.level) continue;
    if (v.source && sourceOf(c) !== v.source) continue;
    if (q && !blobOf(c).includes(q)) continue;
    out.push(c);
  }
  const cmp = {
    newest: byCreated,
    oldest: (a, b) => (a.created || 0) - (b.created || 0),
    due: (a, b) => (a.due || 0) - (b.due || 0),
    level: (a, b) => LEVEL_RANK[level(a)] - LEVEL_RANK[level(b)],
    az: (a, b) => fold(a.text).localeCompare(fold(b.text)),
  }[v.sort];
  // Array.prototype.sort is stable; ties fall back to created desc.
  out.sort((a, b) => cmp(a, b) || byCreated(a, b));
  return out;
}

// Split text into [{t, hit}] so the caller can escape each part and wrap hits. Matching is
// case- and diacritic-insensitive; positions map back to the ORIGINAL string, so it is never altered.
export function highlightParts(text, query) {
  text = String(text ?? "");
  const q = fold(String(query ?? "").trim());
  if (!q || !text) return [{ t: text, hit: false }];
  let folded = "";
  const start = [], end = [];   // folded index -> original [start, end)
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    let j = i + (cp > 0xffff ? 2 : 1);
    while (j < text.length && MARKS.test(text[j])) j++;   // keep decomposed marks with their base
    const f = fold(text.slice(i, j));
    for (let k = 0; k < f.length; k++) { start.push(i); end.push(j); }
    folded += f;
    i = j;
  }
  const parts = [];
  let pos = 0, from = 0;
  while (from <= folded.length - q.length) {
    const at = folded.indexOf(q, from);
    if (at < 0) break;
    const s = start[at], e = end[at + q.length - 1];
    if (s >= pos) {
      if (s > pos) parts.push({ t: text.slice(pos, s), hit: false });
      parts.push({ t: text.slice(s, e), hit: true });
      pos = e;
    } else if (e > pos) {   // overlapping hit: extend the previous one
      parts[parts.length - 1].t += text.slice(pos, e);
      pos = e;
    }
    from = at + 1;
  }
  if (pos < text.length) parts.push({ t: text.slice(pos), hit: false });
  return parts.length ? parts : [{ t: text, hit: false }];
}

// Saved views: [{name, view}]
export function normSavedViews(list) {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const name = String(x?.name ?? "").trim().slice(0, MAX_VIEW_NAME);
    if (!name || seen.has(name)) continue;
    seen.add(name); out.push({ name, view: normView(x.view) });
    if (out.length >= MAX_SAVED_VIEWS) break;
  }
  return out;
}
// Same name replaces the old view (kept in place). Returns a new list; a full list rejects a new name.
export function addSavedView(list, name, view) {
  const cur = normSavedViews(list), n = String(name ?? "").trim().slice(0, MAX_VIEW_NAME);
  if (!n) return cur;
  const entry = { name: n, view: normView(view) }, k = cur.findIndex(x => x.name === n);
  if (k >= 0) { cur[k] = entry; return cur; }
  return cur.length >= MAX_SAVED_VIEWS ? cur : [...cur, entry];
}
export const removeSavedView = (list, name) => normSavedViews(list).filter(x => x.name !== name);
