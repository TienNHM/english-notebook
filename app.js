import * as cloud from "./cloud.js";
import * as P from "./progress.js";
import * as S from "./share.js";

const KEY = "english-notebook-v1";
const PROG_KEY = "english-notebook-progress";
const DAY = 86400000;
const INTERVALS = [0, 1, 3, 7, 14, 30]; // days per Leitner box (0..5)

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Item shape (same in localStorage and Firestore):
// id, type(word|phrase|sentence), text, meaning, example, note, original (source sentence in Vietnamese),
// sourceId (parent sentence id, for expressions taken from a sentence), source (manual|claude|...),
// tags[], box, due, created, reviews
function norm(d) {
  return {
    id: d.id || uid(), type: d.type || "word", text: String(d.text || ""), meaning: String(d.meaning || ""),
    example: d.example || "", note: d.note || "", original: d.original || "", sourceId: d.sourceId || "",
    source: d.source || "manual", tags: Array.isArray(d.tags) ? d.tags : [],
    box: +d.box || 0, due: +d.due || Date.now(), created: +d.created || Date.now(), reviews: +d.reviews || 0,
  };
}
function loadLocal() {
  try { return (JSON.parse(localStorage.getItem(KEY)) || []).map(norm); } catch { return []; }
}

function loadProgress() {
  try { return P.normProgress(JSON.parse(localStorage.getItem(PROG_KEY))); } catch { return P.emptyProgress(); }
}

let items = loadLocal();
let progress = loadProgress();
let user = null, unsub = null, unsubP = null;
const migrated = new Set(), migratedP = new Set();
let activeTag = "";
let queue = [], current = null, revealed = false, reviewTotal = 0, reviewDone = 0;

const isDue = it => it.due <= Date.now();

let toastTimer;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------- persistence (local or Firestore) ----------
function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { alert("Không lưu được dữ liệu (bộ nhớ đầy hoặc bị chặn)."); }
}
const syncErr = e => console.warn("Sync error", e);
function commit(changed = [], removedIds = []) {
  if (user) {
    changed.forEach(it => cloud.put(user.uid, it).catch(syncErr));
    removedIds.forEach(id => cloud.del(user.uid, id).catch(syncErr));
  } else saveLocal();
  renderAll();
}

// ---------- progress: streak, xp, badges ----------
const today = () => P.dayKey();
const ctxNow = () => ({
  items: items.length, sentences: items.filter(i => i.type === "sentence").length,
  maxBox: items.reduce((m, i) => Math.max(m, i.box), 0),
});
function saveProgress() {
  progress = P.prune(progress, today());
  try { localStorage.setItem(PROG_KEY, JSON.stringify(progress)); } catch {}
  if (user) cloud.putProgress(user.uid, progress).catch(syncErr);
  renderPills(); renderRewards();
}
// Spend freezes to bridge missed days (called at start-up, on return to the tab, after a sync).
// When sync is on, wait until the cloud progress has been merged, so a stale device never spends a freeze by mistake.
let progressReady = !cloud.enabled;
function settle() {
  if (!progressReady) return;
  const r = P.settleFreezes(progress, today());
  if (!r.used) return;
  progress = { ...r.p, updated: Date.now() };
  saveProgress();
  toast(`🧊 Đã dùng ${r.used} băng để giữ streak`);
}
function awardBadges(modal) {
  const r = P.checkBadges(progress, ctxNow());
  if (!r.badges.length) return;
  progress = r.p; saveProgress();
  if (modal) celebrate({ xp: 0, goalReached: false, badges: r.badges, levelUp: null, freeze: false, streak: 0 });
  else toast(`🏅 Huy hiệu mới: ${r.badges.map(b => b.name).join(", ")}`);
}
function renderPills() {
  const s = P.streakInfo(progress, today()), lv = P.levelInfo(P.totalXp(progress));
  $("#rewardPills").innerHTML =
    `<span class="pill streak${s.atRisk ? " risk" : ""}" title="${s.atRisk ? "Ôn đủ mục tiêu hôm nay để giữ streak" : "Streak hiện tại"}">🔥 ${s.current}</span> ` +
    `<span class="pill lvl" title="${esc(lv.title)}">⭐ Lv ${lv.level}</span>`;
}

