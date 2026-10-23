// Streak, XP, level and badge logic. Pure functions: no DOM, no storage (app.js does that).
//
// progress = {
//   days:   { "YYYY-MM-DD": { n: cards recalled, xp: xp earned, f: goal met, z: day saved by a freeze } },
//   badges: { id: unlockedAtMs },
//   fe:     freezes earned so far (available = fe - number of days with z),
//   goal:   daily goal (cards),
//   updated: ms
// }
// Every field merges safely across devices (max / union), see mergeProgress().

export const GOALS = [5, 10, 15, 20, 30];
export const GOAL_BONUS_XP = 20;
export const GRADE_XP = [1, 3, 5]; // Quên, Nhớ, Dễ
export const MAX_FREEZES = 2;
export const FREEZE_EVERY = 7; // earn one freeze each time the streak reaches a multiple of 7

export const BADGES = [
  { id: "first",    icon: "🌱", name: "Khởi đầu",       desc: "Ôn thẻ đầu tiên",                  test: s => s.reviews >= 1 },
  { id: "goal1",    icon: "🎯", name: "Đúng mục tiêu",  desc: "Đạt mục tiêu ngày lần đầu",        test: s => s.goalDays >= 1 },
  { id: "streak3",  icon: "🔥", name: "Nóng máy",       desc: "Streak 3 ngày",                    test: s => s.best >= 3 },
  { id: "streak7",  icon: "⚡", name: "Một tuần",       desc: "Streak 7 ngày",                    test: s => s.best >= 7 },
  { id: "streak14", icon: "🚀", name: "Hai tuần",       desc: "Streak 14 ngày",                   test: s => s.best >= 14 },
  { id: "streak30", icon: "👑", name: "Một tháng",      desc: "Streak 30 ngày",                   test: s => s.best >= 30 },
  { id: "streak100", icon: "💎", name: "Kim cương",     desc: "Streak 100 ngày",                  test: s => s.best >= 100 },
  { id: "rev50",    icon: "📖", name: "50 lần ôn",      desc: "Nhớ lại đúng 50 lần",              test: s => s.reviews >= 50 },
  { id: "rev200",   icon: "📘", name: "200 lần ôn",     desc: "Nhớ lại đúng 200 lần",             test: s => s.reviews >= 200 },
  { id: "rev1000",  icon: "🎓", name: "1000 lần ôn",    desc: "Nhớ lại đúng 1000 lần",            test: s => s.reviews >= 1000 },
  { id: "items10",  icon: "📚", name: "10 thẻ",         desc: "Có 10 thẻ trong thư viện",         test: s => s.items >= 10 },
  { id: "items50",  icon: "🗂️", name: "50 thẻ",         desc: "Có 50 thẻ trong thư viện",         test: s => s.items >= 50 },
  { id: "items100", icon: "🏛️", name: "100 thẻ",        desc: "Có 100 thẻ trong thư viện",        test: s => s.items >= 100 },
  { id: "sent10",   icon: "💬", name: "Người kể chuyện", desc: "Lưu 10 câu",                      test: s => s.sentences >= 10 },
  { id: "box5",     icon: "🏆", name: "Thuộc lòng",     desc: "Có một thẻ lên box 5",             test: s => s.maxBox >= 5 },
];

const TITLES = ["Người mới", "Học viên", "Chăm chỉ", "Thành thạo", "Cao thủ", "Bậc thầy", "Huyền thoại"];

export const emptyProgress = () => ({ days: {}, badges: {}, fe: 0, goal: 10, updated: 0 });

export function normProgress(p) {
  const e = emptyProgress();
  if (!p || typeof p !== "object") return e;
  const days = {};
  for (const [k, v] of Object.entries(p.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v) continue;
    days[k] = { n: +v.n || 0, xp: +v.xp || 0, f: !!v.f, z: !!v.z };
  }
  const badges = {};
  for (const [k, v] of Object.entries(p.badges || {})) badges[k] = +v || 0;
  return { days, badges, fe: Math.max(0, +p.fe || 0), goal: GOALS.includes(+p.goal) ? +p.goal : e.goal, updated: +p.updated || 0 };
}

