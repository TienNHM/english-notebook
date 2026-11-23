// Thin Firebase wrapper. The SDK is loaded lazily, only when firebase-config.js is filled in.
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";
import { MAX_ITEMS } from "./vault.js";

export const enabled = !!firebaseConfig;
const BASE = "https://www.gstatic.com/firebasejs/10.12.2/";
let sdk;

async function load() {
  if (sdk) return sdk;
  const [app, auth, fs] = await Promise.all([
    import(BASE + "firebase-app.js"),
    import(BASE + "firebase-auth.js"),
    import(BASE + "firebase-firestore.js"),
  ]);
  const a = app.initializeApp(firebaseConfig);
  // App Check (optional): proves to Firebase that requests come from this app, not a script. Off until a reCAPTCHA key is set.
  if (appCheckSiteKey) {
    try {
      const ac = await import(BASE + "firebase-app-check.js");
      ac.initializeAppCheck(a, { provider: new ac.ReCaptchaV3Provider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    } catch (e) { console.warn("App Check not started", e); }
  }
  // IndexedDB cache: reads and writes keep working offline and sync when back online.
  const db = fs.initializeFirestore(a, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  sdk = { auth, fs, db, au: auth.getAuth(a) };
  return sdk;
}

export async function onUser(cb) {
  const s = await load();
  s.auth.onAuthStateChanged(s.au, cb);
}

// Firebase ID token of the signed-in user (used to prove the login to the agent API Worker). null when signed out.
export async function idToken() {
  const s = await load();
  return s.au.currentUser ? s.au.currentUser.getIdToken() : null;
}

export async function signIn(name) {
  const s = await load();
  const provider = name === "google" ? new s.auth.GoogleAuthProvider() : new s.auth.FacebookAuthProvider();
  await s.auth.signInWithPopup(s.au, provider);
}

export async function signOut() {
  const s = await load();
  await s.auth.signOut(s.au);
}

const col = (s, uid) => s.fs.collection(s.db, "users", uid, "items");

// Calls cb(docs, info) on every change; resolves to an unsubscribe function.
//  since == null: all cards ("full read"); info = { delta: false, maxUpdated }.
//  since = ms:    only cards with updated > since (a "delta"); info = { delta: true, maxUpdated, removed: [ids] }.
// Cards written before the `updated` field existed never match a delta, which is fine: they have not changed since.
export async function watch(uid, cb, since = null, onError) {
  const s = await load();
  const target = since == null ? col(s, uid) : s.fs.query(col(s, uid), s.fs.where("updated", ">", since));
  return s.fs.onSnapshot(target, snap => {
    const docs = snap.docs.map(d => d.data());
    const maxUpdated = docs.reduce((m, d) => Math.max(m, +d.updated || 0), 0);
    cb(docs, since == null ? { delta: false, maxUpdated }
      : { delta: true, maxUpdated, removed: snap.docChanges().filter(ch => ch.type === "removed").map(ch => ch.doc.id) });
  }, onError);
}

// Deleted cards leave a small marker (users/{uid}/deleted/{id}, with `updated`), so a delta read can learn about deletions
// made on another device. Calls cb(arrayOfIds) for markers newer than `since`.
const tombs = (s, uid) => s.fs.collection(s.db, "users", uid, "deleted");
export async function watchDeleted(uid, since, cb, onError) {
  const s = await load();
  return s.fs.onSnapshot(s.fs.query(tombs(s, uid), s.fs.where("updated", ">", since)),
    snap => cb(snap.docs.map(d => d.id)), onError);
}

// Every write stamps `updated` (ms), which is what a delta read looks for.
export async function put(uid, item) {
  const s = await load();
  return s.fs.setDoc(s.fs.doc(col(s, uid), item.id), { ...item, updated: Date.now() });
}

// Streak / XP / badges live in one document: users/{uid}/meta/progress
const progressDoc = (s, uid) => s.fs.doc(s.db, "users", uid, "meta", "progress");

export async function watchProgress(uid, cb, onError) {
  const s = await load();
  return s.fs.onSnapshot(progressDoc(s, uid), snap => cb(snap.exists() ? snap.data() : null), onError);
}

export async function putProgress(uid, progress) {
  const s = await load();
  return s.fs.setDoc(progressDoc(s, uid), progress);
}

export async function del(uid, id) {
  const s = await load();
  await s.fs.deleteDoc(s.fs.doc(col(s, uid), id));
  // The marker is best effort and comes second: if the rules for it are not deployed yet, the delete itself still works.
  s.fs.setDoc(s.fs.doc(tombs(s, uid), id), { id, updated: Date.now() }).catch(() => {});
}

// ---------- shared vaults: shares/{shareId} and shares/{shareId}/items/{itemId} (see firestore.rules) ----------
// These always talk to the server (never the offline cache), so a deleted or expired share cannot look alive.
const BATCH = 400; // Firestore allows 500 writes per batch

// meta = { id, name, from, createdAt, expiresAt, includes: { original, note } }, items = cleaned cards (see vault.js)
export async function createShare(uid, meta, items) {
  const { fs, db } = await load();
  await fs.setDoc(fs.doc(db, "shares", meta.id), {
    owner: uid, name: meta.name, from: meta.from || "", createdAt: meta.createdAt, expiresAt: meta.expiresAt,
    count: items.length, includes: meta.includes,
  });
  try {
    for (let i = 0; i < items.length; i += BATCH) {
      const b = fs.writeBatch(db);
      for (const it of items.slice(i, i + BATCH)) b.set(fs.doc(db, "shares", meta.id, "items", it.id), it);
      await b.commit();
    }
  } catch (e) { await deleteShare(uid, meta.id).catch(() => {}); throw e; } // never leave a half-written share behind
}

// Returns { id, name, from, createdAt, expiresAt, count, includes, items } or null. Throws "permission-denied" when the id
// does not exist or has expired (Firestore does not say which, on purpose).
export async function getShare(id) {
  const { fs, db } = await load();
  const snap = await fs.getDocFromServer(fs.doc(db, "shares", id));
  if (!snap.exists()) return null;
  // limit: a share is capped at MAX_ITEMS cards, but nothing in the rules counts the cards, so never download more than that
  const q = fs.query(fs.collection(db, "shares", id, "items"), fs.limit(MAX_ITEMS + 1));
  const items = (await fs.getDocsFromServer(q)).docs.map(d => d.data());
  return { id, ...snap.data(), items };
}

export async function listMyShares(uid) {
  const { fs, db } = await load();
  const q = fs.query(fs.collection(db, "shares"), fs.where("owner", "==", uid));
  return (await fs.getDocsFromServer(q)).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt);
}

// Cards first, then the share itself (the rules need the share to exist while its cards are being deleted).
export async function deleteShare(uid, id) {
  const { fs, db } = await load();
  const docs = (await fs.getDocsFromServer(fs.collection(db, "shares", id, "items"))).docs;
  for (let i = 0; i < docs.length; i += BATCH) {
    const b = fs.writeBatch(db);
    docs.slice(i, i + BATCH).forEach(d => b.delete(d.ref));
    await b.commit();
  }
  await fs.deleteDoc(fs.doc(db, "shares", id));
}

// ---------- community: collections/{cid} (+ meta/manifest, packs/{n}, stars/{uid}), reports/{rid} (see firestore.rules) ----------
// Lists and detail reads go to the server (not the offline cache), so a hidden or deleted collection does not look alive.
// The counter users/{uid}/meta/community is also read from the server: the rules check pubCount == old +/- 1 exactly.
const SMALL = 10; // writes per batch whose rules call get()/getAfter() (the rules allow at most 20 such calls per batch)
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));
const colDoc = (fs, db, cid) => fs.doc(db, "collections", cid);
const communityDoc = (fs, db, uid) => fs.doc(db, "users", uid, "meta", "community");

