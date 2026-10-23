import test from "node:test";
import assert from "node:assert/strict";
import { createAgentApi, friendlyError, AgentApiError, MAX_TOKENS } from "../agent.js";

const res = (status, data) => new Response(JSON.stringify(data), { status });
function api(handler, id = "id-token") {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, ...init }); return handler(url, init); };
  return { calls, api: createAgentApi({ baseUrl: "https://w.example/", getIdToken: async () => id, fetch }) };
}

test("not enabled without a base URL", () => {
  assert.equal(createAgentApi({ baseUrl: "", getIdToken: async () => "x" }).enabled, false);
  assert.equal(createAgentApi({ baseUrl: "https://w.example", getIdToken: async () => "x" }).enabled, true);
});

test("list sends the Firebase ID token and returns the tokens", async () => {
  const { api: a, calls } = api(() => res(200, { tokens: [{ id: "abc", label: "x" }] }));
  assert.deepEqual(await a.list(), [{ id: "abc", label: "x" }]);
  assert.equal(calls[0].url, "https://w.example/v1/tokens");
  assert.equal(calls[0].headers.authorization, "Bearer id-token");
});

test("create trims and limits the label, defaults to agent", async () => {
  const { api: a, calls } = api(() => res(201, { token: "enb_x", id: "1", label: "l" }));
  await a.create("  " + "x".repeat(60) + " ");
  assert.equal(JSON.parse(calls[0].body).label.length, 40);
  await a.create("   ");
  assert.equal(JSON.parse(calls[1].body).label, "agent");
  assert.equal(calls[1].method, "POST");
});

test("revoke encodes the id", async () => {
  const { api: a, calls } = api(() => res(200, { ok: true }));
  await a.revoke("a/b");
  assert.equal(calls[0].url, "https://w.example/v1/tokens/a%2Fb");
  assert.equal(calls[0].method, "DELETE");
});

test("signed out: no request is made", async () => {
  const { api: a, calls } = api(() => res(200, {}), null);
  await assert.rejects(() => a.list(), e => e instanceof AgentApiError && e.status === 401);
  assert.equal(calls.length, 0);
});

test("API errors become friendly Vietnamese messages", async () => {
  for (const [status, re] of [[401, /đăng nhập lại/], [409, new RegExp(String(MAX_TOKENS))], [429, /quá nhiều/], [503, /bận/]]) {
    const { api: a } = api(() => res(status, { error: "x" }));
    await assert.rejects(() => a.list(), e => { assert.match(friendlyError(e), re); return true; });
  }
  const { api: a } = api(() => res(400, { error: "label is bad" }));
  await assert.rejects(() => a.create("x"), e => friendlyError(e) === "label is bad");
});

test("network failure and non-JSON body", async () => {
  const a = createAgentApi({ baseUrl: "https://w.example", getIdToken: async () => "t", fetch: async () => { throw new TypeError("net"); } });
  await assert.rejects(() => a.list(), e => /kết nối/.test(friendlyError(e)));
  const b = createAgentApi({ baseUrl: "https://w.example", getIdToken: async () => "t", fetch: async () => new Response("<html>", { status: 502 }) });
  await assert.rejects(() => b.list(), e => e.status === 502);
});
