import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION, parseVersion, isNewer, checkForUpdate } from "../version.js";
let t = 0; const ok = async (name, fn) => { await fn(); t++; console.log("ok -", name); };
const res = (body, status = 200) => async () => ({ ok: status < 400, json: async () => body });

await ok("parseVersion reads x.y.z (with or without v) and rejects the rest", () => {
  assert.deepEqual(parseVersion("2.10.1"), [2, 10, 1]); assert.deepEqual(parseVersion("v1.0.0"), [1, 0, 0]);
  for (const bad of ["2.1", "x.y.z", "", null, undefined, "1.0.0-beta"]) assert.equal(parseVersion(bad), null);
});
await ok("isNewer compares numbers, not text (2.10.0 > 2.9.0)", () => {
  assert.equal(isNewer("2.10.0", "2.9.0"), true); assert.equal(isNewer("3.0.0", "2.99.99"), true);
  assert.equal(isNewer("2.1.1", "2.1.0"), true); assert.equal(isNewer("2.1.0", "2.1.0"), false);
  assert.equal(isNewer("2.0.9", "2.1.0"), false); assert.equal(isNewer("garbage", "2.1.0"), false);
});
await ok("version.json and VERSION are the same (update both when releasing)", () => {
  assert.equal(JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8")).version, VERSION);
});
await ok("version.js matches the top entry of CHANGELOG.md", () => {
  const top = /^## (\d+\.\d+\.\d+)/m.exec(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"))[1];
  assert.equal(top, VERSION);
});
await ok("checkForUpdate: newer, same, offline and broken answers", async () => {
  assert.deepEqual(await checkForUpdate("2.1.0", res({ version: "2.2.0" })), { latest: "2.2.0", newer: true });
  assert.deepEqual(await checkForUpdate("2.1.0", res({ version: "2.1.0" })), { latest: "2.1.0", newer: false });
  assert.equal(await checkForUpdate("2.1.0", async () => { throw new Error("offline"); }), null);
  assert.equal(await checkForUpdate("2.1.0", res({}, 404)), null);
  assert.equal(await checkForUpdate("2.1.0", res({ version: "oops" })), null);
});
console.log(`\n${t} tests passed`);
