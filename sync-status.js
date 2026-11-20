// Turns a Firestore/Firebase error into a short Vietnamese message for the sync banner, or null when the error is
// normal (offline, a retry in progress) and should stay silent. No DOM here, so it is easy to test.
const QUIET = new Set(["unavailable", "cancelled", "deadline-exceeded", "aborted"]);

export function errorCode(e) {
  return String(e?.code || "").replace(/^(firestore|auth)\//, "");
}

export function describeSyncError(e) {
  const code = errorCode(e);
  if (QUIET.has(code)) return null;
  if (code === "resource-exhausted") return "Firestore đã hết quota hôm nay. Thẻ bạn sửa sẽ tự đồng bộ khi quota được đặt lại hoặc nâng gói.";
  if (code === "permission-denied") return "Không có quyền đọc hoặc ghi dữ liệu trên cloud. Hãy đăng xuất rồi đăng nhập lại.";
  if (code === "unauthenticated") return "Phiên đăng nhập hết hạn. Hãy đăng nhập lại.";
  return `Không đồng bộ được với cloud${code ? ` (mã lỗi: ${code})` : ""}. Dữ liệu vẫn nằm trên máy này.`;
}
