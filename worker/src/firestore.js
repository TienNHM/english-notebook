// Minimal Firestore REST client for a Worker, authenticated with a service account (kept in a Worker secret).
import { bytesToB64u } from "./auth.js";

const enc = new TextEncoder();
const pemToDer = pem => Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), c => c.charCodeAt(0));

export function toValue(v) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  throw new Error("unsupported value type");
}
export const toFields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));
export function fromValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}
export const fromFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fromValue(v)]));

export async function signJwt(sa, scope, nowSec) {
  const head = bytesToB64u(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = bytesToB64u(enc.encode(JSON.stringify({
    iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600,
  })));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(head + "." + claim)));
  return `${head}.${claim}.${bytesToB64u(sig)}`;
}

export function firestoreClient({ serviceAccount, projectId, fetch: fetchFn = fetch, now = () => Date.now() }) {
  const sa = typeof serviceAccount === "string" ? JSON.parse(serviceAccount) : serviceAccount;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  let access = { token: "", exp: 0 };

  async function accessToken() {
    if (access.token && now() < access.exp - 60_000) return access.token;
    const assertion = await signJwt(sa, "https://www.googleapis.com/auth/datastore", Math.floor(now() / 1000));
    const res = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!res.ok) throw new Error("storage auth failed");
    const j = await res.json();
    access = { token: j.access_token, exp: now() + (j.expires_in || 3600) * 1000 };
    return access.token;
  }
  async function call(url, body) {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`storage error ${res.status}`);
    return res.json();
  }

  return {
    // All items of a user (only the fields needed to list and de-duplicate).
    async listItems(uid, limit = 2000) {
      const rows = await call(`${base}/users/${encodeURIComponent(uid)}:runQuery`, {
        structuredQuery: {
          from: [{ collectionId: "items" }],
          select: { fields: ["type", "text", "meaning", "created"].map(fieldPath => ({ fieldPath })) },
          limit,
        },
      });
      return rows.filter(r => r.document).map(r => fromFields(r.document.fields));
    },
    async addItems(uid, items) {
      const root = `projects/${projectId}/databases/(default)/documents/users/${uid}/items`;
      await call(`${base}:commit`, {
        writes: items.map(it => ({ update: { name: `${root}/${it.id}`, fields: toFields(it) } })),
      });
    },
  };
}