// Public collections, most stars first ("stars") or most recently updated first ("new"), optionally only one tag.
// cursor: pass it back as `after` for the next page; null when this was the last page.
export async function listCollections({ sort = "stars", tag = "", limit = 20, after = null } = {}) {
  const { fs, db } = await load();
  const parts = [fs.where("status", "==", "public")];
  if (tag) parts.push(fs.where("tags", "array-contains", tag));
  parts.push(fs.orderBy(sort === "new" ? "updatedAt" : "stars", "desc"));
  if (after) parts.push(fs.startAfter(after));
  parts.push(fs.limit(limit));
  const docs = (await fs.getDocsFromServer(fs.query(fs.collection(db, "collections"), ...parts))).docs;
  return { items: docs.map(d => ({ id: d.id, ...d.data() })), cursor: docs.length < limit ? null : docs[docs.length - 1] };
}

// null when the collection does not exist or is hidden (the rules answer "permission-denied" for both, on purpose).
export async function getCollection(cid) {
  const { fs, db } = await load();
  try {
    const snap = await fs.getDocFromServer(colDoc(fs, db, cid));
    return snap.exists() ? { id: cid, ...snap.data() } : null;
  } catch (e) {
    if (e && e.code === "permission-denied") return null;
    throw e;
  }
}

// Reads packs "0".."packs-1" in parallel; returns [{ n, cards }] (community.unpack puts them in order). Missing packs are skipped.
export async function getCollectionCards(cid, packs) {
  const { fs, db } = await load();
  const n = Math.max(0, Math.min(+packs || 0, 50)); // MAX_PACKS: never read more than a collection may hold
  const snaps = await Promise.all(Array.from({ length: n }, (_, i) =>
    fs.getDocFromServer(fs.doc(db, "collections", cid, "packs", String(i)))));
  return snaps.flatMap((snap, i) => snap.exists() ? [{ n: i, cards: snap.data().cards || [] }] : []);
}

