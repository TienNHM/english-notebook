// Screens for sharing a vocabulary vault: "Chia sẻ kho" (create and manage links) and "Nhập từ link/mã" (preview and import).
// The logic (what to share, how to import) is in vault.js, the Firestore calls are in cloud.js.
import * as V from "./vault.js";
import * as cloud from "./cloud.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LABEL = { word: "Từ", phrase: "Cụm từ", sentence: "Câu" };
const fmt = ms => new Date(ms).toLocaleDateString("vi-VN");
const withTimeout = (p, ms = 60000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

function friendly(e) {
  const c = e?.code || e?.message || String(e);
  if (c === "permission-denied") return "Bị từ chối. Hãy kiểm tra bạn đã đăng nhập, và giờ trên máy không bị sai lệch quá nhiều.";
  if (c === "timeout" || c === "unavailable") return "Không kết nối được. Hãy kiểm tra mạng rồi thử lại.";
  return String(e?.message || c);
}

// ctx: { getItems, getUser, authKnown, addItems(list), toast, goLibrary }
export function initVault(ctx) {
  const base = () => location.origin + location.pathname;
  const loginBlock = text => `<p class="muted-sm">${esc(text)}</p><button class="primary" type="button" data-login>Đăng nhập Google</button>`;
  const gate = () => {
    if (!cloud.enabled) return `<p class="muted-sm">Tính năng này cần bật đăng nhập và đồng bộ (Firebase). Xem README.</p>`;
    if (!ctx.authKnown()) return `<p class="muted-sm">Đang kiểm tra đăng nhập…</p>`;
    return null;
  };

  // ================= create and manage links =================
  const sh = { types: new Set(V.TYPES), tags: new Set(), original: false, note: false, showName: false, name: "Kho từ vựng của mình", days: 30,
    busy: false, error: "", created: null, mine: null };

  const selection = () => {
    if (!sh.types.size) return [];
    const picked = V.pickItems(ctx.getItems(), { types: [...sh.types], tags: [...sh.tags] });
    return V.toShared(picked, { original: sh.original, note: sh.note });
  };

  function renderShare() {
    const el = $("#vaultBody"), blocked = gate();
    if (blocked) { el.innerHTML = blocked; return; }
    const user = ctx.getUser();
    if (!user) { el.innerHTML = loginBlock("Đăng nhập Google để tạo link chia sẻ."); return; }
    const sel = selection(), n = sel.length, bad = !n || n > V.MAX_ITEMS;
    const tags = V.tagCounts(ctx.getItems()).slice(0, 30);
    el.innerHTML = `
      <p class="muted-sm">Tạo một link để người khác nhập <b>một bản sao</b> các thẻ của bạn. Tiến độ học (box, hạn ôn, streak) <b>không</b> được chia sẻ. Ai có link và đã đăng nhập đều xem được cho đến khi hết hạn hoặc bạn xoá link.</p>
      <fieldset class="vf"><legend>Loại thẻ</legend>
        ${V.TYPES.map(t => `<label class="chk"><input type="checkbox" data-vtype="${t}"${sh.types.has(t) ? " checked" : ""}> ${LABEL[t]}</label>`).join("")}
      </fieldset>
      <fieldset class="vf"><legend>Tag (không chọn = tất cả)</legend>
        <div class="tags">${tags.length ? tags.map(([t, c]) => `<button type="button" class="chip${sh.tags.has(t) ? " on" : ""}" data-vtag="${esc(t)}">#${esc(t)} · ${c}</button>`).join("") : '<span class="muted-sm">Chưa có tag.</span>'}</div>
      </fieldset>
      <fieldset class="vf"><legend>Kèm theo</legend>
        <label class="chk"><input type="checkbox" data-vopt="original"${sh.original ? " checked" : ""}> Câu gốc (có thể chứa nội dung công việc riêng tư)</label>
        <label class="chk"><input type="checkbox" data-vopt="note"${sh.note ? " checked" : ""}> Ghi chú</label>
        <label class="chk"><input type="checkbox" data-vopt="showName"${sh.showName ? " checked" : ""}> Hiện tên của tôi cho người nhận</label>
      </fieldset>
      <label>Tên kho <input id="vName" maxlength="80" value="${esc(sh.name)}" autocomplete="off"></label>
      <label>Hết hạn sau <select id="vDays">${V.EXPIRY_DAYS.map(d => `<option value="${d}"${d === sh.days ? " selected" : ""}>${d} ngày</option>`).join("")}</select></label>
      <div class="vsum${bad ? " bad" : ""}">${!n ? "Không có thẻ nào khớp bộ lọc." : n > V.MAX_ITEMS ? `${n} thẻ: nhiều hơn mức tối đa ${V.MAX_ITEMS}. Hãy chọn theo tag hoặc loại.` : `Sẽ chia sẻ <b>${n}</b> thẻ.`}</div>
      <button class="primary" type="button" id="vCreate"${bad || sh.busy ? " disabled" : ""}>${sh.busy ? "Đang tạo…" : "🔗 Tạo link"}</button>
      ${sh.error ? `<div class="warn">${esc(sh.error)}</div>` : ""}
      ${sh.created ? createdHtml(sh.created) : ""}
      <h3 class="sect">Link đã tạo</h3>
      <div id="vMine">${mineHtml()}</div>`;
  }

  const createdHtml = c => `
    <div class="daily linkbox">
      <div class="streak-big">✅ Đã tạo link</div>
      <input readonly value="${esc(c.link)}" data-select aria-label="Link chia sẻ">
      <div class="muted-sm">Mã: <b>${esc(c.id)}</b> · ${c.count} thẻ · hết hạn ${fmt(c.expiresAt)}</div>
      <div class="btnrow"><button type="button" data-vcopy="${esc(c.link)}">📋 Chép link</button>${navigator.share ? `<button type="button" data-vnative>📲 Gửi…</button>` : ""}</div>
    </div>`;

  const mineHtml = () => {
    if (sh.mine === null) return `<p class="muted-sm">Đang tải…</p>`;
    if (!sh.mine.length) return `<p class="muted-sm">Chưa có link nào.</p>`;
    return sh.mine.map(m => {
      const expired = m.expiresAt <= Date.now(), link = V.shareLink(base(), m.id);
      return `<div class="mine-row">
        <div><b>${esc(m.name)}</b><div class="muted-sm">${m.count} thẻ · ${expired ? "đã hết hạn " : "hết hạn "}${fmt(m.expiresAt)}</div></div>
        <div class="actions">${expired ? "" : `<button type="button" class="small" data-vcopy="${esc(link)}">📋</button>`}<button type="button" class="small" data-vdel="${esc(m.id)}" title="Xoá link">🗑</button></div>
      </div>`;
    }).join("");
  };

  async function loadMine() {
    const user = ctx.getUser(); if (!user) return;
    try { sh.mine = await withTimeout(cloud.listMyShares(user.uid), 20000); } catch { sh.mine = []; }
    if (!$("#vaultDlg").hidden) renderShare();
  }

  async function create() {
    const user = ctx.getUser(), sel = selection();
    if (!user || !sel.length || sel.length > V.MAX_ITEMS) return;
    if (!navigator.onLine) { sh.error = "Cần kết nối mạng để tạo link."; renderShare(); return; }
    sh.busy = true; sh.error = ""; sh.created = null; renderShare();
    const now = Date.now(), id = V.newShareId();
    const meta = { id, name: sh.name.trim().slice(0, 80) || "Kho từ vựng", from: sh.showName ? String(user.displayName || "").slice(0, 80) : "",
      createdAt: now, expiresAt: V.expiresAt(sh.days, now), includes: { original: sh.original, note: sh.note } };
    try {
      await withTimeout(cloud.createShare(user.uid, meta, sel));
      sh.created = { id, link: V.shareLink(base(), id), count: sel.length, expiresAt: meta.expiresAt };
      sh.mine = null; loadMine();
    } catch (e) { sh.error = friendly(e); }
    sh.busy = false; renderShare();
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); ctx.toast("Đã chép ✓"); }
    catch { const i = document.querySelector("#vaultBody [data-select]"); if (i) { i.select(); ctx.toast("Hãy nhấn Ctrl+C để chép"); } }
  }

  async function removeShare(id) {
    const user = ctx.getUser(); if (!user) return;
    if (!confirm("Xoá link này? Người khác sẽ không nhập được nữa. Các thẻ đã được nhập về sổ của họ không bị ảnh hưởng.")) return;
    try { await withTimeout(cloud.deleteShare(user.uid, id)); ctx.toast("Đã xoá link ✓"); if (sh.created?.id === id) sh.created = null; }
    catch (e) { sh.error = friendly(e); }
    sh.mine = null; renderShare(); loadMine();
  }

  function openShare() {
    $("#vaultDlg").hidden = false; sh.error = ""; sh.mine = null; renderShare(); loadMine();
    $("#vaultClose").focus();
  }

  const vb = $("#vaultBody");
  vb.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.vtype) { t.checked ? sh.types.add(t.dataset.vtype) : sh.types.delete(t.dataset.vtype); sh.created = null; renderShare(); }
    else if (t.dataset.vopt) { sh[t.dataset.vopt] = t.checked; sh.created = null; renderShare(); }
    else if (t.id === "vDays") sh.days = +t.value;
  });
  vb.addEventListener("input", e => { if (e.target.id === "vName") sh.name = e.target.value; });
  vb.addEventListener("click", e => {
    const b = e.target.closest("button, input[data-select]"); if (!b) return;
    if (b.dataset.vtag) { sh.tags.has(b.dataset.vtag) ? sh.tags.delete(b.dataset.vtag) : sh.tags.add(b.dataset.vtag); sh.created = null; renderShare(); }
    else if (b.id === "vCreate") create();
    else if (b.dataset.vcopy) copy(b.dataset.vcopy);
    else if (b.dataset.vdel) removeShare(b.dataset.vdel);
    else if (b.dataset.vnative) navigator.share({ title: "Kho từ vựng English Notebook", text: `${sh.name}: ${sh.created.count} thẻ`, url: sh.created.link }).catch(() => {});
    else if (b.dataset.login !== undefined) cloud.signIn("google").catch(() => {});
    else if (b.dataset.select !== undefined) b.select();
  });
  vb.addEventListener("focusin", e => { if (e.target.dataset?.select !== undefined) e.target.select(); });
  $("#vaultClose").onclick = () => { $("#vaultDlg").hidden = true; };
  $("#vaultDlg").onclick = e => { if (e.target.id === "vaultDlg") $("#vaultDlg").hidden = true; };

  // ================= import =================
  const imp = { status: "idle", input: "", id: "", share: null, error: "", skipDup: true, tag: true, done: null };

  const plan = () => V.planImport(imp.share.items, ctx.getItems(), { skipDuplicates: imp.skipDup, tag: imp.tag });

  function renderImport() {
    const el = $("#importBody"), blocked = gate();
    if (blocked) { el.innerHTML = blocked; return; }
    const user = ctx.getUser();
    if (!user) { el.innerHTML = loginBlock("Đăng nhập Google để xem và nhập kho được chia sẻ."); return; }
    if (imp.status === "loading") { el.innerHTML = `<p class="muted-sm">Đang tải kho…</p>`; return; }
    if (imp.status === "done") {
      el.innerHTML = `<div class="daily linkbox"><div class="streak-big">🎉 Đã nhập ${imp.done.added} thẻ</div>
        <div class="muted-sm">${imp.done.skipped ? `Bỏ qua ${imp.done.skipped} thẻ đã có. ` : ""}Các thẻ mới nằm ở box 0 và đến hạn ôn ngay.</div>
        <div class="btnrow"><button type="button" data-igo>📚 Xem thư viện</button></div></div>`;
      return;
    }
    if (imp.status === "ready") {
      const s = imp.share, p = plan(), n = p.added.length;
      el.innerHTML = `
        <div class="daily linkbox">
          <div class="streak-big">📦 ${esc(s.name)}</div>
          <div class="muted-sm">${s.from ? `Từ ${esc(s.from)} · ` : ""}${s.items.length} thẻ · hết hạn ${fmt(s.expiresAt)}</div>
        </div>
        <div class="vsum">Sẽ nhập <b>${n}</b> thẻ (${LABEL.word}: ${p.byType.word}, ${LABEL.phrase}: ${p.byType.phrase}, ${LABEL.sentence}: ${p.byType.sentence})${p.skipped ? `. Bỏ qua <b>${p.skipped}</b> thẻ đã có.` : "."}</div>
        <ul class="prev">${p.added.slice(0, 8).map(a => `<li><b>${esc(a.text)}</b> <span class="muted-sm">${esc(a.meaning)}</span></li>`).join("")}${n > 8 ? `<li class="muted-sm">… và ${n - 8} thẻ nữa</li>` : ""}</ul>
        <label class="chk"><input type="checkbox" data-iopt="skipDup"${imp.skipDup ? " checked" : ""}> Bỏ qua các thẻ đã có trong sổ của tôi</label>
        <label class="chk"><input type="checkbox" data-iopt="tag"${imp.tag ? " checked" : ""}> Gắn tag #shared để dễ tìm</label>
        <button class="primary" type="button" data-iimport${n ? "" : " disabled"}>📥 Nhập ${n} thẻ</button>`;
      return;
    }
    el.innerHTML = `
      <p class="muted-sm">Dán link hoặc mã mà bạn nhận được. Các thẻ sẽ được <b>sao chép</b> vào sổ của bạn, sổ của người chia sẻ không bị thay đổi.</p>
      <label>Link hoặc mã <input id="iInput" value="${esc(imp.input)}" autocomplete="off" placeholder="https://…/?import=… hoặc mã 22 ký tự"></label>
      ${imp.error ? `<div class="warn">${esc(imp.error)}</div>` : ""}
      <button class="primary" type="button" data-ipreview>🔎 Xem trước</button>`;
  }

  async function loadShare(id) {
    imp.id = id; imp.status = "loading"; imp.error = ""; renderImport();
    try {
      const s = await withTimeout(cloud.getShare(id), 30000);
      if (!s) throw Object.assign(new Error("notfound"), { code: "permission-denied" });
      imp.share = s; imp.status = "ready";
    } catch (e) {
      imp.status = "idle";
      imp.error = e?.code === "permission-denied" ? "Không tìm thấy kho này. Link có thể đã hết hạn hoặc đã bị người chia sẻ xoá." : friendly(e);
    }
    renderImport();
  }

  function preview() {
    const id = V.parseShareInput($("#iInput")?.value ?? imp.input);
    imp.input = $("#iInput")?.value ?? imp.input;
    if (!id) { imp.error = "Link hoặc mã không đúng. Mã gồm 22 ký tự chữ, số, - và _."; renderImport(); return; }
    loadShare(id);
  }

  function doImport() {
    const p = plan(); if (!p.added.length) return;
    ctx.addItems(p.added);
    imp.done = { added: p.added.length, skipped: p.skipped }; imp.status = "done"; renderImport();
    ctx.toast(`Đã nhập ${p.added.length} thẻ ✓`);
  }

  function openImport(id) {
    Object.assign(imp, { status: "idle", error: "", share: null, done: null, input: id || "", id: id || "" });
    $("#importDlg").hidden = false; renderImport();
    if (id && ctx.getUser()) loadShare(id);
    $("#importClose").focus();
  }

  const ib = $("#importBody");
  ib.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ipreview !== undefined) preview();
    else if (b.dataset.iimport !== undefined) doImport();
    else if (b.dataset.igo !== undefined) { $("#importDlg").hidden = true; ctx.goLibrary(); }
    else if (b.dataset.login !== undefined) cloud.signIn("google").catch(() => {});
  });
  ib.addEventListener("change", e => { const k = e.target.dataset.iopt; if (k) { imp[k] = e.target.checked; renderImport(); } });
  ib.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "iInput") { e.preventDefault(); preview(); } });
  $("#importClose").onclick = () => { $("#importDlg").hidden = true; };
  $("#importDlg").onclick = e => { if (e.target.id === "importDlg") $("#importDlg").hidden = true; };

  $("#vaultShareBtn").onclick = openShare;
  $("#vaultImportBtn").onclick = () => openImport();
  for (const id of ["vaultShareBtn", "vaultImportBtn"]) $("#" + id).hidden = !cloud.enabled;

  return {
    // a link like https://…/?import=ID opens the import screen straight away
    handleUrl() {
      const id = V.parseShareInput(location.search);
      if (!id) return false;
      history.replaceState(null, "", location.pathname + location.hash); // do not keep the code in the address bar
      openImport(id);
      return true;
    },
    // called whenever the signed-in user changes (or is first known)
    onUser() {
      if (!$("#importDlg").hidden) {
        if (ctx.getUser() && imp.status === "idle" && imp.id && !imp.error) loadShare(imp.id); else renderImport();
      }
      if (!$("#vaultDlg").hidden) { sh.mine = null; renderShare(); loadMine(); }
    },
  };
}
