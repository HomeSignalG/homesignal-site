// STEP 2 — instrumented drop-point trace. Harness-owned wrappers only; production files untouched.
import { chromium } from 'playwright';
import { HS_SEED } from './seed78617.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
const REPO='/home/user/homesignal-site';
const L=readFileSync('./node_modules/leaflet/dist/leaflet.js','utf8'), LC=readFileSync('./node_modules/leaflet/dist/leaflet.css','utf8');
const SB=readFileSync('./node_modules/@supabase/supabase-js/dist/umd/supabase.js','utf8');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
const M={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'};
const SEED_JS='window.HS_SEED = '+JSON.stringify(HS_SEED)+';\nwindow.__HS_SEED_SOURCE="gate2-delvalle-78617";';
const srv=createServer((q,s)=>{const p=normalize(join(REPO,decodeURIComponent(q.url.split('?')[0])));
  if(!p.startsWith(REPO)||!existsSync(p)||statSync(p).isDirectory()){s.writeHead(404);return s.end('nf');}
  s.writeHead(200,{'content-type':M[extname(p)]||'application/octet-stream'});s.end(readFileSync(p));});
await new Promise(r=>srv.listen(8795,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1440,height:960}}); const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
// harness-owned wrapper installed BEFORE the page scripts run — records, never alters.
await ctx.addInitScript(()=>{ window.__TRACE=[];
  const t=(stage,n,extra)=>window.__TRACE.push(Object.assign({stage,n},extra||{}));
  Object.defineProperty(window,'HS',{configurable:true,
    set(v){ delete window.HS; window.HS=v;
      const iv=setInterval(()=>{ if(window.HS&&window.HS.data&&!window.HS.data.__wrapped){
        window.HS.data.__wrapped=true;
        ['projects','facilities'].forEach(fn=>{ const orig=window.HS.data[fn];
          window.HS.data[fn]=async function(zip,home){ const r=await orig.apply(this,arguments);
            t('data.'+fn,(r||[]).length,{zip:zip,home:home?{zip:home.zip,lat:home.lat,lng:home.lng}:null,
              sample:(r||[])[0]?{id:(r||[])[0].id,lat:(r||[])[0].lat,lng:(r||[])[0].lng,distance_mi:(r||[])[0].distance_mi,dist:(r||[])[0].dist}:null});
            return r; }; });
        const wd=window.HS.withDistance;
        if(wd) window.HS.withDistance=function(items,home){ const o=wd.apply(this,arguments);
          t('withDistance',(o||[]).length,{in:(items||[]).length,home:home?{lat:home.lat,lng:home.lng,zip:home.zip}:null}); return o; };
        const rs=window.HS.reserveFacilitySlots;
        if(rs) window.HS.reserveFacilitySlots=function(dev,facs,opts){ const o=rs.apply(this,arguments);
          t('reserveFacilitySlots',(o||[]).length,{devIn:(dev||[]).length,facIn:(facs||[]).length}); return o; };
        clearInterval(iv);} },30); },
    get(){ return this.__hs; } });
  // simple backing store for the setter above
  let _hs; Object.defineProperty(window,'__hs',{get(){return _hs;},set(v){_hs=v;}});
});
await ctx.route('**/*',async r=>{const u=r.request().url();
  if(u.includes('/seed/delvalle.js'))return r.fulfill({status:200,contentType:'application/javascript',body:SEED_JS});
  if(u.includes('leaflet@1.9.4/dist/leaflet.js'))return r.fulfill({status:200,contentType:'application/javascript',body:L});
  if(u.includes('leaflet@1.9.4/dist/leaflet.css'))return r.fulfill({status:200,contentType:'text/css',body:LC});
  if(u.includes('supabase-js'))return r.fulfill({status:200,contentType:'application/javascript',body:SB});
  if(u.includes('cdn.jsdelivr.net'))return r.fulfill({status:200,contentType:'application/javascript',body:'/*stub*/'});
  if(/tile\.openstreetmap|arcgisonline|amazonaws/.test(u))return r.fulfill({status:200,contentType:'image/png',body:PNG});
  if(u.includes('supabase.co'))return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  return r.continue();});
await page.goto('http://127.0.0.1:8795/maps.html?zip=78617&data=seed',{waitUntil:'load'});
await page.waitForTimeout(3500);
console.log(JSON.stringify(await page.evaluate(()=>({
  trace: window.__TRACE||[],
  hs_map: window.__HS_MAP?{items:window.__HS_MAP.items.length,devTotal:window.__HS_MAP.devTotal,
    facTotal:window.__HS_MAP.facTotal,visibleTotal:window.__HS_MAP.visibleTotal,complete:window.__HS_MAP.complete}:null,
  seed:{projects:(window.HS_SEED.projects||[]).length,facilities:(window.HS_SEED.facilities||[]).length,
        community:window.HS_SEED.community, source:window.__HS_SEED_SOURCE},
  cfg:{zip:(window.HS_CONFIG||{}).DEFAULT_ZIP,src:(window.HS_CONFIG||{}).DATA_SOURCE}
})),null,1).slice(0,4000));
console.log('PAGE ERRORS: '+JSON.stringify(errs.slice(0,5)));
await b.close(); srv.close();
