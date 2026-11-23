// Firestore rules test against the LOCAL emulator (project "demo-english-notebook": a demo- project never touches production).
// Covers the community rules (collections, packs, manifest, stars, the per-user counter, reports) plus a few smoke cases
// for the older rules (items, meta/progress, shares).
//
// Run it (Java 21 and Node 22 needed; the first run downloads the emulator):
//   cd tests/emulator && npm install && npm test
// or from the repo root:
//   npx --prefix tests/emulator firebase emulators:exec --only firestore --project demo-english-notebook "node tests/emulator/rules.test.mjs"
// Set RULES_DEBUG=1 to print why a request was denied.
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, orderBy, limit,
  writeBatch, increment, setLogLevel,
} from "firebase/firestore";
setLogLevel("silent");

const env = await initializeTestEnvironment({
  projectId: "demo-english-notebook",
  // RULES_FILE lets you try a changed copy of the rules (e.g. to check that a test really catches a hole)
  firestore: { rules: readFileSync(process.env.RULES_FILE || new URL("../../firestore.rules", import.meta.url), "utf8") },
});
await env.clearFirestore();

let pass = 0, fail = 0; const failures = [];
const code = e => e?.code || String(e?.message || e);
async function expectOk(name, p) {
  try { await (typeof p === "function" ? p() : p); pass++; console.log("ALLOWED as expected :", name); }
  catch (e) { fail++; failures.push(name); console.log("FAIL (was denied)   :", name, "->", code(e), process.env.RULES_DEBUG ? e.message : ""); }
}
async function expectDenied(name, p) {
  try { await (typeof p === "function" ? p() : p); fail++; failures.push(name); console.log("FAIL (was allowed)  :", name); }
  catch (e) {
    if (/permission[-_]denied/i.test(code(e))) { pass++; console.log("DENIED as expected  :", name); }
    else { fail++; failures.push(name); console.log("FAIL (wrong error)  :", name, "->", code(e), process.env.RULES_DEBUG ? e.message : ""); }
  }
}
function check(name, cond) {
  if (cond) { pass++; console.log("OK                  :", name); } else { fail++; failures.push(name); console.log("FAIL                :", name); }
}

// ----- users and helpers -----
const uidA = "user-A", uidB = "user-B", uidC = "user-C", uidF = "user-full";
const dbA = env.authenticatedContext(uidA).firestore();
const dbB = env.authenticatedContext(uidB).firestore();
const dbC = env.authenticatedContext(uidC).firestore();
const dbF = env.authenticatedContext(uidF).firestore();
const dbN = env.unauthenticatedContext().firestore();
// runs fn with the rules turned off and gives back its result (withSecurityRulesDisabled itself returns nothing)
const admin = async fn => { let out; await env.withSecurityRulesDisabled(async ctx => { out = await fn(ctx.firestore()); }); return out; };

const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const newCid = () => Array.from({ length: 22 }, () => ABC[randomInt(ABC.length)]).join("");
const now = Date.now();
const colData = (owner, o = {}) => ({
  owner, ownerName: "Tester", title: "Bộ từ test", description: "", tags: ["ielts", "travel"],
  count: 2, packs: 1, status: "public", stars: 0, createdAt: now, updatedAt: now,
  includes: { original: false, note: false }, ...o,
});
const card = (i, o = {}) => ({
  cardId: "c" + i, rev: 1, type: "word", text: "hello " + i, meaning: "xin chào", example: "", note: "",
  original: "", sourceId: "", tags: [], ...o,
});
const pack = (n = 2) => { const cards = Array.from({ length: n }, (_, i) => card(i)); return { cards, bytes: JSON.stringify(cards).length }; };
const colRef = (db, cid) => doc(db, "collections", cid);
const commRef = (db, uid) => doc(db, "users", uid, "meta", "community");
const packRef = (db, cid, n) => doc(db, "collections", cid, "packs", String(n));
const manRef = (db, cid) => doc(db, "collections", cid, "meta", "manifest");
const starRef = (db, cid, uid) => doc(db, "collections", cid, "stars", uid);
const pubCountOf = uid => admin(async db => { const s = await getDoc(commRef(db, uid)); return s.exists() ? s.data().pubCount : 0; });

