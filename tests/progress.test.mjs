import assert from "node:assert/strict";
import * as P from "../progress.js";
const ctx = { items: 20, sentences: 0, maxBox: 1 };
const at = (key, h = 10) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d, h); };
const day = (p, key, n, grade = 1, c = ctx) => { let ev; for (let i = 0; i < n; i++) ({ p, ev } = P.recordReview(p, grade, c, at(key))); return { p, ev }; };
let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };

ok("goal reached on the 10th recall, xp = 10*3 + 20 bonus", () => {
  let p = P.emptyProgress(), evs = [];
  for (let i = 0; i < 10; i++) { const r = P.recordReview(p, 1, ctx, at("2026-10-01")); p = r.p; evs.push(r.ev); }
  assert.equal(evs.findIndex(e => e.goalReached), 9);
  assert.equal(P.totalXp(p), 50);
  assert.equal(P.streakInfo(p, "2026-10-01").current, 1);
  assert.ok(p.badges.first && p.badges.goal1);
});
ok("Quên gives 1 xp but does not count toward the goal", () => {
  let { p } = day(P.emptyProgress(), "2026-10-01", 9);
  ({ p } = day(p, "2026-10-01", 5, 0));
  assert.equal(p.days["2026-10-01"].n, 9); assert.equal(p.days["2026-10-01"].f, false);
});
ok("goal is capped by the number of cards (3 cards, goal 10)", () => {
  const { p, ev } = day(P.emptyProgress(), "2026-10-01", 3, 1, { items: 3 });
  assert.equal(ev.goalReached, true); assert.equal(P.effectiveGoal(p, 3), 3);
});
ok("streak grows over consecutive days; unfinished today keeps yesterday's streak", () => {
  let p = P.emptyProgress();
  for (const k of ["2026-10-01", "2026-10-02", "2026-10-03"]) ({ p } = day(p, k, 10));
  assert.deepEqual(P.streakInfo(p, "2026-10-03"), { current: 3, best: 3, todayDone: true, atRisk: false });
  const s = P.streakInfo(p, "2026-10-04");
  assert.equal(s.current, 3); assert.equal(s.atRisk, true); assert.equal(s.todayDone, false);
  assert.ok(p.badges.streak3);
});
ok("a missed day with no freeze breaks the streak", () => {
  let p = P.emptyProgress(); for (const k of ["2026-10-01", "2026-10-02"]) ({ p } = day(p, k, 10));
  const r = P.settleFreezes(p, "2026-10-05");
  assert.equal(r.used, 0); assert.equal(P.streakInfo(r.p, "2026-10-05").current, 0);
  assert.equal(P.streakInfo(r.p, "2026-10-05").best, 2);
});
ok("freeze earned at day 7, then saves exactly one missed day", () => {
  let p = P.emptyProgress(), last;
  for (let i = 1; i <= 7; i++) last = day(p, `2026-10-0${i}`, 10), p = last.p;
  assert.equal(last.ev.freeze, true); assert.equal(P.freezesAvailable(p), 1);
  const r = P.settleFreezes(p, "2026-10-09"); // missed the 8th
  assert.equal(r.used, 1); assert.equal(P.freezesAvailable(r.p), 0);
  assert.equal(P.streakInfo(r.p, "2026-10-09").current, 8); // 7 days + frozen day, today not done
  const again = P.settleFreezes(r.p, "2026-10-09"); assert.equal(again.used, 0); // idempotent
});
ok("two missed days with only one freeze: nothing is spent, streak breaks", () => {
  let p = P.emptyProgress(); for (let i = 1; i <= 7; i++) ({ p } = day(p, `2026-10-0${i}`, 10));
  const r = P.settleFreezes(p, "2026-10-10");
  assert.equal(r.used, 0); assert.equal(P.freezesAvailable(r.p), 1); assert.equal(P.streakInfo(r.p, "2026-10-10").current, 0);
});
ok("month boundary: Oct 31 -> Nov 1 is consecutive", () => {
  let { p } = day(P.emptyProgress(), "2026-10-31", 10); ({ p } = day(p, "2026-11-01", 10));
  assert.equal(P.streakInfo(p, "2026-11-01").current, 2); assert.equal(P.addDays("2026-02-28", 1), "2026-03-01");
});
ok("level up and badges from library size", () => {
  const { p } = P.checkBadges(P.emptyProgress(), { items: 12, sentences: 11, maxBox: 5 }, at("2026-10-01"));
  assert.ok(p.badges.items10 && p.badges.sent10 && p.badges.box5 && !p.badges.items50);
  assert.equal(P.levelInfo(0).level, 1); assert.equal(P.levelInfo(30).level, 2); assert.equal(P.levelInfo(120).level, 3);
});
ok("merge takes max/union and is stable", () => {
  let { p: a } = day(P.emptyProgress(), "2026-10-01", 4); let { p: b } = day(P.emptyProgress(), "2026-10-01", 10);
  const m = P.mergeProgress(a, b);
  assert.equal(m.days["2026-10-01"].n, 10); assert.equal(m.days["2026-10-01"].f, true);
  assert.deepEqual(P.mergeProgress(m, a).days, m.days);
});
ok("normProgress cleans bad data", () => {
  const n = P.normProgress({ days: { "bad": { n: 1 }, "2026-10-01": { n: "3", f: 1 } }, goal: 7, fe: -2 });
  assert.deepEqual(Object.keys(n.days), ["2026-10-01"]); assert.equal(n.days["2026-10-01"].n, 3); assert.equal(n.goal, 10); assert.equal(n.fe, 0);
});
ok("badge ids, names and icons are unique, and every badge has a description", () => {
  for (const k of ["id", "icon", "name"]) assert.equal(new Set(P.BADGES.map(b => b[k])).size, P.BADGES.length, k);
  assert.ok(P.BADGES.every(b => b.desc && typeof b.test === "function"));
  assert.ok(P.BADGES.length >= 30);
});
ok("a new account has no badge; stats expose every number the badges use", () => {
  const st = P.stats(P.emptyProgress(), "2026-10-01", {});
  for (const k of ["reviews", "goalDays", "best", "items", "sentences", "maxBox", "activeDays", "bigDay", "saved", "xp", "level", "tags", "agent", "box5"]) assert.equal(typeof st[k], "number", k);
  assert.deepEqual(P.BADGES.filter(b => b.test(st)).map(b => b.id), []);
});
ok("library badges follow the card counts (items, sentences, tags, AI agent, box 5)", () => {
  const c = { items: 1000, sentences: 50, maxBox: 5, tags: 5, agent: 10, box5: 100 };
  const got = P.checkBadges(P.emptyProgress(), c, at("2026-10-01")).badges.map(b => b.id);
  for (const id of ["items10", "items50", "items100", "items500", "items1000", "sent10", "sent50", "tags5", "agent10", "box5", "box5x10", "box5x100"]) assert.ok(got.includes(id), id);
  assert.ok(!got.includes("rev50") && !got.includes("goal1"));
});
ok("one big day unlocks the daily-record badges", () => {
  let p = P.emptyProgress();
  for (let i = 0; i < 100; i++) ({ p } = P.recordReview(p, 2, { items: 500 }, at("2026-10-01")));
  for (const id of ["first", "goal1", "day50", "day100", "rev50"]) assert.ok(p.badges[id], id);
  assert.ok(!p.badges.rev200);
  const st = P.stats(p, "2026-10-01", { items: 500 });
  assert.equal(st.bigDay, 100); assert.equal(st.activeDays, 1); assert.equal(st.xp, P.totalXp(p));
});
ok("goal-day and saved-by-freeze badges count days", () => {
  let p = P.emptyProgress();
  for (let i = 1; i <= 7; i++) ({ p } = day(p, `2026-10-${String(i).padStart(2, "0")}`, 10));
  assert.ok(p.badges.goal7 && p.badges.streak7 && !p.badges.goal30);
  assert.equal(P.stats(p, "2026-10-07", ctx).saved, 0);
  p.days["2026-10-08"] = { n: 0, xp: 0, f: false, z: true };
  assert.equal(P.stats(p, "2026-10-08", ctx).saved, 1);
  assert.ok(P.checkBadges(p, ctx, at("2026-10-08")).badges.some(b => b.id === "saved"));
});
ok("level badges come from total xp", () => {
  const p = P.emptyProgress(); p.days["2026-10-01"] = { n: 1, xp: 30 * 16, f: false, z: false };
  const ids = P.checkBadges(p, {}, at("2026-10-01")).badges.map(b => b.id);
  assert.ok(ids.includes("lv5") && ids.includes("xp1000") === false && !ids.includes("lv10"));
});
console.log(`\n${t} tests passed`);
