// Security-rules test for shared vaults (firestore.rules). NOT part of the normal test run: it talks to the real Firebase project.
//
// What it does: signs in two temporary test users (A = owner, B = someone else) and an anonymous client, checks that every allowed
// action works and every forbidden action is denied (anonymous reads, listing all shares, writing someone else's share, forged owner,
// oversized or malformed shares and cards, expired shares, revoking), then deletes the test users and test data.
//
// Run it from a scratch folder that is NOT inside this repo:
//   1) mkdir rules-test && cd rules-test && npm init -y && npm i firebase firebase-admin   (and set "type": "module" in package.json)
//   2) copy this file there, then:  API_KEY=<web apiKey> SA=<path to a service account key> node rules.test.mjs
//   (the service account key is a secret: keep it outside the repo.)
// Note: it waits 15 s for the "expired" case, because the clock of a PC can be several seconds ahead of Google's server clock.
//
// Tests the production Firestore rules for shared vaults with two temporary users (A = owner, B = other user) and an anonymous client.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { initializeApp as adminInit, cert } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getFirestore as adminFs } from "firebase-admin/firestore";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { getFirestore, doc, getDocFromServer as getDoc, getDocsFromServer as getDocs, setDoc, deleteDoc, collection, query, where, writeBatch, setLogLevel } from "firebase/firestore";
setLogLevel("silent");

const KEY = process.env.SA, PROJECT = "tiennhm-english-notebook";
adminInit({ credential: cert(JSON.parse(readFileSync(KEY, "utf8"))) });
const cfg = { apiKey: process.env.API_KEY, authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT };

const tag = randomBytes(3).toString("hex");
const uidA = `zz-test-A-${tag}`, uidB = `zz-test-B-${tag}`;
const makeClient = async (name, uid) => {
  const app = initializeApp(cfg, name), auth = getAuth(app);
  if (uid) await signInWithCustomToken(auth, await adminAuth().createCustomToken(uid));
  return { db: getFirestore(app), uid };
};
const A = await makeClient("A", uidA), B = await makeClient("B", uidB), N = await makeClient("anon", null);

let pass = 0, fail = 0; const failures = [];
const code = e => e?.code || String(e?.message || e);
async function expectOk(name, p) { try { await p; pass++; console.log("ALLOWED as expected :", name); } catch (e) { fail++; failures.push(name); console.log("FAIL (was denied)   :", name, "->", code(e)); } }
async function expectDenied(name, p) { try { await p; fail++; failures.push(name); console.log("FAIL (was allowed)  :", name); } catch (e) { if (code(e) === "permission-denied") { pass++; console.log("DENIED as expected  :", name); } else { fail++; failures.push(name); console.log("FAIL (wrong error)  :", name, "->", code(e)); } } }

const now = Date.now(), DAY = 86400000;
const meta = (o = {}) => ({ owner: uidA, name: "Test vault", from: "", createdAt: now, expiresAt: now + 30 * DAY, count: 2, includes: { original: false, note: false }, ...o });
const card = (id, o = {}) => ({ id, type: "word", text: "hello " + id, meaning: "xin chào", example: "", note: "", original: "", sourceId: "", tags: ["t"], ...o });
const S1 = "S1-" + tag, S2 = "S2-" + tag, S3 = "S3-" + tag;
const cleanupIds = [S1, S2, S3, "bad-" + tag];

