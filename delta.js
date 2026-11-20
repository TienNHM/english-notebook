// Delta sync: after one full read, the app asks Firestore only for cards changed since the last sync
// (cards carry an `updated` time in ms). Firestore bills one read per card, so this turns "every card on every open"
// into "the few cards that changed". Pure functions, no DOM and no Firebase.
export const SYNC_KEY = "english-notebook-sync";   // { uid, cursor, fullAt }
export const FULL_EVERY = 24 * 3600_000;           // a full read at least once a day: it also picks up deletions made elsewhere
export const MARGIN = 10 * 60_000;                 // look back a little: devices' clocks differ by a few minutes

export function readSync(storage) {
  try {
    const m = JSON.parse(storage.getItem(SYNC_KEY));
    if (m && typeof m.uid === "string" && m.uid && Number.isFinite(m.cursor) && Number.isFinite(m.fullAt)) return m;
  } catch { /* missing or corrupt */ }
  return null;
}
export function writeSync(storage, marker) { try { storage.setItem(SYNC_KEY, JSON.stringify(marker)); } catch { /* ignore */ } }
export function clearSync(storage) { try { storage.removeItem(SYNC_KEY); } catch { /* ignore */ } }

// Decide how to start. A delta needs: a marker for this user, local cards to apply it to, and a recent full read.
// The marker can also be from the future (clock changed): then do a full read.
export function planSync(marker, uid, now, haveCards) {
  const ok = marker && marker.uid === uid && haveCards && marker.fullAt <= now && now - marker.fullAt < FULL_EVERY;
  return ok ? { mode: "delta", since: Math.max(0, marker.cursor - MARGIN) } : { mode: "full", since: null };
}

// The marker to store after a snapshot. A full read sets fullAt and a cursor at the moment the read started;
// a delta keeps fullAt and moves the cursor forward to the newest `updated` seen.
export function nextMarker(prev, { uid, mode, startedAt, maxUpdated }) {
  if (mode === "full") return { uid, fullAt: startedAt, cursor: Math.max(startedAt, maxUpdated || 0) };
  const base = prev && prev.uid === uid ? prev : { uid, fullAt: startedAt, cursor: startedAt };
  return { uid, fullAt: base.fullAt, cursor: Math.max(base.cursor, maxUpdated || 0) };
}

// Apply changed cards (already normalised) and removed ids to the cards we have.
export function mergeDelta(items, changed, removedIds) {
  const byId = new Map(items.map(i => [i.id, i]));
  for (const c of changed) byId.set(c.id, c);
  for (const id of removedIds) byId.delete(id);
  return [...byId.values()];
}
