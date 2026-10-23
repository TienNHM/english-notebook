const CACHE = "english-notebook-v6";
const FILES = [
  "./", "index.html", "style.css", "app.js", "progress.js", "share.js", "cloud.js", "firebase-config.js",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png",
];
const SDK = "https://www.gstatic.com/firebasejs/";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Network first, fall back to the cache (edits show up, and the app still opens offline).
// Only our own files and the Firebase SDK are cached; Firestore/Auth traffic is left alone.
// Opening the installed app offline (any page address, with or without "?source=pwa") falls back to the cached index.html.
self.addEventListener("fetch", e => {
  const r = e.request, url = new URL(r.url);
  if (r.method !== "GET" || (url.origin !== location.origin && !r.url.startsWith(SDK))) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
      return res;
    }).catch(async () => {
      const hit = await caches.match(r, { ignoreSearch: true });
      if (hit) return hit;
      if (r.mode === "navigate") return (await caches.match("index.html")) || (await caches.match("./"));
      return Response.error();
    })
  );
});
