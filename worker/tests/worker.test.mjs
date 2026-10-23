// Worker tests with fakes for Google (JWKs, OAuth, Firestore) and Workers KV. No network, no Cloudflare account.
import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, MAX_TOKENS_PER_USER } from "../src/index.js";
import { firestoreClient, fromFields } from "../src/firestore.js";
import { verifyIdToken, resetKeyCache, JWK_URL, bytesToB64u, hashToken } from "../src/auth.js";
import { buildSentence, buildVocabulary, dropDuplicates, Invalid } from "../src/items.js";

const PROJECT = "demo-project";
const enc = new TextEncoder();
const rsa = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };

const googleKey = await crypto.subtle.generateKey(rsa, true, ["sign", "verify"]);
const googleJwk = { ...(await crypto.subtle.exportKey("jwk", googleKey.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const saKey = await crypto.subtle.generateKey(rsa, true, ["sign", "verify"]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + Buffer.from(await crypto.subtle.exportKey("pkcs8", saKey.privateKey)).toString("base64") + "\n-----END PRIVATE KEY-----\n";
const SA = { client_email: "bot@demo-project.iam.gserviceaccount.com", private_key: pem };

async function idToken(claims = {}, { key = googleKey.privateKey, kid = "k1", alg = "RS256" } = {}, nowMs = Date.now()) {
  const sec = Math.floor(nowMs / 1000);
  const h = bytesToB64u(enc.encode(JSON.stringify({ alg, kid, typ: "JWT" })));
  const p = bytesToB64u(enc.encode(JSON.stringify({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "user-a", iat: sec - 5, exp: sec + 3600, ...claims,
  })));
  const s = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(h + "." + p)));
  return `${h}.${p}.${bytesToB64u(s)}`;
}

function fakeKv() {
  const m = new Map();
  return { m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
}

// In-memory Firestore behind the REST endpoints the Worker calls.
function fakeGoogle() {
  const docs = new Map();      // "users/<uid>/items/<id>" -> fields (Firestore encoded)
  const calls = { oauth: 0, query: 0, commit: 0, jwk: 0 };
  const fetch = async (url, init = {}) => {
    url = String(url);
    const ok = body => new Response(JSON.stringify(body), { status: 200 });
    if (url === JWK_URL) { calls.jwk++; return ok({ keys: [googleJwk] }); }
    if (url === "https://oauth2.googleapis.com/token") {
      calls.oauth++;
      const assertion = new URLSearchParams(init.body).get("assertion");
      const [h, p, s] = assertion.split(".");
      const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", saKey.publicKey,
        Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)), enc.encode(h + "." + p));
      if (!good) return new Response("{}", { status: 400 });
      return ok({ access_token: "access-1", expires_in: 3600 });
    }
    if (init.headers?.authorization !== "Bearer access-1") return new Response("{}", { status: 401 });
    const body = JSON.parse(init.body);
    if (url.endsWith(":runQuery")) {
      calls.query++;
      const uid = decodeURIComponent(url.split("/documents/users/")[1].replace(":runQuery", ""));
      const rows = [...docs].filter(([k]) => k.startsWith(`users/${uid}/items/`)).map(([name, fields]) => ({ document: { name, fields } }));
      return ok(rows.length ? rows : [{ readTime: "now" }]);
    }
    if (url.endsWith(":commit")) {
      calls.commit++;
      for (const w of body.writes) docs.set(w.update.name.split("/documents/")[1], w.update.fields);
      return ok({});
    }
    return new Response("{}", { status: 404 });
  };
  return { docs, calls, fetch };
}

function setup({ now = () => Date.now(), env = {} } = {}) {
  const google = fakeGoogle(), kv = fakeKv();
  const e = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGIN: "https://app.example", ...env };
  const fs = firestoreClient({ serviceAccount: SA, projectId: PROJECT, fetch: google.fetch, now });
  const handle = createHandler({ env: e, kv, fs, now, fetch: google.fetch });
  const call = (method, path, { token, body, origin } = {}) => handle(new Request("https://w.example" + path, {
    method, headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }));
  return { google, kv, call };
}
const makeToken = async (call, who = "user-a", label) =>
  (await (await call("POST", "/v1/tokens", { token: await idToken({ sub: who }), body: { label } })).json());

test.beforeEach(resetKeyCache);

