// The share size limit lives in three places. If they drift apart, sharing breaks in a confusing way
// (the app allows N cards but Firestore refuses, or a receiver downloads fewer cards than were shared).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_ITEMS } from "../vault.js";

const read = f => readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("firestore.rules cap equals MAX_ITEMS", () => {
  const m = read("firestore.rules").match(/data\.count <= (\d+)/);
  assert.ok(m, "no count cap in firestore.rules");
  assert.equal(Number(m[1]), MAX_ITEMS);
});
test("cloud.js downloads at most MAX_ITEMS + 1 cards of a share", () => {
  const cloud = read("cloud.js");
  assert.match(cloud, /import \{ MAX_ITEMS \} from "\.\/vault\.js"/);
  assert.match(cloud, /fs\.limit\(MAX_ITEMS \+ 1\)/);
});
test("a share fits in the 400-write batches and the documented limit is sane", () => {
  assert.ok(Number.isInteger(MAX_ITEMS) && MAX_ITEMS >= 1000 && MAX_ITEMS <= 5000);
});
