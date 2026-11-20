import * as cloud from "./cloud.js";
import * as P from "./progress.js";
import * as S from "./share.js";
import { initVault } from "./vault-ui.js";
import { initAgent } from "./agent-ui.js";
import { ORDERS, orderQueue, normOrder } from "./review-order.js";
import { PAGE_SIZE, buildIndex, nextShown, pageInfo } from "./paging.js";
import { applyView, normView, countsByScope, highlightParts, normSavedViews, addSavedView, removeSavedView, SAVED_VIEWS_KEY } from "./library-view.js";
import { addTag, removeTag, setStatus, removeIds, renameTag, findDuplicates, tagStats, normTag, leeches } from "./bulk.js";
import { keep as keepCard, drop as dropCard, overview as libOverview, counts as statusCounts, isActive } from "./inbox.js";
import { practiceSet, levelSegments, badgeCounts, LEECH_THRESHOLD, PRACTICE_CAP, LEVEL_LABEL } from "./study.js";
import { mergeDuplicateGroup, undoCards, restoreCards, reviveCards } from "./cleanup.js";
import { toCsv, toAnkiTsv, BOM, parseCsv, parseLines, prepareImport, MAX_IMPORT } from "./export-import.js";
import { resolveKey, isTypingTarget, SHORTCUT_HELP } from "./shortcuts.js";
import { VERSION, REPO_URL, INSTALL_URL, checkForUpdate } from "./version.js";
import { readMirror, writeMirror, clearMirror, newPending, addPending, takePending } from "./mirror.js";
import { readSync, writeSync, clearSync, planSync, nextMarker, mergeDelta } from "./delta.js";
import { describeSyncError } from "./sync-status.js";

const KEY = "english-notebook-v1";
const PROG_KEY = "english-notebook-progress";
const DAY = 86400000;
const INTERVALS = [0, 1, 3, 7, 14, 30]; // days per Leitner box (0..5)

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// Motion: "on" / "off" forced by the user (Thưởng tab), otherwise follow the system "reduce motion" setting.
const MOTION_KEY = "english-notebook-motion";
const getMotion = () => { try { const m = localStorage.getItem(MOTION_KEY); return m === "on" || m === "off" ? m : "system"; } catch { return "system"; } };
const systemReducesMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const reduced = () => { const m = getMotion(); return m === "off" || (m === "system" && systemReducesMotion()); };
function applyMotion(m) {
  const root = document.documentElement;
  if (m === "system") delete root.dataset.motion; else root.dataset.motion = m;
  try { m === "system" ? localStorage.removeItem(MOTION_KEY) : localStorage.setItem(MOTION_KEY, m); } catch {}
}

// Numbers that count up (streak, XP...). Only animates when the value changed since it was last shown.
const shownCounts = {};
function runCounts(root) {
  for (const el of root.querySelectorAll("[data-count]")) {
    const to = +el.dataset.count, key = el.dataset.k || "", from = shownCounts[key] ?? 0;
    shownCounts[key] = to;
    if (from === to || reduced()) { el.textContent = to; continue; }
    const t0 = performance.now(), dur = 650;
    (function step(now) {
      const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3;
      el.textContent = Math.round(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
}
// "+3 XP" that floats up from the review card.
function floatText(msg) {
  if (reduced()) { toast(msg); return; }
  const r = ($(".card") || $("#reviewBox")).getBoundingClientRect(), el = document.createElement("div");
  el.className = "xpfloat"; el.textContent = msg;
  el.style.left = `${r.left + r.width / 2}px`; el.style.top = `${Math.max(70, r.top + 20)}px`;
  document.body.appendChild(el); setTimeout(() => el.remove(), 1100);
}
function flashForm() {
  const f = $("#addForm"); f.classList.remove("saved"); void f.offsetWidth; f.classList.add("saved");
}

// Item shape (same in localStorage and Firestore):
// id, type(word|phrase|sentence), text, meaning, example, note, original (source sentence in Vietnamese),
// sourceId (parent sentence id, for expressions taken from a sentence), source (manual|claude|...),
// tags[], box, due, created, reviews, and the optional status ("inbox" | "archived"; absent = active) and lapses (times answered "Quên")
function norm(d) {
  const c = {
    id: d.id || uid(), type: ["word", "phrase", "sentence"].includes(d.type) ? d.type : "word", text: String(d.text || ""), meaning: String(d.meaning || ""),
    example: d.example || "", note: d.note || "", original: d.original || "", sourceId: d.sourceId || "",
    source: d.source || "manual", tags: Array.isArray(d.tags) ? d.tags : [],
    box: +d.box || 0, due: +d.due || Date.now(), created: +d.created || Date.now(), reviews: +d.reviews || 0,
  };
  if (d.status === "inbox" || d.status === "archived") c.status = d.status; // active cards carry no status field
  const lapses = Math.floor(+d.lapses);
  if (lapses > 0) c.lapses = lapses;
  return c;
}
function loadLocal() {
  try { return (JSON.parse(localStorage.getItem(KEY)) || []).map(norm); } catch { return []; }
}

function loadProgress() {
  try { return P.normProgress(JSON.parse(localStorage.getItem(PROG_KEY))); } catch { return P.emptyProgress(); }
}

// Signed-in users: draw the mirror of their cloud cards at once (the cloud answers later and replaces it).
// mirrorUid is set while that mirror is shown but the login is not confirmed yet.
const mirror = cloud.enabled ? readMirror(localStorage) : null;
let mirrorUid = mirror ? mirror.uid : null;
const pending = newPending(); // edits made in that short window; sent as soon as the user is known
let items = mirror ? mirror.items.map(norm).sort((a, b) => b.created - a.created) : loadLocal();
let progress = loadProgress();
let user = null, unsub = null, unsubP = null, unsubD = null;
let authKnown = !cloud.enabled; // false until Firebase has told us whether someone is signed in
let vaultUi = null;             // the share / import screens (set up at the bottom of this file)
let agentUi = null;             // the "connect an AI agent" screen
const migrated = new Set(), migratedP = new Set();
let queue = [], current = null, revealed = false, reviewTotal = 0, reviewDone = 0;
let listAnim = true, cardFx = "slide"; // one-shot flags for the animations
const justAdded = new Set();

// isActive (from inbox.js): inbox / archived cards are hidden from review and from the due count
const isDue = it => isActive(it) && it.due <= Date.now();
const activeCount = () => { let n = 0; for (const i of items) if (isActive(i)) n++; return n; };

let toastTimer;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------- persistence (local or Firestore) ----------
function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { alert("Không lưu được dữ liệu (bộ nhớ đầy hoặc bị chặn)."); }
}
const syncErr = e => { console.warn("Sync error", e); showSync(e); };
// Banner under the header when the cloud refuses us (quota, permission, login). Offline and retries stay silent.
function showSync(e) {
  const msg = describeSyncError(e);
  if (!msg) return;
  $("#syncMsg").textContent = msg; $("#syncBar").hidden = false;
}
function hideSync() { $("#syncBar").hidden = true; }
$("#syncClose").onclick = hideSync;
function commit(changed = [], removedIds = []) {
  if (user) {
    changed.forEach(it => cloud.put(user.uid, it).catch(syncErr));
    removedIds.forEach(id => cloud.del(user.uid, id).catch(syncErr));
  } else if (mirrorUid) { addPending(pending, changed, removedIds); writeMirror(localStorage, mirrorUid, items); }
  else saveLocal();
  renderAll();
}
let mirrorTimer;
function saveMirrorSoon(uidNow) { // after each cloud snapshot; waits a moment so a burst of snapshots writes once
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => { if (user && user.uid === uidNow) writeMirror(localStorage, uidNow, items); }, 400);
}

// ---------- progress: streak, xp, badges ----------
const today = () => P.dayKey();
// Badge counts use active cards only (inbox / archived cards do not count). Earned badges are never taken back (see P.checkBadges).
const ctxNow = () => badgeCounts(items);
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
    `<span class="pill streak${s.atRisk ? " risk" : ""}" title="${s.atRisk ? "Ôn đủ mục tiêu hôm nay để giữ streak" : "Streak hiện tại"}"><span class="flame">🔥</span> ${s.current}</span> ` +
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
  if (unsubD) { unsubD(); unsubD = null; }
  user = u; authKnown = true; renderAuth(); vaultUi?.onUser(); agentUi?.onUser();
  if (!u) {
    clearMirror(localStorage); clearSync(localStorage); mirrorUid = null; takePending(pending); // signed out: do not keep the cards on this device
    items = loadLocal(); progress = loadProgress(); progressReady = true;
    renderAll(); settle(); renderPills(); renderRewards(); return;
  }
  if (mirrorUid && mirrorUid !== u.uid) { items = loadLocal(); takePending(pending); renderAll(); } // mirror belonged to someone else
  else if (mirrorUid) { // same user: send the edits made while waiting
    const p = takePending(pending);
    p.put.forEach(it => cloud.put(u.uid, it).catch(syncErr));
    p.del.forEach(id => cloud.del(u.uid, id).catch(syncErr));
  }
  const hadMirror = !!mirrorUid && items.length > 0;
  mirrorUid = null;
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
  }, syncErr).then(f => { unsubP = f; }).catch(syncErr);   // (progress listener; its callback is cb, then onError)
  // One full read now and then; in between, only the cards that changed since the last sync (see delta.js).
  const startedAt = Date.now(), plan = planSync(readSync(localStorage), u.uid, startedAt, hadMirror);
  cloud.watch(u.uid, (docs, info) => {
    const next = info.delta ? mergeDelta(items, docs.map(norm), info.removed) : docs.map(norm);
    if (!migrated.has(u.uid)) { // first login: upload local items that the cloud does not have yet
      migrated.add(u.uid);
      const have = new Set(next.map(i => i.id));
      const ups = loadLocal().filter(i => !have.has(i.id)).map(i => cloud.put(u.uid, i));
      // Once every card is safely in the cloud, drop the local copy. Otherwise a stale copy would upload again on every start
      // and bring back cards that were deleted or merged since. If an upload fails the copy stays and is retried next time.
      Promise.all(ups).then(() => { try { localStorage.removeItem(KEY); } catch {} }).catch(syncErr);
    }
    writeSync(localStorage, nextMarker(readSync(localStorage), { uid: u.uid, mode: plan.mode, startedAt, maxUpdated: info.maxUpdated }));
    items = next.sort((a, b) => b.created - a.created);
    saveMirrorSoon(u.uid);
    hideSync();        // the cloud answered, so any earlier error is over
    renderAllSoon();   // snapshots can arrive twice in a row (cache, then server): draw once
    if (progressReady) awardBadges(false);
    // opened straight on the Review tab (shortcut) before the cards arrived: start it now
    if ($("#tab-review").classList.contains("active") && !current && reviewTotal === 0) startReview();
    importInbox();
  }, plan.since, syncErr).then(f => { unsub = f; }).catch(syncErr);
  if (plan.mode === "delta") { // learn about cards deleted on other devices (their markers carry `updated`)
    cloud.watchDeleted(u.uid, plan.since, ids => {
      if (!ids.length) return;
      const gone = new Set(ids);
      if (!items.some(i => gone.has(i.id))) return;
      items = items.filter(i => !gone.has(i.id));
      saveMirrorSoon(u.uid); renderAllSoon();
    }, syncErr).then(f => { unsubD = f; }).catch(syncErr);
  }
}
if (cloud.enabled) cloud.onUser(onUser).catch(e => { syncErr(e); authKnown = true; progressReady = true; settle(); vaultUi?.onUser(); });

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