// batch 1 of a publish: the collection + the counter + the manifest (opts let a test break one part)
const revsOf = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), 1]));
async function publishBatch(db, uid, cid, { data = {}, counter = null, manifest = true, packs = 1, revs = packs } = {}) {
  const old = await pubCountOf(uid);
  const b = writeBatch(db);
  b.set(colRef(db, cid), colData(uid, { packs, ...data }));
  b.set(commRef(db, uid), counter || { pubCount: old + 1, lastCid: cid });
  if (manifest) b.set(manRef(db, cid), { packRevs: revsOf(revs), publishedAt: now });
  return b.commit();
}
// the packs, in batches of at most 10 docs
async function writePacks(db, cid, count) {
  for (let i = 0; i < count; i += 10) {
    const b = writeBatch(db);
    for (let n = i; n < Math.min(count, i + 10); n++) b.set(packRef(db, cid, n), pack());
    await b.commit();
  }
}
// unpublish: packs and manifest first, then ONE batch for the collection + the counter (star docs stay behind, like cloud.js)
async function unpublish(db, uid, cid) {
  const col = (await getDoc(colRef(db, cid))).data();
  for (let n = 0; n < col.packs; n++) await deleteDoc(packRef(db, cid, n));
  await deleteDoc(manRef(db, cid));
  const old = await pubCountOf(uid);
  const b = writeBatch(db);
  b.delete(colRef(db, cid));
  b.set(commRef(db, uid), { pubCount: old - 1, lastCid: cid });
  return b.commit();
}
function starBatch(db, uid, cid, { on = true, by = 1, extra = {}, withDoc = true } = {}) {
  const b = writeBatch(db);
  if (withDoc) on ? b.set(starRef(db, cid, uid), { at: now }) : b.delete(starRef(db, cid, uid));
  b.update(colRef(db, cid), { stars: increment(on ? by : -by), ...extra });
  return b.commit();
}

