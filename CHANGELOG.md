# Changelog

## Unreleased

- **Cộng đồng (community) MVP, behind a feature flag** (`communityEnabled` in `firebase-config.js`, committed as `false`; one browser can preview it with `localStorage["english-notebook-community"] = "1"`). With the flag off nothing changes: no tab and no community requests. When on, a fifth tab **🌐 Cộng đồng** lets signed-in users browse public collections (sort by stars or newest, filter by tag, "Tải thêm" paging), open one (description, preview of the first 30 cards, ⭐ one star per account, 🚩 report with a reason), and **📥 Học bộ này** to copy the cards into their own notebook (box 0, tag `community`, source `community`, with a `src` link `{ cid, cardId, rev, hash }` to the published card for a later sync phase). **➕ Đăng bộ của bạn** publishes a public collection (choose cards by type and tag, title, description, tags, a display name pre-filled with the Google name; the email is never shown; original sentence and note are off by default; a warning for cards saved by an AI agent; a required "I may share these" checkbox; at most 20 public collections and 3000 cards each). **Bộ của tôi** lists your collections with their stars, shows when the admin hid one, and **Gỡ bộ** removes it. Code: `community.js` (pure), `community-ui.js`, new functions in `cloud.js`; rules and indexes in `firestore.rules` and `firestore.indexes.json`. **Deploy the rules and indexes before turning the flag on** (docs/OPERATIONS.md).
- `norm()` in `app.js` keeps a valid `src` object, and a card with source `community` counts as "Chia sẻ" (shared) in the Library filter, the overview and the badges.
- Bottom tab bar: icon and label are separate, so with five tabs the icon sits above a smaller label and all five fit on a 320-375 px phone. Service worker cache bumped to v27; `community.js` and `community-ui.js` added to the precache list and the Pages `cp` line.
- Cards get two optional fields: `status` (`"inbox"` = saved by an AI agent and not yet triaged, `"archived"` = hidden but kept; absent = active, so every existing card stays active) and `lapses` (times answered "Quên"). New cards saved by the Worker and the MCP server start as `inbox`. Inbox and archived cards are left out of review, the due badge and the card counts.
- Library: scope tabs (Thư viện, Mới, Lưu trữ), filters (type, tag, level, source), five sort modes, highlighted search hits, saved views, an overview card, hard cards ("Thẻ khó", 4+ lapses) and "Ôn các thẻ đang lọc". Code: `library-view.js`, `inbox.js`, `study.js`.
- Mới (inbox): per-card Giữ / Bỏ, Giữ tất cả / Bỏ tất cả, with a count in every confirm and a Hoàn tác toast. Archived cards can be restored.
- Bulk edit: selection mode with add tag, remove tag, archive and delete (`bulk.js`); every destructive action asks first and can be undone for a few seconds. Undo restores deleted cards under new ids so the cloud delete marker cannot hide them on other devices.
- Clean-up dialog: merge duplicate cards and rename or merge tags (`cleanup.js`).
- Export / import (`export-import.js`): **Xuất CSV** (UTF-8 BOM, for Excel) and **Xuất Anki (TSV)** export exactly the cards the Library filter shows (the whole Library when there is no filter); **Nhập từ văn bản/CSV** pastes or reads a file, shows a preview (to add / skipped duplicates / bad rows, first 10 cards) and then imports one batch of at most 2,000 cards tagged `imported`, with undo.
- Desktop keyboard shortcuts (`shortcuts.js`): `/` search, `n` add, `Esc` leave selection or close panels, `g` then `l`/`r`/`t`/`p` switch tab, `?` help. Ignored while typing or when a dialog is open. No swipe gestures.
- Deploy lists: the new modules are in the `sw.js` precache list and the Pages `cp` line; service worker cache bumped to v26.
- Docs: user guide (new Library features, export/import, shortcuts) and the data model note in `docs/ARCHITECTURE.md`.
- Fixes after review: sharing a vault never includes archived or inbox cards; merging duplicates keeps a different meaning (joined with " / ") and the highest `lapses`, and clears a keeper's dangling `sourceId`; CSV export prefixes formula-like text (`= + - @`) with an apostrophe (import removes it) and Anki TSV escapes HTML; `type` is validated in `norm()`; a signed-in device deletes its old local copy once every card is uploaded (it used to re-upload deleted or merged cards on every start); grading uses the live card, so a card archived or edited on another device is not overwritten; dialogs trap Tab and focus moves on after Giữ / Bỏ; one shared definition of tags, duplicate keys, active status, level and source kind (an "AI agent" is any source other than manual or shared); the Worker cuts a tag longer than 40 characters instead of rejecting it, like the MCP server; bottom tabs no longer clip at 375 px (counts sit on the tab corner).
- Known, transitional: a phone still running an older cached build (service worker v25 or earlier) drops `status` and `lapses` when it saves a card. Archived or inbox cards graded or edited there come back as active cards until that phone updates (the service worker is network-first, so this ends at the next online visit).

