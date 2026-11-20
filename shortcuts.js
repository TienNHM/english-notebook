// Desktop keyboard shortcuts: a pure key resolver (no DOM) so the rules are easy to test.
// app.js decides when to ignore a key (typing in a field, a dialog is open) and carries out the returned action.

export const CHORD_MS = 1200;                       // how long "g" waits for its second key
export const GO_TABS = { l: "library", r: "review", t: "rewards", p: "profile" };

// Shown in the help dialog (Vietnamese UI text).
export const SHORTCUT_HELP = [
  ["/", "Tìm kiếm trong Thư viện"],
  ["n", "Mở form thêm thẻ mới"],
  ["Esc", "Thoát chế độ chọn, đóng form và hộp thoại"],
  ["g rồi l", "Đi tới Thư viện"],
  ["g rồi r", "Đi tới Ôn tập"],
  ["g rồi t", "Đi tới Thưởng"],
  ["g rồi p", "Đi tới Profile"],
  ["?", "Hiện bảng phím tắt này"],
];

// state: { g: time the "g" was pressed, or 0 }. Returns { action, state } where action is null or
// { type: "search" | "add" | "escape" | "help" } or { type: "tab", tab }.
export function resolveKey(e, state = { g: 0 }, now = Date.now()) {
  const none = { action: null, state: { g: 0 } };
  if (!e || e.ctrlKey || e.altKey || e.metaKey) return none;
  const key = e.key;
  if (key === "Escape") return { action: { type: "escape" }, state: { g: 0 } };
  if (key === "?") return { action: { type: "help" }, state: { g: 0 } };
  if (key === "Shift") return { action: null, state }; // pressing Shift for "?" must not cancel a pending "g"
  if (state.g && now - state.g <= CHORD_MS) {
    const tab = GO_TABS[String(key).toLowerCase()];
    if (tab) return { action: { type: "tab", tab }, state: { g: 0 } };
  }
  if (key === "g") return { action: null, state: { g: now } };
  if (key === "/") return { action: { type: "search" }, state: { g: 0 } };
  if (key === "n") return { action: { type: "add" }, state: { g: 0 } };
  return none;
}

// True for fields where keys are text, so a shortcut must not fire.
export function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") return !["checkbox", "radio", "button", "submit", "file"].includes((el.type || "").toLowerCase());
  return !!el.isContentEditable;
}
