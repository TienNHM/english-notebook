# English Notebook agent API (Cloudflare Worker)

Version 2 backend. Users sign in to the app with Google, create a **personal agent token**, and paste only that token into the MCP plugin.
The Firebase service account key stays in a Worker secret on the owner's side.

```
App (Firebase login) --POST /v1/tokens--> Worker --stores hash(token)->uid--> KV
AI agent (enb_ token) --POST /v1/sentence--> Worker --Firestore REST (service account)--> users/<uid>/items
```

## API

| Who | Request | What it does |
|---|---|---|
| App (header `Authorization: Bearer <Firebase ID token>`) | `POST /v1/tokens` `{label}` | Create a token. The token is returned **once**. Max 5 per user. |
| App | `GET /v1/tokens` | List tokens (id, label, created, last used). Never the token itself. |
| App | `DELETE /v1/tokens/:id` | Revoke a token. |
| Agent (header `Authorization: Bearer enb_...`) | `POST /v1/vocabulary` `{text, meaning, kind?, example?, note?, tags?}` | Save a word or phrase. |
| Agent | `POST /v1/sentence` `{text, meaning, original?, expressions?[], note?, tags?}` | Save a sentence and linked expressions. |
| Agent | `GET /v1/items?query=&limit=` | List saved items (to avoid duplicates). |

Rules: exact duplicates (case-insensitive) are skipped; sizes are limited (text 500 chars, 5 expressions, 8 tags, 20 KB body);
at most `DAILY_LIMIT` (default 200) new items per user per day (soft limit: KV is not atomic); errors never include internal details.
CORS allows only `ALLOWED_ORIGIN`.

## Tests

```bash
npm test
```

20 tests with fakes for Google (signing keys, OAuth, Firestore) and KV. They cover ID token checks (wrong audience/issuer/key, expired, tampered),
token create/list/revoke and isolation between users, validation, duplicates, daily limit, CORS and error hiding. No Cloudflare account needed.
The Firestore REST code was also checked once against the real project with a throwaway uid (then deleted).

## Deploy (needs your Cloudflare account)

1. `cd worker && npm i -D wrangler` (or use `npx wrangler`), then `npx wrangler login`.
2. `npx wrangler kv namespace create TOKENS` and put the id in `wrangler.toml`.
3. `npx wrangler secret put SERVICE_ACCOUNT` and paste the service account JSON.
4. `npx wrangler deploy`. Note the Worker URL (optionally add a custom domain such as `agent-api.tiennhm.io.vn`).

The service account needs the Firestore role it already has. Rotate the key if you think it leaked.

## Notes from the live test

- Deployed and checked end to end with a throwaway user: create token, save sentence, duplicate skipped, list, revoke, CORS header, Firebase token rejected as agent token.
- **Revocation is not instant.** Workers KV is eventually consistent, so a revoked token can still work for a short time (measured: a few seconds; Cloudflare documents up to about a minute). Strong consistency would need Durable Objects or D1.
