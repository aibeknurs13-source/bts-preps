/* БТС AI — service worker (offline shell for the app itself only) */
const VERSION='bts-ai-v3';
const SHELL=[
  './','./index.html','./manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/core.js','./assets/js/ai.js','./assets/js/ingest.js','./assets/js/ui.js',
  './assets/icons/icon.svg','./assets/js/icons.js'
];

self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(VERSION)
      .then(c=>Promise.allSettled(SHELL.map(u=>c.add(u))))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  // Кросс-доменные запросы (AI API, CDN, шрифты) не перехватываем —
  // иначе ломается CORS-префлайт и запросы к моделям.
  if(url.origin!==self.location.origin) return;

  if(req.mode==='navigate'){
    e.respondWith(
      fetch(req).then(r=>{
        const copy=r.clone();
        caches.open(VERSION).then(c=>c.put('./index.html',copy));
        return r;
      }).catch(()=>caches.match('./index.html').then(r=>r||caches.match('./')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit=>{
      const net=fetch(req).then(r=>{
        if(r&&r.status===200) caches.open(VERSION).then(c=>c.put(req,r.clone()));
        return r;
      }).catch(()=>hit);
      return hit||net;
    })
  );
});
