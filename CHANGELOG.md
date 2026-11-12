# Changelog

## 2.1.0

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