// ---------- dates (local time) ----------
const pad = n => String(n).padStart(2, "0");
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}
const daysBetween = (a, b) => { // whole days from key a to key b
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

// ---------- streak ----------
const done = (p, k) => !!(p.days[k] && (p.days[k].f || p.days[k].z));

export function streakInfo(p, today) {
  const todayDone = done(p, today);
  let cur = 0, k = todayDone ? today : addDays(today, -1);
  while (done(p, k)) { cur++; k = addDays(k, -1); }
  // best run over all stored days
  const keys = Object.keys(p.days).filter(x => done(p, x)).sort();
  let best = 0, run = 0, prev = null;
  for (const x of keys) {
    run = prev && daysBetween(prev, x) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = x;
  }
  return { current: cur, best: Math.max(best, cur), todayDone, atRisk: cur > 0 && !todayDone };
}

export const freezesAvailable = p => Math.max(0, p.fe - Object.values(p.days).filter(d => d.z).length);

// If days were missed since the last finished day, spend freezes to bridge them (only when there are enough).
export function settleFreezes(p, today) {
  const last = Object.keys(p.days).filter(k => done(p, k) && k < today).sort().pop();
  if (!last) return { p, used: 0 };
  const missed = [];
  for (let k = addDays(last, 1); k < today; k = addDays(k, 1)) if (!done(p, k)) missed.push(k);
  if (!missed.length || missed.length > freezesAvailable(p)) return { p, used: 0 };
  const q = structuredClone(p);
  for (const k of missed) q.days[k] = { ...(q.days[k] || { n: 0, xp: 0, f: false }), z: true };
  return { p: q, used: missed.length };
}

// ---------- xp / level ----------
export const totalXp = p => Object.values(p.days).reduce((s, d) => s + d.xp, 0);
export function levelInfo(xp) {
  const level = Math.floor(Math.sqrt(xp / 30)) + 1;
  const base = 30 * (level - 1) ** 2, next = 30 * level ** 2;
  return { level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], xp, base, next, pct: Math.round((xp - base) / (next - base) * 100) };
}

export function stats(p, today, ctx) {
  const s = streakInfo(p, today);
  const vals = Object.values(p.days);
  return {
    reviews: vals.reduce((a, d) => a + d.n, 0), goalDays: vals.filter(d => d.f).length,
    best: s.best, items: ctx.items || 0, sentences: ctx.sentences || 0, maxBox: ctx.maxBox || 0,
  };
}

export const effectiveGoal = (p, itemCount) => Math.max(1, Math.min(p.goal, itemCount));
export const todayCount = (p, today) => (p.days[today]?.n || 0);

// ---------- recording one review ----------
// grade: 0 Quên, 1 Nhớ, 2 Dễ. ctx: { items, sentences, maxBox }.
// Returns { p, ev } where ev = { xp, goalReached, streak, freeze, levelUp, badges[] }.
export function recordReview(p0, grade, ctx, now = new Date()) {
  const p = structuredClone(p0), today = dayKey(now);
  const d = p.days[today] ||= { n: 0, xp: 0, f: false, z: false };
  const xpBefore = totalXp(p);
  const ev = { xp: GRADE_XP[grade] ?? 0, goalReached: false, streak: 0, freeze: false, levelUp: null, badges: [] };
  d.xp += ev.xp;
  if (grade > 0) d.n++; // only a successful recall counts toward the goal
  if (!d.f && d.n >= effectiveGoal(p, ctx.items || 0)) {
    d.f = true; d.xp += GOAL_BONUS_XP; ev.xp += GOAL_BONUS_XP; ev.goalReached = true;
    const s = streakInfo(p, today);
    ev.streak = s.current;
    if (s.current % FREEZE_EVERY === 0 && freezesAvailable(p) < MAX_FREEZES) { p.fe++; ev.freeze = true; }
  }
  const st = stats(p, today, ctx);
  for (const b of BADGES) if (!p.badges[b.id] && b.test(st)) { p.badges[b.id] = now.getTime(); ev.badges.push(b); }
  const before = levelInfo(xpBefore).level, after = levelInfo(totalXp(p)).level;
  if (after > before) ev.levelUp = levelInfo(totalXp(p));
  p.updated = now.getTime();
  return { p, ev };
}

// Badges can also be earned without a review (e.g. adding cards). Returns { p, badges[] }.
export function checkBadges(p0, ctx, now = new Date()) {
  const p = structuredClone(p0), st = stats(p, dayKey(now), ctx), fresh = [];
  for (const b of BADGES) if (!p.badges[b.id] && b.test(st)) { p.badges[b.id] = now.getTime(); fresh.push(b); }
  if (fresh.length) p.updated = now.getTime();
  return { p, badges: fresh };
}

// ---------- merge (several devices) ----------
export function mergeProgress(a, b) {
  const out = emptyProgress();
  for (const k of new Set([...Object.keys(a.days), ...Object.keys(b.days)])) {
    const x = a.days[k] || {}, y = b.days[k] || {};
    out.days[k] = { n: Math.max(x.n || 0, y.n || 0), xp: Math.max(x.xp || 0, y.xp || 0), f: !!(x.f || y.f), z: !!(x.z || y.z) };
  }
  for (const k of new Set([...Object.keys(a.badges), ...Object.keys(b.badges)])) {
    const t = [a.badges[k], b.badges[k]].filter(Boolean);
    out.badges[k] = Math.min(...t);
  }
  out.fe = Math.max(a.fe, b.fe);
  out.goal = (a.updated >= b.updated ? a : b).goal;
  out.updated = Math.max(a.updated, b.updated);
  return out;
}

// Keep the document small: drop day records older than a year (badges and best streak stay).
export function prune(p, today) {
  const cut = addDays(today, -400), q = structuredClone(p);
  for (const k of Object.keys(q.days)) if (k < cut) delete q.days[k];
  return q;
}
