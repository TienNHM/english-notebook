import assert from "node:assert/strict";
import * as S from "../share.js";

let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };
const d = { streak: 7, best: 7, level: 3, xp: 280, reviews: 64, badges: 5, badgesTotal: 15, icons: ["🌱"], cards: 40 };

ok("text mentions streak, level, recalls and badges", () => {
  const s = S.shareText(d);
  for (const part of ["7-day streak", "Level 3", "64 cards recalled", "5/15 badges", "English Notebook"]) assert.ok(s.includes(part), part);
});
ok("text leaves out empty parts and never has personal data", () => {
  const s = S.shareText({ ...d, streak: 0, reviews: 0, badges: 0 });
  assert.ok(!s.includes("streak") && !s.includes("recalled") && !s.includes("badges") && s.includes("Level 3"));
  assert.ok(!/@|http/i.test(s));
});
ok("text plus link fits in a post of 280 characters", () => {
  const long = S.shareText({ ...d, streak: 365, reviews: 99999, badges: 15 });
  assert.ok(long.length + 1 + 23 <= 280, `length ${long.length}`);
});
ok("links are encoded and carry the site url", () => {
  const text = "A & B = 100% #1?";
  const l = S.shareLinks(text);
  for (const [name, url] of Object.entries(l)) {
    const u = new URL(url);
    assert.ok(u.protocol === "https:", name);
    assert.ok(url.includes(encodeURIComponent(S.SITE_URL)), name + " has the site url");
  }
  assert.equal(new URL(l.x).searchParams.get("text"), text);
  assert.equal(new URL(l.telegram).searchParams.get("text"), text);
  assert.equal(new URL(l.facebook).searchParams.get("quote"), text);
  assert.equal(new URL(l.x).hostname, "x.com");
});
ok("drawShareCard sizes the canvas for feed and link preview", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => k === "measureText" ? () => ({ width: 100 }) : (...a) => { calls.push(k); }, set: () => true });
  const cv = { width: 0, height: 0, getContext: () => ctx };
  S.drawShareCard(cv, d); assert.deepEqual([cv.width, cv.height], [1080, 1080]);
  S.drawShareCard(cv, d, { wide: true }); assert.deepEqual([cv.width, cv.height], [1200, 630]);
  S.drawShareCard(cv, d, { wide: true, promo: true }); assert.deepEqual([cv.width, cv.height], [1200, 630]);
  assert.ok(calls.includes("fillText"));
});
console.log(`\n${t} tests passed`);
