# English Notebook

PWA to save English words, phrases and sentences, then review them (spaced repetition).
No build step. Plain HTML/CSS/JS.

## Run

```bash
python -m http.server 5173 --directory D:\TienNHM\english-notebook
```

Open http://localhost:5173 (Chrome/Edge: "Install" in the address bar).

## Features

- Add word / phrase / sentence. For a sentence you can add the original (Vietnamese) sentence and
  expressions taken from it (`english = nghĩa`, one per line). Each expression is a separate card linked to the sentence.
- Library: search, filter by type/tag, text-to-speech, edit, delete.
- Review: Leitner boxes (1, 3, 7, 14, 30 days).
- Export / import JSON.
- Works offline.

## Turn on Google / Facebook login + sync (optional)

Without this the app is local-only (data in this browser).

1. https://console.firebase.google.com > create a project.
2. Build > Authentication > Sign-in method: enable **Google**. For **Facebook**, create a Facebook app
   (developers.facebook.com), copy App ID / Secret into Firebase, and add the Firebase redirect URI to the Facebook app.
3. Authentication > Settings > Authorized domains: add your host (localhost is allowed by default).
4. Build > Firestore Database > create (production mode), then Rules:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /users/{uid}/items/{id} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. Project settings > Your apps > Web app: copy the config into `firebase-config.js`.

On first login, local items are uploaded to your account. Data is stored at `users/{uid}/items/{id}`.
Firestore keeps an offline cache, so adding and reviewing works without internet and syncs later.