// ---------- look: colour MODE (system / light / dark) and visual STYLE (neo / solid / glass / gradient) ----------
// The two are independent. The page sets data-scheme ("light" | "dark") and data-style on <html>; style.css does the rest.
const THEME_KEY = "english-notebook-theme";
const THEMES = { system: ["🖥", "Theo hệ thống"], light: ["☀️", "Sáng"], dark: ["🌙", "Tối"] };
const STYLE_KEY = "english-notebook-style";
const STYLES = {
  neo: ["🧱", "Neo-brutalism", "Viền dày, bóng cứng, tông ấm"],
  solid: ["⬜", "Solid", "Phẳng, tinh gọn, xanh ngọc và vàng"],
  glass: ["🪟", "Glass", "Kính mờ, nền ngả sắc dịu"],
  gradient: ["✨", "Gradient", "Chuyển sắc cùng tông, bo tròn"],
};
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function getTheme() {
  try { const t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; }
}
function getStyle() {
  try { const s = localStorage.getItem(STYLE_KEY); return Object.hasOwn(STYLES, s) ? s : "neo"; } catch { return "neo"; }
}
// Short cross-fade of colours when the look changes (class removed again by a timer).
function fadeColors() {
  const root = document.documentElement; root.classList.add("theming"); setTimeout(() => root.classList.remove("theming"), 500);
}
// The browser bar / status bar colour follows the current style and mode (each style defines --tc).
function syncThemeColor() {
  const tc = getComputedStyle(document.documentElement).getPropertyValue("--tc").trim();
  if (tc) $$('meta[name="theme-color"]').forEach(m => { m.content = tc; });
}
function resolveScheme() {
  const t = getTheme();
  document.documentElement.dataset.scheme = t === "system" ? (darkQuery.matches ? "dark" : "light") : t;
  syncThemeColor();
}
function applyTheme(t) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme; else root.dataset.theme = t;
  try { t === "system" ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, t); } catch {}
  resolveScheme();
}
function applyStyle(s) {
  document.documentElement.dataset.style = s;
  try { s === "neo" ? localStorage.removeItem(STYLE_KEY) : localStorage.setItem(STYLE_KEY, s); } catch {}
  syncThemeColor();
}
function chooseStyle(s) {
  fadeColors(); applyStyle(s); renderProfile(); toast(`${STYLES[s][0]} Phong cách: ${STYLES[s][1]}`);
}
darkQuery.addEventListener("change", () => { if (getTheme() === "system") resolveScheme(); });
applyTheme(getTheme());
applyStyle(getStyle());

