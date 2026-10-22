import * as cloud from "./cloud.js";

const KEY = "english-notebook-v1";
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

let items = loadLocal();
let user = null, unsub = null;
const migrated = new Set();
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
  user = u; renderAuth();
  if (!u) { items = loadLocal(); renderAll(); return; }
  cloud.watch(u.uid, docs => {
    const remote = docs.map(norm);
    if (!migrated.has(u.uid)) { // first login: upload local items that the cloud does not have yet
      migrated.add(u.uid);
      const have = new Set(remote.map(i => i.id));
      loadLocal().filter(i => !have.has(i.id)).forEach(i => cloud.put(u.uid, i).catch(syncErr));
    }
    items = remote.sort((a, b) => b.created - a.created);
    renderAll();
    importInbox();
  }, syncErr).then(f => { unsub = f; }).catch(syncErr);
}
if (cloud.enabled) cloud.onUser(onUser).catch(e => { syncErr(e); });

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
    if (added.length) { items.unshift(...added); commit(added); toast(`Đã nhập ${added.length} mục từ Claude ✓`); }
  } catch { /* no inbox, offline, or bad JSON: ignore */ }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) importInbox(); });

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
function renderReview() {
  const box = $("#reviewBox");
  if (!current) {
    box.innerHTML = `<div class="empty">🎉 Không còn mục nào cần ôn hôm nay.<br>Tổng: ${items.length} mục.</div>`;
    return;
  }
  const c = current;
  const parent = c.sourceId && items.find(p => p.id === c.sourceId);
  box.innerHTML = `
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
  next();
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
importInbox();