// ---------- auth ----------
function renderAuth() {
  const el = $("#auth");
  if (!cloud.enabled) { el.innerHTML = `<span class="muted" title="Điền firebase-config.js để bật đăng nhập">Local</span>`; return; }
  el.innerHTML = user
    ? `<span class="muted">${esc(user.displayName || user.email || "")}</span> <button class="small" data-auth="out">Đăng xuất</button>`
    : `<button class="small" data-auth="google">Google</button> <button class="small" data-auth="facebook">Facebook</button>`;
}
$("#auth").onclick = async e => {
  const a = e.target.dataset.auth; if (!a) return;
  try { a === "out" ? await cloud.signOut() : await cloud.signIn(a); }
  catch (err) { if (err?.code !== "auth/popup-closed-by-user") alert("Đăng nhập lỗi: " + (err?.message || err)); }
};
function onUser(u) {
  if (unsub) { unsub(); unsub = null; }
  if (unsubP) { unsubP(); unsubP = null; }
  user = u; renderAuth();
  if (!u) {
    items = loadLocal(); progress = loadProgress(); progressReady = true;
    renderAll(); settle(); renderPills(); renderRewards(); return;
  }
  progressReady = false;
  cloud.watchProgress(u.uid, doc => {
    progressReady = true;
    progress = P.mergeProgress(P.normProgress(doc), progress); // never lose either side
    if (!migratedP.has(u.uid)) { // first sync on this device: upload local progress, but never an empty record
      migratedP.add(u.uid);
      if (Object.keys(progress.days).length || Object.keys(progress.badges).length) cloud.putProgress(u.uid, progress).catch(syncErr);
    }
    try { localStorage.setItem(PROG_KEY, JSON.stringify(progress)); } catch {}
    settle(); renderPills(); renderRewards();
  }, syncErr).then(f => { unsubP = f; }).catch(syncErr);
  cloud.watch(u.uid, docs => {
    const remote = docs.map(norm);
    if (!migrated.has(u.uid)) { // first login: upload local items that the cloud does not have yet
      migrated.add(u.uid);
      const have = new Set(remote.map(i => i.id));
      loadLocal().filter(i => !have.has(i.id)).forEach(i => cloud.put(u.uid, i).catch(syncErr));
    }
    items = remote.sort((a, b) => b.created - a.created);
    renderAll();
    if (progressReady) awardBadges(false);
    importInbox();
  }, syncErr).then(f => { unsub = f; }).catch(syncErr);
}
if (cloud.enabled) cloud.onUser(onUser).catch(e => { syncErr(e); progressReady = true; settle(); });

// ---------- inbox.json (filled by the MCP server, e.g. from Claude Code) ----------
const IMPORTED_KEY = "english-notebook-imported";
async function importInbox() {
  if (!location.protocol.startsWith("http") || (cloud.enabled && !user)) return;
  try {
    const res = await fetch("inbox.json", { cache: "no-store" });
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list)) return;
    let done; try { done = new Set(JSON.parse(localStorage.getItem(IMPORTED_KEY)) || []); } catch { done = new Set(); }
    const have = new Set(items.map(i => i.id));
    const fresh = list.filter(d => d && d.id && d.text && d.meaning && !done.has(d.id));
    const added = fresh.filter(d => !have.has(d.id)).map(norm);
    fresh.forEach(d => done.add(d.id));
    try { localStorage.setItem(IMPORTED_KEY, JSON.stringify([...done])); } catch {}
    if (added.length) { items.unshift(...added); commit(added); toast(`Đã nhập ${added.length} mục từ Claude ✓`); awardBadges(false); }
  } catch { /* no inbox, offline, or bad JSON: ignore */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  importInbox(); settle(); renderPills(); renderRewards();
});

// ---------- theme: system -> light -> dark ----------
const THEME_KEY = "english-notebook-theme";
const THEMES = { system: ["🖥", "Theo hệ thống"], light: ["☀️", "Sáng"], dark: ["🌙", "Tối"] };
function getTheme() {
  try { const t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; }
}
function applyTheme(t) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme; else root.dataset.theme = t;
  try { t === "system" ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, t); } catch {}
  const btn = $("#themeBtn");
  btn.textContent = THEMES[t][0];
  btn.title = btn.ariaLabel = `Giao diện: ${THEMES[t][1]}`;
}
$("#themeBtn").onclick = () => {
  const order = ["system", "light", "dark"], next = order[(order.indexOf(getTheme()) + 1) % 3];
  applyTheme(next); toast(`Giao diện: ${THEMES[next][1]}`);
};
applyTheme(getTheme());