## 2.1.0

- Update check: the app compares its version with `version.json` on the site (at start-up, when you return to the app, or with **Kiểm tra cập nhật** in the footer) and shows a **Có bản mới – Tải lại** bar. When releasing, change `VERSION` in `version.js`, `version.json` and the top of this file together; `tests/version.test.mjs` fails if they differ.
- Footer shows the app version and links to the GitHub repo and the install guide (`version.js` is the single source of the version).
- Performance: the Library draws 40 cards at a time and loads the next page when you scroll near the end (or press **Tải thêm**); search is debounced; the list is not drawn while the Library is hidden; card lookups are indexed (no more O(n²)). With 1,500 cards: 21,000 → 1,000 DOM nodes, and a redraw went from 0.5-1.1 s to about 10 ms.
- Fast start-up when signed in: the app keeps a local copy of your cards (`mirror.js`) and draws it at once, before Firebase has loaded; the cloud answer then replaces it. Edits made in that short window are sent when the login is confirmed. The copy is deleted on sign-out. The service worker now serves the versioned Firebase SDK from its cache first.
- AI agent screen: after you create a token it shows a one-line `npx` installer (copy button) next to the plugin steps.
- Sharing: a link can now hold up to **3000** cards (was 1000). Raised in `vault.js`, `cloud.js` and `firestore.rules` (a test keeps them equal). **Deploy the rules.** Each person who previews or imports reads every card of the share, and those reads count against your project's Firestore quota.
- Sync banner: when the cloud refuses us (quota, permission, login) a red bar under the header says so; it clears on the next good snapshot. Offline and retries stay silent.
- Deleted-card markers (`users/{uid}/deleted/{id}`): deletions reach other devices without a full read. **Deploy the rules** (`npx firebase-tools deploy --only firestore:rules --project tiennhm-english-notebook`).
- App Check support, off until `appCheckSiteKey` is set in `firebase-config.js` (steps in docs/OPERATIONS.md).
- Worker: the token's "last used" time is written at most once an hour (halves KV writes per save).
- CI: the Pages workflow runs the unit tests before it publishes. The Firebase code is preloaded (`modulepreload`).
- Delta sync: cards carry an `updated` time; after one full read the app (signed in) asks Firestore only for cards changed since the last sync, plus one full read a day (`delta.js`). Opening the app now costs about the number of changed cards instead of every card. Deletions made on another device can take up to a day to show unless the app is open. Worker and key-mode MCP stamp `updated` too (**redeploy the Worker**, restart Claude Code).
- Agent API: saves no longer read the whole notebook from Firestore each time (the card list is cached 10 minutes per user in the Worker), which cut reads from about one per card per save to one per 10 minutes; a spent Firestore quota now gives a clear 503 message instead of a generic error. **Redeploy the Worker** (`cd worker && npx wrangler deploy`).
- Review: **🔀 Ngẫu nhiên** button and a *Thứ tự ôn tập* setting (Profile) to shuffle the cards that are due; default stays oldest-due-first.
- 20 new trophy badges (35 in total): more daily-goal, streak (up to 365 days), review, XP and level milestones, a one-day record, "saved by a freeze", library size up to 1,000 cards, sentences, tags, AI agent helper, and box 5 mastery.

- Menu merged: **Thêm** is now a button inside **Thư viện**; new **Profile** tab holds personal settings (account, look and theme, motion, daily goal, install app, vault sharing, AI agent token, backup). The old `?tab=add` shortcut still works.

## 2.0.0

- `worker/`: Cloudflare Worker agent API (personal tokens, save words and sentences, daily limit).
- Docs: user guide, architecture (10 diagrams), operations guide in `docs/`.
- New screen **Profile → 🤖 Kết nối AI agent**: create, list and revoke personal tokens. Its address is `agentApiUrl` in `firebase-config.js`.

## 1.0.0

First release of English Notebook (PWA).

- Words, phrases and sentences with Vietnamese meanings, tags and linked expressions.
- Leitner review, streak, daily goal, XP, badges and sharing of achievements.
- Google sign-in, Firestore sync with offline cache.
- Four visual styles, light and dark, Be Vietnam Pro font, motion switch.
- Share a vocabulary vault with another account (link or code, preview, import a copy).
- Installable PWA (Android, iOS, desktop).
- Claude Code integration through the MCP server and English Coach skill (see the MCP repo).

Planned for 2.0: personal agent tokens through a Cloudflare Worker, so the MCP plugin works without a Firebase key.