// ---- Firebase ID token verification
test("verifyIdToken accepts a valid token and returns the uid", async () => {
  const g = fakeGoogle();
  assert.deepEqual(await verifyIdToken(await idToken(), { projectId: PROJECT, fetch: g.fetch }), { uid: "user-a" });
});

test("verifyIdToken rejects bad tokens", async () => {
  const g = fakeGoogle(), opts = { projectId: PROJECT, fetch: g.fetch };
  const bad = {
    "wrong audience": await idToken({ aud: "other" }),
    "wrong issuer": await idToken({ iss: "https://securetoken.google.com/other" }),
    "expired": await idToken({ exp: Math.floor(Date.now() / 1000) - 10 }),
    "issued in the future": await idToken({ iat: Math.floor(Date.now() / 1000) + 600 }),
    "empty subject": await idToken({ sub: "" }),
    "unknown key id": await idToken({}, { kid: "nope" }),
    "signed with another key": await idToken({}, { key: saKey.privateKey }),
    "alg none": await idToken({}, { alg: "none" }),
    "garbage": "not.a.jwt",
    "empty": "",
  };
  for (const [why, t] of Object.entries(bad)) await assert.rejects(() => verifyIdToken(t, opts), /invalid token/, why);
});

test("verifyIdToken rejects a token whose payload was changed after signing", async () => {
  const g = fakeGoogle(), t = (await idToken({ sub: "user-a" })).split(".");
  const forged = [t[0], bytesToB64u(enc.encode(JSON.stringify({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "victim", iat: 1, exp: 9999999999 }))), t[2]].join(".");
  await assert.rejects(() => verifyIdToken(forged, { projectId: PROJECT, fetch: g.fetch, now: 2000 }), /invalid token/);
});

test("Google keys are cached between calls", async () => {
  const g = fakeGoogle();
  for (let i = 0; i < 3; i++) await verifyIdToken(await idToken(), { projectId: PROJECT, fetch: g.fetch });
  assert.equal(g.calls.jwk, 1);
});

// ---- token management
test("create, list and delete a personal token", async () => {
  const { call, kv } = setup();
  const t = await makeToken(call, "user-a", "my laptop");
  assert.match(t.token, /^enb_[A-Za-z0-9_-]{43}$/);
  assert.equal(t.label, "my laptop");

  const list = await (await call("GET", "/v1/tokens", { token: await idToken() })).json();
  assert.equal(list.tokens.length, 1);
  assert.equal(list.tokens[0].id, t.id);
  assert.ok(!JSON.stringify(list).includes(t.token), "the list never shows the token");

  assert.ok(![...kv.m.values()].some(v => v.includes(t.token)), "only a hash is stored");
  assert.ok(kv.m.has("tok:" + await hashToken(t.token)));

  const del = await call("DELETE", `/v1/tokens/${t.id}`, { token: await idToken() });
  assert.equal(del.status, 200);
  assert.equal((await call("POST", "/v1/vocabulary", { token: t.token, body: { text: "x", meaning: "y" } })).status, 401);
});

test("token endpoints need a Firebase login, not an agent token", async () => {
  const { call } = setup();
  assert.equal((await call("POST", "/v1/tokens", {})).status, 401);
  const t = await makeToken(call);
  assert.equal((await call("POST", "/v1/tokens", { token: t.token })).status, 401);
  assert.equal((await call("GET", "/v1/tokens", { token: "junk" })).status, 401);
});

test(`at most ${MAX_TOKENS_PER_USER} tokens per user`, async () => {
  const { call } = setup();
  for (let i = 0; i < MAX_TOKENS_PER_USER; i++) assert.equal((await call("POST", "/v1/tokens", { token: await idToken(), body: {} })).status, 201);
  assert.equal((await call("POST", "/v1/tokens", { token: await idToken(), body: {} })).status, 409);
  assert.equal((await call("POST", "/v1/tokens", { token: await idToken({ sub: "user-b" }), body: {} })).status, 201);
});

test("a user cannot delete or see another user's tokens", async () => {
  const { call } = setup();
  const a = await makeToken(call, "user-a");
  assert.equal((await call("DELETE", `/v1/tokens/${a.id}`, { token: await idToken({ sub: "user-b" }) })).status, 404);
  assert.equal((await (await call("GET", "/v1/tokens", { token: await idToken({ sub: "user-b" }) })).json()).tokens.length, 0);
  assert.equal((await call("DELETE", "/v1/tokens/abc", { token: await idToken() })).status, 404);   // too-short id
});