// ---------- tabs ----------
function showTab(name) {
  $$("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + name));
  if (name === "review") startReview();
  if (name === "library") renderList();
  if (name === "rewards") renderRewards();
}
$$("nav button").forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ---------- speech ----------
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US"; u.rate = 0.9;
  speechSynthesis.speak(u);
}

// ---------- add / edit ----------
const form = $("#addForm");
const toggleSentence = () => {
  const v = $("#fType").value;
  $("#sentenceOnly").hidden = v !== "sentence";
  $$("#seg button").forEach(b => { b.classList.toggle("on", b.dataset.v === v); b.setAttribute("aria-pressed", b.dataset.v === v); });
};
$("#fType").onchange = toggleSentence;
$("#seg").onclick = e => {
  const v = e.target.closest("button")?.dataset.v; if (!v) return;
  $("#fType").value = v; toggleSentence();
};

// "find out = tìm ra" per line
const parseExpr = s => s.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
  const [a, ...b] = l.split("="); return { text: a.trim(), meaning: b.join("=").trim() };
}).filter(x => x.text && x.meaning);

form.onsubmit = e => {
  e.preventDefault();
  const id = $("#editId").value;
  const data = {
    type: $("#fType").value,
    text: $("#fText").value.trim(),
    meaning: $("#fMeaning").value.trim(),
    example: $("#fExample").value.trim(),
    note: $("#fNote").value.trim(),
    original: data_original(),
    tags: $("#fTags").value.split(",").map(t => t.trim().toLowerCase()).filter(Boolean),
  };
  if (!data.text || !data.meaning) return;
  const changed = [];
  let parent;
  if (id) {
    parent = items.find(i => i.id === id);
    Object.assign(parent, data);
    changed.push(parent);
  } else {
    if (items.some(i => i.text.toLowerCase() === data.text.toLowerCase()) &&
        !confirm("Mục này đã có rồi. Vẫn thêm?")) return;
    parent = norm({ ...data, due: Date.now(), created: Date.now() });
    items.unshift(parent);
    changed.push(parent);
  }
  if (data.type === "sentence") {
    for (const x of parseExpr($("#fExpr").value)) {
      const child = norm({ type: "phrase", text: x.text, meaning: x.meaning, sourceId: parent.id, tags: data.tags });
      items.unshift(child); changed.push(child);
    }
  }
  resetForm();
  commit(changed);
  toast(id ? "Đã cập nhật ✓" : changed.length > 1 ? `Đã lưu ${changed.length} thẻ ✓` : "Đã lưu ✓");
  awardBadges(true);
  $("#fText").focus();
};
const data_original = () => $("#fType").value === "sentence" ? $("#fOriginal").value.trim() : "";

function resetForm() {
  form.reset(); $("#editId").value = "";
  $("#saveBtn").textContent = "Lưu"; $("#cancelEdit").hidden = true;
  toggleSentence();
}
$("#cancelEdit").onclick = resetForm;

function editItem(id) {
  const it = items.find(i => i.id === id); if (!it) return;
  $("#editId").value = id;
  $("#fType").value = it.type; $("#fText").value = it.text; $("#fMeaning").value = it.meaning;
  $("#fExample").value = it.example; $("#fNote").value = it.note; $("#fTags").value = it.tags.join(", ");
  $("#fOriginal").value = it.original; $("#fExpr").value = "";
  toggleSentence();
  $("#saveBtn").textContent = "Cập nhật"; $("#cancelEdit").hidden = false;
  showTab("add"); $("#fText").focus();
}

