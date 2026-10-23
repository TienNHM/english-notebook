// English Notebook agent API (Cloudflare Worker).
//   App (Firebase login):  POST/GET /v1/tokens, DELETE /v1/tokens/:id   -> manage personal agent tokens
//   Agent (enb_ token):    POST /v1/vocabulary, POST /v1/sentence, GET /v1/items?query=&limit=
// The Firebase service account lives only in the Worker secret SERVICE_ACCOUNT.
import { verifyIdToken, newAgentToken, hashToken, looksLikeAgentToken, bearer } from "./auth.js";
import { firestoreClient } from "./firestore.js";
import { buildVocabulary, buildSentence, dropDuplicates, Invalid, LIMITS } from "./items.js";

export const MAX_TOKENS_PER_USER = 5;
const MAX_BODY = 20_000;
const DEFAULT_DAILY_LIMIT = 200;

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...extra } });
const day = now => new Date(now).toISOString().slice(0, 10);

async function readBody(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Invalid("request is too large");
  try { return text ? JSON.parse(text) : {}; } catch { throw new Invalid("body must be JSON"); }
}

export function createHandler(deps) {
  const { env, kv, fs, now = () => Date.now(), fetch: fetchFn = fetch } = deps;
  const limit = Number(env.DAILY_LIMIT) > 0 ? Number(env.DAILY_LIMIT) : DEFAULT_DAILY_LIMIT;
  const origin = env.ALLOWED_ORIGIN || "";

  const corsFor = req => {
    const o = req.headers.get("origin");
    return o && o === origin
      ? { "access-control-allow-origin": o, "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", vary: "origin" }
      : {};
  };

  async function userTokens(uid) { return JSON.parse((await kv.get(`user:${uid}`)) || "[]"); }

  async function appUser(req) {
    try { return await verifyIdToken(bearer(req), { projectId: env.FIREBASE_PROJECT_ID, fetch: fetchFn, now: now() }); }
    catch { return null; }
  }
  async function agentUser(req) {
    const t = bearer(req);
    if (!looksLikeAgentToken(t)) return null;
    const hash = await hashToken(t);
    const rec = JSON.parse((await kv.get(`tok:${hash}`)) || "null");
    if (!rec) return null;
    return { uid: rec.uid, hash, rec };
  }

  async function tokens(req, url, cors) {
    const user = await appUser(req);
    if (!user) return json({ error: "sign in again" }, 401, cors);
    const idParam = url.pathname.split("/")[3];

    if (req.method === "GET" && !idParam) {
      const list = [];
      for (const h of await userTokens(user.uid)) {
        const r = JSON.parse((await kv.get(`tok:${h}`)) || "null");
        if (r) list.push({ id: h.slice(0, 12), label: r.label, created: r.created, lastUsed: r.lastUsed || null });
      }
      return json({ tokens: list }, 200, cors);
    }
    if (req.method === "POST" && !idParam) {
      const body = await readBody(req);
      const label = String(body.label ?? "").trim().slice(0, 40) || "agent";
      const hashes = await userTokens(user.uid);
      if (hashes.length >= MAX_TOKENS_PER_USER) return json({ error: `at most ${MAX_TOKENS_PER_USER} tokens; delete one first` }, 409, cors);
      const token = newAgentToken(), hash = await hashToken(token);
      await kv.put(`tok:${hash}`, JSON.stringify({ uid: user.uid, label, created: now() }));
      await kv.put(`user:${user.uid}`, JSON.stringify([...hashes, hash]));
      return json({ token, id: hash.slice(0, 12), label }, 201, cors);   // the only time the token is shown
    }
    if (req.method === "DELETE" && idParam) {
      const hashes = await userTokens(user.uid);
      const hash = hashes.find(h => h.startsWith(idParam) && idParam.length >= 12);
      if (!hash) return json({ error: "not found" }, 404, cors);
      await kv.delete(`tok:${hash}`);
      await kv.put(`user:${user.uid}`, JSON.stringify(hashes.filter(h => h !== hash)));
      return json({ ok: true }, 200, cors);
    }
    return json({ error: "not found" }, 404, cors);
  }

  async function agent(req, url) {
    const auth = await agentUser(req);
    if (!auth) return json({ error: "invalid token" }, 401);
    const { uid, hash, rec } = auth;

    if (req.method === "GET" && url.pathname === "/v1/items") {
      const q = (url.searchParams.get("query") || "").slice(0, LIMITS.query).toLowerCase();
      const n = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);
      const rows = (await fs.listItems(uid))
        .sort((a, b) => (a.created ?? 0) - (b.created ?? 0))
        .filter(i => !q || `${i.text} ${i.meaning}`.toLowerCase().includes(q))
        .slice(-n)
        .map(i => ({ type: i.type, text: i.text, meaning: i.meaning }));
      return json({ items: rows });
    }
    if (req.method === "POST" && (url.pathname === "/v1/vocabulary" || url.pathname === "/v1/sentence")) {
      const body = await readBody(req);
      const entries = url.pathname === "/v1/vocabulary" ? buildVocabulary(body, now()) : buildSentence(body, now());
      const { fresh, skipped } = dropDuplicates(entries, await fs.listItems(uid));
      if (fresh.length) {
        const rk = `rate:${uid}:${day(now())}`, used = Number((await kv.get(rk)) || 0);
        if (used + fresh.length > limit) return json({ error: `daily limit of ${limit} items reached` }, 429);
        await fs.addItems(uid, fresh);
        await kv.put(rk, String(used + fresh.length), { expirationTtl: 172800 });
        await kv.put(`tok:${hash}`, JSON.stringify({ ...rec, lastUsed: now() }));
      }
      return json({ added: fresh.map(i => i.text), skipped });
    }
    return json({ error: "not found" }, 404);
  }

  return async function handle(req) {
    const url = new URL(req.url), cors = corsFor(req);
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "english-notebook-agent-api" });
      if (url.pathname === "/v1/tokens" || url.pathname.startsWith("/v1/tokens/")) return await tokens(req, url, cors);
      if (url.pathname.startsWith("/v1/")) return await agent(req, url);
      return json({ error: "not found" }, 404);
    } catch (e) {
      if (e instanceof Invalid) return json({ error: e.message }, 400, cors);
      return json({ error: "server error" }, 500, cors);   // details are never sent to the client
    }
  };
}

let shared;   // one Firestore client per isolate, so the OAuth access token is reused between requests
export default {
  fetch(req, env) {
    shared ??= firestoreClient({ serviceAccount: env.SERVICE_ACCOUNT, projectId: env.FIREBASE_PROJECT_ID });
    return createHandler({ env, kv: env.TOKENS, fs: shared })(req);
  },
};
