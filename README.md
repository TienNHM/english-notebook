# 📒 English Notebook

Learn English from what you actually read and write at work.
Save words, phrases and sentences (with the Vietnamese meaning and the original context), then review them with spaced repetition.

**Live demo:** https://english-notebook.tiennhm.io.vn

An installable PWA in plain HTML, CSS and JavaScript. No build step, works offline, optional Google login with cloud sync.

<p align="center">
  <img src="docs/screenshots/library-light.png" alt="Library (light theme)" width="48%">
  <img src="docs/screenshots/library-dark.png" alt="Library (dark theme)" width="48%">
</p>

## Features

- **Three kinds of cards**: word, phrase, sentence. Each has meaning, example, note and tags.
- **Context cards**: save a sentence with the original (Vietnamese) sentence, then list the expressions in it (`check again = kiểm tra lại`). Every expression becomes its own card that stays linked to the sentence.
- **Library**: search, filter by type or tag, text-to-speech, edit, delete.
- **Review**: Leitner boxes (1, 3, 7, 14 and 30 days). Rate each card with Quên / Nhớ / Dễ.
- **Neo-brutalism UI** with a light, dark and system theme switch. Bottom tab bar on phones.
- **Offline first**: works without internet and can be installed from the browser.
- **Google login + Firestore sync** (optional). Without it, data stays in your browser.
- **Claude Code integration** (optional): an MCP server saves words and sentences for you. See [english-notebook-mcp](https://github.com/TienNHM/english-notebook-mcp).
- Export / import JSON.

## Screenshots

### Add a sentence with its expressions

<p align="center"><img src="docs/screenshots/add-sentence.png" alt="Add a sentence with the original sentence and expressions" width="70%"></p>

### Review

<p align="center">
  <img src="docs/screenshots/review-question.png" alt="Review: question" width="48%">
  <img src="docs/screenshots/review-answer.png" alt="Review: answer and rating buttons" width="48%">
</p>

### On your phone

<p align="center"><img src="docs/screenshots/mobile-library.jpg" alt="Library on a phone" width="30%"></p>

## Run locally

```bash
python -m http.server 5173 --directory .
```

Open http://localhost:5173. In Chrome or Edge, use "Install" in the address bar to add it as an app.

The service worker (offline mode) needs `http://` or `https://`. Opening `index.html` directly still works, but without offline install.

## Turn on Google login and sync (optional)

Without this the app is local-only.

1. Create a project at https://console.firebase.google.com and add a **Web app**.
2. **Authentication → Sign-in method**: enable **Google**.
3. **Firestore Database → Create database** (production mode).
4. Copy the web config into `firebase-config.js`.
5. Deploy the security rules (`firestore.rules`, each user can only read and write their own items):

   ```bash
   npx firebase-tools deploy --only firestore:rules --project <your-project-id>
   ```
6. Authentication → Settings → **Authorized domains**: add the domain you host on (`localhost` is allowed by default).

Items are stored at `users/{uid}/items/{id}`. Firestore keeps an offline cache, so adding and reviewing works without internet and syncs later. On the first login, local items are uploaded to your account.

The Firebase web config is not a secret. Access is controlled by the security rules.

## Deploy

`.github/workflows/pages.yml` publishes only the app files to GitHub Pages on every push to `master`.
In **Settings → Pages**, set **Source** to **GitHub Actions**. For a custom domain, add a `CNAME` DNS record to `<user>.github.io` and set the domain in the same page.

## Claude Code integration (MCP)

The MCP server writes new items to `inbox.json` next to the app. The app imports them when it opens (each item once). This works only when the app is served from this folder on the same PC (`localhost`), not on the hosted site.

## Project structure

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Markup and neo-brutalism styles |
| `app.js` | UI, library, review, theme, import / export |
| `cloud.js`, `firebase-config.js` | Firebase Auth and Firestore (loaded only when configured) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Offline cache and installable app |
| `firestore.rules`, `firebase.json` | Firestore security rules and CLI config |
