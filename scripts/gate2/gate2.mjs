// GATE 2 — Street / Satellite / Focus parity, real Chromium, real maps.html.
// Data enters through the page's OWN built-in seed path (?data=seed + window.HS_SEED),
// so lib/data.js, lib/map.js, the marker resolver, the legend, the mode switch, the
// popups and the filters all run unmodified. Nothing internal is monkey-patched.
import { chromium } from 'playwright';
import { HS_SEED } from './seed78617.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const REPO='/home/user/homesignal-site';
const L=readFileSync('./node_modules/leaflet/dist/leaflet.js','utf8'), LC=readFileSync('./node_modules/leaflet/dist/leaflet.css','utf8');
const SB=readFileSync('./node_modules/@supabase/supabase-js/dist/umd/supabase.js','utf8');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
const M={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const srv=createServer((q,s)=>{const p=normalize(join(REPO,decodeURIComponent(q.url.split('?')[0])));
  if(!p.startsWith(REPO)||!existsSync(p)||statSync(p).isDirectory()){s.writeHead(404);return s.end('nf');}
  s.writeHead(200,{'content-type':M[extname(p)]||'application/octet-stream'});s.end(readFileSync(p));});
await new Promise(r=>srv.listen(8791,r));

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1440,height:960}});
await ctx.addInitScript(seed => { window.HS_SEED = seed; }, HS_SEED);
const page=await ctx.newPage();
const consoleErrors=[], pageErrors=[];
page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
page.on('pageerror',e=>pageErrors.push(String(e)));
await ctx.route('**/*',async r=>{const u=r.request().url();
  if(u.includes('leaflet@1.9.4/dist/leaflet.js'))return r.fulfill({status:200,contentType:'application/javascript',body:L});
  if(u.includes('leaflet@1.9.4/dist/leaflet.css'))return r.fulfill({status:200,contentType:'text/css',body:LC});
  if(u.includes('supabase-js'))return r.fulfill({status:200,contentType:'application/javascript',body:SB});
  if(u.includes('cdn.jsdelivr.net'))return r.fulfill({status:200,contentType:'application/javascript',body:'/*stub*/'});
  if(/tile\.openstreetmap|arcgisonline|amazonaws/.test(u))return r.fulfill({status:200,contentType:'image/png',body:PNG});
  if(u.includes('supabase.co'))return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  return r.continue();});

await page.goto('http://127.0.0.1:8791/maps.html?zip=78617&data=seed',{waitUntil:'load'});
for(let i=0;i<200;i++){ const n=await page.evaluate(()=>document.querySelectorAll('#mapSch svg *, #maplf .leaflet-marker-icon, #mapgl .maplibregl-marker').length); if(n>0)break; await page.waitForTimeout(100); }
await page.waitForTimeout(1500);

// The canonical resolver output for EVERY seed record — mode-independent truth.
const truth = await page.evaluate(() => {
  const HS = window.HS, S = window.HS_SEED;
  const all = (S && S.projects ? S.projects : []).concat(S && S.facilities ? S.facilities : []).filter(Boolean);
  if (!HS || !HS.resolveMarker) return { __err: 'HS.resolveMarker missing' };
  if (!all.length) return { __err: 'HS_SEED empty', seedKeys: S ? Object.keys(S) : null, cfg: (window.HS_CONFIG||{}).DATA_SOURCE };
  return all.map(r => { const m = HS.resolveMarker(r);
    return { name:r.name, kind:r.record_kind, registry_id:r.registry_id, evidence:r.source_ref,
             category:m.categoryKey, lifecycle:m.lifecycle, symbol:m.shape, color:m.color,
             isFacility:!!m.isFacility, filterKey:m.filterKey, legendLabel:m.legendLabel,
             fallbackReason:m.fallbackReason }; });
});

const MODES=[['street','Street'],['satellite','Satellite'],['impact','Focus']];
const per={};
for(const [key,label] of MODES){
  await page.evaluate(k=>{const btn=document.querySelector('#mapMode button[data-mode="'+k+'"]'); if(btn) btn.click();},key);
  await page.waitForTimeout(1800);
  per[label]= await page.evaluate(()=>{
    const q=s=>Array.from(document.querySelectorAll(s));
    const vis=el=>{const r=el.getBoundingClientRect?el.getBoundingClientRect():null; return !!r;};
    const nodes=q('#mapSch [data-id], #maplf .leaflet-marker-icon, #mapgl .maplibregl-marker, #mapSch svg polygon, #mapSch svg rect, #mapSch svg circle');
    const shapeOf=n=>{const t=(n.tagName||'').toLowerCase(); if(t==='rect')return 'square'; if(t==='circle')return 'circle';
      const p=(n.getAttribute&&n.getAttribute('points')||'').trim().split(/\s+/).length; return 'poly'+p;};
    const hist={},colors={};
    nodes.forEach(n=>{const inner=n.querySelector?n.querySelector('polygon,rect,circle'):null; const t=inner||n;
      const s=shapeOf(t); hist[s]=(hist[s]||0)+1; const f=t.getAttribute&&t.getAttribute('fill'); if(f&&f!=='#fff')colors[f]=(colors[f]||0)+1;});
    const legendRows=q('#mapLegend .ld, #mapLegend [id^=stt], #mapLegend .lens, #mapLegend span').map(e=>(e.textContent||'').trim()).filter(Boolean);
    return { marker_nodes:nodes.length, symbol_hist:hist, colors, legend_sample:legendRows.slice(0,14),
             visible_container:['mapSch','mapgl','maplf'].filter(id=>{const e=document.getElementById(id);return e&&e.style.display!=='none';}) };
  });
  await page.screenshot({path:`gate2-${key}.png`});
}
console.log(JSON.stringify({truth_summary:{
    records:truth.length,
    by_category:truth.reduce((a,t)=>{a[t.category]=(a[t.category]||0)+1;return a;},{}),
    by_lifecycle:truth.reduce((a,t)=>{a[t.lifecycle]=(a[t.lifecycle]||0)+1;return a;},{}),
    by_symbol:truth.reduce((a,t)=>{a[t.symbol]=(a[t.symbol]||0)+1;return a;},{}),
    facilities:truth.filter(t=>t.isFacility).length,
    tabs:truth.filter(t=>!t.registry_id && t.kind==='development').map(t=>({name:t.name,lifecycle:t.lifecycle,category:t.category,symbol:t.symbol,filterKey:t.filterKey,isFacility:t.isFacility,evidence:t.evidence.slice(0,46)})),
  }, modes:per, console_errors:consoleErrors.slice(0,10), page_errors:pageErrors.slice(0,10)},null,1));
await b.close(); srv.close();