// ---------- tabs ----------
function showTab(name, keepSession) { // keepSession: the caller starts its own review session (practice, hard cards)
  $$("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + name));
  if (name === "review" && !keepSession) startReview();
  if (name === "library") { listAnim = true; resetPaging(); renderList(); }
  else renderSelBar();   // the bulk action bar belongs to the Library only
  if (name === "profile") renderProfile();
  if (name === "rewards") {
    for (const k of Object.keys(shownCounts)) delete shownCounts[k]; // count up again when the tab is opened
    renderRewards();
  }
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
  changed.forEach(c => justAdded.add(c.id)); // flash them when the Library is opened
  flashForm();
  awardBadges(true);
  $("#fText").focus();
};
const data_original = () => $("#fType").value === "sentence" ? $("#fOriginal").value.trim() : "";

function resetForm() {
  form.reset(); $("#editId").value = "";
  $("#saveBtn").textContent = "Lưu"; $("#cancelEdit").hidden = true;
  toggleSentence();
}
$("#cancelEdit").onclick = () => { resetForm(); openAdd(false); };

// The add form lives in the Library, behind a button, so a long list never pushes it out of reach.
function openAdd(open) {
  $("#addPanel").hidden = !open;
  const t = $("#addToggle"); t.setAttribute("aria-expanded", String(open));
  t.textContent = open ? "▲ Ẩn form thêm" : "➕ Thêm từ / câu mới";
  if (open) { $("#addPanel").scrollIntoView({ block: "nearest" }); $("#fText").focus(); }
}
$("#addToggle").onclick = () => openAdd($("#addPanel").hidden);

function editItem(id) {
  const it = items.find(i => i.id === id); if (!it) return;
  $("#editId").value = id;
  $("#fType").value = it.type; $("#fText").value = it.text; $("#fMeaning").value = it.meaning;
  $("#fExample").value = it.example; $("#fNote").value = it.note; $("#fTags").value = it.tags.join(", ");
  $("#fOriginal").value = it.original; $("#fExpr").value = "";
  toggleSentence();
  $("#saveBtn").textContent = "Cập nhật"; $("#cancelEdit").hidden = false;
  showTab("library"); openAdd(true);
}

// ---------- library ----------
// The list is drawn one page at a time (PAGE_SIZE cards). The next page is added when the reader scrolls near the end
// (IntersectionObserver) or presses "Tải thêm". Drawing 1,000+ cards at once froze the app.
// What the list shows is one "view" object (see library-view.js): scope, type, tag, query, level, source, sort.
let view = normView({});
let shownCount = PAGE_SIZE;         // how many cards the reader has asked for (kept across data updates)
let shownList = [], renderedCount = 0, listIndex = buildIndex([]), listDirty = false, lastTagHtml = "";
let leechOnly = false;              // "Thẻ khó" chip: only cards forgotten 4+ times (not part of the saved view object)
let selecting = false;              // selection mode (checkboxes + bottom action bar)
const selected = new Set();         // ids of the selected cards (cleared whenever the view changes)
const resetPaging = () => { shownCount = PAGE_SIZE; };
const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

// Escape every part of a text, wrapping the parts that match the search words in <mark>.
const hl = text => view.query ? highlightParts(text, view.query).map(p => p.hit ? `<mark>${esc(p.t)}</mark>` : esc(p.t)).join("") : esc(text);

// Buttons on a card. Mới: keep or drop (drop = archive, so nothing is lost); Lưu trữ: restore; Thư viện: delete.
function actionsHtml(i) {
  const t = esc(i.text), sp = `<button class="small" data-act="speak" title="Nghe" aria-label="Nghe">🔊</button>`;
  const ed = `<button class="small" data-act="edit" title="Sửa" aria-label="Sửa">✏️</button>`;
  if (view.scope === "inbox") return `<button class="small primary" data-act="keep" aria-label="Giữ thẻ: ${t}">✓ Giữ</button><button class="small" data-act="drop" aria-label="Bỏ thẻ: ${t}">✕ Bỏ</button>${sp}${ed}`;
  if (view.scope === "archived") return `<button class="small primary" data-act="restore" aria-label="Khôi phục thẻ: ${t}">↩ Khôi phục</button>${sp}${ed}<button class="small" data-act="del" title="Xoá" aria-label="Xoá">🗑</button>`;
  return `${sp}${ed}<button class="small" data-act="del" title="Xoá" aria-label="Xoá">🗑</button>`;
}
function itemHtml(i, idx, fresh, more) {
  const parent = i.sourceId && listIndex.byId.get(i.sourceId), kids = listIndex.kids.get(i.id) || 0;
  const on = selected.has(i.id);
  return `
    <li class="item${fresh.has(i.id) ? " new" : ""}${more ? " more" : ""}${on ? " sel" : ""}" data-id="${esc(i.id)}" data-type="${i.type}" style="--i:${Math.min(idx, 10)}">
      ${selecting ? `<input type="checkbox" class="selcb" data-sel aria-label="Chọn: ${esc(i.text)}"${on ? " checked" : ""}>` : ""}
      <div class="en">${hl(i.text)}</div>
      <div class="vi">${hl(i.meaning)}</div>
      ${i.original ? `<div class="note">🇻🇳 Câu gốc: ${hl(i.original)}</div>` : ""}
      ${i.example ? `<div class="ex">${hl(i.example)}</div>` : ""}
      ${parent ? `<div class="ex">↳ trong câu: ${esc(parent.text)}</div>` : ""}
      ${i.note ? `<div class="note">📝 ${hl(i.note)}</div>` : ""}
      <div class="meta">
        <span class="chip t-${i.type}">${i.type}</span>
        <span class="chip">box ${i.box}</span>
        ${kids ? `<span class="chip kids">${kids} cụm</span>` : ""}
        ${i.source !== "manual" ? `<span class="chip src">${esc(i.source)}</span>` : ""}
        ${i.lapses ? `<span class="chip lapse" title="Số lần trả lời Quên">quên ${i.lapses} lần</span>` : ""}
        ${i.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join("")}
        <span class="actions">${actionsHtml(i)}</span>
      </div>
    </li>`;
}
// Controls follow the view object (after a saved view is applied, or a selection is dropped).
function syncControls() {
  $("#q").value = view.query; $("#fltType").value = view.type; $("#fltLevel").value = view.level;
  $("#fltSource").value = view.source; $("#fltSort").value = view.sort;
  syncTagSelect(true);
  $$("#scopeTabs [data-scope]").forEach(b => { const on = b.dataset.scope === view.scope; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
}
// The tag drop-down lists every tag on any card; rebuilt only when the set of tags changes.
function syncTagSelect(force) {
  const tags = [...new Set(items.flatMap(i => i.tags))].sort();
  if (view.tag && !tags.includes(view.tag)) tags.push(view.tag);
  const html = `<option value="">Tất cả</option>` + tags.map(t => `<option value="${esc(t)}">#${esc(t)}</option>`).join("");
  if (html !== lastTagHtml || force) { $("#fltTag").innerHTML = html; lastTagHtml = html; }
  $("#fltTag").value = view.tag;
}
function renderScopeTabs() {
  const n = countsByScope(items);
  $("#scopeInbox").textContent = `Mới (${n.inbox})`;
}
// Small badge with the number of new (inbox) cards on the Thư viện tab. Runs on every data change, whatever tab is open.
function renderInboxBadge() {
  const n = statusCounts(items).inbox, lib = $('nav button[data-tab="library"]');
  $("#inboxBadge").textContent = n || "";
  if (n) lib.setAttribute("aria-label", `Thư viện, ${n} thẻ mới cần xem`); else lib.removeAttribute("aria-label");
}
// The cards the current view shows (also used by the CSV / Anki export, so it never depends on a stale drawn list).
function computeShown() {
  let list = applyView(items, view.scope === "inbox" ? { ...view, sort: "newest" } : view); // Mới is always newest first
  if (leechOnly && view.scope === "library") { const hard = new Set(leechCards().map(c => c.id)); list = list.filter(c => hard.has(c.id)); }
  return list;
}
const EMPTY = { library: "Chưa có mục nào.", inbox: "Không có thẻ mới nào cần xem.", archived: "Chưa lưu trữ thẻ nào." };
function renderList() {
  // Nothing to draw while the Library is hidden (the add form lives there too): draw when it is opened.
  if (!$("#tab-library").classList.contains("active")) { listDirty = true; return; }
  listDirty = false;
  syncTagSelect(false); renderScopeTabs();
  if (view.scope !== "library") leechOnly = false;   // "Thẻ khó" belongs to the Thư viện scope
  shownList = computeShown();
  listIndex = buildIndex(items);
  for (const id of [...selected]) if (!listIndex.byId.has(id)) selected.delete(id); // cards removed elsewhere (sync)
  const fresh = new Set(justAdded);
  $("#list").classList.toggle("stagger", listAnim);
  $("#list").classList.toggle("selecting", selecting);
  listAnim = false; justAdded.clear();
  renderedCount = Math.min(shownCount, shownList.length);
  const filtered = view.type || view.tag || view.query || view.level || view.source;
  $("#list").innerHTML = shownList.length ? shownList.slice(0, renderedCount).map((i, idx) => itemHtml(i, idx, fresh, false)).join("")
    : `<div class="empty">${leechOnly && !filtered ? `Chưa có thẻ khó nào (thẻ bị quên từ ${LEECH_THRESHOLD} lần trở lên).` : filtered || leechOnly ? "Không có mục nào khớp bộ lọc." : EMPTY[view.scope]}</div>`;
  renderListFoot(); renderSavedViews(); renderSelBar(); renderLibBar(); renderOverview();
}
// Toolbar state that depends on the view: Thẻ khó chip, "Ôn các thẻ đang lọc", Giữ/Bỏ tất cả in Mới, sort lock in Mới.
function renderLibBar() {
  const inbox = view.scope === "inbox", n = shownList.length, nLeech = leechCards().length;
  const lb = $("#leechChip"); lb.hidden = view.scope !== "library";
  lb.textContent = `🔥 Thẻ khó (${nLeech})`; lb.setAttribute("aria-pressed", String(leechOnly));
  const pv = $("#practiceViewBtn"); pv.hidden = view.scope !== "library";
  pv.textContent = `💪 Ôn các thẻ đang lọc (${Math.min(n, PRACTICE_CAP)}${n > PRACTICE_CAP ? "+" : ""})`;
  $("#inboxBar").hidden = !inbox;
  if (inbox) {
    $("#keepAll").textContent = `✓ Giữ tất cả (${n})`; $("#dropAll").textContent = `✕ Bỏ tất cả (${n})`;
    $("#keepAll").disabled = $("#dropAll").disabled = !n;
  }
  $("#fltSort").disabled = inbox; $("#fltSort").title = inbox ? "Thẻ mới luôn xếp mới nhất trước" : "";
}
// Footer under the list: "Hiển thị 40 / 1000" + a button. Watching it makes the next page load by itself.
const listObserver = "IntersectionObserver" in window
  ? new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore(); }, { rootMargin: "600px 0px" }) : null;
function renderListFoot() {
  const foot = $("#listFoot"), pi = pageInfo(renderedCount, shownList.length);
  listObserver?.unobserve(foot);
  foot.innerHTML = !shownList.length ? "" : pi.more
    ? `<div class="listinfo">Hiển thị ${pi.shown} / ${pi.total} mục</div><button type="button" id="moreBtn">⬇ Tải thêm ${pi.next} mục</button>`
    : pi.total > PAGE_SIZE ? `<div class="listinfo">Đã hiển thị tất cả ${pi.total} mục</div>` : "";
  if (pi.more) listObserver?.observe(foot);   // observe() reports the current state at once, so a short page keeps filling
}
function loadMore() {
  if (renderedCount >= shownList.length) return;
  const to = nextShown(renderedCount, shownList.length), none = new Set();
  $("#list").insertAdjacentHTML("beforeend", shownList.slice(renderedCount, to).map((i, k) => itemHtml(i, renderedCount + k, none, true)).join(""));
  renderedCount = shownCount = to;
  renderListFoot();
}
$("#listFoot").onclick = e => { if (e.target.closest("#moreBtn")) loadMore(); };

// Change the view: a new filter drops the selection (so a bulk action never reaches cards the reader cannot see).
function setView(patch, redraw = true) {
  const next = normView({ ...view, ...patch });
  if (JSON.stringify(next) !== JSON.stringify(view)) selected.clear();
  view = next; resetPaging();
  if (redraw) renderList();
}
$("#q").oninput = debounce(() => setView({ query: $("#q").value }), 150);
$("#fltType").onchange = () => setView({ type: $("#fltType").value });
$("#fltTag").onchange = () => setView({ tag: $("#fltTag").value });
$("#fltLevel").onchange = () => setView({ level: $("#fltLevel").value });
$("#fltSource").onchange = () => setView({ source: $("#fltSource").value });
$("#fltSort").onchange = () => setView({ sort: $("#fltSort").value });
$("#scopeTabs").onclick = e => {
  const s = e.target.closest("[data-scope]")?.dataset.scope; if (!s) return;
  setView({ scope: s }); syncControls();
};
$("#scopeTabs").onkeydown = e => { // arrow keys move between the tabs
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const tabs = $$("#scopeTabs [data-scope]"), k = tabs.findIndex(b => b.dataset.scope === view.scope);
  const b = tabs[(k + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  e.preventDefault(); setView({ scope: b.dataset.scope }); syncControls(); b.focus();
};

// ----- Thẻ khó, practise the current view, Mới (inbox) triage -----
$("#leechChip").onclick = () => { leechOnly = !leechOnly; selected.clear(); resetPaging(); renderList(); };
$("#practiceViewBtn").onclick = () => {
  const set = practiceSet(shownList);
  if (!set.total) {
    if (confirm("Chế độ xem đang trống, chưa có thẻ nào để ôn. Ôn các thẻ đến hạn thay thế?")) showTab("review");
    return;
  }
  if (set.capped && !confirm(`Chế độ xem có ${set.total} thẻ. Chỉ ôn ${PRACTICE_CAP} thẻ đầu tiên trong lần này. Bắt đầu?`)) return;
  practiceNow(set.cards);
  toast(`Ôn ${set.cards.length} thẻ đang lọc 💪`);
};
// Move cards to another status (keep / drop / restore) through applyBulk, so Hoàn tác and cloud sync work as for other bulk edits.
function moveCards(cards, fn, msg) {
  const ids = new Set(cards.map(c => c.id)), changed = [];
  const out = items.map(c => { if (!ids.has(c.id)) return c; const n = fn(c); changed.push(n); return n; });
  return applyBulk({ items: out, changed, removedIds: [] }, msg);
}
$("#keepAll").onclick = () => {
  const n = shownList.length; if (!n) return;
  if (!confirm(`Giữ ${n} thẻ mới? Thẻ sẽ vào Thư viện và phần ôn tập.`)) return;
  selected.clear();
  moveCards(shownList.slice(), keepCard, `Đã giữ ${n} thẻ`);
};
$("#dropAll").onclick = () => {
  const n = shownList.length; if (!n) return;
  if (!confirm(`Bỏ ${n} thẻ mới? Thẻ được cất vào Lưu trữ (khôi phục được).`)) return;
  selected.clear();
  moveCards(shownList.slice(), dropCard, `Đã bỏ ${n} thẻ vào Lưu trữ`);
};

// ----- overview card (top of the Thư viện scope): totals, by level, by source, top tags. Plain CSS bars. -----
const OV_KEY = "english-notebook-overview-open";
const ovOpen = () => { try { return localStorage.getItem(OV_KEY) === "1"; } catch { return false; } };
function renderOverview() {
  const box = $("#overview"), o = libOverview(items, 8);
  box.hidden = view.scope !== "library" || !o.total;
  if (box.hidden) return;
  const open = ovOpen(), c = statusCounts(items);
  $("#ovToggle").setAttribute("aria-expanded", String(open));
  $("#ovTitle").textContent = `📊 Tổng quan · ${o.total} thẻ · ${o.dueNow} đến hạn`;
  $("#ovBody").hidden = !open;
  if (!open) return;
  const pct = n => Math.round(n / o.total * 100);
  const segs = levelSegments(o.byLevel, o.total), nLeech = leechCards().length;
  const src = [["AI agent", o.bySource.agent], ["Thủ công", o.bySource.manual], ["Chia sẻ", o.bySource.shared]];
  $("#ovBody").innerHTML = `
    <div class="ovstats">
      <div><b>${o.total}</b><small>thẻ</small></div>
      <div><b>${o.dueNow}</b><small>đến hạn</small></div>
      <div><b>${nLeech}</b><small>thẻ khó</small></div>
      <div><b>${c.inbox}</b><small>mới chờ xem</small></div>
    </div>
    <div class="muted-sm">Từ ${o.byType.word} · Cụm từ ${o.byType.phrase} · Câu ${o.byType.sentence}${c.archived ? ` · Lưu trữ ${c.archived}` : ""}</div>
    <h4 class="ovh">Theo mức độ</h4>
    <div class="lvbar" role="img" aria-label="${segs.map(s => `${s.label} ${s.count}`).join(", ")}">${segs.filter(s => s.count).map(s => `<i class="lv-${s.key}" style="width:${s.pct}%"></i>`).join("")}</div>
    <ul class="lvlegend">${segs.map(s => `<li><span class="dotc lv-${s.key}" aria-hidden="true"></span>${s.label} <b>${s.count}</b></li>`).join("")}</ul>
    <h4 class="ovh">Theo nguồn</h4>
    <div class="srcrows">${src.map(([name, n]) => `<div class="srow"><span>${name}</span><div class="mini" aria-hidden="true"><i style="width:${pct(n)}%"></i></div><b>${n}</b></div>`).join("")}</div>
    ${o.topTags.length ? `<h4 class="ovh">Tag nhiều nhất</h4><div class="ovtags">${o.topTags.map(t => `<button type="button" class="chip" data-ovtag="${esc(t.tag)}" aria-label="Lọc theo tag ${esc(t.tag)}, ${t.count} thẻ">#${esc(t.tag)} <b>${t.count}</b></button>`).join("")}</div>` : ""}`;
}
$("#ovToggle").onclick = () => {
  try { localStorage.setItem(OV_KEY, ovOpen() ? "0" : "1"); } catch {}
  renderOverview();
};
$("#ovBody").onclick = e => {
  const t = e.target.closest("[data-ovtag]")?.dataset.ovtag; if (!t) return;
  leechOnly = false; setView({ tag: t }); syncControls(); toast(`Lọc theo #${t}`);
};

// ----- undo: a few seconds to take back a delete / archive / merge -----
let undoTimer, undoFn = null;
function hideUndo() { clearTimeout(undoTimer); undoFn = null; $("#undoBar").hidden = true; }
function offerUndo(msg, fn) {
  // Fill the live region a moment after it appears: screen readers announce changes, not text that shows up with the region.
  const bar = $("#undoBar"); $("#undoMsg").textContent = ""; bar.hidden = false; undoFn = fn;
  setTimeout(() => { if (undoFn === fn) $("#undoMsg").textContent = msg; }, 60);
  clearTimeout(undoTimer); undoTimer = setTimeout(hideUndo, 7000);
}
$("#undoBtn").onclick = () => { const f = undoFn; hideUndo(); if (f) f(); };
// Apply the result of a bulk.js helper ({items, changed, removedIds}) and offer "Hoàn tác" that puts the old cards back.
function applyBulk(res, msg, { undoable = true } = {}) {
  if (!res.changed.length && !res.removedIds.length) return false;
  const old = undoCards(items, res), removed = res.removedIds;
  items = res.items;
  commit(res.changed, res.removedIds);
  if (undoable) offerUndo(msg, () => {
    const back = reviveCards(old, removed, uid); // removed cards come back under new ids (see reviveCards)
    items = restoreCards(items, back);
    commit(back, []);
    toast("Đã hoàn tác ✓");
    if (!$("#cleanDlg").hidden) renderClean();   // the clean-up panel shows the restored cards again
  });
  else toast(msg);
  return true;
}

// ----- saved views (kept on this device) -----
const loadViews = () => { try { return normSavedViews(JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY))); } catch { return []; } };
const storeViews = list => { try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(list)); } catch { toast("Không lưu được chế độ xem trên thiết bị này"); } };
function renderSavedViews() {
  const cur = JSON.stringify(view);
  $("#savedViews").innerHTML = loadViews().map(v => `<span class="svchip">
    <button type="button" class="chip" data-sv="${esc(v.name)}" aria-pressed="${JSON.stringify(v.view) === cur}">${esc(v.name)}</button><button type="button" class="chip x" data-svdel="${esc(v.name)}" aria-label="Xóa chế độ xem ${esc(v.name)}">✕</button></span>`).join("");
}
function openSaveView(open) {
  $("#svForm").hidden = !open; $("#saveViewBtn").setAttribute("aria-expanded", String(open));
  if (open) { $("#svName").value = ""; $("#svName").focus(); }
}
$("#saveViewBtn").onclick = () => openSaveView($("#svForm").hidden);
$("#svCancel").onclick = () => { openSaveView(false); $("#saveViewBtn").focus(); };
$("#svForm").onsubmit = e => {
  e.preventDefault();
  const name = $("#svName").value.trim(); if (!name) { $("#svName").focus(); return; }
  const cur = loadViews(), next = addSavedView(cur, name, view);
  if (next.length === cur.length && !cur.some(v => v.name === name.slice(0, 24))) { toast("Đã đủ 12 chế độ xem. Hãy xóa bớt một chế độ."); return; }
  storeViews(next); openSaveView(false); renderSavedViews(); toast(`Đã lưu chế độ xem "${name.slice(0, 24)}" ✓`);
};
$("#savedViews").onclick = e => {
  const ap = e.target.closest("[data-sv]"), del = e.target.closest("[data-svdel]");
  if (ap) {
    const v = loadViews().find(x => x.name === ap.dataset.sv); if (!v) return;
    selected.clear(); leechOnly = false; view = normView(v.view); resetPaging(); syncControls(); renderList();
  } else if (del) {
    storeViews(removeSavedView(loadViews(), del.dataset.svdel)); renderSavedViews(); toast("Đã xóa chế độ xem");
  }
};

