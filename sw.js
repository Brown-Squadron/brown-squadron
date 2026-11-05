/* Brown Squadron — service worker
   • l'appli s'ouvre même sans réseau (dernière version téléchargée) ;
   • les nouvelles versions publiées sur GitHub sont prises en priorité ;
   • les tuiles de carte déjà vues restent disponibles hors réseau (terrain sans 4G) ;
   • les données Supabase ne passent JAMAIS par ce cache (toujours en direct). */
const APP_CACHE = 'bs-app-v4';
const TILE_CACHE = 'bs-tiles-v1';
const TILE_MAX = 2500; // environ 50 à 80 Mo de tuiles au maximum

const TILE_HOSTS = ['data.geopf.fr', 'server.arcgisonline.com', 'tile.opentopomap.org', 'elevation-tiles-prod'];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length > TILE_MAX) {
    await Promise.all(keys.slice(0, keys.length - TILE_MAX + 200).map((k) => c.delete(k)));
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return; // données : jamais en cache

  // page de l'appli : réseau d'abord (nouvelle version), cache si pas de réseau
  if (req.mode === 'navigate' || (url.origin === self.location.origin && /\/$|\.html$/.test(url.pathname))) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./')))
    );
    return;
  }

  // tuiles de carte : cache d'abord, réseau sinon (et on garde la tuile)
  if (TILE_HOSTS.some((h) => url.hostname.includes(h))) {
    e.respondWith(
      caches.open(TILE_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { c.put(req, res.clone()); if (Math.random() < 0.05) trimTiles(); }
        return res;
      })))
    );
    return;
  }

  // bibliothèques et polices : réponse immédiate depuis le cache, mise à jour en arrière-plan
  if (LIB_HOSTS.some((h) => url.hostname.includes(h))) {
    e.respondWith(
      caches.open(APP_CACHE).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }))
    );
  }
});
