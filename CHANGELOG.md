# Changelog

## 2.0.0 (in progress)

- `worker/`: Cloudflare Worker agent API (personal tokens, save words and sentences, daily limit).
- New screen **Library → 🤖 Kết nối AI agent**: create, list and revoke personal tokens. It stays disabled until `agentApiUrl` in `firebase-config.js` points at the deployed Worker.

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