// ----- selection mode and bulk actions -----
function setSelecting(on) {
  selecting = on; if (!on) { selected.clear(); openTagForm(false); }
  $("#selToggle").setAttribute("aria-pressed", String(on)); $("#selToggle").textContent = on ? "✕ Thoát chọn" : "☑ Chọn";
  renderList();
}
function renderSelBar() {
  const bar = $("#selBar"), show = selecting && $("#tab-library").classList.contains("active");
  bar.hidden = !show; document.body.classList.toggle("selecting", show);
  if (!show) return;
  const n = selected.size, all = shownList.length > 0 && shownList.every(i => selected.has(i.id));
  $("#selCount").textContent = `Đã chọn ${n}`;
  $("#selAll").textContent = all ? "Bỏ chọn tất cả" : "Chọn tất cả (đang lọc)";
  $("#selAll").disabled = !shownList.length;
  for (const id of ["selAddTag", "selRemoveTag", "selArchive", "selDelete"]) $("#" + id).disabled = !n;
  $("#selArchive").textContent = view.scope === "archived" ? "↩ Khôi phục" : "📦 Lưu trữ";
  document.documentElement.style.setProperty("--selh", bar.offsetHeight + "px");
}
function syncChecks() { // update the drawn checkboxes without redrawing the list
  $$("#list .item").forEach(li => { const on = selected.has(li.dataset.id); li.classList.toggle("sel", on); const cb = li.querySelector(".selcb"); if (cb) cb.checked = on; });
  renderSelBar();
}
$("#selToggle").onclick = () => setSelecting(!selecting);
$("#selDone").onclick = () => { setSelecting(false); $("#selToggle").focus(); };
$("#selAll").onclick = () => {
  const all = shownList.every(i => selected.has(i.id));
  if (all) selected.clear(); else shownList.forEach(i => selected.add(i.id));
  syncChecks();
};
let tagMode = "";
function openTagForm(mode) {
  tagMode = mode || "";
  $("#selTagForm").hidden = !mode;
  if (!mode) return;
  const names = mode === "add" ? tagStats(items).map(t => t.tag) : [...new Set(items.filter(i => selected.has(i.id)).flatMap(i => i.tags))].sort();
  $("#tagList").innerHTML = names.map(t => `<option value="${esc(t)}"></option>`).join("");
  $("#selTagLabel").firstChild.textContent = mode === "add" ? "Thêm tag" : "Bỏ tag";
  $("#selTagOk").textContent = mode === "add" ? "Thêm" : "Bỏ";
  $("#selTagInput").value = ""; $("#selTagInput").focus();
  renderSelBar();
}
$("#selAddTag").onclick = () => openTagForm("add");
$("#selRemoveTag").onclick = () => openTagForm("remove");
$("#selTagCancel").onclick = () => { openTagForm(false); renderSelBar(); };
$("#selTagForm").onsubmit = e => {
  e.preventDefault();
  const tag = normTag($("#selTagInput").value), n = selected.size;
  if (!tag) { $("#selTagInput").focus(); return; }
  if (tagMode === "remove" && !confirm(`Bỏ tag #${tag} khỏi ${n} thẻ đã chọn?`)) return;
  const res = tagMode === "add" ? addTag(items, selected, tag) : removeTag(items, selected, tag);
  openTagForm(false);
  if (!applyBulk(res, tagMode === "add" ? `Đã thêm #${tag} cho ${res.changed.length} thẻ` : `Đã bỏ #${tag} khỏi ${res.changed.length} thẻ`)) toast("Không có thẻ nào thay đổi");
  renderSelBar();
};
$("#selArchive").onclick = () => {
  const n = selected.size; if (!n) return;
  const restore = view.scope === "archived";
  if (!confirm(restore ? `Khôi phục ${n} thẻ về Thư viện?` : `Lưu trữ ${n} thẻ? Thẻ sẽ bị ẩn khỏi Thư viện và phần ôn tập (khôi phục được ở tab Lưu trữ).`)) return;
  const res = setStatus(items, selected, restore ? "" : "archived");
  selected.clear();
  applyBulk(res, restore ? `Đã khôi phục ${res.changed.length} thẻ` : `Đã lưu trữ ${res.changed.length} thẻ`);
};
$("#selDelete").onclick = () => {
  const n = selected.size; if (!n) return;
  const orphans = items.filter(c => c.sourceId && selected.has(c.sourceId) && !selected.has(c.id)).length;
  if (!confirm(`Xóa ${n} thẻ đã chọn?${orphans ? ` ${orphans} cụm liên quan sẽ được giữ lại như thẻ riêng.` : ""} Bạn có vài giây để hoàn tác.`)) return;
  const res = removeIds(items, selected);
  selected.clear();
  applyBulk(res, `Đã xóa ${res.removedIds.length} thẻ`);
};