// ---------- library ----------
function renderList() {
  const q = $("#q").value.trim().toLowerCase(), ft = $("#fltType").value;
  const tags = [...new Set(items.flatMap(i => i.tags))].sort();
  $("#tagBar").innerHTML = tags.map(t => `<button class="chip ${t === activeTag ? "on" : ""}" data-tag="${esc(t)}">#${esc(t)}</button>`).join("");
  const shown = items.filter(i =>
    (!ft || i.type === ft) && (!activeTag || i.tags.includes(activeTag)) &&
    (!q || [i.text, i.meaning, i.example, i.note, i.original].join(" ").toLowerCase().includes(q)));
  $("#list").innerHTML = shown.length ? shown.map(i => {
    const parent = i.sourceId && items.find(p => p.id === i.sourceId);
    const kids = items.filter(k => k.sourceId === i.id).length;
    return `
    <li class="item" data-id="${i.id}" data-type="${i.type}">
      <div class="en">${esc(i.text)}</div>
      <div class="vi">${esc(i.meaning)}</div>
      ${i.original ? `<div class="note">🇻🇳 Câu gốc: ${esc(i.original)}</div>` : ""}
      ${i.example ? `<div class="ex">${esc(i.example)}</div>` : ""}
      ${parent ? `<div class="ex">↳ trong câu: ${esc(parent.text)}</div>` : ""}
      ${i.note ? `<div class="note">📝 ${esc(i.note)}</div>` : ""}
      <div class="meta">
        <span class="chip t-${i.type}">${i.type}</span>
        <span class="chip">box ${i.box}</span>
        ${kids ? `<span class="chip kids">${kids} cụm</span>` : ""}
        ${i.source !== "manual" ? `<span class="chip src">${esc(i.source)}</span>` : ""}
        ${i.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join("")}
        <span class="actions">
          <button class="small" data-act="speak" title="Nghe">🔊</button>
          <button class="small" data-act="edit" title="Sửa">✏️</button>
          <button class="small" data-act="del" title="Xoá">🗑</button>
        </span>
      </div>
    </li>`;
  }).join("") : `<div class="empty">Chưa có mục nào.</div>`;
}
$("#q").oninput = renderList;
$("#fltType").onchange = renderList;
$("#tagBar").onclick = e => {
  const t = e.target.dataset.tag; if (t === undefined) return;
  activeTag = activeTag === t ? "" : t; renderList();
};
$("#list").onclick = e => {
  const act = e.target.dataset.act, li = e.target.closest(".item"); if (!act || !li) return;
  const it = items.find(i => i.id === li.dataset.id);
  if (act === "speak") speak(it.text);
  if (act === "edit") editItem(it.id);
  if (act === "del") {
    const kids = items.filter(k => k.sourceId === it.id);
    if (!confirm(`Xoá "${it.text}"${kids.length ? ` và ${kids.length} cụm liên quan` : ""}?`)) return;
    const ids = new Set([it.id, ...kids.map(k => k.id)]);
    items = items.filter(i => !ids.has(i.id));
    commit([], [...ids]);
  }
};

