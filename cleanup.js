// Pure helpers for the Library "Dọn dẹp" panel and for undo. No DOM, storage or network; inputs are never mutated.
import { mergeGroup } from "./bulk.js";

/**
 * Merge one duplicate group (from findDuplicates) into its keeper.
 * Expressions that pointed at a removed card (sourceId) are re-pointed to the keeper, so no card is orphaned.
 * Returns { items, changed, removedIds } like the bulk.js helpers; `changed` = the keeper + re-pointed children.
 */
export function mergeDuplicateGroup(items, group) {
  const list = Array.isArray(items) ? items : [];
  const { keep, removeIds } = mergeGroup(group);
  if (!keep || !removeIds.length) return { items: list.slice(), changed: [], removedIds: [] };
  const gone = new Set(removeIds), changed = [keep], out = [];
  // The keeper itself may be a child of a card that is removed in this merge: clear the dangling link.
  if (keep.sourceId && gone.has(keep.sourceId)) keep.sourceId = "";
  for (const c of list) {
    if (!c) { out.push(c); continue; }
    if (c.id === keep.id) { out.push(keep); continue; }
    if (gone.has(c.id)) continue;
    if (c.sourceId && gone.has(c.sourceId)) {
      const next = { ...c, sourceId: keep.id };
      changed.push(next); out.push(next);
    } else out.push(c);
  }
  return { items: out, changed, removedIds: removeIds };
}

/** The original cards that a bulk result (changed / removedIds) replaced or deleted: what Hoàn tác must put back. */
export function undoCards(before, res) {
  const byId = new Map((Array.isArray(before) ? before : []).filter(Boolean).map(c => [c.id, c]));
  const ids = [...(res?.changed || []).map(c => c.id), ...(res?.removedIds || [])];
  return [...new Set(ids)].map(id => byId.get(id)).filter(Boolean);
}

/** Put cards back into the list (replace by id, or add), newest first. */
export function restoreCards(items, cards) {
  const list = Array.isArray(items) ? items : [];
  const back = new Map((Array.isArray(cards) ? cards : []).filter(Boolean).map(c => [c.id, c]));
  const used = new Set();
  const out = list.map(c => {
    if (c && back.has(c.id)) { used.add(c.id); return back.get(c.id); }
    return c;
  });
  for (const [id, c] of back) if (!used.has(id)) out.push(c);
  return out.sort((a, b) => (b.created || 0) - (a.created || 0));
}

/**
 * Cards for "Hoàn tác" after a delete or merge: the removed cards get NEW ids (genId), and cards that pointed at them
 * (sourceId) are re-pointed. Why: a delete leaves a marker for the old id in the cloud, and other devices would
 * hide a card that comes back with the same id.
 */
export function reviveCards(cards, removedIds, genId) {
  const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
  const gone = new Set(removedIds || []), map = new Map();
  for (const c of list) if (gone.has(c.id)) map.set(c.id, genId());
  return list.map(c => {
    const id = map.get(c.id) ?? c.id;
    const moved = c.sourceId && map.has(c.sourceId);
    if (id === c.id && !moved) return c;
    return moved ? { ...c, id, sourceId: map.get(c.sourceId) } : { ...c, id };
  });
}
