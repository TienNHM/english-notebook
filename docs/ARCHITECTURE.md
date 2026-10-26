# English Notebook: system architecture

Diagrams are [Mermaid](https://mermaid.js.org/); GitHub draws them in the page. Version 2.0.

Contents: [1. Landscape](#1-system-landscape) · [2. Components](#2-components) · [3. Flows](#3-main-flows) · [4. Data model](#4-data-model) · [5. Deployment](#5-deployment-and-ci) · [6. Security](#6-security-and-trust-boundaries) · [7. Limits and decisions](#7-limits-and-design-decisions)

## 1. System landscape

Who talks to whom. Arrows show the direction of the request.

```mermaid
flowchart LR
  user(["👤 Learner"])

  subgraph devices["Learner's devices"]
    pwa["📱 English Notebook PWA<br/>(browser / installed app)"]
    agent["🤖 AI agent<br/>Claude Code, Cursor, Codex…"]
    skill["📘 English Coach skill<br/>(rules for the agent)"]
    mcp["🔌 MCP server<br/>english-notebook-mcp (Node, stdio)"]
  end

  subgraph github["GitHub (TienNHM)"]
    repoApp[("english-notebook<br/>app + worker code")]
    repoMcp[("english-notebook-mcp<br/>MCP + skill + plugin")]
    actions["⚙️ Actions<br/>Deploy to GitHub Pages"]
    pages["🌐 GitHub Pages<br/>english-notebook.tiennhm.io.vn"]
  end

  subgraph cf["Cloudflare"]
    worker["⚡ Worker<br/>agent API"]
    kv[("KV: TOKENS<br/>token hashes, rate counters")]
  end

  subgraph google["Google / Firebase project"]
    auth["🔐 Firebase Auth<br/>Google sign-in"]
    fs[("Firestore<br/>users/*, shares/*")]
  end

  user --> pwa
  user --> agent
  agent -. "follows" .-> skill
  agent -- "MCP tools<br/>add_sentence, add_vocabulary, list_inbox" --> mcp

  pwa -- "load app files" --> pages
  pwa -- "sign in" --> auth
  pwa -- "read / write own notebook<br/>(rules by uid)" --> fs
  pwa -- "create / list / revoke token<br/>(Firebase ID token)" --> worker

  mcp -- "HTTPS + personal token (enb_…)" --> worker
  worker --> kv
  worker -- "verify ID token (Google JWKs)" --> auth
  worker -- "REST + service account<br/>(secret in Worker)" --> fs

  repoApp --> actions --> pages
  repoMcp -. "plugin marketplace<br/>(claude plugin install)" .-> devices
```

**Key idea of version 2:** the Firebase admin key lives only in the Worker. A user's machine holds only a personal token that can write to that user's own notebook, nothing else.

## 2. Components

| Component | Where | Tech | Role |
|---|---|---|---|
| **PWA** | repo `english-notebook`, GitHub Pages | Plain JS modules, service worker, Firebase Web SDK (loaded from gstatic) | UI: cards, Leitner review, streak/XP/badges, 4 styles, vault sharing, token screen. Works offline. |
| **Worker (agent API)** | `english-notebook/worker`, Cloudflare | Workers runtime, WebCrypto, KV | Verifies Firebase login, manages personal tokens, saves/lists items for agents with limits. |
| **MCP server** | repo `english-notebook-mcp`, runs on the learner's PC | Node 18+, `@modelcontextprotocol/sdk` | Gives agents three tools. Token mode (calls Worker), key mode (Firestore Admin SDK) or inbox mode (file). |
| **Skill / rules** | `skills/`, `rules/` in the MCP repo | Markdown | Tells the agent to coach English and when to call the tools. One source, copies for Cursor and `AGENTS.md`. |
| **Plugin + marketplace** | `.claude-plugin/` in the MCP repo | Claude Code plugin format | One-step install of MCP server + skill; asks for the token. |
| **Firebase Auth** | Google | Google sign-in | Identity (uid). |
| **Firestore** | Google | Rules per uid | Notebook data, progress, shared vaults. |

Module map of the PWA:

```mermaid
flowchart TB
  html["index.html + style.css<br/>markup, design tokens"] --> app
  app["app.js<br/>main UI, state, review, rewards"] --> progress["progress.js<br/>streak, XP, badges, Leitner"]
  app --> share["share.js<br/>share text, canvas card"]
  app --> vaultui["vault-ui.js"] --> vault["vault.js<br/>what leaves an account, import plan"]
  app --> agentui["agent-ui.js"] --> agentjs["agent.js<br/>Worker client"]
  app --> cloud["cloud.js<br/>Firebase wrapper"]
  vaultui --> cloud
  agentui --> cloud
  cloud --> sdk[("Firebase SDK")]
  sw["sw.js<br/>offline cache"] -. "caches" .-> html
```

## 3. Main flows

### 3.1 Sign in and sync

```mermaid
sequenceDiagram
  actor U as Learner
  participant P as PWA
  participant A as Firebase Auth
  participant F as Firestore
  U->>P: open app
  P->>P: load local data (localStorage, works offline)
  U->>P: "Sign in with Google"
  P->>A: popup sign-in
  A-->>P: user (uid)
  P->>F: listen users/uid/items and meta/progress
  F-->>P: documents (also from offline cache)
  U->>P: add / review a card
  P->>F: write users/uid/items/id (rules: only the owner)
  F-->>P: snapshot update (other devices get it too)
```

### 3.2 Create a personal agent token

```mermaid
sequenceDiagram
  actor U as Learner
  participant P as PWA (Library → Kết nối AI agent)
  participant W as Worker
  participant G as Google JWKs
  participant K as KV
  U->>P: "Tạo token"
  P->>P: getIdToken() from Firebase Auth
  P->>W: POST /v1/tokens (Bearer Firebase ID token)
  W->>G: load signing keys (cached 1 h)
  W->>W: check signature, aud, iss, exp
  W->>W: new token enb_ + 32 random bytes
  W->>K: put tok:sha256(token) = uid, label, created
  W->>K: put user:uid = list of hashes (max 5)
  W-->>P: token (shown ONCE)
  P-->>U: copy button + plugin steps
```

### 3.3 The agent saves a sentence

```mermaid
sequenceDiagram
  actor U as Learner
  participant A as AI agent (+ English Coach skill)
  participant M as MCP server
  participant W as Worker
  participant K as KV
  participant F as Firestore
  U->>A: request in Vietnamese
  A->>U: coach block + answer (simple English + Vietnamese)
  A->>M: add_sentence(text, meaning, original, expressions, tags)
  M->>W: POST /v1/sentence (Bearer enb_…)
  W->>K: get tok:sha256(token) → uid
  W->>W: validate sizes, build items
  W->>F: runQuery users/uid/items (find duplicates)
  W->>K: check daily counter (limit 200)
  W->>F: commit users/uid/items/* (service account)
  W->>K: update counter, lastUsed
  W-->>M: added[], skipped[]
  M-->>A: "Added 3. Saved to your English Notebook"
  Note over F,U: The app shows the new cards at once (live listener)
```

### 3.4 Share a vocabulary vault to another account

```mermaid
sequenceDiagram
  actor A as Owner
  actor B as Receiver
  participant P as PWA
  participant F as Firestore
  A->>P: choose types/tags, expiry, what to include
  P->>P: toShared() keeps only text, meaning, example, type, tags (no progress)
  P->>F: create shares/id (22-char random id) + shares/id/items/*
  P-->>A: link ?import=id (and code)
  A-->>B: send link
  B->>P: open link, sign in
  P->>F: read shares/id (signed-in users only)
  P-->>B: preview (counts, duplicates skipped)
  B->>P: import
  P->>F: write copies into B's own notebook (box 0, tag #shared)
  A->>P: revoke (delete items, then the share)
```

## 4. Data model

```mermaid
erDiagram
  USER ||--o{ ITEM : "users/uid/items"
  USER ||--|| PROGRESS : "users/uid/meta/progress"
  USER ||--o{ SHARE : "owns (owner = uid)"
  SHARE ||--o{ SHARE_ITEM : "shares/id/items"
  ITEM ||--o{ ITEM : "sourceId (expression → sentence)"

  ITEM {
    string id
    string type "word | phrase | sentence"
    string text
    string meaning
    string example
    string note
    string original
    string sourceId
    string source "claude | shared | empty"
    string_array tags
    int box "Leitner 0-5"
    int due "ms"
    int created "ms"
    int reviews
  }
  PROGRESS {
    map days "YYYY-MM-DD → n, xp, f (goal met), z (freeze used)"
    map badges "id → unlocked at (ms)"
    int fe "freezes earned"
    int goal "5, 10, 15, 20 or 30 cards a day"
    int updated "ms"
  }
  SHARE {
    string owner
    string name
    string from
    int count
    int createdAt
    int expiresAt "7, 30 or 90 days"
    map includes
  }
  SHARE_ITEM {
    string type
    string text
    string meaning
    string example
    string_array tags
    string original "only if the owner chose to include it"
    string note "only if the owner chose to include it"
    string sourceId "only if the sentence is shared too"
  }
```

Worker storage (Cloudflare KV, not Firestore):

| Key | Value | Notes |
|---|---|---|
| `tok:<sha256>` | `{uid, label, created, lastUsed}` | Only the hash of the token is stored. |
| `user:<uid>` | list of hashes | Max 5 tokens per user. |
| `rate:<uid>:<yyyy-mm-dd>` | count | New items today; expires after 2 days. |

## 5. Deployment and CI

```mermaid
flowchart LR
  dev["💻 Developer PC"] -- "git push master" --> gh["GitHub repo<br/>english-notebook"]
  gh -- "push triggers" --> act["Actions: pages.yml<br/>copies app files (explicit list)"]
  act --> pages["GitHub Pages<br/>(worker/, tests/, docs/ are NOT published)"]
  dev -- "npx wrangler deploy" --> cf["Cloudflare Worker"]
  dev -- "npx firebase-tools deploy<br/>--only firestore:rules" --> fb["Firestore rules"]
  devm["💻 Developer PC<br/>english-notebook-mcp"] -- "git push + tag" --> ghm["GitHub repo<br/>english-notebook-mcp"]
  ghm -- "claude plugin marketplace add" --> users["Learners"]
```

- **App:** every push to `master` publishes the app. New app files must be added to the `cp` line in `.github/workflows/pages.yml` **and** to `FILES` in `sw.js` (and bump the cache name in `sw.js`).
- **Worker:** deployed by hand with Wrangler (see [OPERATIONS.md](OPERATIONS.md)). Not part of Pages.
- **Plugin:** users install from the GitHub repo; a new version = bump `version` in `.claude-plugin/plugin.json`, tag, push.

## 6. Security and trust boundaries

```mermaid
flowchart TB
  subgraph untrusted["Untrusted: user devices and the internet"]
    b["Browser / PWA"]
    m["MCP server + agent"]
  end
  subgraph edge["Cloudflare Worker (trusted code)"]
    w["checks identity, limits, validates input"]
  end
  subgraph data["Google (trusted storage)"]
    f[("Firestore + rules")]
  end
  b -- "Firebase ID token<br/>direct access limited by rules" --> f
  b -- "Firebase ID token" --> w
  m -- "personal token enb_" --> w
  w -- "service account (secret)" --> f
```

| Secret / credential | Where it lives | Who can use it | If leaked |
|---|---|---|---|
| Firebase **service account key** | Worker secret `SERVICE_ACCOUNT` (and a local file on the owner's PC, git-ignored) | The Worker only | Create a new key in Firebase, `wrangler secret put` again, delete the old key. |
| **Personal token** `enb_…` | Learner's agent config (plugin stores it as sensitive) | Saves/lists in that one learner's notebook | Revoke in the app, create a new one. |
| **Firebase web config** (`firebase-config.js`) | Public in the repo | Anyone | Not a secret; access is controlled by Firestore rules and Auth. |

Main protections:

- Firestore rules: a user reads and writes only `users/<own uid>/…`; shared vaults are readable only when signed in and writable only by the owner.
- Worker: Firebase ID token fully verified (signature, issuer, audience, expiry); agent tokens are random 256-bit values, stored hashed; one token type cannot be used as the other; input size limits; 200 new items per user per day; CORS only for the app origin; no internal error details in responses.
- A leaked agent token can add cards to one notebook (within the daily limit) and read that notebook's item texts. It cannot read progress, change shares, or touch other users.
- Tests: `tests/` (app), `worker/tests/` (Worker, 20 tests), MCP repo `tests/` (client, token mode end to end, skill/tool consistency). `tests/rules.test.mjs` is run by hand against the real project.

## 7. Limits and design decisions

| Topic | Decision | Why / consequence |
|---|---|---|
| Backend | Firebase Auth + Firestore, no custom server for the app | Free tier is enough; offline cache built in. |
| Agent access | Cloudflare Worker with personal tokens | Admin key never leaves the owner; users paste one token. Works on the free plan (100k requests/day). |
| Token store | Workers KV | Simple and cheap. **Eventually consistent:** revoking can take seconds to about a minute; daily limit is soft. Durable Objects or D1 would fix both. |
| Cost owner | Owner of the Firebase project | Firestore free quota is shared by all users; per-user daily limit protects it. |
| Modes of the MCP server | token (default), key, inbox | Key and inbox modes remain for self-hosters and offline use. |
| Hosting | GitHub Pages + custom domain | Static files, no build step. |
| Sync conflicts | Last write wins per card | Fine for a personal notebook. |

```mermaid
flowchart TD
  start{{"How does the MCP server start?"}} --> t{"ENGLISH_NOTEBOOK_TOKEN set?"}
  t -- yes --> mixed{"also key variables?"}
  mixed -- yes --> err["exit with error"]
  mixed -- no --> tm["Token mode → Worker API"]
  t -- no --> k{"service account + uid both set?"}
  k -- yes --> km["Key mode → Firestore Admin SDK"]
  k -- "only one" --> err
  k -- neither --> im["Inbox mode → inbox.json next to the app (localhost only)"]
```