export async function listMyCollections(uid) {
  const { fs, db } = await load();
  const q = fs.query(fs.collection(db, "collections"), fs.where("owner", "==", uid), fs.orderBy("updatedAt", "desc"));
  return (await fs.getDocsFromServer(q)).docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getCommunityMeta(uid) {
  const { fs, db } = await load();
  const snap = await fs.getDocFromServer(communityDoc(fs, db, uid));
  const d = snap.exists() ? snap.data() : {};
  return { pubCount: +d.pubCount || 0, lastCid: d.lastCid || "" };
}

// meta = { title, description, tags, ownerName } (cleaned by community.cleanMeta), plan = community.planPublish(...).
// Batch 1 creates the collection, its manifest and bumps the counter (the rules check all three together);
// the packs follow in batches of at most SMALL docs. If a pack write fails, everything is removed again.
export async function publishCollection(uid, cid, meta, plan, includes) {
  const { fs, db } = await load();
  const old = await getCommunityMeta(uid);
  const now = Date.now();
  const b = fs.writeBatch(db);
  b.set(colDoc(fs, db, cid), {
    owner: uid, ownerName: meta.ownerName, title: meta.title, description: meta.description || "", tags: meta.tags || [],
    count: plan.count, packs: plan.packs.length, status: "public", stars: 0, createdAt: now, updatedAt: now,
    includes: { original: !!(includes && includes.original), note: !!(includes && includes.note) },
  });
  b.set(communityDoc(fs, db, uid), { pubCount: old.pubCount + 1, lastCid: cid });
  b.set(fs.doc(db, "collections", cid, "meta", "manifest"), { packRevs: plan.packRevs, publishedAt: now });
  await b.commit();
  try {
    const packs = plan.packs.map((p, n) => ({ n, p }));
    for (const part of chunks(packs, SMALL)) {
      const pb = fs.writeBatch(db);
      for (const { n, p } of part) pb.set(fs.doc(db, "collections", cid, "packs", String(n)), { cards: p.cards, bytes: p.bytes });
      await pb.commit();
    }
  } catch (e) { await unpublishCollection(uid, cid).catch(() => {}); throw e; } // never leave a half-written collection behind
}

// Packs and manifest first (their rules need the collection to still exist), then ONE batch that deletes
// the collection and lowers the counter (the rules check both together). Star docs stay behind: only their own user may
// delete them (otherwise an owner could reset a star and let the same account star again); they are harmless.
export async function unpublishCollection(uid, cid) {
  const { fs, db } = await load();
  const packs = await fs.getDocsFromServer(fs.collection(db, "collections", cid, "packs"));
  const refs = [...packs.docs.map(d => d.ref), fs.doc(db, "collections", cid, "meta", "manifest")];
  await Promise.all(chunks(refs, SMALL).map(part => {
    const b = fs.writeBatch(db);
    part.forEach(r => b.delete(r));
    return b.commit();
  }));
  const old = await getCommunityMeta(uid);
  const b = fs.writeBatch(db);
  b.delete(colDoc(fs, db, cid));
  b.set(communityDoc(fs, db, uid), { pubCount: old.pubCount - 1, lastCid: cid });
  await b.commit();
}

export async function getStar(uid, cid) {
  const { fs, db } = await load();
  return (await fs.getDocFromServer(fs.doc(db, "collections", cid, "stars", uid))).exists();
}

// ONE batch: the star doc and the counter move together, and nothing else changes (the rules check exactly that).
// It reads the star from the server first: offline it fails at once (so no write waits in the offline queue), and when the
// star is already in the wanted state (e.g. an earlier write that looked failed went through later) it writes nothing.
export async function setStar(uid, cid, on) {
  const { fs, db } = await load();
  const star = fs.doc(db, "collections", cid, "stars", uid);
  if ((await fs.getDocFromServer(star)).exists() === !!on) return;
  const b = fs.writeBatch(db);
  if (on) b.set(star, { at: Date.now() });
  else b.delete(star);
  b.update(colDoc(fs, db, cid), { stars: fs.increment(on ? 1 : -1) });
  await b.commit();
}

// One report per user and collection: the doc id is "<uid>_<cid>" (the rules deny a second one).
// The collection is read from the server first, so offline it fails at once instead of waiting in the offline queue.
export async function reportCollection(uid, cid, reason, note) {
  const { fs, db } = await load();
  await fs.getDocFromServer(colDoc(fs, db, cid));
  await fs.setDoc(fs.doc(db, "reports", `${uid}_${cid}`), { cid, reason, note: note || "", by: uid, at: Date.now() });
}
