// "Kết nối AI agent" screen: create a personal token, see the tokens, revoke them. Logic is in agent.js.
import { createAgentApi, friendlyError, MAX_TOKENS, PLUGIN_COMMANDS } from "./agent.js";
import * as cloud from "./cloud.js";
import { agentApiUrl } from "./firebase-config.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = ms => ms ? new Date(ms).toLocaleDateString("vi-VN") : "chưa dùng";

// ctx: { getUser, authKnown, toast }
export function initAgent(ctx) {
  const api = createAgentApi({ baseUrl: agentApiUrl, getIdToken: () => cloud.idToken() });
  const st = { tokens: null, busy: false, error: "", fresh: null, label: "" };

  function render() {
    const el = $("#agentBody");
    if (!cloud.enabled) { el.innerHTML = `<p class="muted-sm">Tính năng này cần bật đăng nhập và đồng bộ (Firebase). Xem README.</p>`; return; }
    if (!api.enabled) { el.innerHTML = `<p class="muted-sm">Máy chủ kết nối AI agent chưa được bật cho bản app này. Xem <code>worker/README.md</code> để triển khai.</p>`; return; }
    if (!ctx.authKnown()) { el.innerHTML = `<p class="muted-sm">Đang kiểm tra đăng nhập…</p>`; return; }
    if (!ctx.getUser()) { el.innerHTML = `<p class="muted-sm">Đăng nhập Google để tạo token cho AI agent.</p><button class="primary" type="button" data-login>Đăng nhập Google</button>`; return; }

    const list = st.tokens;
    el.innerHTML = `
      <p class="muted-sm">Token cho phép AI agent (Claude, Cursor…) lưu từ và câu vào sổ của <b>bạn</b>, không đọc được gì khác. Mỗi token chỉ hiện <b>một lần</b>; mất thì thu hồi và tạo lại.</p>
      ${st.fresh ? `<div class="daily linkbox">
        <div class="streak-big">🔑 Token mới: ${esc(st.fresh.label)}</div>
        <div class="muted-sm">Sao chép ngay, sẽ không hiện lại. Đừng gửi cho ai.</div>
        <input id="agentTokenOut" readonly value="${esc(st.fresh.token)}" aria-label="Token mới">
        <div class="btnrow"><button class="primary" type="button" data-copy>📋 Sao chép token</button></div>
        <ol class="steps">
          <li>Cài plugin (một lần): <code>${esc(PLUGIN_COMMANDS[0])}</code> rồi <code>${esc(PLUGIN_COMMANDS[1])}</code></li>
          <li>Khi Claude Code hỏi <b>token</b>, dán token này vào, rồi khởi động lại Claude Code.</li>
        </ol></div>` : ""}
      ${st.error ? `<div class="warn">${esc(st.error)}</div>` : ""}
      <h3>Token của bạn</h3>
      ${list === null ? `<p class="muted-sm">Đang tải…</p>`
        : !list.length ? `<p class="muted-sm">Chưa có token nào.</p>`
        : `<ul class="prev">${list.map(t => `<li><b>${esc(t.label)}</b> <span class="muted-sm">tạo ${fmt(t.created)} · dùng gần nhất: ${fmt(t.lastUsed)}</span>
            <button type="button" class="small" data-revoke="${esc(t.id)}"${st.busy ? " disabled" : ""}>Thu hồi</button></li>`).join("")}</ul>`}
      ${list && list.length >= MAX_TOKENS ? `<p class="muted-sm">Đã đủ ${MAX_TOKENS} token. Thu hồi một token để tạo mới.</p>`
        : `<label>Tên token <input id="agentLabel" value="${esc(st.label)}" maxlength="40" placeholder="vd: laptop công ty" autocomplete="off"></label>
           <button class="primary" type="button" data-create${st.busy || list === null ? " disabled" : ""}>➕ Tạo token</button>`}`;
  }

  async function load() {
    st.error = "";
    try { st.tokens = await api.list(); } catch (e) { st.tokens = st.tokens ?? []; st.error = friendlyError(e); }
    render();
  }

  async function create() {
    st.label = $("#agentLabel")?.value ?? st.label;
    st.busy = true; st.error = ""; render();
    try {
      st.fresh = await api.create(st.label); st.label = "";
      st.tokens = await api.list();
    } catch (e) { st.error = friendlyError(e); }
    st.busy = false; render();
  }

  async function revoke(id) {
    if (!confirm("Thu hồi token này? Agent đang dùng nó sẽ không lưu được nữa.")) return;
    st.busy = true; st.error = ""; render();
    try { await api.revoke(id); st.tokens = await api.list(); if (st.fresh?.id === id) st.fresh = null; }
    catch (e) { st.error = friendlyError(e); }
    st.busy = false; render();
  }

  async function copy() {
    const v = st.fresh?.token; if (!v) return;
    try { await navigator.clipboard.writeText(v); ctx.toast("Đã sao chép token ✓"); }
    catch { const i = $("#agentTokenOut"); i?.select(); ctx.toast("Hãy nhấn Ctrl+C để sao chép"); }
  }

  const body = $("#agentBody");
  body.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.create !== undefined) create();
    else if (b.dataset.revoke) revoke(b.dataset.revoke);
    else if (b.dataset.copy !== undefined) copy();
    else if (b.dataset.login !== undefined) cloud.signIn("google").catch(() => {});
  });
  body.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "agentLabel") { e.preventDefault(); create(); } });
  const close = () => { $("#agentDlg").hidden = true; st.fresh = null; };   // the token is forgotten when the screen closes
  $("#agentClose").onclick = close;
  $("#agentDlg").onclick = e => { if (e.target.id === "agentDlg") close(); };
  $("#agentBtn").hidden = !cloud.enabled;
  $("#agentBtn").onclick = () => {
    st.tokens = null; st.error = ""; st.fresh = null;
    $("#agentDlg").hidden = false; render(); $("#agentClose").focus();
    if (api.enabled && ctx.getUser()) load();
  };

  return {
    onUser() {
      if ($("#agentDlg").hidden) return;
      st.tokens = null; st.fresh = null; render();
      if (api.enabled && ctx.getUser()) load();
    },
  };
}