$("#list").onclick = e => {
  const act = e.target.dataset.act, li = e.target.closest(".item");
  if (!li) return;
  if (selecting && !act) { // a tap on the card (or its checkbox) toggles it
    const cb = li.querySelector(".selcb");
    if (e.target !== cb) cb.checked = !cb.checked;
    cb.checked ? selected.add(li.dataset.id) : selected.delete(li.dataset.id);
    li.classList.toggle("sel", cb.checked); renderSelBar();
    return;
  }
  if (!act) return;
  const it = items.find(i => i.id === li.dataset.id);
  if (act === "speak") speak(it.text);
  if (act === "edit") editItem(it.id);
  if (act === "keep" || act === "drop" || act === "restore") {
    // The redraw replaces the focused button: hand focus to the next card (or the list) so keyboard users keep their place.
    const sib = li.nextElementSibling || li.previousElementSibling, sibId = sib?.dataset.id;
    if (act === "keep") moveCards([it], keepCard, `Đã giữ "${it.text}"`);
    else if (act === "drop") moveCards([it], dropCard, `Đã bỏ "${it.text}" vào Lưu trữ`);
    else moveCards([it], keepCard, `Đã khôi phục "${it.text}"`);
    setTimeout(() => {
      const nextEl = sibId && $$("#list .item").find(el => el.dataset.id === sibId);
      const target = nextEl?.querySelector("[data-act]") || $("#list");
      if (!target.hasAttribute("tabindex") && target.id === "list") target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }, 0);
  }
  if (act === "del") {
    const kids = items.filter(k => k.sourceId === it.id);
    if (!confirm(`Xoá "${it.text}"${kids.length ? ` và ${kids.length} cụm liên quan` : ""}?`)) return;
    const ids = new Set([it.id, ...kids.map(k => k.id)]);
    const old = items.filter(i => ids.has(i.id));
    $$("#list .item").filter(el => ids.has(el.dataset.id)).forEach(el => el.classList.add("leaving")); // slide away first
    setTimeout(() => {
      items = items.filter(i => !ids.has(i.id));
      commit([], [...ids]);
      offerUndo(`Đã xóa ${old.length} thẻ`, () => { const back = reviveCards(old, [...ids], uid); items = restoreCards(items, back); commit(back, []); toast("Đã hoàn tác ✓"); });
    }, reduced() ? 0 : 270);
  }
};

// ----- "Dọn dẹp": duplicate cards and tag manager -----
let cleanOpener = null;
const skippedDups = new Set();   // groups the reader chose to ignore (until the page is reloaded)
let renamingTag = "";
const fmtDate = ms => { const d = new Date(+ms || 0); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };
function cleanHtml() {
  const groups = findDuplicates(items.filter(isActive)).filter(g => !skippedDups.has(g.key));
  const dup = groups.length ? groups.map(g => `
    <fieldset class="vf dupgroup" data-key="${esc(g.key)}">
      <legend>${g.cards.length} thẻ trùng</legend>
      <ul class="prev">${g.cards.map(c => `<li${c === g.keeper ? ` class="keeper"` : ""}><b>${esc(c.text)}</b> = ${esc(c.meaning)}<br><small>${c.type} · box ${c.box} · ${c.reviews} lần ôn · ${fmtDate(c.created)}${c.tags.length ? " · " + c.tags.map(t => "#" + esc(t)).join(" ") : ""}${c === g.keeper ? " · <b>giữ lại</b>" : ""}</small></li>`).join("")}</ul>
      <div class="btnrow"><button type="button" class="small primary" data-merge="${esc(g.key)}">Gộp thành 1 thẻ</button><button type="button" class="small" data-skip="${esc(g.key)}">Bỏ qua</button></div>
    </fieldset>`).join("") : `<div class="muted-sm">Không tìm thấy thẻ trùng nào.</div>`;
  const tags = tagStats(items);
  const tg = tags.length ? `<ul class="taglist">${tags.map(t => renamingTag === t.tag
    ? `<li><form class="tagrename" data-from="${esc(t.tag)}"><label>Đổi #${esc(t.tag)} thành<input class="trin" list="tagList" maxlength="41" value="${esc(t.tag)}" autocomplete="off"></label><button type="submit" class="small primary">Lưu</button><button type="button" class="small" data-rncancel>Hủy</button></form></li>`
    : `<li><span class="chip">#${esc(t.tag)}</span> <span class="muted-sm">${t.count} thẻ</span> <button type="button" class="small" data-rename="${esc(t.tag)}" aria-label="Đổi tên hoặc gộp tag ${esc(t.tag)}">Đổi tên / gộp</button></li>`).join("")}</ul>`
    : `<div class="muted-sm">Chưa có tag nào.</div>`;
  return `<h3 class="sect">Thẻ trùng</h3>
    <div class="muted-sm">Tìm các thẻ có cùng chữ tiếng Anh (không phân biệt hoa thường, dấu). Thẻ có box cao nhất được giữ lại; tag và ghi chú được gộp vào.</div>
    <div id="dupBox">${dup}</div>
    <h3 class="sect">Quản lý tag</h3>
    <div class="muted-sm">Đổi tên một tag trên tất cả thẻ. Nếu tên mới đã có thì hai tag được gộp lại.</div>
    ${tg}`;
}
function renderClean() { $("#cleanBody").innerHTML = cleanHtml(); }
function openClean() {
  cleanOpener = document.activeElement; renamingTag = ""; skippedDups.clear();
  $("#tagList").innerHTML = tagStats(items).map(t => `<option value="${esc(t.tag)}"></option>`).join("");
  renderClean(); $("#cleanDlg").hidden = false; $("#cleanClose").focus();
}
function closeClean() { $("#cleanDlg").hidden = true; cleanOpener?.focus?.(); cleanOpener = null; }
$("#cleanBtn").onclick = openClean;
$("#cleanClose").onclick = closeClean;
$("#cleanDlg").onclick = e => { if (e.target.id === "cleanDlg") closeClean(); };
$("#cleanBody").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.skip !== undefined) { skippedDups.add(b.dataset.skip); renderClean(); return; }
  if (b.dataset.merge !== undefined) {
    const g = findDuplicates(items.filter(isActive)).find(x => x.key === b.dataset.merge); if (!g) { renderClean(); return; }
    if (!confirm(`Gộp ${g.cards.length} thẻ trùng "${g.keeper.text}" thành 1 thẻ? ${g.cards.length - 1} thẻ sẽ bị xóa (có thể hoàn tác trong vài giây).`)) return;
    applyBulk(mergeDuplicateGroup(items, g), `Đã gộp ${g.cards.length} thẻ thành 1`);
    renderClean(); return;
  }
  if (b.dataset.rename !== undefined) { renamingTag = b.dataset.rename; renderClean(); $("#cleanBody .trin")?.select(); return; }
  if (b.dataset.rncancel !== undefined) { renamingTag = ""; renderClean(); }
};
$("#cleanBody").onsubmit = e => {
  const f = e.target.closest(".tagrename"); if (!f) return;
  e.preventDefault();
  const from = f.dataset.from, to = normTag(f.querySelector(".trin").value);
  if (!to || to === from) { renamingTag = ""; renderClean(); return; }
  const res = renameTag(items, from, to), merging = items.some(c => c.tags.includes(to));
  if (!confirm(`${merging ? "Gộp" : "Đổi"} tag #${from} ${merging ? "vào" : "thành"} #${to} trên ${res.changed.length} thẻ?`)) return;
  renamingTag = "";
  applyBulk(res, `Đã ${merging ? "gộp" : "đổi"} #${from} → #${to} (${res.changed.length} thẻ)`);
  renderClean();
};

