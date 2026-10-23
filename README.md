# 📒 English Notebook

Learn English from what you actually read and write at work.
Save words, phrases and sentences (with the Vietnamese meaning and the original context), then review them with spaced repetition.

**Live demo:** https://english-notebook.tiennhm.io.vn

An installable PWA in plain HTML, CSS and JavaScript. No build step, works offline, optional Google login with cloud sync, optional Claude Code integration.

<p align="center">
  <img src="docs/screenshots/library-light.png" alt="Library (light theme)" width="48%">
  <img src="docs/screenshots/library-dark.png" alt="Library (dark theme)" width="48%">
</p>

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Quick start](#quick-start)
- [How to use the app](#how-to-use-the-app)
- [Set up Google login and cloud sync](#set-up-google-login-and-cloud-sync)
- [Publish with GitHub Pages and a custom domain](#publish-with-github-pages-and-a-custom-domain)
- [Save from Claude Code (MCP)](#save-from-claude-code-mcp)
- [Data, privacy and security](#data-privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Project structure and development notes](#project-structure-and-development-notes)

## Features

- **Three kinds of cards**: word, phrase, sentence. Each has meaning, example, note and tags.
- **Context cards**: save a sentence with the original (Vietnamese) sentence, then list the expressions in it (`check again = kiểm tra lại`). Every expression becomes its own card that stays linked to the sentence.
- **Library**: search, filter by type or tag, text-to-speech, edit, delete.
- **Review**: Leitner boxes (1, 3, 7, 14 and 30 days). Rate each card with Quên / Nhớ / Dễ.
- **Daily goal, streak and rewards**: review N cards a day to keep your 🔥 streak. Earn XP and levels, 15 badges, 🧊 freezes that save your streak, and confetti when you reach the goal.
- **Share your achievements**: a share card image (streak, level, recalls, badges) plus ready-made posts for Facebook, X, LinkedIn and Telegram, or the phone's share sheet. The image is drawn on your device and has no name or email.
- **Share your vocabulary with another account**: create a link, and the other person signs in with Google, previews the cards and imports a copy. Your study progress is never shared, links expire, and you can delete them at any time.
- **Lively motion**: bouncy page, card and reward animations (count-up numbers, flickering 🔥, floating "+XP", shaking card on Quên, confetti). It follows your system "reduce motion" setting, and you can force it on or off in the app.
- **4 visual styles** (Neo-brutalism, Solid, Glass, Gradient), each in light and dark, plus a system mode. Bottom tab bar on phones.
- **Installable PWA**: install it on your phone or PC like a normal app (own icon, full screen, home-screen shortcuts), and it opens without internet.
- **Offline first**: works without internet and syncs when you are back online.
- **Google login + Firestore sync** (optional). Without it, data stays in your browser.
- **Claude Code integration** (optional): an MCP server saves words and sentences for you.
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

## Quick start

You need Python 3 (or any static file server). Nothing else.

```bash
git clone https://github.com/TienNHM/english-notebook.git
cd english-notebook
python -m http.server 5173 --directory .
```

Open http://localhost:5173. In Chrome or Edge, use "Install" in the address bar to add it as an app.

This is **local-only mode**: no login, and your data lives in your browser (`localStorage`). Use **Xuất JSON** in the Library tab to back it up.

The service worker (offline mode) needs `http://` or `https://`. Opening `index.html` directly still works, but without offline install.

Pick how far you want to go:

| Goal | What to do |
|---|---|
| Just try it | Quick start above |
| Same data on all devices | [Google login and cloud sync](#set-up-google-login-and-cloud-sync) |
| Use it from a phone, anywhere | [GitHub Pages](#publish-with-github-pages-and-a-custom-domain) (needs the cloud sync step too) |
| Let Claude save words for you | [Claude Code (MCP)](#save-from-claude-code-mcp) |

## Install the app on your phone

Open the live site (or your own deployed copy). It must be served over **HTTPS** (GitHub Pages is). Then:

| Device | Steps |
|---|---|
| **Android (Chrome, Edge, Samsung Internet)** | Press **📲 Cài app** in the header and confirm. Or use the browser menu **⋮ → Install app** (or **Add to Home screen**). |
| **iPhone / iPad (Safari)** | Safari has no install prompt. Press **📲 Cài app** to see the steps, or: tap **Share** `⬆︎` → **Add to Home Screen** → **Add**. It must be Safari, not the browser inside another app. |
| **Windows / macOS / Linux (Chrome, Edge)** | Press **📲 Cài app**, or click the install icon at the right of the address bar. |

What you get after installing:

- An **icon** on the home screen, and the app opens **full screen** without the browser bars.
- **Long-press the icon** (Android and desktop) for shortcuts: **Ôn tập hôm nay**, **Thêm từ mới**, **Thành tích và streak**.
- It **opens offline**. Everything you add or review offline is saved on the device (and synced when you sign in and go online).
- **Updates are automatic.** The app checks for new files each time it opens, so you always get the latest version after a deploy (close and reopen it once if it still looks old).

The **📲 Cài app** button only appears when installing is possible, and it disappears once the app is installed. To remove the app, uninstall it like any other app (long-press the icon).

## How to use the app

### Add

1. Open **➕ Thêm** and choose a type: **Từ** (word), **Cụm từ** (phrase) or **Câu** (sentence).
2. Fill in the English text and the Vietnamese meaning. Example, note and tags are optional.
3. For a **sentence**, two extra fields appear:
   - **Câu gốc**: the original sentence, for example the Vietnamese you wanted to say.
   - **Cụm từ rút ra**: one expression per line as `english = nghĩa`. Each line becomes a separate phrase card linked to the sentence.
4. Press **Lưu**. Adding something that already exists asks for confirmation.

### Library

- Search matches English, meaning, example, note and the original sentence.
- Filter by type with the dropdown, or by tag by clicking a `#tag`.
- 🔊 reads the English text aloud (your browser's voice), ✏️ edits, 🗑 deletes. Deleting a sentence also deletes the expressions linked to it (it asks first).

### Review

- **🧠 Ôn tập** shows the cards that are due. The badge on the tab is how many.
- Think of the meaning, press **Xem nghĩa**, then rate yourself:

| Button | What happens |
|---|---|
| **Quên** | Back to box 0, comes again in 10 minutes (and again in this session) |
| **Nhớ** | Up 1 box |
| **Dễ** | Up 2 boxes |

Boxes 0 to 5 come back after 0, 1, 3, 7, 14 and 30 days.
Cards that came from a sentence show the sentence under the answer.

### Daily goal, streak and rewards

- **🏆 Thưởng** opens with the streak panel: your 🔥 streak, today's goal (default **10 cards**, change it further down in the same tab: 5, 10, 15, 20 or 30) and the last 7 days.
- **🧠 Ôn tập** is a focused full-screen view: one small line (`Còn 5 mục · 🎯 2/5 hôm nay`), a big card that fills the screen between the top of the page and the bottom menu, and the rating buttons at the bottom. It fits one screen on a phone without scrolling (very long cards scroll instead). The 🔥 pill in the header shows your streak at all times and turns red when today's goal is not finished.
- Only **Nhớ** and **Dễ** count toward the goal. **Quên** gives a little XP but does not count. If you have fewer cards than the goal, the goal is the number of cards you have.
- **Streak 🔥**: the number of days in a row you reached the goal. If you have not finished today yet, yesterday's streak is kept and the 🔥 pill turns red as a warning.
- **Freeze 🧊**: every time your streak reaches a multiple of 7 days you earn one (you can hold 2). If you miss exactly one day and have a freeze, it is used automatically and your streak continues. Missing more days than you have freezes breaks the streak.
- **Practice mode 💪**: if no cards are due but you have not reached the goal, press "Ôn thêm" to review cards that are not due yet (soonest first). So you can always keep your streak.
- **XP and levels**: Quên +1, Nhớ +3, Dễ +5, and +20 bonus when you reach the daily goal. Level = `floor(sqrt(XP / 30)) + 1`.
- **Badges**: 15 badges for streaks (3, 7, 14, 30, 100 days), number of recalls (50, 200, 1000), library size (10, 50, 100 cards), 10 sentences, and a card in box 5. A celebration with confetti appears when you reach the goal, level up or unlock a badge (it is skipped if your system asks for reduced motion).
- Days are counted in your **local time zone**.

### Share your achievements

Open **🏆 Thưởng → 📣 Chia sẻ thành tích**, or press **📣 Chia sẻ** in the celebration pop-up.

- The dialog shows a share card (1080×1080) and an editable text, for example `🔥 9-day streak · Level 5 · 108 cards recalled · 6/15 badges on English Notebook! ...`.
- **📲 Chia sẻ…** (phones and some browsers) opens the system share sheet with the image attached.
- **Facebook, X, LinkedIn, Telegram** open that site's share page with your text and the link to the app. These sites do not accept an image from a link (and LinkedIn takes only the link), so press **⬇ Tải ảnh** (or **🖼 Chép ảnh**) and attach the image yourself.
- **📋 Chép chữ** copies the text and the link. 
- **Privacy**: the card is drawn in your browser. It contains only numbers and badge icons: no name, no email. Nothing is uploaded when you open the dialog; data leaves your device only when you post it.
- **Link preview**: `index.html` has Open Graph and Twitter Card tags that use `og-image.png` (1200×630). Social sites cache previews, so after you change the image use the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) or the [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) to refresh it. If you host the app on another domain, change the URLs in the `<meta>` tags and `SITE_URL` in `share.js`.

### Share your vocabulary with another account

Needs Google sign-in and cloud sync (both people must be signed in). In **📚 Thư viện**:

**To share (the sender)**
1. Press **🔗 Chia sẻ kho**.
2. Choose what to share: card types, tags (no tag chosen = all), a name, and how long the link works (7, 30 or 90 days). You see how many cards will be shared (up to 1000 per link).
3. Press **🔗 Tạo link**. Copy the link (or the 22-character code) and send it however you like.
4. The list **Link đã tạo** shows your links. **🗑** deletes a link at once: nobody can use it any more.

**To receive**
1. Open the link (or press **📥 Nhập từ link** and paste the link or code), and sign in with Google if asked.
2. You see a preview: the name, how many cards, the card types, and how many you already have.
3. Press **📥 Nhập**. You get an independent **copy**: new cards that start from box 0 and are due now, tagged `#shared`. Cards you already have are skipped (you can switch this off). Expressions stay linked to their sentence.

**Privacy and safety**
- **Study progress** (boxes, due dates, review counts, streak, XP) is **never** shared, only the card content.
- The **original sentence** and the **note** can contain private work text, so they are **off by default**. Your **name** is hidden unless you tick the box.
- A share has an **unguessable** 22-character id. Only people who are signed in and know the id can read it, and it works until it expires or you delete it. Nobody can list or search shares. Anyone who has the link can read the shared cards, so send it only to people you trust.
- Deleting a link does not remove cards that someone has already imported (they are their own copy). Importing never changes the sender's notebook.
- It copies cards once. It is not a live shared deck: later changes are not synced between the two notebooks.

### Motion and animations

- The logo drops in and the tabs rise one by one; Library cards come in one after another, a card you just added flashes, and a deleted card slides away.
- In **Review**, each new card slides in, **Quên** shakes it, the answer pops open, and `+3 XP` floats up. In **🏆 Thưởng** the numbers count up, the badge shine sweeps over unlocked badges, and the 🔥 flickers. Changing the theme fades the colours.
- **Accessibility**: by default the app follows your operating system. If "reduce motion" (Windows: *Animation effects* off; macOS: *Reduce motion*) is on, all animations are off.
- To override it, open **🏆 Thưởng → Hiệu ứng chuyển động** and choose **Theo hệ thống** (default), **Luôn bật** or **Tắt**. The choice is saved in your browser. If your system has motion off, the app shows a one-time hint about this switch.

### Style and colour mode

Two separate choices, both saved in your browser (per device):

- **Style** (how it looks): press **🎨** in the header to go to the next style, or open **🏆 Thưởng → Phong cách giao diện** and pick one from the previews.

  | Style | Look |
  |---|---|
  | 🧱 **Neo-brutalism** (default) | Thick dark borders and hard offset shadows on a dotted ivory background, with a warm curated palette (mustard gold, sage, slate, blush) |
  | ⬜ **Solid** | Flat and clean: hairline borders, soft warm shadows, an emerald brand colour (antique gold in dark mode) |
  | 🪟 **Glass** | Frosted translucent panels over a soft sage / champagne / slate glow, and a smoked black-green background in dark mode (needs a browser with `backdrop-filter`; others see slightly more opaque panels) |
  | ✨ **Gradient** | Tonal gradients in one colour family: deep emerald on an ivory-sage background, antique gold in dark mode |

- **Colour mode** (light or dark): the round button next to it cycles **System → Light → Dark**. Every style has both a light and a dark version.

The browser bar / status bar colour follows the style and mode. The share card, the app icon and the link-preview image always use the Neo-brutalism look (mustard gold on ivory), because that is the app's brand.

**Colour idea:** a warm ivory / charcoal base, one deep brand colour, and muted earthy supporting tones, so it looks calm and considered instead of a saturated rainbow. The small colours that tell the card types apart are always muted gold (word), slate (phrase) and blush (sentence).

### Font

The app uses **Be Vietnam Pro** (weights 500 to 800) for all text, because it was designed for Vietnamese and keeps tone marks clear. The font files are **hosted in the app** (`fonts/`, Vietnamese and Latin subsets, about 137 KB in total), so the app does not call Google Fonts, it works offline, and it loads fast. The font is licensed under the SIL Open Font License 1.1 (`fonts/OFL.txt`). If a character is missing, the browser falls back to Segoe UI or the system font.

## Set up Google login and cloud sync

Without this the app is local-only. With it, you sign in with Google and every device shows the same items. Firestore keeps an offline cache, so adding and reviewing works without internet and syncs later.

The free **Spark** plan is enough for personal use (no credit card; free daily quota of about 50,000 reads and 20,000 writes). Check the current limits on the [Firebase pricing page](https://firebase.google.com/pricing).

1. **Create a project** at https://console.firebase.google.com (Google Analytics is not needed).
2. **Add a Web app**: Project overview → `</>` → register it (no Firebase Hosting needed). Copy the config.
3. **Put the config in `firebase-config.js`** (these web keys are public identifiers, not secrets):

   ```js
   export const firebaseConfig = {
     apiKey: "...",
     authDomain: "<project-id>.firebaseapp.com",
     projectId: "<project-id>",
     appId: "...",
   };
   ```
4. **Turn on Google sign-in**: Build → Authentication → Get started → Sign-in method → **Google** → Enable → choose a support email → Save.
5. **Create the database**: Build → Firestore Database → Create database → pick a region near you → **production mode**.
6. **Deploy the security rules** from `firestore.rules`. Each signed-in user can only read and write their own data (`users/{uid}/items/{id}` for cards and `users/{uid}/meta/{id}` for streak and rewards). Redeploy them whenever `firestore.rules` changes:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project <project-id>
   ```
   You can also paste the content of `firestore.rules` in Firestore → Rules → Publish.
7. **Authorized domains**: Authentication → Settings → Authorized domains. Add every domain you host the app on. `localhost` is already there.
8. Reload the app. The header now shows **Google** and **Facebook** buttons. Sign in with Google.

On your first login, items that were already in this browser are uploaded to your account.

### Facebook login (optional, not required)

The Facebook button needs extra setup, so skip it if you only need Google.

1. Create an app at https://developers.facebook.com. Copy **App ID** and **App Secret** (Settings → Basic).
2. Firebase → Authentication → Sign-in method → **Facebook** → Enable → paste them → copy the **OAuth redirect URI** that Firebase shows.
3. In the Facebook app: Facebook Login → Settings → **Valid OAuth Redirect URIs** → paste it → save.
4. While the Facebook app is in *Development* mode, only you and the testers you add can sign in.

## Publish with GitHub Pages and a custom domain

The workflow `.github/workflows/pages.yml` publishes only the app files on every push to `master`. README, rules and screenshots are not published.

1. Push the repo to GitHub. On the free plan, GitHub Pages needs a **public** repo.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `master` (or run the workflow from the Actions tab). The site appears at `https://<user>.github.io/<repo>/`.

### Custom domain (for example `english-notebook.example.com`)

1. In your DNS provider add one record:

   | Type | Name | Value |
   |---|---|---|
   | `CNAME` | `english-notebook` | `<user>.github.io` |

   The value is your GitHub **username**, not the repo name. If you use Cloudflare, start with **DNS only** (grey cloud).
2. **Settings → Pages → Custom domain**: type the domain and save. GitHub adds a `CNAME` file to the repo (run `git pull`).
3. Wait for the DNS check to pass (minutes, sometimes hours), then tick **Enforce HTTPS**.
4. **Add the domain to Firebase** → Authentication → Settings → Authorized domains. Without this, Google login on the live site fails with `auth/unauthorized-domain`.

## Save from Claude Code (MCP)

The MCP server [english-notebook-mcp](https://github.com/TienNHM/english-notebook-mcp) lets Claude Code save words and sentences while you work. It has three tools: `add_vocabulary`, `add_sentence` (with linked expressions) and `list_inbox` (to avoid duplicates).

Short version, using **Firestore mode** so the items show up on every device and on the hosted site:

1. Create a service account key (Firebase console → Project settings → Service accounts → Generate new private key). Save the JSON **outside any git repo and outside synced folders**. It has full admin access to the project: never commit it, never paste it in a chat.
2. Find your user id: Authentication → Users, or `npx firebase-tools auth:export users.json --project <project-id>` and read `localId`.
3. Register the server (one line, run once):

   ```bash
   claude mcp add --scope user --env ENGLISH_NOTEBOOK_SERVICE_ACCOUNT="C:\path\to\key.json" --env ENGLISH_NOTEBOOK_UID="<your uid>" english-notebook -- node C:\path\to\english-notebook-mcp\server.mjs
   ```
4. Restart Claude Code and check with `claude mcp list`.

Without the two environment variables the server uses **inbox mode**: it writes `inbox.json` next to this app and the app imports it when it opens. That works only on `localhost` from this folder, not on the hosted site.

### Install the English Coach skill (to use the app with an AI agent)

**Fastest way:** copy the setup prompt from the [MCP README](https://github.com/TienNHM/english-notebook-mcp#quick-start-let-your-ai-agent-set-everything-up) into your AI agent. It installs the MCP server and the skill for you. Or do it by hand:

The MCP server only gives the agent the tools. The **English Coach skill** tells the agent to correct your English, answer in simple English + Vietnamese, and save the sentence and expressions to your notebook after each Vietnamese request. Install it for your agent:

- **Claude Code**: copy `skills/english-coach` from the MCP repo to `~/.claude/skills/english-coach`.
- **Cursor**: copy `rules/cursor/english-coach.mdc` to `.cursor/rules/` in your project.
- **Codex, Copilot, Windsurf and others**: paste `rules/AGENTS.snippet.md` into your `AGENTS.md`.

Steps for every agent, and the MCP JSON config for non-Claude agents, are in the [MCP README](https://github.com/TienNHM/english-notebook-mcp#install-the-english-coach-skill-needed-to-use-the-app-with-an-ai-agent). Say "skip coach" to turn it off for one message.

Full details and troubleshooting are in the [MCP README](https://github.com/TienNHM/english-notebook-mcp#readme).

## Data, privacy and security

| Mode | Where your data is |
|---|---|
| Local-only | In your browser (`localStorage`). Clearing site data deletes it. Use **Xuất JSON** to back up. |
| Signed in | In your Firestore: cards at `users/<uid>/items`, streak / XP / badges at `users/<uid>/meta/progress`. Other people cannot read them because of `firestore.rules`. |

Streak, XP and badges are stored with your cards (in the browser, or in Firestore when you are signed in), so they sync between devices. If two devices have different progress, they are merged and nothing is lost (the larger number wins for each day).

- The Firebase web config in `firebase-config.js` is **not a secret**. The security rules protect the data.
- The service account key (MCP Firestore mode) **is** a secret. Keep it out of git and out of synced or shared folders. If you think it leaked, delete it in the Firebase console (Service accounts → Manage → Keys) and create a new one.
- `inbox.json` is in `.gitignore` because it holds your personal vocabulary.
- **Xuất JSON / Nhập JSON** give you a plain backup you control. Import skips items that already exist (same id).
- **Shared vaults**: see "Share your vocabulary with another account" above for what a link exposes and how to delete it.

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| Header shows only "Local" | `firebase-config.js` is still `null`, or the browser cached the old file. Hard refresh (Ctrl+F5). |
| `auth/unauthorized-domain` when signing in | Add the site's domain in Authentication → Settings → Authorized domains. |
| Popup closes or is blocked | Allow popups for the site and try again. |
| `Missing or insufficient permissions` / `permission-denied` | The rules are not deployed, or they do not match `users/{uid}/items/{id}`. Redeploy `firestore.rules`. |
| `Cloud Firestore API has not been used...` | Create the database in the console first (Build → Firestore Database → Create database). |
| Facebook login says the app is not available | The Facebook app is in Development mode. Add yourself as a tester or publish the app. |
| Items saved by Claude do not show on the live site | You are in inbox mode. Set up Firestore mode (see above). |
| "Không tìm thấy kho này" when importing | The link expired, the owner deleted it, or the code was copied incompletely (it has exactly 22 characters). Ask the sender for a new link. |
| "Bị từ chối" when creating a link | You are signed out, or the clock of your device is wrong by more than about a day. Sign in again and check the date and time. |
| `inbox.json` 404 in the console | Harmless: the app looks for it at start-up and it does not exist. |
| Site shows an old version after a deploy | Close and reopen the app (or the tab), then hard refresh (Ctrl+F5). The service worker asks the server for every file (no 4-hour browser cache), but the CDN can still hold a changed file for a few minutes after a deploy, and Chrome may reuse a file already loaded in the same open tab. |
| GitHub Actions deploy does not start | Settings → Pages → Source must be **GitHub Actions**, and the workflow file must be on `master`. |
| `Enforce HTTPS` is greyed out | The DNS check has not passed yet. Wait, and check the `CNAME` record. |

## Project structure and development notes

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Markup and the four styles (design tokens at the top of the CSS, then the components) |
| `app.js` | UI, library, review, rewards screen, theme, import / export, inbox import |
| `progress.js` | Streak, freeze, XP, level and badge logic (pure functions, no DOM) |
| `share.js` | Share text, social links and the share-card drawing (canvas) |
| `vault.js`, `vault-ui.js` | Sharing a vocabulary vault between accounts: the logic (what to share, how to import, ids, links) and the two screens |
| `og-image.png` | Link preview image (1200×630) used by the Open Graph tags |
| `tests/` | Unit tests for `progress.js`, `share.js` and `vault.js`, and a security-rules test (`rules.test.mjs`) that is run by hand |
| `cloud.js`, `firebase-config.js` | Firebase Auth and Firestore (loaded only when `firebase-config.js` is filled in) |
| `fonts/` | Be Vietnam Pro font files (WOFF2) and its licence |
| `sw.js`, `manifest.webmanifest` | Offline cache, offline fallback and installable-app manifest (name, colours, shortcuts) |
| `icon.svg`, `icon-maskable.svg` | Source drawings of the app icon (the second one is full-bleed for round or squircle masks) |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | Icons made from the SVGs. Android needs the PNGs, and iPhone does not support SVG icons |
| `firestore.rules`, `firebase.json` | Firestore security rules and CLI config |
| `.github/workflows/pages.yml` | Publishes the app files to GitHub Pages |
| `docs/screenshots/` | Images used in this README |

Things to remember when you change the code:

- **Adding a new app file?** Add it to the `FILES` list in `sw.js` (offline cache) **and** to the `cp` line in `.github/workflows/pages.yml`, otherwise it will not be published.
- **Tests**: the streak, freeze, XP, badge and share logic has unit tests. Run `node tests/progress.test.mjs`, `node tests/share.test.mjs` and `node tests/vault.test.mjs` (Node 18+, no install).
- **Styles are design tokens.** `style.css` has one block of CSS variables per style and mode (`html[data-style=…][data-scheme=…]`): colours, border widths (`--bw`), radii, shadows (`--sh*`), hover and press movement (`--lift`, `--press`), page background (`--bg-image`) and the browser-bar colour (`--tc`). Components use only these tokens, never fixed colours or shadows. To add a style: add its two token blocks (a block must set *every* token, or the Neo default shows through), add it to `STYLES` in `app.js`, to the `<script>` in `<head>` of `index.html`, and add a `.sw-<name>` preview swatch. Text on coloured surfaces uses `--on`; panels on a coloured card use `--answer-bg` and `--answer-fg`.
- **Colours:** keep the palette restrained. Use `--primary` for the one brand colour, `--gold` for rewards, and the muted tones for categories. Avoid pure saturated colours and purple-to-pink gradients, they look generic. Strong text uses `--fw` (800 in neo, 700 elsewhere) and small upper-case labels use `--ls`.
- **Review layout:** the page is a full-height flex column (`body` > `header`, `nav`, `main`), and in the Review tab `#reviewBox` and `.card` grow to fill `main`. Keep the rating buttons in the DOM from the start (`.grade.pending` only hides them), so the card does not change height when the answer is revealed.
- **Sharing vaults (security-sensitive):** the data lives in `shares/{id}` and `shares/{id}/items/{itemId}`, protected by the rules in `firestore.rules` (deploy them with the CLI, see above). Always change the rules together with `tests/rules.test.mjs` and run it against the project: it checks both what is allowed and, more importantly, what must be denied. Share ids come from `crypto.getRandomValues`, and `toShared()` is the only place that decides which fields leave an account, so keep progress fields out of it. The client reads shares with `getDocFromServer`, never from the offline cache.
- **Fonts:** only weights 500 to 800 are hosted. To add a weight, download the two WOFF2 files, add the two `@font-face` rules in `style.css`, and list the files in `sw.js` (the workflow already copies the whole `fonts/` folder).
- **Check contrast** after changing colours. Aim for WCAG AA: 4.5:1 for normal text and 3:1 for large text, in every style and in both modes, including pop-ups and the Rewards tab. (When this was written all 8 combinations passed, 2,268 measurements.)
- **Motion rules**: animate only `transform` and `opacity`, give animations `backwards` fill (so hover styles keep working), and keep every new animation under the motion switch at the end of `style.css` (it also covers `::before` and `::after`). In JavaScript, call `reduced()` before starting an animation. To test motion when your system has "reduce motion" on, set the app switch to **Luôn bật**.
- **Caching (important)**: GitHub Pages sends `Cache-Control: max-age=14400` (4 hours). A plain `fetch(request)` in the service worker would trust that cache and serve old files after a deploy, mixed with new ones. So `sw.js` installs with `cache: "reload"` and fetches same-origin files with `cache: "no-cache"` (the server answers `304` when nothing changed), and `app.js` registers it with `updateViaCache: "none"`. Keep this when you edit `sw.js`. To test it, serve a copy of the app with a `max-age=14400` header, change a file, and reload in a **new tab**.
- **Installability checklist**: HTTPS, a manifest with `name`, `start_url`, `display: standalone` and 192 + 512 PNG icons (plus a `maskable` one), and a service worker with a `fetch` handler. If you change an icon, redraw the SVG, render it to PNG at the sizes above (draw the SVG on a canvas and use `canvas.toBlob`), and keep the file names in `sw.js` and the workflow in sync.
- To redraw `og-image.png`, call `drawShareCard(canvas, {}, { wide: true, promo: true })` from `share.js` and save the canvas as a PNG.
- After changing the cached files, you can bump `CACHE` in `sw.js` to force clients to drop the old cache.
- Item shape (same in `localStorage` and Firestore): `id, type, text, meaning, example, note, original, sourceId, source, tags, box, due, created, reviews`.
- Progress shape: `{ days: { "YYYY-MM-DD": { n, xp, f (goal met), z (saved by a freeze) } }, badges: { id: unlockedAt }, fe (freezes earned), goal, updated }`. Streak, level and freezes left are calculated from it, so the merge of two devices is always safe.
- No build step and no dependencies in the app itself. The Firebase SDK is loaded from `gstatic.com` only when sync is configured.
