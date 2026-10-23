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
