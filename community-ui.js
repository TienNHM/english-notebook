// The "🌐 Cộng đồng" tab: browse public collections, see one (preview, star, report, "Học bộ này"), publish your own, and
// manage "Bộ của tôi". The logic is in community.js, the Firestore calls are in cloud.js.
// Behind a feature flag: communityEnabled in firebase-config.js, or localStorage "english-notebook-community" = "1".
// With the flag off nothing is drawn and no community request is made.
// Titles, descriptions, tags, names and cards come from other people: every one of them goes through esc().
import * as C from "./community.js";
import * as V from "./vault.js";
import * as cloud from "./cloud.js";
import { sourceKind } from "./inbox.js";
import { communityEnabled } from "./firebase-config.js";

export const FLAG_KEY = "english-notebook-community";
const NAME_KEY = "english-notebook-community-name"; // { uid, name }: the display name this account typed last time
const PAGE = 20;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LABEL = { word: "Từ", phrase: "Cụm từ", sentence: "Câu" };
const typeLabel = t => (Object.hasOwn(LABEL, t) ? LABEL[t] : ""); // card types come from other people's packs
const fmt = ms => (ms ? new Date(ms).toLocaleDateString("vi-VN") : "");
const withTimeout = (p, ms = 30000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// The saved display name belongs to one account: on a shared device another account never gets it pre-filled.
const savedName = user => {
  try { const d = JSON.parse(lsGet(NAME_KEY) || "null"); return user && d && d.uid === user.uid && typeof d.name === "string" ? d.name : ""; }
  catch { return ""; }
};
const defaultName = user => (savedName(user) || user?.displayName || "").slice(0, C.LIMITS.ownerName);

// The tab shows when the flag is on in the code, or when this browser opted in (preview after the rules are deployed).
export const isOn = () => communityEnabled === true || lsGet(FLAG_KEY) === "1";

function friendly(e) {
  const c = e?.code || e?.message || String(e);
  if (c === "permission-denied") return "Bị từ chối. Hãy kiểm tra bạn đã đăng nhập, và giờ trên máy không bị sai lệch quá nhiều.";
  if (c === "timeout" || c === "unavailable") return "Không kết nối được. Hãy kiểm tra mạng rồi thử lại.";
  if (c === "failed-precondition") return "Máy chủ chưa sẵn sàng cho cách lọc này (chỉ mục đang được tạo). Hãy thử lại sau ít phút.";
  if (c === "resource-exhausted") return "Máy chủ đã hết hạn mức hôm nay. Hãy thử lại sau.";
  return String(e?.message || c);
}

// "#IELTS, abc" -> "ielts" (one tag to filter by)
const oneTag = s => (String(s ?? "").trim().replace(/^#+/, "").toLowerCase().split(/[\s,]+/)[0] || "").slice(0, C.LIMITS.tag);

const NOOP = { enabled: false, render() {}, onUser() {} };

// ctx: { getItems, getUser, authKnown, addItems(list), toast, goLibrary, showTab }
export function initCommunity(ctx) {
  if (!isOn()) return NOOP;

  // ---------- the nav button and the tab (only added when the flag is on) ----------
  const nav = $("nav"), main = $("main");
  if (!nav || !main) return NOOP;
  const btn = document.createElement("button");
  btn.type = "button"; btn.dataset.tab = "community";
  btn.innerHTML = `<span class="ni" aria-hidden="true">🌐</span> <span class="nl">Cộng đồng</span>`;
  btn.setAttribute("aria-label", "Cộng đồng");
  btn.onclick = () => ctx.showTab("community");
  nav.appendChild(btn);
  nav.classList.add("five");
  const sec = document.createElement("section");
  sec.id = "tab-community"; sec.className = "tab";
  sec.innerHTML = `<div id="comBody"></div>`;
  main.insertBefore(sec, $("#appFooter"));

  const body = $("#comBody"), dlg = $("#comDlg"), dlgBody = $("#comDlgBody"), pubDlg = $("#comPubDlg"), pubBody = $("#comPubBody");
  const tabOpen = () => sec.classList.contains("active");
  const loginBlock = text => `<p class="muted-sm">${esc(text)}</p><button class="primary" type="button" data-login>Đăng nhập Google</button>`;
  const gate = () => {
    if (!cloud.enabled) return `<p class="muted-sm">Tính năng này cần bật đăng nhập và đồng bộ (Firebase). Xem README.</p>`;
    if (!ctx.authKnown()) return `<p class="muted-sm">Đang kiểm tra đăng nhập…</p>`;
    if (!ctx.getUser()) return loginBlock("Đăng nhập Google để xem các bộ thẻ cộng đồng, gắn sao và học cùng mọi người.");
    return null;
  };
  const offlineBlock = () => `<div class="empty">📴 Bạn đang offline. Cộng đồng cần kết nối mạng.<div class="btnrow"><button type="button" data-cretry>↻ Thử lại</button></div></div>`;

  // ================= the tab: browse + my collections =================
  const st = { view: "browse", sort: "stars", tag: "", tagInput: "", items: [], cursor: null, status: "idle", error: "", more: false, seq: 0,
    mine: null, mineError: "", mineSeq: 0 };

  const resetBrowse = () => Object.assign(st, { items: [], cursor: null, status: "idle", error: "", more: false, seq: st.seq + 1 });

  function tagChips() {
    const m = new Map();
    for (const c of st.items) for (const t of c.tags) m.set(t, (m.get(t) || 0) + 1);
    const list = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).filter(t => t !== st.tag).slice(0, 12);
    const on = st.tag ? `<button type="button" class="chip on" data-ctagclear title="Bỏ lọc tag">#${esc(st.tag)} ✕</button>` : "";
    return on + list.map(t => `<button type="button" class="chip" data-ctag="${esc(t)}">#${esc(t)}</button>`).join("");
  }

  const cardHtml = c => `
    <li><button type="button" class="comcard" data-copen="${esc(c.id)}">
      <span class="comtitle">${esc(c.title)}</span>
      <span class="commeta">bởi ${esc(c.ownerName)} · ${c.count} thẻ · ⭐ ${c.stars}</span>
      ${c.tags.length ? `<span class="comtags">${c.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join("")}</span>` : ""}
    </button></li>`;

  function browseHtml() {
    if (!navigator.onLine && !st.items.length) return offlineBlock();
    const list = st.items.length ? `<ul class="comlist">${st.items.map(cardHtml).join("")}</ul>`
      : st.status === "loading" ? `<p class="muted-sm">Đang tải…</p>`
      : st.status === "error" ? ""
      : `<div class="empty">${st.tag ? `Chưa có bộ thẻ nào với tag #${esc(st.tag)}.` : "Chưa có bộ thẻ nào. Hãy là người đầu tiên đăng một bộ!"}</div>`;
    return `
      <div class="scopetabs comsort" role="group" aria-label="Sắp xếp">
        <button type="button" data-csort="stars" aria-pressed="${st.sort === "stars"}">⭐ Nhiều sao</button>
        <button type="button" data-csort="new" aria-pressed="${st.sort === "new"}">🆕 Mới nhất</button>
      </div>
      <form class="comfilter" id="comTagForm">
        <input id="comTag" type="search" maxlength="${C.LIMITS.tag + 1}" autocomplete="off" placeholder="Lọc theo tag, vd: ielts" aria-label="Lọc theo tag" value="${esc(st.tagInput)}">
        <button type="submit" class="small">Lọc</button>
      </form>
      <div class="tags comchips">${tagChips()}</div>
      ${st.error ? `<div class="warn">${esc(st.error)}</div> <button type="button" class="small" data-cretry>↻ Thử lại</button>` : ""}
      ${list}
      ${st.cursor ? `<div class="listfoot"><button type="button" data-cmore${st.more ? " disabled" : ""}>${st.more ? "Đang tải…" : "Tải thêm"}</button></div>` : ""}`;
  }

  function mineHtml() {
    if (st.mine === null && !navigator.onLine) return offlineBlock();
    if (st.mine === null) return st.mineError ? `<div class="warn">${esc(st.mineError)}</div> <button type="button" class="small" data-cretry>↻ Thử lại</button>` : `<p class="muted-sm">Đang tải…</p>`;
    if (!st.mine.length) return `<div class="empty">Bạn chưa đăng bộ thẻ nào.</div>`;
    return `<p class="muted-sm">${st.mine.length}/${C.MAX_PUBLIC} bộ thẻ công khai.</p>` + st.mine.map(m => `
      <div class="mine-row">
        <div><b>${esc(m.title)}</b>
          <div class="muted-sm">${m.count} thẻ · ⭐ ${m.stars} · đăng ${fmt(m.createdAt)}</div>
          ${m.status === "hidden" ? `<div class="muted-sm comhidden">🚫 Đã bị quản trị viên ẩn: người khác không thấy bộ này.</div>` : ""}
        </div>
        <div class="actions">
          <button type="button" class="small" data-copen="${esc(m.id)}" title="Xem">👁</button>
          <button type="button" class="small danger" data-cdel="${esc(m.id)}" title="Gỡ bộ">🗑 Gỡ bộ</button>
        </div>
      </div>`).join("");
  }

  function render() {
    const blocked = gate();
    if (blocked) { body.innerHTML = `<div class="daily pcard"><div class="streak-big">🌐 Cộng đồng</div>${blocked}</div>`; return; }
    body.innerHTML = `
      <div class="daily pcard comhead">
        <div class="streak-big">🌐 Cộng đồng</div>
        <div class="muted-sm">Các bộ thẻ công khai do mọi người chia sẻ. Gắn sao bộ bạn thích, hoặc bấm “Học bộ này” để chép thẻ vào sổ của bạn.</div>
        <button type="button" class="primary" id="comPublish">➕ Đăng bộ của bạn</button>
      </div>
      <div class="scopetabs" role="tablist" aria-label="Cộng đồng">
        <button type="button" role="tab" data-cview="browse" aria-selected="${st.view === "browse"}">Khám phá</button>
        <button type="button" role="tab" data-cview="mine" aria-selected="${st.view === "mine"}">Bộ của tôi</button>
      </div>
      <div id="comView">${st.view === "browse" ? browseHtml() : mineHtml()}</div>`;
    ensureLoaded();
  }

  // Loads what the current view needs, once (a sort / tag change or a retry resets it first).
  function ensureLoaded() {
    if (!ctx.getUser() || !navigator.onLine) return;
    if (st.view === "browse" && st.status === "idle") loadPage(false);
    if (st.view === "mine" && st.mine === null && !st.mineError) loadMine();
  }

  async function loadPage(more) {
    const seq = more ? st.seq : ++st.seq;
    if (more) st.more = true; else st.status = "loading";
    st.error = ""; if (tabOpen()) render();
    try {
      const r = await withTimeout(cloud.listCollections({ sort: st.sort, tag: st.tag, limit: PAGE, after: more ? st.cursor : null }), 20000);
      if (seq !== st.seq) return; // the sort or tag changed meanwhile
      const have = new Set(st.items.map(c => c.id));
      const page = r.items.map(d => C.normCollection(d, d.id)).filter(c => c.status === "public" && !have.has(c.id));
      st.items = more ? st.items.concat(page) : page;
      st.cursor = r.cursor; st.status = "ready";
    } catch (e) {
      if (seq !== st.seq) return;
      st.error = friendly(e); st.status = "error";
    }
    st.more = false;
    if (tabOpen()) render();
  }

  async function loadMine() {
    const user = ctx.getUser(); if (!user) return;
    const seq = ++st.mineSeq; st.mineError = "";
    try {
      const list = await withTimeout(cloud.listMyCollections(user.uid), 20000);
      if (seq !== st.mineSeq) return;
      st.mine = list.map(d => C.normCollection(d, d.id));
    } catch (e) { if (seq === st.mineSeq) { st.mine = null; st.mineError = friendly(e); } }
    if (tabOpen()) render();
  }

  function retry() {
    if (st.view === "browse") { resetBrowse(); } else { st.mine = null; st.mineError = ""; }
    render();
  }

  function applyTag(t) {
    st.tag = oneTag(t); st.tagInput = st.tag; resetBrowse(); render();
  }

  async function removeMine(id) {
    const user = ctx.getUser(), m = (st.mine || []).find(x => x.id === id); if (!user || !m) return;
    if (!confirm(`Gỡ bộ “${m.title}” khỏi Cộng đồng? Bộ và các sao của nó sẽ bị xoá. Thẻ mà người khác đã học vẫn nằm trong sổ của họ.`)) return;
    if (!navigator.onLine) { ctx.toast("Cần kết nối mạng để gỡ bộ."); return; }
    try {
      await withTimeout(cloud.unpublishCollection(user.uid, id), 60000);
      ctx.toast("Đã gỡ bộ ✓");
      st.items = st.items.filter(c => c.id !== id);
    } catch (e) { ctx.toast(friendly(e)); }
    st.mine = null; st.mineError = ""; render();
  }

  body.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.login !== undefined) cloud.signIn("google").catch(() => {});
    else if (b.id === "comPublish") openPublish();
    else if (b.dataset.cview) { st.view = b.dataset.cview; render(); }
    else if (b.dataset.csort) { if (st.sort !== b.dataset.csort) { st.sort = b.dataset.csort; resetBrowse(); render(); } }
    else if (b.dataset.ctag) applyTag(b.dataset.ctag);
    else if (b.dataset.ctagclear !== undefined) applyTag("");
    else if (b.dataset.cmore !== undefined) { if (!st.more && st.cursor) loadPage(true); }
    else if (b.dataset.cretry !== undefined) retry();
    else if (b.dataset.copen) openDetail(b.dataset.copen);
    else if (b.dataset.cdel) removeMine(b.dataset.cdel);
  });
  body.addEventListener("input", e => { if (e.target.id === "comTag") st.tagInput = e.target.value; });
  body.addEventListener("submit", e => { if (e.target.id === "comTagForm") { e.preventDefault(); applyTag(st.tagInput); } });

  // ================= detail dialog =================
  const det = { id: "", col: null, gone: false, cards: null, all: false, cardsError: "", starred: null, starBusy: false, copyBusy: false,
    skipDup: true, report: null, seq: 0 };

  const findCol = id => st.items.find(c => c.id === id) || (st.mine || []).find(c => c.id === id) || null;

  function renderDetail() {
    const blocked = gate();
    if (blocked) { $("#comDlgTitle").textContent = "🌐 Cộng đồng"; dlgBody.innerHTML = blocked; return; }
    const c = det.col, user = ctx.getUser();
    if (det.gone) { $("#comDlgTitle").textContent = "🌐 Cộng đồng"; dlgBody.innerHTML = `<div class="empty">Không tìm thấy bộ này. Có thể chủ bộ đã gỡ, hoặc bộ đã bị ẩn.</div>`; return; }
    if (!c) { $("#comDlgTitle").textContent = "🌐 Cộng đồng"; dlgBody.innerHTML = `<p class="muted-sm">${det.cardsError ? esc(det.cardsError) : "Đang tải…"}</p>`; return; }
    const mine = user && c.owner === user.uid;
    $("#comDlgTitle").textContent = "📦 " + c.title; // textContent: no HTML from the title can run
    const inc = [c.includes.original && "câu gốc", c.includes.note && "ghi chú"].filter(Boolean);
    const shown = det.cards ? det.cards.slice(0, C.LIMITS.preview).map(C.cleanCard).filter(Boolean) : []; // checked + clipped
    const starLabel = det.starred ? `★ Đã gắn sao · ${c.stars}` : `☆ Gắn sao · ${c.stars}`;
    const r = det.report;
    dlgBody.innerHTML = `
      <div class="muted-sm">bởi <b>${esc(c.ownerName)}</b> · ${c.count} thẻ · ⭐ ${c.stars}${c.updatedAt ? ` · cập nhật ${fmt(c.updatedAt)}` : ""}</div>
      ${c.tags.length ? `<div class="tags comtags">${c.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join("")}</div>` : ""}
      ${c.description ? `<p class="comdesc">${esc(c.description)}</p>` : ""}
      ${inc.length ? `<div class="muted-sm">Có kèm ${inc.join(" và ")}.</div>` : ""}
      ${mine && c.status === "hidden" ? `<div class="warn">🚫 Bộ này đã bị quản trị viên ẩn.</div>` : ""}
      <div class="btnrow">
        ${mine ? `<span class="muted-sm">Đây là bộ của bạn.</span>`
          : `<button type="button" data-dstar aria-pressed="${!!det.starred}"${det.starred === null || det.starBusy ? " disabled" : ""}>${starLabel}</button>`}
        <button type="button" class="primary" data-dcopy${det.copyBusy || !det.cards ? " disabled" : ""}>${det.copyBusy ? "Đang chép…" : "📥 Học bộ này"}</button>
      </div>
      <label class="chk"><input type="checkbox" data-dskip${det.skipDup ? " checked" : ""}> Bỏ qua các thẻ đã có trong sổ của tôi</label>
      <h3 class="sect">Xem trước</h3>
      ${det.cardsError ? `<div class="warn">${esc(det.cardsError)}</div>`
        : !det.cards ? `<p class="muted-sm">Đang tải thẻ…</p>`
        : `<ul class="prev">${shown.map(k => `<li><span class="chip t-${esc(k.type)}">${typeLabel(k.type)}</span> <b>${esc(k.text)}</b> <span class="muted-sm">${esc(k.meaning)}</span></li>`).join("")}
           ${c.count > shown.length ? `<li class="muted-sm">… và ${c.count - shown.length} thẻ nữa</li>` : ""}</ul>`}
      ${mine ? "" : !r ? `<button type="button" class="small" data-dreport>🚩 Báo cáo</button>`
        : r.done ? `<p class="muted-sm">${r.pending ? "⏳ Mạng chậm: báo cáo sẽ được gửi khi kết nối ổn định lại. Bạn không cần gửi lại." : "✅ Cảm ơn bạn, báo cáo đã được gửi."}</p>`
        : `<fieldset class="vf"><legend>Báo cáo bộ này</legend>
            <label>Lý do <select id="comReason"><option value="">Chọn lý do…</option>${C.REASONS.map(x => `<option value="${x}"${r.reason === x ? " selected" : ""}>${esc(C.REASON_LABEL[x])}</option>`).join("")}</select></label>
            <label>Ghi chú (không bắt buộc) <textarea id="comReportNote" rows="2" maxlength="${C.LIMITS.reportNote}">${esc(r.note)}</textarea></label>
            ${r.error ? `<div class="warn">${esc(r.error)}</div>` : ""}
            <div class="btnrow"><button type="button" class="small primary" data-dsend${r.busy ? " disabled" : ""}>${r.busy ? "Đang gửi…" : "Gửi báo cáo"}</button><button type="button" class="small" data-dcancel>Huỷ</button></div>
          </fieldset>`}`;
  }

  async function openDetail(id) {
    const seq = ++det.seq;
    Object.assign(det, { id, col: findCol(id), gone: false, cards: null, all: false, cardsError: "", starred: null, starBusy: false, copyBusy: false, report: null });
    dlg.hidden = false; renderDetail(); $("#comDlgClose").focus();
    const user = ctx.getUser(); if (!user) return;
    try {
      const fresh = await withTimeout(cloud.getCollection(id), 20000);
      if (seq !== det.seq) return;
      if (!fresh) { det.gone = true; renderDetail(); return; }
      det.col = C.normCollection(fresh, id);
      syncListCol(det.col);
      renderDetail();
      const mine = det.col.owner === user.uid;
      const [starred, packs] = await Promise.all([
        mine ? Promise.resolve(false) : withTimeout(cloud.getStar(user.uid, id), 20000).catch(() => null),
        withTimeout(cloud.getCollectionCards(id, Math.min(1, det.col.packs)), 30000), // the preview needs pack 0 only
      ]);
      if (seq !== det.seq) return;
      det.starred = starred; det.cards = C.unpack(packs); det.all = det.col.packs <= 1;
    } catch (e) { if (seq !== det.seq) return; det.cardsError = friendly(e); }
    renderDetail();
  }

  // keep the card in the list in step with what the dialog shows (stars)
  function syncListCol(col) {
    const i = st.items.findIndex(c => c.id === col.id);
    if (i >= 0) { st.items[i] = col; if (tabOpen() && st.view === "browse") render(); }
  }

  async function toggleStar() {
    const user = ctx.getUser(), c = det.col;
    if (!user || !c || det.starred === null || det.starBusy) return;
    if (!navigator.onLine) { ctx.toast("Cần kết nối mạng để gắn sao."); return; }
    const on = !det.starred, seq = det.seq;
    det.starBusy = true; det.starred = on; c.stars = Math.max(0, c.stars + (on ? 1 : -1)); // optimistic
    syncListCol(c); renderDetail();
    try { await withTimeout(cloud.setStar(user.uid, c.id, on), 20000); }
    catch (e) {
      // a timeout after the server read means the write is queued and will most likely still arrive: keep the new state
      // (setStar checks the server again next time, so a later tap cannot double it)
      if (e?.message === "timeout") ctx.toast("Mạng chậm: sao sẽ được lưu khi kết nối ổn định lại.");
      else {
        det.starred = !on; c.stars = Math.max(0, c.stars + (on ? -1 : 1)); // revert
        syncListCol(c);
        ctx.toast(friendly(e));
      }
    }
    if (seq === det.seq) { det.starBusy = false; renderDetail(); }
  }

  async function copyCollection() {
    const c = det.col; if (!c || !det.cards || det.copyBusy) return;
    const seq = det.seq;
    if (!det.all) { // the preview loaded pack 0 only: fetch every pack now
      if (!navigator.onLine) { ctx.toast("Cần kết nối mạng để tải bộ thẻ."); return; }
      det.copyBusy = true; renderDetail();
      try {
        const packs = await withTimeout(cloud.getCollectionCards(c.id, c.packs), 60000);
        if (seq !== det.seq) return;
        det.cards = C.unpack(packs); det.all = true;
      } catch (e) { if (seq === det.seq) { det.copyBusy = false; ctx.toast(friendly(e)); renderDetail(); } return; }
    }
    const p = C.planCopy(c.id, det.cards, ctx.getItems(), { skipDuplicates: det.skipDup });
    det.copyBusy = false;
    if (!p.added.length) { ctx.toast(p.skipped ? "Bạn đã có tất cả các thẻ của bộ này." : "Bộ này không có thẻ nào để thêm."); renderDetail(); return; }
    ctx.addItems(p.added);
    ctx.toast(`Đã thêm ${p.added.length} thẻ${p.skipped ? ` (bỏ qua ${p.skipped} thẻ đã có)` : ""} ✓`);
    closeDetail(); ctx.goLibrary();
  }

  async function sendReport() {
    const user = ctx.getUser(), r = det.report; if (!user || !r || r.busy) return;
    r.reason = $("#comReason")?.value ?? r.reason; r.note = $("#comReportNote")?.value ?? r.note;
    const ok = C.cleanReport({ reason: r.reason, note: r.note });
    if (!ok.ok) { r.error = ok.error; renderDetail(); return; }
    if (!navigator.onLine) { r.error = "Cần kết nối mạng để gửi báo cáo."; renderDetail(); return; }
    r.busy = true; r.error = ""; renderDetail();
    try { await withTimeout(cloud.reportCollection(user.uid, det.id, ok.reason, ok.note), 20000); r.done = true; ctx.toast("Đã gửi báo cáo ✓"); }
    catch (e) {
      // a timeout: the report is probably queued and will be sent later, so do not invite a second send
      if (e?.message === "timeout") { r.done = true; r.pending = true; }
      // one report per account and collection: a second one is denied
      else if (e?.code === "permission-denied") r.error = "Không gửi được. Có thể bạn đã báo cáo bộ này trước đó.";
      else r.error = friendly(e);
    }
    r.busy = false; renderDetail();
  }

  function closeDetail() { dlg.hidden = true; det.seq++; }

  dlgBody.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.login !== undefined) cloud.signIn("google").catch(() => {});
    else if (b.dataset.dstar !== undefined) toggleStar();
    else if (b.dataset.dcopy !== undefined) copyCollection();
    else if (b.dataset.dreport !== undefined) { det.report = { reason: "", note: "", error: "", busy: false, done: false }; renderDetail(); $("#comReason")?.focus(); }
    else if (b.dataset.dcancel !== undefined) { det.report = null; renderDetail(); }
    else if (b.dataset.dsend !== undefined) sendReport();
  });
  dlgBody.addEventListener("change", e => {
    if (e.target.dataset.dskip !== undefined) det.skipDup = e.target.checked;
    else if (e.target.id === "comReason" && det.report) det.report.reason = e.target.value;
  });
  dlgBody.addEventListener("input", e => { if (e.target.id === "comReportNote" && det.report) det.report.note = e.target.value; });
  $("#comDlgClose").onclick = closeDetail;
  dlg.onclick = e => { if (e.target === dlg) closeDetail(); };

  // ================= publish dialog =================
  const pub = { types: new Set(V.TYPES), tags: new Set(), title: "", description: "", tagsText: "", ownerName: "", original: false, note: false,
    agree: false, busy: false, errors: [], pubCount: null, done: null, uid: null }; // uid: whose name is in ownerName

  const picked = () => (pub.types.size ? V.pickItems(ctx.getItems(), { types: [...pub.types], tags: [...pub.tags] }) : []);

  function renderPublish() {
    const blocked = gate();
    if (blocked) { pubBody.innerHTML = blocked; return; }
    if (pub.done) {
      pubBody.innerHTML = `<div class="daily linkbox"><div class="streak-big">✅ Đã đăng “${esc(pub.done.title)}”</div>
        <div class="muted-sm">${pub.done.count} thẻ, công khai ngay cho mọi người đã đăng nhập.</div>
        <div class="btnrow"><button type="button" data-pview>👁 Xem bộ</button></div></div>`;
      return;
    }
    const list = picked(), cards = C.toPublicCards(list, { original: pub.original, note: pub.note }), n = cards.length;
    const agentCards = list.filter(i => sourceKind(i) === "agent").length;
    const tags = V.tagCounts(ctx.getItems()).slice(0, 30);
    const full = pub.pubCount !== null && pub.pubCount >= C.MAX_PUBLIC;
    const bad = !n || n > C.MAX_CARDS;
    pubBody.innerHTML = `
      <p class="muted-sm">Bộ thẻ sẽ <b>công khai</b>: mọi người đã đăng nhập đều xem và chép được. Chỉ nội dung thẻ được đăng, tiến độ học thì không. Email của bạn không bao giờ hiện.</p>
      <fieldset class="vf"><legend>Loại thẻ</legend>
        ${V.TYPES.map(t => `<label class="chk"><input type="checkbox" data-ptype="${t}"${pub.types.has(t) ? " checked" : ""}> ${LABEL[t]}</label>`).join("")}
      </fieldset>
      <fieldset class="vf"><legend>Tag (không chọn = tất cả)</legend>
        <div class="tags">${tags.length ? tags.map(([t, c]) => `<button type="button" class="chip${pub.tags.has(t) ? " on" : ""}" data-ptag="${esc(t)}">#${esc(t)} · ${c}</button>`).join("") : '<span class="muted-sm">Chưa có tag.</span>'}</div>
      </fieldset>
      <div class="vsum${bad ? " bad" : ""}">${!n ? "Không có thẻ nào khớp bộ lọc." : n > C.MAX_CARDS ? `${n} thẻ: nhiều hơn mức tối đa ${C.MAX_CARDS}. Hãy chọn theo tag hoặc loại.` : `Sẽ đăng <b>${n}</b> thẻ.`}</div>
      ${agentCards ? `<div class="warn">⚠ ${agentCards} thẻ do AI agent lưu từ các cuộc trò chuyện công việc, có thể chứa thông tin công việc. Hãy xem lại trước khi đăng.</div>` : ""}
      <label>Tên bộ thẻ * <input id="pTitle" maxlength="${C.LIMITS.title}" value="${esc(pub.title)}" autocomplete="off" placeholder="vd: Tiếng Anh khi họp online"></label>
      <label>Mô tả <textarea id="pDesc" rows="3" maxlength="${C.LIMITS.description}" placeholder="Bộ này có gì, dành cho ai…">${esc(pub.description)}</textarea></label>
      <label>Tag (tối đa ${C.LIMITS.tags}, cách nhau bằng dấu phẩy) <input id="pTags" value="${esc(pub.tagsText)}" autocomplete="off" placeholder="ielts, meeting, work"></label>
      <label>Tên hiển thị * <input id="pName" maxlength="${C.LIMITS.ownerName}" value="${esc(pub.ownerName)}" autocomplete="off"></label>
      <fieldset class="vf"><legend>Kèm theo</legend>
        <label class="chk"><input type="checkbox" data-popt="original"${pub.original ? " checked" : ""}> Câu gốc (có thể chứa nội dung công việc riêng tư)</label>
        <label class="chk"><input type="checkbox" data-popt="note"${pub.note ? " checked" : ""}> Ghi chú</label>
      </fieldset>
      <label class="chk"><input type="checkbox" data-popt="agree"${pub.agree ? " checked" : ""}> Mình có quyền chia sẻ những thẻ này và chúng không chứa thông tin riêng tư</label>
      ${full ? `<div class="warn">Bạn đã có ${pub.pubCount}/${C.MAX_PUBLIC} bộ công khai. Hãy gỡ bớt một bộ ở “Bộ của tôi” trước khi đăng thêm.</div>` : ""}
      ${pub.errors.length ? `<div class="warn">${pub.errors.map(esc).join("<br>")}</div>` : ""}
      <button class="primary" type="button" id="pGo"${bad || full || !pub.agree || pub.busy ? " disabled" : ""}>${pub.busy ? "Đang đăng…" : "🌐 Đăng công khai"}</button>`;
  }

  async function loadPubCount() {
    const user = ctx.getUser(); if (!user) return;
    try { pub.pubCount = (await withTimeout(cloud.getCommunityMeta(user.uid), 20000)).pubCount; }
    catch { pub.pubCount = null; } // the rules still enforce the cap
    if (!pubDlg.hidden && !pub.busy) renderPublish();
  }

  function openPublish() {
    const user = ctx.getUser();
    Object.assign(pub, { errors: [], busy: false, done: null, agree: false, pubCount: null });
    if (pub.uid !== (user?.uid || "")) { pub.uid = user?.uid || ""; pub.ownerName = ""; }
    if (!pub.ownerName) pub.ownerName = defaultName(user);
    pubDlg.hidden = false; renderPublish(); loadPubCount();
    $("#comPubClose").focus();
  }

  async function publish() {
    const user = ctx.getUser(); if (!user || pub.busy) return;
    const m = C.cleanMeta({ title: pub.title, description: pub.description, tags: pub.tagsText, ownerName: pub.ownerName });
    pub.errors = [...m.errors];
    if (!pub.agree) pub.errors.push("Hãy đánh dấu ô xác nhận quyền chia sẻ.");
    if (!navigator.onLine) pub.errors.push("Cần kết nối mạng để đăng.");
    let plan = null;
    const cards = C.toPublicCards(picked(), { original: pub.original, note: pub.note });
    if (!pub.errors.length) { try { plan = C.planPublish(cards); } catch (e) { pub.errors.push(e.message); } }
    if (pub.errors.length) { renderPublish(); return; }
    pub.busy = true; renderPublish();
    try {
      const meta = await withTimeout(cloud.getCommunityMeta(user.uid), 20000);
      if (meta.pubCount >= C.MAX_PUBLIC) { pub.pubCount = meta.pubCount; throw new Error(`Bạn đã có ${meta.pubCount}/${C.MAX_PUBLIC} bộ công khai.`); }
      const cid = C.newCollectionId();
      await withTimeout(cloud.publishCollection(user.uid, cid, m.meta, plan, { original: pub.original, note: pub.note }), 120000);
      lsSet(NAME_KEY, JSON.stringify({ uid: user.uid, name: m.meta.ownerName }));
      pub.done = { id: cid, title: m.meta.title, count: plan.count };
      Object.assign(pub, { title: "", description: "", tagsText: "", agree: false });
      ctx.toast("Đã đăng bộ thẻ ✓");
      resetBrowse(); st.mine = null; st.mineError = "";
      if (tabOpen()) render();
    } catch (e) { pub.errors = [friendly(e)]; }
    pub.busy = false; renderPublish();
  }

  pubBody.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.ptype) { t.checked ? pub.types.add(t.dataset.ptype) : pub.types.delete(t.dataset.ptype); renderPublish(); }
    else if (t.dataset.popt) { pub[t.dataset.popt] = t.checked; renderPublish(); }
  });
  pubBody.addEventListener("input", e => {
    const k = { pTitle: "title", pDesc: "description", pTags: "tagsText", pName: "ownerName" }[e.target.id];
    if (k) pub[k] = e.target.value;
  });
  pubBody.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ptag) { pub.tags.has(b.dataset.ptag) ? pub.tags.delete(b.dataset.ptag) : pub.tags.add(b.dataset.ptag); renderPublish(); }
    else if (b.id === "pGo") publish();
    else if (b.dataset.pview !== undefined) { const id = pub.done.id; pubDlg.hidden = true; openDetail(id); }
    else if (b.dataset.login !== undefined) cloud.signIn("google").catch(() => {});
  });
  $("#comPubClose").onclick = () => { pubDlg.hidden = true; };
  pubDlg.onclick = e => { if (e.target === pubDlg) pubDlg.hidden = true; };

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!dlg.hidden) closeDetail();
    if (!pubDlg.hidden) pubDlg.hidden = true;
  });
  // back online: try again what failed
  window.addEventListener("online", () => { if (tabOpen() && st.status !== "loading") { if (st.status === "error") resetBrowse(); render(); } });

  return {
    enabled: true,
    render, // called by showTab("community")
    // called whenever the signed-in user changes (or is first known)
    onUser() {
      resetBrowse(); st.mine = null; st.mineError = ""; st.mineSeq++;
      pub.pubCount = null; pub.done = null;
      const uid = ctx.getUser()?.uid || "";
      if (uid !== pub.uid) { pub.uid = uid; pub.ownerName = ""; } // another account (or signed out): never keep the old name
      if (tabOpen()) render();
      if (!dlg.hidden) { if (ctx.getUser() && det.id) openDetail(det.id); else renderDetail(); }
      if (!pubDlg.hidden) { if (!pub.ownerName) pub.ownerName = defaultName(ctx.getUser()); renderPublish(); loadPubCount(); }
    },
  };
}