// ---- saving and listing
test("add a sentence with expressions: items land in the right user's notebook", async () => {
  const { call, google } = setup();
  const a = await makeToken(call, "user-a"), b = await makeToken(call, "user-b");
  const res = await call("POST", "/v1/sentence", { token: a.token, body: {
    text: "Can you help me find out why it fails?", meaning: "Bạn giúp tôi tìm lý do nó lỗi được không?", original: "xem giúp tôi",
    expressions: [{ text: "find out", meaning: "tìm ra" }, { text: "why it fails", meaning: "tại sao nó lỗi" }], tags: ["Work"],
  } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).added.length, 3);

  const keys = [...google.docs.keys()];
  assert.equal(keys.length, 3);
  assert.ok(keys.every(k => k.startsWith("users/user-a/items/")), "all under user-a");
  const rows = [...google.docs.values()].map(fromFields);
  const parent = rows.find(r => r.type === "sentence"), kids = rows.filter(r => r.type === "phrase");
  assert.deepEqual(parent.tags, ["work"]);
  assert.ok(kids.every(k => k.sourceId === parent.id));
  assert.equal(parent.box, 0);
  assert.equal(parent.source, "claude");

  const other = await (await call("GET", "/v1/items", { token: b.token })).json();
  assert.deepEqual(other.items, [], "user-b sees nothing of user-a");
});

test("add a word; kind defaults from the text; duplicates are skipped case-insensitively", async () => {
  const { call, google } = setup();
  const t = await makeToken(call);
  assert.equal((await (await call("POST", "/v1/vocabulary", { token: t.token, body: { text: "rollback", meaning: "quay lại bản cũ" } })).json()).added[0], "rollback");
  assert.equal([...google.docs.values()].map(fromFields)[0].type, "word");
  const again = await (await call("POST", "/v1/vocabulary", { token: t.token, body: { text: "ROLLBACK", meaning: "x" } })).json();
  assert.deepEqual(again, { added: [], skipped: ["ROLLBACK"] });
  assert.equal(google.docs.size, 1);
  await call("POST", "/v1/vocabulary", { token: t.token, body: { text: "find out", meaning: "tìm ra" } });
  assert.ok([...google.docs.values()].map(fromFields).some(r => r.text === "find out" && r.type === "phrase"));
});

test("list items filters by query and respects limit", async () => {
  const { call } = setup();
  const t = await makeToken(call);
  for (const [text, meaning] of [["alpha", "một"], ["beta", "hai"], ["gamma", "ba"]])
    await call("POST", "/v1/vocabulary", { token: t.token, body: { text, meaning } });
  assert.equal((await (await call("GET", "/v1/items", { token: t.token })).json()).items.length, 3);
  assert.deepEqual((await (await call("GET", "/v1/items?query=BET", { token: t.token })).json()).items.map(i => i.text), ["beta"]);
  assert.equal((await (await call("GET", "/v1/items?limit=2", { token: t.token })).json()).items.length, 2);
  assert.equal((await (await call("GET", "/v1/items?limit=abc", { token: t.token })).json()).items.length, 3);
});

test("agent endpoints reject missing, wrong, revoked and Firebase tokens", async () => {
  const { call } = setup();
  const body = { text: "a", meaning: "b" };
  assert.equal((await call("POST", "/v1/vocabulary", { body })).status, 401);
  assert.equal((await call("POST", "/v1/vocabulary", { token: "enb_" + "A".repeat(43), body })).status, 401);
  assert.equal((await call("POST", "/v1/vocabulary", { token: await idToken(), body })).status, 401);
  assert.equal((await call("GET", "/v1/items", {})).status, 401);
});

test("input is validated", async () => {
  const { call, google } = setup();
  const t = (await makeToken(call)).token;
  const post = body => call("POST", "/v1/sentence", { token: t, body });
  assert.equal((await post({ text: "", meaning: "x" })).status, 400);
  assert.equal((await post({ text: "x" })).status, 400);
  assert.equal((await post({ text: 5, meaning: "x" })).status, 400);
  assert.equal((await post({ text: "x".repeat(501), meaning: "m" })).status, 400);
  assert.equal((await post({ text: "x", meaning: "m", tags: "work" })).status, 400);
  assert.equal((await post({ text: "x", meaning: "m", tags: Array(9).fill("a") })).status, 400);
  assert.equal((await post({ text: "x", meaning: "m", expressions: Array(6).fill({ text: "a", meaning: "b" }) })).status, 400);
  assert.equal((await post({ text: "x", meaning: "m", expressions: [{ text: "a" }] })).status, 400);
  assert.equal((await call("POST", "/v1/sentence", { token: t, body: "{not json" })).status, 400);
  assert.equal((await call("POST", "/v1/vocabulary", { token: t, body: { text: "x", meaning: "m", kind: "verb" } })).status, 400);
  assert.equal((await post({ text: "x".repeat(30_000), meaning: "m" })).status, 400);
  assert.equal(google.docs.size, 0, "nothing invalid was stored");
});