// ---------- review (Leitner) ----------
function startReview() {
  queue = items.filter(isDue).sort((a, b) => a.due - b.due);
  reviewTotal = queue.length; reviewDone = 0;
  next();
}
function next() {
  current = queue.shift() || null; revealed = false; renderReview();
}
// Nothing is due but the daily goal is not reached yet: practise cards that are not due, soonest first.
function startPractice() {
  const left = P.effectiveGoal(progress, items.length) - P.todayCount(progress, today());
  queue = items.filter(i => !isDue(i)).sort((a, b) => a.due - b.due).slice(0, Math.max(left, 1));
  reviewTotal = queue.length; reviewDone = 0;
  next();
}
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
function dotsHtml() {
  const t = today(), out = [];
  for (let i = 6; i >= 0; i--) {
    const k = P.addDays(t, -i), d = progress.days[k], [y, m, dd] = k.split("-").map(Number);
    const cls = d?.f ? "on" : d?.z ? "ice" : k === t ? "today" : "";
    out.push(`<span class="dot-wrap"><span class="dot ${cls}" title="${k}">${d?.f ? "✓" : d?.z ? "🧊" : ""}</span><small>${WEEKDAY[new Date(y, m - 1, dd).getDay()]}</small></span>`);
  }
  return `<div class="dots">${out.join("")}</div>`;
}
function dailyHtml() {
  const t = today(), s = P.streakInfo(progress, t), goal = P.effectiveGoal(progress, items.length);
  const n = P.todayCount(progress, t), met = !!progress.days[t]?.f, pct = Math.min(100, Math.round(n / goal * 100));
  return `<div class="daily">
    <div class="daily-top">
      <div class="streak-big">🔥 <b>${s.current}</b> ngày</div>
      <div class="muted-sm">🧊 ${P.freezesAvailable(progress)} băng</div>
    </div>
    ${s.atRisk ? `<div class="warn">Ôn đủ mục tiêu hôm nay để giữ streak!</div>` : ""}
    <div class="goalrow"><span>Mục tiêu hôm nay</span><b>${Math.min(n, goal)}/${goal}${met ? " ✅" : ""}</b></div>
    <div class="bar goal" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(n, goal)}"><i style="width:${pct}%"></i></div>
    ${dotsHtml()}
  </div>`;
}
function renderReview() {
  const box = $("#reviewBox");
  if (!current) {
    const left = P.effectiveGoal(progress, items.length) - P.todayCount(progress, today());
    const spare = items.filter(i => !isDue(i)).length;
    box.innerHTML = dailyHtml() + (!items.length
      ? `<div class="empty">Chưa có thẻ nào. Hãy thêm vài thẻ ở tab ➕ Thêm.</div>`
      : left > 0 && spare > 0
        ? `<div class="empty">Hết thẻ đến hạn, nhưng còn <b>${left}</b> thẻ nữa để đạt mục tiêu hôm nay.<br><br><button class="primary" id="practiceBtn">💪 Ôn thêm ${Math.min(left, spare)} thẻ</button></div>`
        : `<div class="empty">🎉 Không còn mục nào cần ôn hôm nay.<br>Tổng: ${items.length} mục.</div>`);
    const pb = $("#practiceBtn"); if (pb) pb.onclick = startPractice;
    return;
  }
  const c = current;
  const parent = c.sourceId && items.find(p => p.id === c.sourceId);
  box.innerHTML = dailyHtml() + `
    <div class="progress">Còn ${queue.length + 1} mục · box ${c.box}</div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${reviewTotal}" aria-valuenow="${reviewDone}"><i style="width:${reviewTotal ? Math.round(reviewDone / reviewTotal * 100) : 0}%"></i></div>
    <div class="card" data-type="${c.type}">
      <div class="big">${esc(c.text)}</div>
      <div><button class="small" id="rSpeak">🔊 Nghe</button></div>
      ${revealed ? `<div class="answer">
          <div class="big">${esc(c.meaning)}</div>
          ${c.original ? `<div class="note">🇻🇳 ${esc(c.original)}</div>` : ""}
          ${c.example ? `<div class="ex">${esc(c.example)}</div>` : ""}
          ${parent ? `<div class="ex">Trong câu: ${esc(parent.text)}</div>` : ""}
          ${c.note ? `<div class="note">📝 ${esc(c.note)}</div>` : ""}
        </div>` : `<div><button id="rShow" class="primary">Xem nghĩa</button></div>`}
    </div>
    ${revealed ? `<div class="grade">
      <button class="again" data-g="0">Quên</button>
      <button class="good" data-g="1">Nhớ</button>
      <button class="easy" data-g="2">Dễ</button></div>` : ""}`;
  $("#rSpeak").onclick = () => speak(c.text);
  const show = $("#rShow"); if (show) show.onclick = () => { revealed = true; renderReview(); };
  $$(".grade button").forEach(b => b.onclick = () => grade(+b.dataset.g));
}
function grade(g) {
  const c = current;
  c.box = g === 0 ? 0 : Math.min(5, c.box + g);
  c.due = g === 0 ? Date.now() + 10 * 60000 : Date.now() + INTERVALS[c.box] * DAY;
  c.reviews++;
  if (user) cloud.put(user.uid, c).catch(syncErr); else saveLocal();
  renderStats();
  if (g === 0) queue.push(c); // see it again in this session
  else reviewDone++;
  const r = P.recordReview(progress, g, ctxNow());
  progress = r.p; saveProgress();
  next();
  if (r.ev.goalReached || r.ev.badges.length || r.ev.levelUp) celebrate(r.ev);
  else toast(`+${r.ev.xp} XP`);
}

