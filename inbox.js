// Pure helpers for card status (active / inbox / archived) and the library overview. No DOM, no mutation of inputs.
// status: "inbox" = saved by an AI agent, not yet triaged; "archived" = hidden but kept; anything else = active.

const isInbox = c => !!c && c.status === "inbox";
const isArchived = c => !!c && c.status === "archived";
export const isActive = c => !isInbox(c) && !isArchived(c);

const list = items => (Array.isArray(items) ? items : []);

// Cards that take part in review: active only.
const reviewable = items => list(items).filter(isActive);

// One definition of where a card came from, shared by the library filter, the overview and the badges:
// "manual", "shared" (from a share link or copied from Cộng đồng: source "community"), or "agent" (any other source, e.g. "claude").
export function sourceKind(c) {
  const s = (c && c.source) || "manual";
  return s === "manual" ? "manual" : s === "shared" || s === "community" ? "shared" : "agent";
}

// Copy of the card without the status field (back to active). Also used to restore an archived card.
export function keep(card) {
  const { status, ...rest } = card;
  return rest;
}

export const drop = card => ({ ...card, status: "archived" });

// Derived level, never stored.
export function levelOf(c) {
  if (!c.reviews) return "new";
  const box = c.box || 0;
  if (box <= 1) return "weak";
  if (box >= 5) return "mastered";
  return "learning";
}

// Per-status totals; mastered/weak/never are counted over active cards only.
export function counts(items) {
  const out = { active: 0, inbox: 0, archived: 0, mastered: 0, weak: 0, never: 0 };
  for (const c of list(items)) {
    if (isInbox(c)) out.inbox++;
    else if (isArchived(c)) out.archived++;
    else {
      out.active++;
      const lv = levelOf(c);
      if (lv === "mastered") out.mastered++;
      else if (lv === "weak") out.weak++;
      else if (lv === "new") out.never++;
    }
  }
  return out;
}

// Overview of the active library. now is injectable for tests.
export function overview(items, topN = 8, now = Date.now()) {
  const act = reviewable(items);
  const out = {
    total: act.length,
    byType: { word: 0, phrase: 0, sentence: 0 },
    byLevel: { new: 0, weak: 0, learning: 0, mastered: 0 },
    bySource: { agent: 0, manual: 0, shared: 0 },
    topTags: [],
    dueNow: 0,
  };
  const tagCount = new Map();
  for (const c of act) {
    if (c.type in out.byType) out.byType[c.type]++;
    out.byLevel[levelOf(c)]++;
    out.bySource[sourceKind(c)]++;
    for (const t of Array.isArray(c.tags) ? c.tags : []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    if (typeof c.due === "number" && c.due <= now) out.dueNow++;
  }
  out.topTags = [...tagCount]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, Math.max(0, topN));
  return out;
}