// ---------- review (Leitner) ----------
const ORDER_KEY = "english-notebook-order";   // review order on this device: "due" (default) or "random"
const getOrder = () => { try { return normOrder(localStorage.getItem(ORDER_KEY)); } catch { return "due"; } };
function setOrder(mode) {
  mode = normOrder(mode);
  try { mode === "due" ? localStorage.removeItem(ORDER_KEY) : localStorage.setItem(ORDER_KEY, mode); } catch {}
  queue = orderQueue(queue, mode);   // re-order the cards that are still waiting
}
function startReview() {
  queue = orderQueue(items.filter(isDue), getOrder());
  reviewTotal = queue.length; reviewDone = 0;
  cardFx = "slide";
  next();
}
function next() {
  current = queue.shift() || null; revealed = false; renderReview();
}
// Practice session. Without a list: nothing is due but the daily goal is not reached yet, so practise cards that are not due,
// soonest first. With a list (the cards of the Library view, or the hard cards): practise exactly those (active only, at most 100).
function startPractice(list) {
  if (Array.isArray(list)) queue = orderQueue(practiceSet(list).cards, getOrder());
  else {
    const left = P.effectiveGoal(progress, activeCount()) - P.todayCount(progress, today());
    queue = orderQueue(items.filter(i => isActive(i) && !isDue(i)).sort((a, b) => a.due - b.due).slice(0, Math.max(left, 1)), getOrder());
  }
  reviewTotal = queue.length; reviewDone = 0;
  cardFx = "slide";
  next();
}
// Open the Review tab on a practice session instead of the normal due queue.
function practiceNow(list) { showTab("review", true); startPractice(list); }
const leechCards = () => leeches(items, LEECH_THRESHOLD);
function startLeeches() {
  const l = leechCards();
  if (!l.length) { toast("Chưa có thẻ khó nào"); return; }
  const set = practiceSet(l);
  practiceNow(l);
  toast(set.capped ? `Ôn ${set.cards.length}/${set.total} thẻ khó (tối đa ${PRACTICE_CAP})` : `Ôn ${set.cards.length} thẻ khó 🔥`);
}
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
function dotsHtml() {
  const t = today(), out = [];
  for (let i = 6; i >= 0; i--) {
    const k = P.addDays(t, -i), d = progress.days[k], [y, m, dd] = k.split("-").map(Number);
    const cls = d?.f ? "on" : d?.z ? "ice" : k === t ? "today" : "";
    out.push(`<span class="dot-wrap" style="--k:${6 - i}"><span class="dot ${cls}" title="${k}">${d?.f ? "✓" : d?.z ? "🧊" : ""}</span><small>${WEEKDAY[new Date(y, m - 1, dd).getDay()]}</small></span>`);
  }
  return `<div class="dots">${out.join("")}</div>`;
}
function dailyHtml() {
  const t = today(), s = P.streakInfo(progress, t), goal = P.effectiveGoal(progress, activeCount());
  const n = P.todayCount(progress, t), met = !!progress.days[t]?.f, pct = Math.min(100, Math.round(n / goal * 100));
  return `<div class="daily">
    <div class="daily-top">
      <div class="streak-big"><span class="flame">🔥</span> <b data-count="${s.current}" data-k="streak">${s.current}</b> ngày</div>
      <div class="muted-sm">🧊 ${P.freezesAvailable(progress)} băng</div>
    </div>
    ${s.atRisk ? `<div class="warn">Ôn đủ mục tiêu hôm nay để giữ streak!</div>` : ""}
    <div class="goalrow"><span>Mục tiêu hôm nay</span><b>${Math.min(n, goal)}/${goal}${met ? " ✅" : ""}</b></div>
    <div class="bar goal" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(n, goal)}"><i style="width:${pct}%"></i></div>
    ${dotsHtml()}
  </div>`;
}
// "🎯 2/5 hôm nay": the only trace of the daily goal on the Review screen (the full streak panel is in the Thưởng tab)
function goalLine() {
  const t = today(), goal = P.effectiveGoal(progress, activeCount()), n = Math.min(P.todayCount(progress, t), goal);
  return `🎯 ${n}/${goal} hôm nay${progress.days[t]?.f ? " ✅" : ""}`;
}
function renderReview() {
  const box = $("#reviewBox");
  const fx = cardFx; cardFx = "";
  if (!current) {
    const total = activeCount(), left = P.effectiveGoal(progress, total) - P.todayCount(progress, today());
    const spare = items.filter(i => isActive(i) && !isDue(i)).length, nLeech = leechCards().length, nInbox = statusCounts(items).inbox;
    const leechBtn = nLeech ? `<br><br><button type="button" id="leechBtn2">🔥 Ôn thẻ khó (${nLeech})</button>` : "";
    box.innerHTML = (!total
      ? `<div class="empty">Chưa có thẻ nào để ôn. Hãy thêm vài thẻ bằng nút ➕ Thêm ở tab Thư viện.${nInbox ? `<br>Có <b>${nInbox}</b> thẻ mới từ AI đang chờ bạn xem ở Thư viện → Mới.` : ""}</div>`
      : left > 0 && spare > 0
        ? `<div class="empty">Hết thẻ đến hạn, nhưng còn <b>${left}</b> thẻ nữa để đạt mục tiêu hôm nay.<br><br><button class="primary" id="practiceBtn" type="button">💪 Ôn thêm ${Math.min(left, spare)} thẻ</button>${leechBtn}</div>`
        : `<div class="empty">🎉 Không còn mục nào cần ôn hôm nay.<br>Tổng: ${total} mục · ${goalLine()}${leechBtn}</div>`);
    const pb = $("#practiceBtn"); if (pb) pb.onclick = () => startPractice();
    const lb = $("#leechBtn2"); if (lb) lb.onclick = startLeeches;
    return;
  }
  const nLeech = leechCards().length;
  const c = current;
  const parent = c.sourceId && items.find(p => p.id === c.sourceId);
  box.innerHTML = `
    <div class="progress">Còn ${queue.length + 1} mục · box ${c.box} · ${goalLine()}</div>
    <div class="orderbar"><button class="small" id="rOrder" type="button" aria-pressed="${getOrder() === "random"}" title="Đổi thứ tự các thẻ còn lại">🔀 Ngẫu nhiên: ${getOrder() === "random" ? "bật" : "tắt"}</button>${nLeech ? ` <button class="small" id="rLeech" type="button" title="Ôn các thẻ bạn hay quên (quên từ ${LEECH_THRESHOLD} lần)">🔥 Ôn thẻ khó (${nLeech})</button>` : ""}</div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${reviewTotal}" aria-valuenow="${reviewDone}"><i style="width:${reviewTotal ? Math.round(reviewDone / reviewTotal * 100) : 0}%"></i></div>
    <div class="card${fx ? " fx-" + fx : ""}" data-type="${c.type}">
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
    <div class="grade${revealed ? "" : " pending"}">
      <button class="again" data-g="0">Quên</button>
      <button class="good" data-g="1">Nhớ</button>
      <button class="easy" data-g="2">Dễ</button></div>`;
  $("#rSpeak").onclick = () => speak(c.text);
  $("#rOrder").onclick = () => {
    const mode = getOrder() === "random" ? "due" : "random";
    setOrder(mode); renderReview(); toast(mode === "random" ? "🔀 Thứ tự ngẫu nhiên" : "Thứ tự theo hạn ôn");
  };
  const rl = $("#rLeech"); if (rl) rl.onclick = startLeeches;
  const show = $("#rShow"); if (show) show.onclick = () => { revealed = true; renderReview(); };
  $$(".grade button").forEach(b => b.onclick = () => grade(+b.dataset.g));
}
function grade(g) {
  // `current` can be an old object: a sync may have replaced `items` (card archived or edited on another device) while the card
  // was on screen. Grade the live card, and skip it when it is gone or no longer active, so the put never overwrites newer data.
  const c = items.find(i => i.id === current.id);
  if (!c || !isActive(c)) { cardFx = "slide"; next(); return; }
  c.box = g === 0 ? 0 : Math.min(5, c.box + g);
  c.due = g === 0 ? Date.now() + 10 * 60000 : Date.now() + INTERVALS[c.box] * DAY;
  c.reviews++;
  if (g === 0) c.lapses = (c.lapses || 0) + 1;   // "Quên": counts toward the hard-card (leech) list
  if (user) cloud.put(user.uid, c).catch(syncErr);
  else if (mirrorUid) { addPending(pending, [c]); writeMirror(localStorage, mirrorUid, items); }
  else saveLocal();
  renderStats();
  if (g === 0) queue.push(c); // see it again in this session
  else reviewDone++;
  const r = P.recordReview(progress, g, ctxNow());
  progress = r.p; saveProgress();
  cardFx = g === 0 ? "shake" : "slide"; // Quên shakes the next card, a recall slides it in
  next();
  if (r.ev.goalReached || r.ev.badges.length || r.ev.levelUp) celebrate(r.ev);
  else floatText(`+${r.ev.xp} XP`);
}

// ---------- rewards tab ----------
function renderRewards() {
  const box = $("#rewardsBox"); if (!box) return;
  const t = today(), s = P.streakInfo(progress, t), lv = P.levelInfo(P.totalXp(progress));
  const st = P.stats(progress, t, ctxNow());
  box.innerHTML = dailyHtml() + `
    <button class="primary" id="shareBtn" type="button">📣 Chia sẻ thành tích</button>
    <div class="daily level">
      <div class="daily-top"><div class="streak-big">⭐ Lv <b data-count="${lv.level}" data-k="level">${lv.level}</b> · ${esc(lv.title)}</div><div class="muted-sm"><span data-count="${lv.xp}" data-k="xp">${lv.xp}</span> XP</div></div>
      <div class="bar goal" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${lv.pct}"><i style="width:${lv.pct}%"></i></div>
      <div class="muted-sm">Còn ${lv.next - lv.xp} XP để lên cấp ${lv.level + 1}</div>
    </div>
    <div class="statgrid">
      <div class="stat"><b><span class="flame">🔥</span> <span data-count="${s.current}" data-k="r-streak">${s.current}</span></b><small>Streak hiện tại</small></div>
      <div class="stat"><b>🏅 <span data-count="${s.best}" data-k="r-best">${s.best}</span></b><small>Streak dài nhất</small></div>
      <div class="stat"><b>🧊 ${P.freezesAvailable(progress)}/${P.MAX_FREEZES}</b><small>Băng cứu streak</small></div>
      <div class="stat"><b>✅ <span data-count="${st.reviews}" data-k="r-reviews">${st.reviews}</span></b><small>Lần nhớ đúng</small></div>
    </div>
    <div class="daily">
      <div class="streak-big">🎯 Mục tiêu: ${progress.goal} thẻ mỗi ngày</div>
      <div class="muted-sm">Ôn đủ số thẻ này mỗi ngày để giữ streak. Nhớ/Dễ mới được tính; Quên thì không. Cứ ${P.FREEZE_EVERY} ngày streak được 1 băng 🧊 (tối đa ${P.MAX_FREEZES}) tự cứu streak khi bạn lỡ 1 ngày.</div>
      <div class="muted-sm">XP: Quên +1 · Nhớ +3 · Dễ +5 · đạt mục tiêu ngày +${P.GOAL_BONUS_XP}.</div>
      <div class="btnrow"><button type="button" class="small" id="goProfile">⚙️ Đổi mục tiêu ở Profile</button></div>
    </div>
    <h3 class="sect">Huy hiệu (${Object.keys(progress.badges).length}/${P.BADGES.length})</h3>
    <div class="trophies">${P.BADGES.map((b, idx) => {
      const got = progress.badges[b.id];
      return `<div class="trophy${got ? " got" : ""}" style="--i:${idx}" title="${esc(b.desc)}">
        <span class="ico" aria-hidden="true">${got ? b.icon : "🔒"}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`;
    }).join("")}</div>`;
  runCounts(box);
}
$("#rewardsBox").onclick = e => {
  if (e.target.closest("#shareBtn")) openShare();
  if (e.target.closest("#goProfile")) showTab("profile");
};

