// Pure helpers for study sessions, the overview card and badge counts. No DOM, storage or network; inputs are never mutated.
import { isActive, sourceKind } from "./inbox.js";

export const LEECH_THRESHOLD = 4;  // answered "Quên" this many times = a hard card ("thẻ khó")
export const PRACTICE_CAP = 100;   // most cards in one practice session

const list = items => (Array.isArray(items) ? items : []);

/** Cards for a practice session: active cards only (never inbox / archived), at most `cap`, in the given order. */
export function practiceSet(cards, cap = PRACTICE_CAP) {
  const act = list(cards).filter(c => c && isActive(c));
  const max = Math.max(0, Math.floor(cap) || 0);
  return { cards: act.slice(0, max), total: act.length, capped: act.length > max };
}

export const LEVEL_LABEL = { new: "Mới", weak: "Yếu", learning: "Đang học", mastered: "Đã thuộc" };
const LEVEL_ORDER = ["mastered", "learning", "weak", "new"];

/** Segments of the "by level" bar: [{ key, label, count, pct }]. pct is a share of `total` (0 when total is 0). */
export function levelSegments(byLevel, total) {
  const t = Math.max(0, +total || 0);
  return LEVEL_ORDER.map(key => {
    const count = Math.max(0, +byLevel?.[key] || 0);
    return { key, label: LEVEL_LABEL[key], count, pct: t ? Math.round((count / t) * 1000) / 10 : 0 };
  });
}

/**
 * Counts that feed the badge tests (see progress.js). Only active cards count: cards waiting in the inbox or put in the archive
 * do not add to "cards in the library". Badges that are already earned stay earned (checkBadges only ever adds).
 */
export function badgeCounts(items) {
  const act = list(items).filter(c => c && isActive(c));
  const tags = new Set();
  let sentences = 0, maxBox = 0, agent = 0, box5 = 0;
  for (const c of act) {
    if (c.type === "sentence") sentences++;
    const box = +c.box || 0;
    if (box > maxBox) maxBox = box;
    if (box >= 5) box5++;
    if (sourceKind(c) === "agent") agent++;
    for (const t of Array.isArray(c.tags) ? c.tags : []) tags.add(t);
  }
  return { items: act.length, sentences, maxBox, tags: tags.size, agent, box5 };
}
