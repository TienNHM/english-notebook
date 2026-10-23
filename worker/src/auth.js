// Auth helpers: Firebase ID token verification (RS256, Google JWKs) and personal agent tokens.
const enc = new TextEncoder();
const b64uToBytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const bytesToB64u = b => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const parseJson = b64u => JSON.parse(new TextDecoder().decode(b64uToBytes(b64u)));

export const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwkCache = { at: 0, keys: null };

async function googleKeys(fetchFn, now) {
  if (jwkCache.keys && now - jwkCache.at < 3600_000) return jwkCache.keys;
  const res = await fetchFn(JWK_URL);
  if (!res.ok) throw new Error("cannot load Google signing keys");
  jwkCache = { at: now, keys: (await res.json()).keys };
  return jwkCache.keys;
}
export const resetKeyCache = () => { jwkCache = { at: 0, keys: null }; };

// Returns { uid } or throws Error("invalid token: ...").
export async function verifyIdToken(token, { projectId, fetch: fetchFn = fetch, now = Date.now() }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("invalid token: format");
  let header, claims;
  try { header = parseJson(parts[0]); claims = parseJson(parts[1]); } catch { throw new Error("invalid token: format"); }
  if (header.alg !== "RS256" || !header.kid) throw new Error("invalid token: algorithm");
  const jwk = (await googleKeys(fetchFn, now)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("invalid token: unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64uToBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("invalid token: signature");
  const sec = Math.floor(now / 1000);
  if (claims.aud !== projectId) throw new Error("invalid token: audience");
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("invalid token: issuer");
  if (typeof claims.exp !== "number" || claims.exp <= sec) throw new Error("invalid token: expired");
  if (typeof claims.iat !== "number" || claims.iat > sec + 60) throw new Error("invalid token: issued in the future");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) throw new Error("invalid token: subject");
  return { uid: claims.sub };
}

// Personal agent token: "enb_" + 32 random bytes. Only its SHA-256 hash is stored.
export function newAgentToken() {
  return "enb_" + bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
}
export async function hashToken(token) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export const looksLikeAgentToken = t => /^enb_[A-Za-z0-9_-]{43}$/.test(String(t || ""));

export function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  return m ? m[1].trim() : "";
}
export { bytesToB64u, b64uToBytes };