// ---------- profile tab: personal settings (look, motion, daily goal) ----------
function renderProfile() {
  const box = $("#profileDyn"); if (!box) return;
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`).join("");
  box.innerHTML = `
    <div class="daily pcard">
      <div class="streak-big">🎨 Giao diện</div>
      <div class="muted-sm">Phong cách và chế độ màu được lưu trên thiết bị này.</div>
      <div class="stylepick" id="stylePick">${Object.entries(STYLES).map(([k, [ico, name, desc]]) => `
        <button type="button" data-style="${k}" aria-pressed="${k === getStyle()}">
          <span class="sw sw-${k}"><span>Aa</span></span><b>${ico} ${esc(name)}</b><small>${esc(desc)}</small>
        </button>`).join("")}</div>
      <label class="goalsel">Chế độ màu
        <select id="themeSel">${opt(Object.entries(THEMES).map(([k, [ico, name]]) => [k, `${ico} ${name}`]), getTheme())}</select>
      </label>
      <label class="goalsel">Hiệu ứng chuyển động
        <select id="motionSel">${opt([["system", "Theo hệ thống"], ["on", "Luôn bật"], ["off", "Tắt"]], getMotion())}</select>
      </label>
      <div class="muted-sm">${systemReducesMotion() ? "Hệ thống của bạn đang bật \"giảm chuyển động\" nên chế độ \"Theo hệ thống\" sẽ không có hiệu ứng. Chọn \"Luôn bật\" để xem hiệu ứng." : "\"Theo hệ thống\" sẽ tự tắt hiệu ứng nếu bạn bật \"giảm chuyển động\" trong hệ điều hành."}</div>
    </div>
    <div class="daily pcard">
      <div class="streak-big">🎯 Học tập</div>
      <label class="goalsel">Mục tiêu mỗi ngày (số thẻ)
        <select id="goalSel">${P.GOALS.map(g => `<option value="${g}"${g === progress.goal ? " selected" : ""}>${g} thẻ</option>`).join("")}</select>
      </label>
      <div class="muted-sm">Ôn đủ số thẻ này mỗi ngày để giữ streak.</div>
      <label class="goalsel">Thứ tự ôn tập
        <select id="orderSel">${opt(Object.entries(ORDERS), getOrder())}</select>
      </label>
      <div class="muted-sm">"Theo hạn" ôn thẻ quá hạn lâu nhất trước. "Ngẫu nhiên" trộn các thẻ cần ôn. Lưu trên thiết bị này.</div>
    </div>`;
  renderExportScope();
}
$("#profileDyn").onclick = e => {
  const pick = e.target.closest("#stylePick [data-style]"); // (not just [data-style]: <html> has that attribute too)
  if (pick && pick.dataset.style !== getStyle()) chooseStyle(pick.dataset.style);
};
$("#profileDyn").onchange = e => {
  if (e.target.id === "themeSel") { fadeColors(); applyTheme(e.target.value); toast(`Chế độ màu: ${THEMES[e.target.value][1]}`); return; }
  if (e.target.id === "motionSel") {
    applyMotion(e.target.value); renderProfile();
    toast(e.target.value === "on" ? "Đã bật hiệu ứng ✨" : e.target.value === "off" ? "Đã tắt hiệu ứng" : "Hiệu ứng: theo hệ thống");
    return;
  }
  if (e.target.id === "orderSel") { setOrder(e.target.value); toast(e.target.value === "random" ? "🔀 Thứ tự ngẫu nhiên" : "Thứ tự theo hạn ôn"); return; }
  if (e.target.id !== "goalSel") return;
  progress = { ...progress, goal: +e.target.value, updated: Date.now() };
  saveProgress(); renderRewards(); toast(`Mục tiêu: ${progress.goal} thẻ/ngày`);
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
  if (e.key === "Escape") { $("#celebrate").hidden = true; $("#shareDlg").hidden = true; $("#installDlg").hidden = true; if (!$("#cleanDlg").hidden) closeClean(); if (!$("#impDlg").hidden) closeImport(); if (!$("#helpDlg").hidden) closeHelp(); }
});

// ---------- share achievements ----------
function shareStats() {
  const t = today(), s = P.streakInfo(progress, t), lv = P.levelInfo(P.totalXp(progress)), st = P.stats(progress, t, ctxNow());
  return {
    streak: s.current, best: s.best, level: lv.level, xp: lv.xp, reviews: st.reviews, cards: activeCount(),
    badges: Object.keys(progress.badges).length, badgesTotal: P.BADGES.length,
    icons: P.BADGES.filter(b => progress.badges[b.id]).map(b => b.icon),
  };
}
async function openShare() {
  const d = shareStats();
  $("#shareText").value = S.shareText(d);
  await S.loadCardFont(); // so the card is drawn with Be Vietnam Pro, not a fallback font
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
  if (reduced()) return;
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
  const due = items.filter(isDue).length, active = items.filter(isActive).length;
  $("#stats").textContent = `${active} mục · ${due} cần ôn`;
  $("#dueBadge").textContent = due || "";
  renderInboxBadge();
}
function renderAll() {
  renderStats(); renderList();
  if ($("#tab-profile").classList.contains("active")) renderExportScope();
  if (!$("#cleanDlg").hidden && !$("#cleanBody").contains(document.activeElement)) renderClean(); // keep the clean-up panel current (but never reset a field being typed in)
}
let renderQueued = false;
function renderAllSoon() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderAll(); }); }

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

// ----- CSV / Anki export: exactly the cards the Library shows now (the whole Thư viện when no filter is set) -----
const SRC_LABEL = { agent: "AI agent", manual: "Thủ công", shared: "Chia sẻ" };
const SCOPE_LABEL = { inbox: "Mới", archived: "Lưu trữ" };
function exportSet() {
  const list = computeShown(), parts = [];
  if (view.scope !== "library") parts.push(`mục ${SCOPE_LABEL[view.scope]}`);
  if (view.type) parts.push(view.type);
  if (view.tag) parts.push(`#${view.tag}`);
  if (view.query) parts.push(`tìm "${view.query}"`);
  if (view.level) parts.push(LEVEL_LABEL[view.level]);
  if (view.source) parts.push(SRC_LABEL[view.source]);
  if (leechOnly && view.scope === "library") parts.push("thẻ khó");
  return { list, parts };
}
function renderExportScope() {
  const el = $("#exportScope"); if (!el) return;
  const { list, parts } = exportSet();
  el.textContent = parts.length
    ? `CSV và Anki sẽ xuất ${list.length} thẻ theo bộ lọc hiện tại của Thư viện (${parts.join(", ")}). Xóa bộ lọc để xuất tất cả.`
    : `CSV và Anki sẽ xuất toàn bộ Thư viện: ${list.length} thẻ (không gồm thẻ Mới và Lưu trữ).`;
}
function downloadText(name, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCards(kind) {
  const { list, parts } = exportSet();
  if (!list.length) { toast("Không có thẻ nào để xuất"); return; }
  const day = new Date().toISOString().slice(0, 10), what = parts.length ? `${list.length} thẻ đang lọc` : `${list.length} thẻ`;
  if (kind === "csv") downloadText(`english-notebook-${day}.csv`, BOM + toCsv(list), "text/csv;charset=utf-8");
  else downloadText(`english-notebook-anki-${day}.tsv`, toAnkiTsv(list), "text/tab-separated-values;charset=utf-8");
  toast(`Đã xuất ${what} ✓`);
}
$("#exportCsvBtn").onclick = () => exportCards("csv");
$("#exportAnkiBtn").onclick = () => exportCards("anki");

// ----- import from text / CSV: paste or pick a file, check the PREVIEW, then add everything as one batch -----
const IMP_MAX_BYTES = 2 * 1024 * 1024;
let impOpener = null, impFileName = "", impTimer;
function impDetect(text) {
  if (/\.csv$/i.test(impFileName)) return "csv";
  const first = text.replace(/^﻿/, "").split(/\r\n|\r|\n/).find(l => l.trim()) || "";
  return /^\s*"?(type|text)"?\s*,/i.test(first) ? "csv" : "lines";
}
function impPlan() {
  const text = $("#impText").value;
  if (!text.trim()) return null;
  const mode = $("#impMode").value === "auto" ? impDetect(text) : $("#impMode").value;
  const parsed = mode === "csv" ? parseCsv(text) : parseLines(text);
  return { mode, parsed, ...prepareImport(items, parsed, { tag: "imported" }) };
}
function renderImpPreview() {
  const box = $("#impPreview"), plan = impPlan();
  $("#impOk").disabled = !plan || !plan.fresh.length;
  $("#impOk").textContent = plan && plan.fresh.length ? `Nhập ${plan.fresh.length} thẻ` : "Nhập";
  if (!plan) { box.innerHTML = `<div class="muted-sm">Chưa có nội dung. Dán văn bản hoặc chọn file để xem trước.</div>`; return; }
  const { fresh, skipped, invalid } = plan;
  box.innerHTML = `
    <div class="impcounts">
      <span><b>${fresh.length}</b> sẽ thêm</span>
      <span><b>${skipped.length}</b> bỏ qua (trùng)</span>
      <span><b>${invalid.length}</b> dòng lỗi</span>
    </div>
    ${fresh.length ? `<ul class="prev">${fresh.slice(0, 10).map(c => `<li><b>${esc(c.text)}</b> = ${esc(c.meaning)}<br><small>${esc(c.type)}${c.tags.length ? " · " + c.tags.map(t => "#" + esc(t)).join(" ") : ""}</small></li>`).join("")}</ul>` : ""}
    ${fresh.length > 10 ? `<div class="muted-sm">… và ${fresh.length - 10} thẻ nữa.</div>` : ""}
    ${fresh.length >= MAX_IMPORT ? `<div class="muted-sm">Mỗi lần nhập tối đa ${MAX_IMPORT.toLocaleString("vi-VN")} thẻ; phần còn lại hãy nhập ở lần sau.</div>` : ""}
    ${invalid.length ? `<ul class="prev errs">${invalid.slice(0, 5).map(r => `<li>Dòng ${r.line}: ${esc(r.reason)}</li>`).join("")}</ul>${invalid.length > 5 ? `<div class="muted-sm">… và ${invalid.length - 5} dòng lỗi nữa.</div>` : ""}` : ""}
    <div class="muted-sm">Thẻ nhập vào có tag "imported", nguồn Thủ công, và đi thẳng vào Thư viện.</div>`;
}
const impPreviewSoon = () => { clearTimeout(impTimer); impTimer = setTimeout(renderImpPreview, 250); };
function openImport() {
  impOpener = document.activeElement; impFileName = "";
  $("#impText").value = ""; $("#impMode").value = "auto"; $("#impFile").value = "";
  renderImpPreview(); $("#impDlg").hidden = false; $("#impText").focus();
}
function closeImport() { clearTimeout(impTimer); $("#impDlg").hidden = true; impOpener?.focus?.(); impOpener = null; }
$("#textImportBtn").onclick = openImport;
$("#impCancel").onclick = closeImport;
$("#impDlg").onclick = e => { if (e.target.id === "impDlg") closeImport(); };
$("#impText").oninput = () => { impFileName = ""; impPreviewSoon(); };
$("#impMode").onchange = renderImpPreview;
$("#impFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > IMP_MAX_BYTES) { toast("File quá lớn (tối đa 2 MB)"); e.target.value = ""; return; }
  try { $("#impText").value = await f.text(); impFileName = f.name; renderImpPreview(); }
  catch { toast("Không đọc được file"); }
};
$("#impOk").onclick = () => {
  clearTimeout(impTimer);
  const plan = impPlan(); // recomputed now, in case the cards changed while the dialog was open
  if (!plan || !plan.fresh.length) return;
  const fresh = plan.fresh.map(norm), ids = new Set(fresh.map(c => c.id)), n = fresh.length;
  items.unshift(...fresh);
  commit(fresh);           // one batch: one write per card, one redraw
  fresh.forEach(c => justAdded.add(c.id));
  closeImport(); awardBadges(false);
  offerUndo(`Đã nhập ${n} thẻ`, () => {
    items = items.filter(c => !ids.has(c.id));
    commit([], [...ids]); toast(`Đã hủy lần nhập ${n} thẻ`);
  });
};

// ----- keyboard shortcuts (desktop): see shortcuts.js for the key rules -----
function openHelp() {
  helpOpener = document.activeElement;
  $("#helpList").innerHTML = SHORTCUT_HELP.map(([k, d]) => `<div><dt>${k.split(" ").map(p => p === "rồi" ? " rồi " : `<kbd>${esc(p)}</kbd>`).join("")}</dt><dd>${esc(d)}</dd></div>`).join("");
  $("#helpDlg").hidden = false; $("#helpClose").focus();
}
let helpOpener = null;
function closeHelp() { $("#helpDlg").hidden = true; helpOpener?.focus?.(); helpOpener = null; }
$("#helpBtn").onclick = openHelp;
$("#helpClose").onclick = closeHelp;
$("#helpDlg").onclick = e => { if (e.target.id === "helpDlg") closeHelp(); };
let chord = { g: 0 };
// Capture phase: runs before the dialog handlers, so we see which dialog was open when the key went down.
document.addEventListener("keydown", e => {
  const r = resolveKey(e, chord, Date.now()); chord = r.state;
  const a = r.action; if (!a) return;
  const typing = isTypingTarget(e.target), dialogOpen = !!$(".overlay:not([hidden])");
  if (a.type === "escape") {
    if (dialogOpen) return;                              // the dialog handlers close it
    if (typing) { e.target.blur(); return; }
    if (selecting) setSelecting(false);
    else if (!$("#svForm").hidden) openSaveView(false);
    else if (!$("#addPanel").hidden && $("#tab-library").classList.contains("active")) openAdd(false);
    return;
  }
  if (typing || dialogOpen) return;
  e.preventDefault();
  if (a.type === "search") { showTab("library"); $("#q").focus(); $("#q").select(); }
  else if (a.type === "add") { showTab("library"); openAdd(true); }
  else if (a.type === "help") openHelp();
  else if (a.type === "tab") showTab(a.tab);
}, true);
// Keep Tab inside the open dialog (they are aria-modal): wrap from the last focusable element to the first and back.
document.addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const dlg = $(".overlay:not([hidden])"); if (!dlg) return;
  const f = [...dlg.querySelectorAll("a[href],button,input,select,textarea,[tabindex]")]
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.offsetParent !== null);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1], at = document.activeElement;
  if (!dlg.contains(at)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
});