try {
  // ----- the owner publishes a share -----
  await expectOk("owner A creates a valid share", setDoc(doc(A.db, "shares", S1), meta()));
  await expectOk("owner A adds cards to it", (async () => { const b = writeBatch(A.db); b.set(doc(A.db, "shares", S1, "items", "c1"), card("c1")); b.set(doc(A.db, "shares", S1, "items", "c2"), card("c2", { type: "sentence", text: "A sentence" })); await b.commit(); })());

  // ----- who can read -----
  await expectOk("other signed-in user B reads the share by id", getDoc(doc(B.db, "shares", S1)));
  await expectOk("other signed-in user B reads its cards", getDocs(collection(B.db, "shares", S1, "items")));
  await expectDenied("anonymous (not signed in) cannot read the share", getDoc(doc(N.db, "shares", S1)));
  await expectDenied("anonymous cannot read the cards", getDocs(collection(N.db, "shares", S1, "items")));
  await expectDenied("B cannot list ALL shares", getDocs(collection(B.db, "shares")));
  await expectDenied("B cannot list A's shares (filter by A's uid)", getDocs(query(collection(B.db, "shares"), where("owner", "==", uidA))));
  await expectOk("A can list their own shares", getDocs(query(collection(A.db, "shares"), where("owner", "==", uidA))));
  await expectDenied("B cannot read A's private cards", getDocs(collection(B.db, "users", uidA, "items")));

  // ----- who can change or delete -----
  await expectDenied("B cannot delete A's share", deleteDoc(doc(B.db, "shares", S1)));
  await expectDenied("B cannot delete a card of A's share", deleteDoc(doc(B.db, "shares", S1, "items", "c1")));
  await expectDenied("B cannot add a card to A's share", setDoc(doc(B.db, "shares", S1, "items", "evil"), card("evil")));
  await expectDenied("nobody can edit an existing share (even the owner)", setDoc(doc(A.db, "shares", S1), meta({ name: "renamed" })));
  await expectDenied("B cannot create a share that claims A as the owner", setDoc(doc(B.db, "shares", "bad-" + tag), meta({ owner: uidA })));
  await expectDenied("anonymous cannot create a share", setDoc(doc(N.db, "shares", "bad-" + tag), meta()));
  await expectDenied("cannot add a card to a share that does not exist", setDoc(doc(A.db, "shares", "nope-" + tag, "items", "c1"), card("c1")));

  // ----- the share document must be well formed -----
  await expectDenied("expiry more than 91 days away", setDoc(doc(A.db, "shares", "bad-" + tag), meta({ expiresAt: now + 200 * DAY })));
  await expectDenied("expiry already in the past", setDoc(doc(A.db, "shares", "bad-" + tag), meta({ expiresAt: now - DAY })));
  await expectDenied("more than 1000 cards", setDoc(doc(A.db, "shares", "bad-" + tag), meta({ count: 1001 })));
  await expectDenied("zero cards", setDoc(doc(A.db, "shares", "bad-" + tag), meta({ count: 0 })));
  await expectDenied("name longer than 80 characters", setDoc(doc(A.db, "shares", "bad-" + tag), meta({ name: "x".repeat(81) })));
  await expectDenied("unknown extra field on the share", setDoc(doc(A.db, "shares", "bad-" + tag), { ...meta(), admin: true }));

  // ----- every card must be well formed -----
  await expectDenied("card with learning progress fields (box)", setDoc(doc(A.db, "shares", S1, "items", "x1"), card("x1", { box: 5 })));
  await expectDenied("card with an unknown type", setDoc(doc(A.db, "shares", S1, "items", "x2"), card("x2", { type: "evil" })));
  await expectDenied("card text over 500 characters", setDoc(doc(A.db, "shares", S1, "items", "x3"), card("x3", { text: "a".repeat(501) })));
  await expectDenied("card with an empty meaning", setDoc(doc(A.db, "shares", S1, "items", "x4"), card("x4", { meaning: "" })));
  await expectDenied("card with more than 10 tags", setDoc(doc(A.db, "shares", S1, "items", "x5"), card("x5", { tags: Array.from({ length: 11 }, (_, i) => "t" + i) })));

  // ----- expiry -----
  await expectOk("A creates a share that expires in a few seconds", (async () => { await setDoc(doc(A.db, "shares", S2), meta({ expiresAt: Date.now() + 3000, count: 1 })); await setDoc(doc(A.db, "shares", S2, "items", "c1"), card("c1")); })());
  await expectOk("B can read it while it is valid", getDoc(doc(B.db, "shares", S2)));
  // this PC's clock is ~7 s ahead of Google's server, so wait well past 3 s + 7 s
  await new Promise(r => setTimeout(r, 15000));
  await expectDenied("B can NOT read it after it expired", getDoc(doc(B.db, "shares", S2)));
  await expectDenied("B can NOT read its cards after it expired", getDocs(collection(B.db, "shares", S2, "items")));
  await expectOk("the owner can still read the expired share", getDoc(doc(A.db, "shares", S2)));
  await expectOk("the owner can still list its cards (to delete them)", getDocs(collection(A.db, "shares", S2, "items")));
  await expectOk("the owner can delete the expired card", deleteDoc(doc(A.db, "shares", S2, "items", "c1")));
  await expectOk("the owner can delete the expired share", deleteDoc(doc(A.db, "shares", S2)));

  // ----- revoking: cards first, then the share -----
  await expectOk("owner A deletes the cards then the share (revoke)", (async () => { await deleteDoc(doc(A.db, "shares", S1, "items", "c1")); await deleteDoc(doc(A.db, "shares", S1, "items", "c2")); await deleteDoc(doc(A.db, "shares", S1)); })());
  await expectDenied("after the revoke B can no longer read it", getDoc(doc(B.db, "shares", S1)));
} finally {
  // remove anything left behind (admin bypasses the rules), then the two temporary users
  for (const id of cleanupIds) { try { await adminFs().recursiveDelete(adminFs().doc(`shares/${id}`)); } catch {} }
  for (const uid of [uidA, uidB]) { try { await adminAuth().deleteUser(uid); } catch {} }
  const left = (await adminFs().collection("shares").get()).size;
  console.log(`\nclean-up done. shares left in the project: ${left}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED:", failures.join(" | ")); process.exitCode = 1; }
process.exit(process.exitCode || 0);
