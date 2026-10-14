// Volya Gem Defense — offline support for the installed web app.
// Pages: network first (fresh updates), cached copy when offline.
// Static files and fonts: cached copy first, refreshed in the background.
const CACHE = "volya-v1";
const PRECACHE = ["./", "index.html", "manifest.webmanifest", "privacy.html",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];
const STATIC_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "telegram.org"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put("index.html", copy));
      return res;
    }).catch(() => caches.match("index.html").then((r) => r || caches.match("./"))));
    return;
  }
  const same = url.origin === self.location.origin;
  if (!same && !STATIC_HOSTS.includes(url.hostname)) return; // leaderboard API, ads: always live
  e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => {
    const fresh = fetch(req).then((res) => {
      if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fresh;
  })));
});
