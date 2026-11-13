// Local mirror of the signed-in user's cloud cards, so the app can draw them at once on start-up
// (before Firebase has loaded and answered). The cloud stays the source of truth: every snapshot replaces the mirror.
export const MIRROR_KEY = "english-notebook-mirror";   // { uid, items }

export function readMirror(storage) {
  try {
    const m = JSON.parse(storage.getItem(MIRROR_KEY));
    if (m && typeof m.uid === "string" && m.uid && Array.isArray(m.items)) return m;
  } catch { /* missing or corrupt: no mirror */ }
  return null;
}

export function writeMirror(storage, uid, items) {
  try { storage.setItem(MIRROR_KEY, JSON.stringify({ uid, items })); return true; } catch { return false; }
}

export function clearMirror(storage) {
  try { storage.removeItem(MIRROR_KEY); } catch { /* ignore */ }
}

// Edits made while the mirror is shown but the login is not confirmed yet are kept here, then sent once the user is known.
export function newPending() { return { put: new Map(), del: new Set() }; }
export function addPending(p, changed = [], removedIds = []) {
  for (const it of changed) { p.put.set(it.id, it); p.del.delete(it.id); }
  for (const id of removedIds) { p.del.add(id); p.put.delete(id); }
}
export function takePending(p) {
  const out = { put: [...p.put.values()], del: [...p.del] };
  p.put.clear(); p.del.clear();
  return out;
}