test("daily limit stops saving and resets the next day", async () => {
  let t0 = Date.now();   // ID tokens are minted with the real clock
  const { call, google } = setup({ now: () => t0, env: { DAILY_LIMIT: "3" } });
  const tok = (await makeToken(call)).token;
  const add = text => call("POST", "/v1/vocabulary", { token: tok, body: { text, meaning: "m" } });
  for (const w of ["a1", "a2", "a3"]) assert.equal((await add(w)).status, 200);
  const blocked = await add("a4");
  assert.equal(blocked.status, 429);
  assert.equal(google.docs.size, 3);
  // a sentence needing 3 items cannot squeeze in either
  t0 += 24 * 3600_000;
  assert.equal((await add("a4")).status, 200);
});

test("a request that would pass the daily limit is refused as a whole", async () => {
  const { call, google } = setup({ env: { DAILY_LIMIT: "2" } });
  const tok = (await makeToken(call)).token;
  const r = await call("POST", "/v1/sentence", { token: tok, body: { text: "s", meaning: "m", expressions: [{ text: "a", meaning: "b" }, { text: "c", meaning: "d" }] } });
  assert.equal(r.status, 429);
  assert.equal(google.docs.size, 0);
});

test("OAuth access token is reused between requests", async () => {
  const { call, google } = setup();
  const tok = (await makeToken(call)).token;
  for (const w of ["w1", "w2", "w3"]) await call("POST", "/v1/vocabulary", { token: tok, body: { text: w, meaning: "m" } });
  assert.equal(google.calls.oauth, 1);
});

test("storage failures return a generic error without leaking details", async () => {
  const kv = fakeKv(), tok = "enb_" + "B".repeat(43);
  await kv.put(`tok:${await hashToken(tok)}`, JSON.stringify({ uid: "user-a", label: "x", created: 1 }));
  const failing = createHandler({
    env: { FIREBASE_PROJECT_ID: PROJECT }, kv,
    fs: { listItems: async () => { throw new Error("secret internal text"); }, addItems: async () => {} },
  });
  const res = await failing(new Request("https://w.example/v1/items", { headers: { authorization: "Bearer " + tok } }));
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes("secret"));
});

// ---- CORS and misc
test("CORS: only the app origin is allowed", async () => {
  const { call } = setup();
  const ok = await call("OPTIONS", "/v1/tokens", { origin: "https://app.example" });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://app.example");
  const no = await call("OPTIONS", "/v1/tokens", { origin: "https://evil.example" });
  assert.equal(no.headers.get("access-control-allow-origin"), null);
  const r = await call("GET", "/v1/tokens", { token: await idToken(), origin: "https://app.example" });
  assert.equal(r.headers.get("access-control-allow-origin"), "https://app.example");
});

test("health check and unknown routes", async () => {
  const { call } = setup();
  assert.equal((await call("GET", "/health")).status, 200);
  assert.equal((await call("GET", "/nope")).status, 404);
  assert.equal((await call("GET", "/v1/unknown", { token: (await makeToken(call)).token })).status, 404);
});

// ---- pure helpers
test("items: builders and de-duplication", () => {
  assert.throws(() => buildVocabulary({ text: " ", meaning: "x" }), Invalid);
  const [s, ...kids] = buildSentence({ text: "Hi", meaning: "Chào", expressions: [{ text: "hi", meaning: "chào" }] }, 1000);
  assert.equal(kids[0].sourceId, s.id);
  assert.equal(s.due, 1000);
  const { fresh, skipped } = dropDuplicates([{ text: "A" }, { text: "a" }, { text: "B" }], [{ text: "b" }]);
  assert.deepEqual([fresh.map(x => x.text), skipped], [["A"], ["a", "B"]]);
});
