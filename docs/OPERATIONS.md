# Operations guide

How to set up, deploy, check, update and fix every part of English Notebook. Architecture is in [ARCHITECTURE.md](ARCHITECTURE.md).

Contents: [1. What you need](#1-what-you-need) · [2. Firebase](#2-firebase) · [3. App on GitHub Pages](#3-app-on-github-pages) · [4. Worker on Cloudflare](#4-worker-on-cloudflare) · [5. MCP server and plugin](#5-mcp-server-and-plugin) · [6. Releases](#6-releases) · [7. Secrets and rotation](#7-secrets-and-rotation) · [8. Monitoring and cost](#8-monitoring-and-cost) · [9. Troubleshooting](#9-troubleshooting)

## 1. What you need

| For | You need |
|---|---|
| Using the hosted app | A Google account. |
| Using an AI agent | The app account + Claude Code 2.1.275+ (plugin), or Cursor / Codex… (manual setup). |
| Running your own copy | Firebase project (Auth + Firestore), GitHub repo with Pages, Cloudflare account (free), Node.js 18+. |

Current production values: Firebase project `tiennhm-english-notebook`; app `https://english-notebook.tiennhm.io.vn`; Worker `https://english-notebook-agent-api.tiennhm-it.workers.dev`.

## 2. Firebase

1. Create a project; enable **Authentication → Google** and **Firestore** (production mode).
2. Add a web app and copy its config into `firebase-config.js` (public identifiers, not secrets).
3. Authentication → Settings → **Authorized domains**: add your app domain (and `localhost` for testing).
4. Deploy the rules (after every change of `firestore.rules`):

   ```bash
   npx firebase-tools deploy --only firestore:rules --project <project-id>
   ```

5. Service account key (needed only by the Worker or key mode): Project settings → Service accounts → **Generate new private key**. Keep the file outside any git repo.
6. Rules are checked by hand with `tests/rules.test.mjs` against the real project (it makes temporary users and deletes them).

## 3. App on GitHub Pages

- Settings → Pages → **Source: GitHub Actions**. Custom domain in `CNAME`; DNS: a `CNAME` record from your sub-domain to `<user>.github.io`.
- Every push to `master` runs `.github/workflows/pages.yml` and publishes only the files in its `cp` list.
- **Adding a new app file:** add it to (1) the `cp` line in `pages.yml`, (2) `FILES` in `sw.js`, and (3) bump `CACHE` in `sw.js`. Forgetting (1) gives a 404 on the live site; forgetting (2) breaks offline mode.
- After a deploy the CDN can serve old files for a few minutes (`max-age=14400` on Pages; the service worker checks the network first). Hard refresh (Ctrl+F5) or reopen the app.
- Run the unit tests before pushing:

  ```bash
  node --test tests/progress.test.mjs tests/share.test.mjs tests/vault.test.mjs tests/agent.test.mjs
  ```

## 4. Worker on Cloudflare

Code: `worker/`. Config: `worker/wrangler.toml` (`FIREBASE_PROJECT_ID`, `ALLOWED_ORIGIN`, `DAILY_LIMIT`, KV id).

First deploy (PowerShell, in `worker/`):

```powershell
npx wrangler login
npx wrangler kv namespace create TOKENS
```

Put the printed `id` in `wrangler.toml`. Then upload the secret **from the file with a pipe** and deploy:

```powershell
Get-Content <path-to>\service-account.json -Raw | npx wrangler secret put SERVICE_ACCOUNT
npx wrangler deploy
```

> **Do not** paste the JSON into the secret prompt (it reads one line only, so the secret is cut off) and do not use `<` in PowerShell (not supported). Use the pipe above.

Then:

1. Check: `curl https://<worker-url>/health` → `{"ok":true,...}`.
2. Put the Worker URL in `agentApiUrl` (`firebase-config.js`) and in `DEFAULT_API_URL` (`english-notebook-mcp/api-client.mjs`).
3. Push the app, then try the screen: Library → 🤖 Kết nối AI agent → Tạo token.

Update the Worker: change the code, run `cd worker && npm test`, then `npx wrangler deploy`. Change a limit: edit `DAILY_LIMIT` in `wrangler.toml` and deploy. Logs: `npx wrangler tail`.

Worker tests (no account needed): `cd worker && npm test` (20 tests).

## 5. MCP server and plugin

Repo `english-notebook-mcp`. Modes: token (default for users), key, inbox (see the architecture page).

**Users with Claude Code:**

```bash
claude plugin marketplace add TienNHM/english-notebook-mcp
claude plugin install english-notebook@tiennhm
```

Enter the token when asked (`/plugin configure english-notebook@tiennhm` to change it) and restart Claude Code. The skill `english-notebook:english-coach` comes with it.

**Other agents:** use the copy-paste prompt in the MCP README ("Quick start"), or add the server by hand:

```json
{ "mcpServers": { "english-notebook": {
  "command": "node", "args": ["D:/path/to/english-notebook-mcp/server.mjs"],
  "env": { "ENGLISH_NOTEBOOK_TOKEN": "enb_..." } } } }
```

and install the rule file from `rules/` (Cursor: `.cursor/rules/`; others: `AGENTS.md`). Run `npm install` in the MCP folder first.

**Changing the skill:** edit `skills/english-coach/SKILL.md`, run `npm run build:agents`, then `npm test` (checks tool names against `server.mjs`, that copies are current, and that no personal data is in the skill). Validate the plugin: `claude plugin validate . --strict`.

## 6. Releases

1. Update `CHANGELOG.md` and versions (`.claude-plugin/plugin.json`, `package.json` in the MCP repo).
2. Run all tests and `claude plugin validate . --strict`.
3. Commit, tag `vX.Y.Z`, push with the tag, then create a GitHub release (`gh release create vX.Y.Z`).
4. Users update with `claude plugin update` (or auto-update).

## 7. Secrets and rotation

| Secret | Rotate when | How |
|---|---|---|
| Service account key | Leaked, or on a schedule | Firebase console → create new key → `Get-Content new.json -Raw \| npx wrangler secret put SERVICE_ACCOUNT` → delete the old key (Service accounts → Manage → Keys). |
| A user's agent token | Lost or leaked | The user revokes it in the app and creates a new one; revocation can take up to about a minute. |
| Cloudflare login | Shared computer | `npx wrangler logout`. |

Never commit key files (`.gitignore` in the MCP repo blocks `*-firebase-adminsdk-*.json`, `.env*`). Never paste a key in chat.

## 8. Monitoring and cost

- **Cloudflare:** dashboard → Workers → `english-notebook-agent-api` → metrics (requests, errors). Free plan: 100k requests/day, KV 100k reads and 1k writes/day. Each save does 2 KV writes (daily counter and last-used time), so the **1k KV writes/day** limit means about 500 saves a day across all users. It is the first limit to hit; the paid plan or D1 raises it.
- **Firestore:** console → Usage. Free quota is 20k writes/day for the whole project. The per-user limit (`DAILY_LIMIT`) protects it; lower it if needed.
- **GitHub:** Actions tab for Pages deploys (about 20-60 s).

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Live site looks old | CDN or browser cache. Ctrl+F5, or close and reopen the PWA. Check the cache name in `sw.js` was bumped. |
| 404 for a new file on the live site | The file is missing from the `cp` line in `pages.yml`. |
| "Kết nối AI agent" says server not enabled | `agentApiUrl` is empty in `firebase-config.js`. |
| Screen says "Phiên đăng nhập hết hạn" (401) | Sign in again. If it repeats, check the PC clock (it must be correct within about a minute). |
| `/health` works but token endpoints return 500 | Secret missing or cut off. Re-upload with the pipe command; check `wrangler tail`. |
| Agent says token invalid or revoked | Create a new token in the app; update the plugin setting (`/plugin configure`). |
| "daily limit reached" | 200 new items per user per day (`DAILY_LIMIT`). Resets the next day (UTC). |
| MCP server shows failed in `claude mcp list` | Run `node server.mjs` in the folder to see the error; run `npm install`; check env variables (token alone, or key + uid together). |
| `wrangler secret put ... <` fails in PowerShell | PowerShell has no `<` redirect. Use `Get-Content file -Raw \| ...`. |
| Pasted a multi-line key into the secret prompt | Only the first line was stored and the rest ran as shell commands. Re-upload with the pipe. |
| Items from the agent do not show | Wrong account (the token belongs to the account that created it), or the app is offline; reload while online. |
| Sharing link says not found | Expired, revoked, or the receiver is not signed in. |