// ---------- rewards tab ----------
function renderRewards() {
  const box = $("#rewardsBox"); if (!box) return;
  const t = today(), s = P.streakInfo(progress, t), lv = P.levelInfo(P.totalXp(progress));
  const st = P.stats(progress, t, ctxNow());
  box.innerHTML = `
    <button class="primary" id="shareBtn" type="button">📣 Chia sẻ thành tích</button>
    <div class="daily level">
      <div class="daily-top"><div class="streak-big">⭐ Lv <b>${lv.level}</b> · ${esc(lv.title)}</div><div class="muted-sm">${lv.xp} XP</div></div>
      <div class="bar goal" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${lv.pct}"><i style="width:${lv.pct}%"></i></div>
      <div class="muted-sm">Còn ${lv.next - lv.xp} XP để lên cấp ${lv.level + 1}</div>
    </div>
    <div class="statgrid">
      <div class="stat"><b>🔥 ${s.current}</b><small>Streak hiện tại</small></div>
      <div class="stat"><b>🏅 ${s.best}</b><small>Streak dài nhất</small></div>
      <div class="stat"><b>🧊 ${P.freezesAvailable(progress)}/${P.MAX_FREEZES}</b><small>Băng cứu streak</small></div>
      <div class="stat"><b>✅ ${st.reviews}</b><small>Lần nhớ đúng</small></div>
    </div>
    <div class="daily">
      <label class="goalsel">Mục tiêu mỗi ngày (số thẻ)
        <select id="goalSel">${P.GOALS.map(g => `<option value="${g}"${g === progress.goal ? " selected" : ""}>${g} thẻ</option>`).join("")}</select>
      </label>
      <div class="muted-sm">Ôn đủ số thẻ này mỗi ngày để giữ streak. Nhớ/Dễ mới được tính; Quên thì không. Cứ ${P.FREEZE_EVERY} ngày streak được 1 băng 🧊 (tối đa ${P.MAX_FREEZES}) tự cứu streak khi bạn lỡ 1 ngày.</div>
      <div class="muted-sm">XP: Quên +1 · Nhớ +3 · Dễ +5 · đạt mục tiêu ngày +${P.GOAL_BONUS_XP}.</div>
    </div>
    <h3 class="sect">Huy hiệu (${Object.keys(progress.badges).length}/${P.BADGES.length})</h3>
    <div class="trophies">${P.BADGES.map(b => {
      const got = progress.badges[b.id];
      return `<div class="trophy${got ? " got" : ""}" title="${esc(b.desc)}">
        <span class="ico">${got ? b.icon : "🔒"}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`;
    }).join("")}</div>`;
}
$("#rewardsBox").onclick = e => { if (e.target.closest("#shareBtn")) openShare(); };
$("#rewardsBox").onchange = e => {
  if (e.target.id !== "goalSel") return;
  progress = { ...progress, goal: +e.target.value, updated: Date.now() };
  saveProgress(); toast(`Mục tiêu: ${progress.goal} thẻ/ngày`);
};

// ---------- celebration ----------
function celebrate(ev) {
  const lines = [];
  if (ev.xp) lines.push(`<div class="cel-line">+${ev.xp} XP</div>`);
  if (ev.goalReached) lines.push(`<div class="cel-line">🔥 Streak: <b>${ev.streak}</b> ngày</div>`);
  if (ev.freeze) lines.push(`<div class="cel-line">🧊 Bạn nhận 1 băng cứu streak!</div>`);
  if (ev.levelUp) lines.push(`<div class="cel-line">⭐ Lên <b>Lv ${ev.levelUp.level}</b> · ${esc(ev.levelUp.title)}</div>`);
  for (const b of ev.badges) lines.push(`<div class="cel-badge"><span class="ico">${b.icon}</span><span><b>${esc(b.name)}</b><br><small>${esc(b.desc)}</small></span></div>`);
  $("#celTitle").textContent = ev.goalReached ? "🎉 Hoàn thành mục tiêu hôm nay!" : ev.levelUp ? "⬆️ Lên cấp!" : "🏅 Huy hiệu mới!";
  $("#celBody").innerHTML = lines.join("");
  $("#celebrate").hidden = false; $("#celClose").focus();
  confetti();
}
$("#celClose").onclick = () => { $("#celebrate").hidden = true; };
$("#celShare").onclick = () => { $("#celebrate").hidden = true; openShare(); };
$("#celebrate").onclick = e => { if (e.target.id === "celebrate") $("#celebrate").hidden = true; };
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { $("#celebrate").hidden = true; $("#shareDlg").hidden = true; }
});

