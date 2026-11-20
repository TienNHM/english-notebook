import test from "node:test";
import assert from "node:assert/strict";
import { describeSyncError, errorCode } from "../sync-status.js";

test("normal offline and retry errors stay silent", () => {
  for (const code of ["unavailable", "cancelled", "deadline-exceeded", "aborted", "firestore/unavailable"]) assert.equal(describeSyncError({ code }), null);
});
test("quota, permission and login errors get a specific message", () => {
  assert.match(describeSyncError({ code: "resource-exhausted" }), /quota/);
  assert.match(describeSyncError({ code: "permission-denied" }), /quyền/);
  assert.match(describeSyncError({ code: "unauthenticated" }), /đăng nhập/);
  assert.match(describeSyncError({ code: "firestore/resource-exhausted" }), /quota/);
});
test("unknown errors give a generic message with the code, and never throw on odd input", () => {
  assert.match(describeSyncError({ code: "weird" }), /mã lỗi: weird/);
  for (const bad of [null, undefined, "x", 5, {}]) assert.equal(typeof describeSyncError(bad), "string");
  assert.equal(errorCode(null), "");
});
