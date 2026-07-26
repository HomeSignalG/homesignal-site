// STEP 1 — capture the WORKING seed contract from the page's own bundled demo seed.
// The bundled seed/delvalle.js is served untouched; nothing is injected.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
const REPO='/home/user/homesignal-site';
const L=readFileSync('./node_modules/leaflet/dist/leaflet.js','utf8'), LC=readFileSync('./node_modules/leaflet/dist/leaflet.css','utf8');
const SB=readFileSync('./node_modules/@supabase/supabase-js/dist/umd/supabase.js','utf8');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
const M={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'};
const srv=createServer((q,s)=>{const p=normalize(join(REPO,decodeURIComponent(q.url.split('?')[0])));
  if(!p.startsWith(REPO)||!existsSync(p)||statSync(p).isDirectory()){s.writeHead(404);return s.end('nf');}
  s.writeHead(200,{'content-type':M[extname(p)]||'application/octet-stream'});s.end(readFileSync(p));});
await new Promise(r=>srv.listen(8793,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1440,height:960}}); const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await ctx.route('**/*',async r=>{const u=r.request().url();
  if(u.includes('leaflet@1.9.4/dist/leaflet.js'))return r.fulfill({status:200,contentType:'application/javascript',body:L});
  if(u.includes('leaflet@1.9.4/dist/leaflet.css'))return r.fulfill({status:200,contentType:'text/css',body:LC});
  if(u.includes('supabase-js'))return r.fulfill({status:200,contentType:'application/javascript',body:SB});
  if(u.includes('cdn.jsdelivr.net'))return r.fulfill({status:200,contentType:'application/javascript',body:'/*stub*/'});
  if(/tile\.openstreetmap|arcgisonline|amazonaws/.test(u))return r.fulfill({status:200,contentType:'image/png',body:PNG});
  if(u.includes('supabase.co'))return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  return r.continue();});
await page.goto('http://127.0.0.1:8793/maps.html?data=seed',{waitUntil:'load'});
for(let i=0;i<250;i++){ if(await page.evaluate(()=>!!(window.__HS_MAP&&window.__HS_MAP.items&&window.__HS_MAP.items.length))) break; await page.waitForTimeout(100); }
await page.waitForTimeout(1200);
const out = await page.evaluate(()=>{
  const S=window.HS_SEED||{}; const P=(S.projects||[])[0], F=(S.facilities||[])[0];
  const items=(window.__HS_MAP&&window.__HS_MAP.items)||[];
  const t=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
  const shape=o=>o?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,t(v)])):null;
  return { seed_top_keys:Object.keys(S), community:S.community||null, coverage0:(S.coverage||[])[0]||null,
    projects_n:(S.projects||[]).length, facilities_n:(S.facilities||[]).length,
    project0:P, project0_shape:shape(P), facility0:F, facility0_shape:shape(F),
    map_items_n:items.length, item0:items[0]||null, item0_shape:shape(items[0]),
    zip_url:location.search, cfg_zip:(window.HS_CONFIG||{}).DEFAULT_ZIP };
});
console.log(JSON.stringify({errs, ...out},null,1).slice(0,6000));
await b.close(); srv.close();