// ---------- PWA: service worker + install button ----------
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {}); // always check the server for a new sw.js
}
let installEvent = null; // Chrome / Edge / Android: the browser hands us a prompt we can show on a button press
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function renderInstall() {
  // Show the button only when installing is possible and the app is not already running as an installed app.
  $("#installBtn").hidden = $("#installBox").hidden = isStandalone() || !(installEvent || isIos());
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; renderInstall(); });
window.addEventListener("appinstalled", () => { installEvent = null; renderInstall(); toast("Đã cài app ✓"); });
$("#installBtn").onclick = async () => {
  if (installEvent) {
    const ev = installEvent; installEvent = null; renderInstall(); // a prompt can be used only once
    ev.prompt();
    await ev.userChoice.catch(() => {});
  } else $("#installDlg").hidden = false; // iPhone / iPad: show the manual steps
};
$("#installClose").onclick = () => { $("#installDlg").hidden = true; };
$("#installDlg").onclick = e => { if (e.target.id === "installDlg") $("#installDlg").hidden = true; };
renderInstall();
// One-time hint: the system turns motion off, so the animations stay hidden until the user switches them on.
try {
  if (getMotion() === "system" && systemReducesMotion() && !localStorage.getItem("english-notebook-motion-hint")) {
    localStorage.setItem("english-notebook-motion-hint", "1");
    setTimeout(() => toast("Hệ thống đang tắt chuyển động. Bật hiệu ứng ở 👤 Profile → Giao diện."), 1200);
  }
} catch {}
renderAuth();
toggleSentence();
renderAll();
settle();
renderPills();
renderRewards();
renderProfile();
importInbox();
// ---------- sharing a vocabulary vault between accounts (see vault.js and vault-ui.js) ----------
vaultUi = initVault({
  getItems: () => items, getUser: () => user, authKnown: () => authKnown,
  addItems: list => { items.unshift(...list); commit(list); awardBadges(false); }, // imported cards are new cards for this account
  toast, goLibrary: () => showTab("library"),
});
vaultUi.handleUrl(); // a link like /?import=CODE opens the import screen
agentUi = initAgent({ getUser: () => user, authKnown: () => authKnown, toast }); // "Kết nối AI agent": personal tokens for the MCP plugin

// Home-screen shortcuts open a tab directly: /?tab=review, /?tab=add, /?tab=rewards, /?tab=library
const startTab = new URLSearchParams(location.search).get("tab");
if (startTab === "add") { showTab("library"); openAdd(true); }   // old shortcut: the add form now lives in the Library
else if (["library", "review", "rewards", "profile"].includes(startTab)) showTab(startTab);

// Footer: version and GitHub links (the single source is version.js)
$("#appVersion").textContent = "v" + VERSION;
$("#repoLink").href = REPO_URL;
$("#installLink").href = INSTALL_URL;

// Update check: compare VERSION with version.json on the site. Automatic at start-up and when the app comes back to the
// screen (at most once an hour); the footer button checks right away. "Tải lại" reloads: the service worker is network-first.
const UPDATE_EVERY = 3600000;
let lastUpdateCheck = 0, dismissedVer = "";
try { dismissedVer = sessionStorage.getItem("english-notebook-update-later") || ""; } catch {}
async function runUpdateCheck(manual) {
  lastUpdateCheck = Date.now();
  const r = await checkForUpdate();
  if (!r) { if (manual) toast("Không kiểm tra được (đang offline?)"); return; }
  if (!r.newer) { if (manual) toast(`Bạn đang dùng bản mới nhất (v${VERSION})`); return; }
  if (!manual && r.latest === dismissedVer) return; // "Để sau" is remembered until the tab is closed
  $("#updateVer").textContent = "v" + r.latest;
  $("#updateBar").hidden = false;
  $("#updateBar").dataset.ver = r.latest;
}
$("#updateReload").onclick = () => location.reload();
$("#updateLater").onclick = () => {
  const v = $("#updateBar").dataset.ver || "";
  dismissedVer = v; try { sessionStorage.setItem("english-notebook-update-later", v); } catch {}
  $("#updateBar").hidden = true;
};
$("#checkUpdate").onclick = () => runUpdateCheck(true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastUpdateCheck > UPDATE_EVERY) runUpdateCheck(false);
});
setTimeout(() => runUpdateCheck(false), 3000);
