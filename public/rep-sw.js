// Rep app service worker (scope /rep): makes the app installable and lets it open without a connection.
// Pages are network-first; the last good copy of the app shell is served when offline. Data is never cached.
const CACHE='gd-rep-v1';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/rep','/brand/gd-logo.webp','/rep-icons/icon-192.png'])).catch(()=>{}))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request;const url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin)return;
  if(req.mode==='navigate'){e.respondWith(fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put('/rep',copy));return r}).catch(()=>caches.match('/rep')));return}
  if(url.pathname.startsWith('/assets/')||url.pathname.startsWith('/brand/')||url.pathname.startsWith('/rep-icons/')){
    e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r})));
  }
});