// ---------- share achievements ----------
function shareStats() {
  const t = today(), s = P.streakInfo(progress, t), lv = P.levelInfo(P.totalXp(progress)), st = P.stats(progress, t, ctxNow());
  return {
    streak: s.current, best: s.best, level: lv.level, xp: lv.xp, reviews: st.reviews, cards: items.length,
    badges: Object.keys(progress.badges).length, badgesTotal: P.BADGES.length,
    icons: P.BADGES.filter(b => progress.badges[b.id]).map(b => b.icon),
  };
}
function openShare() {
  const d = shareStats();
  $("#shareText").value = S.shareText(d);
  S.drawShareCard($("#shareCanvas"), d);
  $('#shareGrid [data-share="native"]').hidden = !navigator.share;
  $('#shareGrid [data-share="copyimg"]').hidden = !(window.ClipboardItem && navigator.clipboard?.write);
  $("#shareDlg").hidden = false; $("#shareClose").focus();
}
const shareBlob = () => new Promise(res => $("#shareCanvas").toBlob(res, "image/png"));
const shareFull = () => `${$("#shareText").value.trim()} ${S.SITE_URL}`;
$("#shareClose").onclick = () => { $("#shareDlg").hidden = true; };
$("#shareDlg").onclick = e => { if (e.target.id === "shareDlg") $("#shareDlg").hidden = true; };
$("#shareGrid").onclick = async e => {
  const kind = e.target.closest("[data-share]")?.dataset.share; if (!kind) return;
  const text = $("#shareText").value.trim();
  try {
    if (kind in S.shareLinks(text)) {
      window.open(S.shareLinks(text)[kind], "_blank", "noopener,noreferrer");
    } else if (kind === "copy") {
      await navigator.clipboard.writeText(shareFull()); toast("Đã chép nội dung ✓");
    } else if (kind === "copyimg") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": shareBlob() })]); toast("Đã chép ảnh ✓");
    } else if (kind === "download") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await shareBlob()); a.download = "english-notebook-achievement.png";
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast("Đã tải ảnh ✓");
    } else if (kind === "native") {
      const file = new File([await shareBlob()], "english-notebook.png", { type: "image/png" });
      const data = { title: "English Notebook", text: shareFull() };
      if (navigator.canShare?.({ files: [file] })) data.files = [file];
      await navigator.share(data);
    }
  } catch (err) {
    if (err?.name !== "AbortError") toast("Không thực hiện được. Hãy thử nút Tải ảnh.");
  }
};

function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("#confetti"), cx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ["#ffd93d", "#ff7eb6", "#6bc5ff", "#79e08a", "#b69cff", "#ff5c5c"];
  const ps = Array.from({ length: 140 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.4, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10,
    vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4, r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4,
    c: cols[(Math.random() * cols.length) | 0],
  }));
  let f = 0;
  (function tick() {
    cx.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r);
      cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cx.strokeStyle = "#111"; cx.lineWidth = 1.5; cx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cx.restore();
    }
    if (++f < 160) requestAnimationFrame(tick); else cx.clearRect(0, 0, cv.width, cv.height);
  })();
}

// ---------- stats ----------
function renderStats() {
  const due = items.filter(isDue).length;
  $("#stats").textContent = `${items.length} mục · ${due} cần ôn`;
  $("#dueBadge").textContent = due || "";
}
function renderAll() { renderStats(); renderList(); }

// ---------- export / import ----------
$("#exportBtn").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(items, null, 2)], { type: "application/json" }));
  a.download = `english-notebook-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
};
$("#importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data)) throw 0;
    const have = new Set(items.map(i => i.id));
    const added = data.filter(d => d && d.text && d.meaning && !have.has(d.id)).map(norm);
    items.push(...added);
    commit(added);
    alert(`Đã nhập ${added.length} mục.`);
    awardBadges(true);
  } catch { alert("File JSON không hợp lệ."); }
  e.target.value = "";
};

// ---------- PWA ----------
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
renderAuth();
toggleSentence();
renderAll();
settle();
renderPills();
renderRewards();
importInbox();
