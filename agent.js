// Client of the agent API Worker (worker/): create, list and revoke personal agent tokens.
// No DOM and no Firebase here, so it is easy to test: the Firebase ID token and fetch are passed in.
export const MAX_TOKENS = 5;
export const PLUGIN_COMMANDS = [
  "claude plugin marketplace add TienNHM/english-notebook-mcp",
  "claude plugin install english-notebook@tiennhm",
];

export class AgentApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const LABELS = {
  401: "Phiên đăng nhập hết hạn. Hãy đăng nhập lại.",
  409: `Bạn đã có ${MAX_TOKENS} token. Hãy thu hồi một token trước.`,
  429: "Bạn thao tác quá nhiều. Hãy thử lại sau ít phút.",
};
export function friendlyError(e) {
  if (e instanceof AgentApiError) return LABELS[e.status] || (e.status >= 500 ? "Máy chủ đang bận. Hãy thử lại sau." : e.message);
  return "Không kết nối được. Hãy kiểm tra mạng rồi thử lại.";
}

export function createAgentApi({ baseUrl, getIdToken, fetch: fetchFn = (...a) => fetch(...a) }) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  async function call(method, path, body) {
    const idToken = await getIdToken();
    if (!idToken) throw new AgentApiError("not signed in", 401);
    const res = await fetchFn(root + path, {
      method,
      headers: { authorization: "Bearer " + idToken, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty or invalid body */ }
    if (!res.ok) throw new AgentApiError(data?.error || `HTTP ${res.status}`, res.status);
    return data;
  }
  return {
    enabled: !!root,
    async list() { return (await call("GET", "/v1/tokens")).tokens; },
    // The token itself is returned only here and never again.
    async create(label) { return call("POST", "/v1/tokens", { label: String(label || "").trim().slice(0, 40) || "agent" }); },
    async revoke(id) { await call("DELETE", "/v1/tokens/" + encodeURIComponent(id)); },
  };
}
