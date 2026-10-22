const CACHE = "english-notebook-v2";
const FILES = ["./", "index.html", "style.css", "app.js", "cloud.js", "firebase-config.js", "manifest.webmanifest", "icon.svg"];
const SDK = "https://www.gstatic.com/firebasejs/";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Network first, fall back to cache (edits show up, still works offline).
// Only our own files and the Firebase SDK are cached; Firestore/Auth traffic is left alone.
self.addEventListener("fetch", e => {
  const r = e.request, url = new URL(r.url);
  if (r.method !== "GET" || (url.origin !== location.origin && !r.url.startsWith(SDK))) return;
  e.respondWith(
    fetch(r).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(r, copy));
      return res;
    }).catch(() => caches.match(r))
  );
});