try {
  // ===== publishing =====
  const P1 = newCid(), P2 = newCid();
  await expectOk("A publishes: collection + counter + manifest in one batch", publishBatch(dbA, uidA, P1, { packs: 12, data: { count: 24 } }));
  await expectOk("A writes 12 packs in batches of 10", writePacks(dbA, P1, 12));
  check("A's counter is now 1", (await pubCountOf(uidA)) === 1);
  await expectOk("A publishes a second collection (counter 1 -> 2)", async () => { await publishBatch(dbA, uidA, P2); await writePacks(dbA, P2, 1); });
  await expectOk("A reads their counter", getDoc(commRef(dbA, uidA)));
  await expectDenied("B cannot read A's counter", getDoc(commRef(dbB, uidA)));

  const bad = async (name, opts) => expectDenied(name, publishBatch(dbA, uidA, newCid(), opts));
  const W = newCid();
  await expectDenied("publish with counter +2 is denied", publishBatch(dbA, uidA, W, { counter: { pubCount: (await pubCountOf(uidA)) + 2, lastCid: W } }));
  await expectDenied("publish with the counter unchanged is denied", publishBatch(dbA, uidA, W, { counter: { pubCount: await pubCountOf(uidA), lastCid: W } }));
  await expectDenied("publish with lastCid of another collection is denied", publishBatch(dbA, uidA, newCid(), { counter: { pubCount: (await pubCountOf(uidA)) + 1, lastCid: P1 } }));
  await expectDenied("collection without the counter in the same batch is denied", setDoc(colRef(dbA, newCid()), colData(uidA)));
  await expectDenied("forged owner (A writes a collection owned by B) is denied", publishBatch(dbA, uidA, newCid(), { data: { owner: uidB } }));
  await bad("stars != 0 on publish is denied", { data: { stars: 1 } });
  await bad("status hidden on publish is denied", { data: { status: "hidden" } });
  await bad("an extra key on the collection is denied", { data: { featured: true } });
  await bad("a title of 81 characters is denied", { data: { title: "x".repeat(81) } });
  await bad("an empty title is denied", { data: { title: "" } });
  await bad("9 tags are denied", { data: { tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] } });
  await bad("a tag of 31 characters is denied", { data: { tags: ["x".repeat(31)] } });
  await bad("an uppercase tag is denied", { data: { tags: ["IELTS"] } });
  await bad("an ownerName of 41 characters is denied", { data: { ownerName: "x".repeat(41) } });
  await bad("a description of 501 characters is denied", { data: { description: "x".repeat(501) } });
  await bad("count 3001 is denied", { data: { count: 3001 } });
  await bad("51 packs are denied", { data: { packs: 51 } });
  await bad("includes with an extra key is denied", { data: { includes: { original: true, note: false, x: true } } });
  await bad("createdAt different from updatedAt on publish is denied", { data: { createdAt: now - 1 } });
  await bad("updatedAt far in the future on publish is denied", { data: { createdAt: 8640000000000000, updatedAt: 8640000000000000 } });
  await bad("createdAt/updatedAt far in the past on publish are denied", { data: { createdAt: -1, updatedAt: -1 } });
  await bad("a manifest with fewer entries than packs is denied", { packs: 2, data: { count: 4 }, revs: 1 });
  await bad("a publish without the manifest is denied", { manifest: false });
  await bad("count above packs * 1000 is denied", { data: { count: 1001 } });
  await bad("more packs than cards is denied", { packs: 3 });
  await expectOk("8 lowercase tags of 30 characters are fine", publishBatch(dbA, uidA, newCid(), { data: { tags: Array.from({ length: 8 }, (_, i) => String(i).repeat(30)) } }));
  check("the denied publishes did not move the counter (3 now)", (await pubCountOf(uidA)) === 3);

  // the 21st collection
  await admin(db => setDoc(commRef(db, uidF), { pubCount: 20, lastCid: "y".repeat(22) }));
  await expectDenied("a 21st public collection is denied", publishBatch(dbF, uidF, newCid()));

  // ===== reading =====
  await expectDenied("signed-out user cannot read a collection", getDoc(colRef(dbN, P1)));
  await expectDenied("signed-out user cannot read a pack", getDoc(packRef(dbN, P1, 0)));
  await expectDenied("signed-out user cannot list public collections", getDocs(query(collection(dbN, "collections"), where("status", "==", "public"))));
  await expectOk("B reads A's public collection", getDoc(colRef(dbB, P1)));
  await expectOk("B reads its manifest", getDoc(manRef(dbB, P1)));
  await expectOk("B reads its packs", async () => { for (let n = 0; n < 12; n++) await getDoc(packRef(dbB, P1, n)); });
  await expectOk("B lists public collections (status == public, by stars)", getDocs(query(collection(dbB, "collections"), where("status", "==", "public"), orderBy("stars", "desc"), limit(20))));
  await expectOk("B lists public collections with a tag (newest first)", getDocs(query(collection(dbB, "collections"), where("status", "==", "public"), where("tags", "array-contains", "ielts"), orderBy("updatedAt", "desc"))));
  await expectDenied("B cannot list collections without the status filter", getDocs(collection(dbB, "collections")));

  // the admin hides P2
  await admin(db => updateDoc(colRef(db, P2), { status: "hidden" }));
  await expectDenied("B cannot read a hidden collection", getDoc(colRef(dbB, P2)));
  await expectDenied("B cannot read the packs of a hidden collection", getDoc(packRef(dbB, P2, 0)));
  await expectDenied("B cannot read the manifest of a hidden collection", getDoc(manRef(dbB, P2)));
  await expectOk("owner A still reads the hidden collection", getDoc(colRef(dbA, P2)));
  await expectOk("owner A still reads its packs", getDoc(packRef(dbA, P2, 0)));
  await expectOk("A lists their own collections (owner == A, newest first)", getDocs(query(collection(dbA, "collections"), where("owner", "==", uidA), orderBy("updatedAt", "desc"))));
  await expectDenied("B cannot list A's collections by owner (one is hidden)", getDocs(query(collection(dbB, "collections"), where("owner", "==", uidA))));
  await expectDenied("B cannot star a hidden collection", starBatch(dbB, uidB, P2));

  // ===== other users cannot write packs / manifest =====
  await expectDenied("B cannot add a pack to A's collection", setDoc(packRef(dbB, P1, 12), pack()));
  await expectDenied("B cannot overwrite A's pack", setDoc(packRef(dbB, P1, 0), pack(1)));
  await expectDenied("B cannot delete A's pack", deleteDoc(packRef(dbB, P1, 0)));
  await expectDenied("B cannot change A's manifest", setDoc(manRef(dbB, P1), { packRevs: { 0: 9 }, publishedAt: now }));
  await expectDenied("B cannot delete A's manifest", deleteDoc(manRef(dbB, P1)));
  await expectDenied("owner A cannot write a pack with an extra key", setDoc(packRef(dbA, P1, 0), { ...pack(), x: 1 }));
  await expectDenied("owner A cannot write an empty pack", setDoc(packRef(dbA, P1, 0), { cards: [], bytes: 0 }));
  // only the declared field: the rules cannot look inside cards, the reader cleans them (community.cleanCard)
  await expectDenied("owner A cannot write a pack that declares over 200000 bytes", setDoc(packRef(dbA, P1, 0), { ...pack(), bytes: 200001 }));
  await expectDenied("owner A cannot write pack number 50", setDoc(packRef(dbA, P1, 50), pack()));
  await expectOk("owner A can update a pack", setDoc(packRef(dbA, P1, 0), pack(3)));

  // ===== stars =====
  await expectOk("B stars P1: star doc + stars +1 in one batch", starBatch(dbB, uidB, P1));
  check("P1 has 1 star", (await admin(async db => (await getDoc(colRef(db, P1))).data().stars)) === 1);
  await expectOk("B reads their own star", getDoc(starRef(dbB, P1, uidB)));
  await expectOk("B reads a star doc they do not have (getStar = false)", getDoc(starRef(dbB, P2, uidB)));
  await expectDenied("C cannot read B's star", getDoc(starRef(dbC, P1, uidB)));
  await expectOk("owner A lists the stars of P1", getDocs(collection(dbA, "collections", P1, "stars")));
  await expectDenied("B cannot list the stars of P1", getDocs(collection(dbB, "collections", P1, "stars")));
  await expectDenied("B cannot star P1 twice", starBatch(dbB, uidB, P1));
  await expectDenied("C cannot add a star without the star doc", starBatch(dbC, uidC, P1, { withDoc: false }));
  await expectDenied("C cannot add +2 stars", starBatch(dbC, uidC, P1, { by: 2 }));
  await expectDenied("C cannot change another field while starring", starBatch(dbC, uidC, P1, { extra: { title: "hacked" } }));
  await expectDenied("C cannot create a star doc without the counter", setDoc(starRef(dbC, P1, uidC), { at: now }));
  await expectDenied("C cannot create a star doc for B", async () => { const b = writeBatch(dbC); b.set(starRef(dbC, P1, uidB), { at: now }); b.update(colRef(dbC, P1), { stars: increment(1) }); await b.commit(); });
  await expectDenied("C cannot unstar without having a star", starBatch(dbC, uidC, P1, { on: false }));
  await expectDenied("owner A cannot star their own collection", starBatch(dbA, uidA, P1));
  await expectOk("C stars P1", starBatch(dbC, uidC, P1));
  await expectOk("B unstars P1: delete star doc + stars -1", starBatch(dbB, uidB, P1, { on: false }));
  check("P1 has 1 star after B unstarred and C starred", (await admin(async db => (await getDoc(colRef(db, P1))).data().stars)) === 1);
  await expectDenied("B cannot delete C's star", deleteDoc(starRef(dbB, P1, uidC)));
  // star farming: the owner resets a second account's star so it can star again
  await expectDenied("owner A cannot delete C's star doc (no free reset)", deleteDoc(starRef(dbA, P1, uidC)));
  await expectDenied("C cannot star again while the star doc exists", starBatch(dbC, uidC, P1));
  check("P1 still has 1 star", (await admin(async db => (await getDoc(colRef(db, P1))).data().stars)) === 1);
  await admin(db => updateDoc(colRef(db, P1), { stars: 0 }));
  await expectDenied("unstarring cannot push stars below 0", starBatch(dbC, uidC, P1, { on: false }));
  await admin(db => updateDoc(colRef(db, P1), { stars: 1 }));

  // ===== owner edits =====
  await expectDenied("owner A cannot change stars", updateDoc(colRef(dbA, P1), { stars: 99 }));
  await expectDenied("owner A cannot change status (unhide)", updateDoc(colRef(dbA, P2), { status: "public" }));
  await expectDenied("owner A cannot change owner", updateDoc(colRef(dbA, P1), { owner: uidB }));
  await expectDenied("owner A cannot change createdAt", updateDoc(colRef(dbA, P1), { createdAt: 1 }));
  await expectDenied("owner A cannot add a key", updateDoc(colRef(dbA, P1), { featured: true }));
  await expectDenied("owner A cannot set a title of 81 characters", updateDoc(colRef(dbA, P1), { title: "x".repeat(81) }));
  await expectOk("owner A edits title, tags and updatedAt", updateDoc(colRef(dbA, P1), { title: "Bộ mới", tags: ["new"], updatedAt: now + 1 }));
  await expectDenied("owner A cannot set updatedAt far in the future", updateDoc(colRef(dbA, P1), { updatedAt: 8640000000000000 }));
  await expectDenied("owner A cannot move updatedAt back", updateDoc(colRef(dbA, P1), { updatedAt: now - 1000 }));
  await expectOk("owner A edits the title without touching updatedAt", updateDoc(colRef(dbA, P1), { title: "Bộ mới 2" }));
  await expectDenied("owner A cannot change packs without a matching manifest", updateDoc(colRef(dbA, P1), { packs: 13 }));
  await expectDenied("owner A cannot claim 3000 cards in 1 pack", updateDoc(colRef(dbA, P2), { count: 3000 }));
  await expectOk("owner A adds a pack: collection + manifest + pack in one batch", async () => {
    const b = writeBatch(dbA);
    b.update(colRef(dbA, P1), { packs: 13, count: 26, updatedAt: now + 2 });
    b.set(manRef(dbA, P1), { packRevs: revsOf(13), publishedAt: now + 2 });
    b.set(packRef(dbA, P1, 12), pack());
    await b.commit();
  });
  await expectOk("owner A updates the manifest", setDoc(manRef(dbA, P1), { packRevs: { ...revsOf(13), 0: 2 }, publishedAt: now + 3 }));
  await expectDenied("owner A cannot write a junk manifest (one huge entry)", setDoc(manRef(dbA, P1), { packRevs: { junk: "z".repeat(900000) }, publishedAt: now }));
  await expectDenied("owner A cannot write a manifest with 51 entries", setDoc(manRef(dbA, P1), { packRevs: revsOf(51), publishedAt: now }));
  await expectDenied("owner A cannot write a manifest with fewer entries than packs", setDoc(manRef(dbA, P1), { packRevs: revsOf(12), publishedAt: now }));
  await expectDenied("owner A cannot set publishedAt far in the future", setDoc(manRef(dbA, P1), { packRevs: revsOf(13), publishedAt: 8640000000000000 }));
  await expectDenied("B cannot edit A's title", updateDoc(colRef(dbB, P1), { title: "x" }));

  // ===== unpublishing =====
  await expectDenied("owner A cannot delete a collection without the counter", deleteDoc(colRef(dbA, P1)));
  await expectDenied("B cannot delete A's collection", deleteDoc(colRef(dbB, P1)));
  await expectDenied("counter -1 without deleting the collection is denied", setDoc(commRef(dbA, uidA), { pubCount: (await pubCountOf(uidA)) - 1, lastCid: P1 }));
  const before = await pubCountOf(uidA);
  await expectOk("owner A unpublishes P1 (packs, manifest, then collection + counter -1)", unpublish(dbA, uidA, P1));
  check("counter went down by one", (await pubCountOf(uidA)) === before - 1);
  const left = await admin(async db => ({
    col: (await getDoc(colRef(db, P1))).exists(),
    packs: (await getDocs(collection(db, "collections", P1, "packs"))).size,
    manifest: (await getDoc(manRef(db, P1))).exists(),
  }));
  check("nothing of P1 is left (no collection, packs or manifest)", !left.col && !left.packs && !left.manifest);
  await expectDenied("C cannot unstar a deleted collection (the left-over star doc stays)", starBatch(dbC, uidC, P1, { on: false }));
  await expectOk("owner A unpublishes the hidden P2 too", unpublish(dbA, uidA, P2));

  // ===== the counter doc itself =====
  await expectDenied("free write to meta/community (reset to 0) is denied", setDoc(commRef(dbA, uidA), { pubCount: 0, lastCid: "z".repeat(22) }));
  await expectDenied("free write to meta/community (fresh user) is denied", setDoc(commRef(dbC, uidC), { pubCount: 1, lastCid: "z".repeat(22) }));
  await expectDenied("deleting meta/community is denied", deleteDoc(commRef(dbA, uidA)));
  await expectDenied("B cannot write A's meta/community", setDoc(commRef(dbB, uidA), { pubCount: 0, lastCid: "z".repeat(22) }));
  await expectOk("A still writes meta/progress", setDoc(doc(dbA, "users", uidA, "meta", "progress"), { xp: 10, streak: 2 }));
  await expectOk("A still reads meta/progress", getDoc(doc(dbA, "users", uidA, "meta", "progress")));
  await expectDenied("B cannot write A's meta/progress", setDoc(doc(dbB, "users", uidA, "meta", "progress"), { xp: 1 }));

  // ===== reports =====
  const R = newCid();
  await publishBatch(dbA, uidA, R); await writePacks(dbA, R, 1);
  // one report per user and collection: the doc id is "<uid>_<cid>" (like cloud.reportCollection)
  const report = (o = {}) => ({ cid: R, reason: "spam", note: "", by: uidB, at: now, ...o });
  const reportAs = (db, uid, o = {}) => { const d = report({ by: uid, ...o }); return setDoc(doc(db, "reports", `${uid}_${d.cid}`), d); };
  const rid = `${uidB}_${R}`;
  await expectOk("B reports a collection", reportAs(dbB, uidB, { note: "quảng cáo" }));
  await expectDenied("B cannot report the same collection twice", reportAs(dbB, uidB, { note: "again" }));
  await expectDenied("B cannot read the report back", getDoc(doc(dbB, "reports", rid)));
  await expectDenied("A (the owner) cannot list reports", getDocs(collection(dbA, "reports")));
  await expectDenied("B cannot update the report", updateDoc(doc(dbB, "reports", rid), { note: "x" }));
  await expectDenied("B cannot delete the report", deleteDoc(doc(dbB, "reports", rid)));
  await expectDenied("a report with a random id is denied", addDoc(collection(dbC, "reports"), report({ by: uidC })));
  await expectDenied("a report under another user's id is denied", setDoc(doc(dbC, "reports", `${uidF}_${R}`), report({ by: uidC })));
  await expectDenied("a report with a bad reason is denied", reportAs(dbC, uidC, { reason: "boring" }));
  await expectDenied("a report with a forged 'by' is denied", setDoc(doc(dbC, "reports", `${uidC}_${R}`), report({ by: uidB })));
  await expectDenied("a report note of 301 characters is denied", reportAs(dbC, uidC, { note: "x".repeat(301) }));
  await expectDenied("a report about a missing collection is denied", reportAs(dbC, uidC, { cid: newCid() }));
  await expectDenied("a report with an extra key is denied", reportAs(dbC, uidC, { email: "a@b.c" }));
  await expectDenied("a report with a made-up time is denied", reportAs(dbC, uidC, { at: -5 }));
  await expectDenied("a signed-out report is denied", setDoc(doc(dbN, "reports", `x_${R}`), report()));
  await expectOk("C reports the collection (the denials above were not about C)", reportAs(dbC, uidC));

  // ===== older rules still behave (smoke) =====
  await expectOk("A writes their own card", setDoc(doc(dbA, "users", uidA, "items", "i1"), { id: "i1", text: "hi" }));
  await expectOk("A reads their own cards", getDocs(collection(dbA, "users", uidA, "items")));
  await expectDenied("B cannot read A's cards", getDocs(collection(dbB, "users", uidA, "items")));
  await expectDenied("B cannot write A's deleted markers", setDoc(doc(dbB, "users", uidA, "deleted", "i1"), { id: "i1" }));
  const S = newCid();
  const share = { owner: uidA, name: "Vault", from: "", createdAt: now, expiresAt: now + 30 * 86400000, count: 1, includes: { original: false, note: false } };
  await expectOk("A creates a share", setDoc(doc(dbA, "shares", S), share));
  await expectOk("A adds a card to the share", setDoc(doc(dbA, "shares", S, "items", "c1"), { id: "c1", type: "word", text: "hello", meaning: "xin chào", example: "", note: "", original: "", sourceId: "", tags: [] }));
  await expectOk("B reads the share by id", getDoc(doc(dbB, "shares", S)));
  await expectOk("B reads its cards", getDocs(collection(dbB, "shares", S, "items")));
  await expectDenied("signed-out user cannot read the share", getDoc(doc(dbN, "shares", S)));
  await expectDenied("B cannot list all shares", getDocs(collection(dbB, "shares")));
  await expectDenied("B cannot add a card to A's share", setDoc(doc(dbB, "shares", S, "items", "c2"), { id: "c2", type: "word", text: "x", meaning: "y", example: "", note: "", original: "", sourceId: "", tags: [] }));
} catch (e) {
  fail++; failures.push("unexpected error: " + code(e)); console.error(e);
} finally {
  await env.cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exitCode = 1; }
