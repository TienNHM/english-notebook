// Thin Firebase wrapper. The SDK is loaded lazily, only when firebase-config.js is filled in.
import { firebaseConfig } from "./firebase-config.js";

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

// Calls cb(arrayOfItems) on every change; resolves to an unsubscribe function.
export async function watch(uid, cb) {
  const s = await load();
  return s.fs.onSnapshot(col(s, uid), snap => cb(snap.docs.map(d => d.data())));
}

export async function put(uid, item) {
  const s = await load();
  return s.fs.setDoc(s.fs.doc(col(s, uid), item.id), item);
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
  return s.fs.deleteDoc(s.fs.doc(col(s, uid), id));
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
  // limit: a share is capped at 1000 cards, but nothing in the rules counts the cards, so never download more than that
  const q = fs.query(fs.collection(db, "shares", id, "items"), fs.limit(1001));
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
