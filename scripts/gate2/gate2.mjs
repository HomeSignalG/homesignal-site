// GATE 2 — Street / Satellite / Focus parity. Real Chromium, real maps.html.
//
// HARNESS DEFECT FIXED: the seed is no longer injected with addInitScript (which the
// page's own <script src="seed/delvalle.js"> overwrote). It is served THROUGH the page's
// real seed-loading path by intercepting that exact request in ctx.route(). maps.html,
// lib/data.js and lib/map.js run unmodified; no rendering internal is monkey-patched.
import { chromium } from 'playwright';
import { HS_SEED, ROWS } from './seed78617.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';

const REPO='/home/user/homesignal-site';
const L=readFileSync('./node_modules/leaflet/dist/leaflet.js','utf8'), LC=readFileSync('./node_modules/leaflet/dist/leaflet.css','utf8');
const SB=readFileSync('./node_modules/@supabase/supabase-js/dist/umd/supabase.js','utf8');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
const M={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};

// Deterministic checksum over the FULL row identity — proves which dataset ran.
const SEED_JS = 'window.HS_SEED = ' + JSON.stringify(HS_SEED) + ';\nwindow.__HS_SEED_SOURCE = "gate2-delvalle-78617";';
const SEED_SHA = createHash('sha256').update(
  ROWS.map(r=>[r.record_kind,r.registry_id||'',r.type,r.status,r.lat,r.lng,r.source_ref,r.name].join('|')).sort().join('\n')
).digest('hex');

const srv=createServer((q,s)=>{const p=normalize(join(REPO,decodeURIComponent(q.url.split('?')[0])));
  if(!p.startsWith(REPO)||!existsSync(p)||statSync(p).isDirectory()){s.writeHead(404);return s.end('nf');}
  s.writeHead(200,{'content-type':M[extname(p)]||'application/octet-stream'});s.end(readFileSync(p));});
await new Promise(r=>srv.listen(8791,r));

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1440,height:960}});
const page=await ctx.newPage();
const consoleErrors=[], pageErrors=[]; let seedIntercepted=false;
page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
page.on('pageerror',e=>pageErrors.push(String(e)));
await ctx.route('**/*',async r=>{const u=r.request().url();
  if(u.includes('/seed/delvalle.js')){ seedIntercepted=true;
    return r.fulfill({status:200,contentType:'application/javascript',body:SEED_JS}); }
  if(u.includes('leaflet@1.9.4/dist/leaflet.js'))return r.fulfill({status:200,contentType:'application/javascript',body:L});
  if(u.includes('leaflet@1.9.4/dist/leaflet.css'))return r.fulfill({status:200,contentType:'text/css',body:LC});
  if(u.includes('supabase-js'))return r.fulfill({status:200,contentType:'application/javascript',body:SB});
  if(u.includes('cdn.jsdelivr.net'))return r.fulfill({status:200,contentType:'application/javascript',body:'/*stub*/'});
  if(/tile\.openstreetmap|arcgisonline|amazonaws/.test(u))return r.fulfill({status:200,contentType:'image/png',body:PNG});
  if(u.includes('supabase.co'))return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  return r.continue();});

await page.goto('http://127.0.0.1:8791/maps.html?zip=78617&data=seed',{waitUntil:'load'});
for(let i=0;i<250;i++){ if(await page.evaluate(()=>!!(window.__HS_MAP&&window.__HS_MAP.items&&window.__HS_MAP.items.length))) break; await page.waitForTimeout(100); }
await page.waitForTimeout(1200);

// ── SEED VALIDATION — must pass before any parity measurement ─────────────────
const seed = await page.evaluate(() => {
  const S = window.HS_SEED || {};
  const p = S.projects||[], f = S.facilities||[];
  return { source: window.__HS_SEED_SOURCE||null, projects:p.length, facilities:f.length,
    tabs: p.filter(r=>!r.registry_id).length,
    registry_ids: Array.from(new Set(p.map(r=>r.registry_id||'(none)'))).sort(),
    kinds: Array.from(new Set(p.concat(f).map(r=>r.record_kind))).sort(),
    demo_leak: p.concat(f).filter(r=>String(r.zip)!=='78617').length,
    cfg: (window.HS_CONFIG||{}).DATA_SOURCE };
});
const seedOK = seedIntercepted && seed.source==='gate2-delvalle-78617' && seed.demo_leak===0
  && seed.projects===HS_SEED.projects.length && seed.facilities===HS_SEED.facilities.length && seed.tabs===5;
if(!seedOK){ console.log(JSON.stringify({SEED_VALIDATION:'FAIL',seedIntercepted,seed,expected:{projects:HS_SEED.projects.length,facilities:HS_SEED.facilities.length,tabs:5}},null,1)); await b.close(); srv.close(); process.exit(1); }

const MODES=[['street','Street'],['satellite','Satellite'],['impact','Focus']];
const perMode={};
for(const [key,label] of MODES){
  await page.evaluate(k=>{const btn=document.querySelector('#mapMode button[data-mode="'+k+'"]'); if(btn) btn.click();},key);
  await page.waitForTimeout(1800);
  perMode[label] = await page.evaluate(()=>{
    const HS=window.HS, items=(window.__HS_MAP&&window.__HS_MAP.items)||[];
    const rec = items.map(it=>{ const m=HS.resolveMarker(it);
      return { id: it.source_ref||it.name, name:it.name, kind: m.isFacility?'facility':'development',
               category:m.categoryKey, symbol:m.shape, lifecycle:m.lifecycle, color:m.color,
               evidence: it.source_ref||'', filterKey:m.filterKey, legendLabel:m.legendLabel,
               registry_id: it.registry_id||null }; });
    const q=s=>Array.from(document.querySelectorAll(s));
    return { records: rec, total: rec.length,
      dev: rec.filter(r=>r.kind==='development').length, fac: rec.filter(r=>r.kind==='facility').length,
      by_category: rec.reduce((a,r)=>{a[r.category]=(a[r.category]||0)+1;return a;},{}),
      by_symbol:   rec.reduce((a,r)=>{a[r.symbol]=(a[r.symbol]||0)+1;return a;},{}),
      by_lifecycle:rec.reduce((a,r)=>{a[r.lifecycle]=(a[r.lifecycle]||0)+1;return a;},{}),
      legend_labels: (HS.SHAPE_LEGEND||[]).map(x=>x.label).concat([HS.CATEGORY_REGISTRY.facility.label]),
      legend_symbols:(HS.SHAPE_LEGEND||[]).map(x=>x.shape).concat([HS.CATEGORY_REGISTRY.facility.symbol]),
      lifecycle_chips:(HS.STATUS_LEGEND_ROWS||[]).map(x=>x.key+':'+x.label),
      dom_markers: q('#mapSch svg polygon, #mapSch svg rect, #mapSch svg circle, #maplf .leaflet-marker-icon, #mapgl .maplibregl-marker').length,
      container: ['mapSch','mapgl','maplf'].filter(id=>{const e=document.getElementById(id);return e&&e.style.display!=='none';})[0]||null };
  });
  await page.screenshot({path:`gate2-${key}-full.png`});
}

// ── PER-RECORD PARITY, keyed by stable source identity ────────────────────────
const [A,B,C]=[perMode.Street,perMode.Satellite,perMode.Focus];
const idx=m=>Object.fromEntries(m.records.map(r=>[r.id,r]));
const iA=idx(A),iB=idx(B),iC=idx(C);
const ids=Object.keys(iA).sort();
const mismatches=[];
for(const id of ids){ const a=iA[id],b2=iB[id],c=iC[id];
  if(!b2||!c){ mismatches.push({id,field:'presence',street:!!a,satellite:!!b2,focus:!!c}); continue; }
  for(const f of ['category','symbol','lifecycle','evidence','kind'])
    if(!(a[f]===b2[f]&&b2[f]===c[f])) mismatches.push({id,field:f,street:a[f],satellite:b2[f],focus:c[f]});
}
const sameIdSet = JSON.stringify(ids)===JSON.stringify(Object.keys(iB).sort()) && JSON.stringify(ids)===JSON.stringify(Object.keys(iC).sort());
const tabs = A.records.filter(r=>!r.registry_id && r.kind==='development');

// ── FILTER MEMBERSHIP (real chips, real toggles) ──────────────────────────────
await page.evaluate(()=>{const btn=document.querySelector('#mapMode button[data-mode="street"]'); if(btn)btn.click();});
await page.waitForTimeout(1200);
const filters={};
for(const key of ['proposed','approved','operating','unknown']){
  const before=await page.evaluate(()=>((window.__HS_MAP&&window.__HS_MAP.items)||[]).length);
  const beforeIds=await page.evaluate(()=>((window.__HS_MAP&&window.__HS_MAP.items)||[]).map(i=>i.source_ref||i.name));
  await page.evaluate(k=>window.HS.setStatusFilter(k,false),key);
  await page.evaluate(()=>{const s=document.querySelector('#mapMode button[data-mode="satellite"]');if(s)s.click();});
  await page.waitForTimeout(600);
  await page.evaluate(()=>{const s=document.querySelector('#mapMode button[data-mode="street"]');if(s)s.click();});
  await page.waitForTimeout(1000);
  const afterIds=await page.evaluate(()=>((window.__HS_MAP&&window.__HS_MAP.items)||[]).map(i=>i.source_ref||i.name));
  await page.screenshot({path:`gate2-filter-${key}-off.png`});
  await page.evaluate(k=>window.HS.setStatusFilter(k,true),key);
  await page.evaluate(()=>{const s=document.querySelector('#mapMode button[data-mode="satellite"]');if(s)s.click();});
  await page.waitForTimeout(500);
  await page.evaluate(()=>{const s=document.querySelector('#mapMode button[data-mode="street"]');if(s)s.click();});
  await page.waitForTimeout(900);
  const restored=await page.evaluate(()=>((window.__HS_MAP&&window.__HS_MAP.items)||[]).length);
  const removed=beforeIds.filter(i=>!afterIds.includes(i));
  filters[key]={before,after:afterIds.length,restored,removed_count:removed.length,
    removed_tabs:removed.filter(i=>i.includes('tdlr.texas.gov')).length};
}

console.log(JSON.stringify({
  SEED_VALIDATION:'PASS', seedIntercepted, seed, seed_sha256:SEED_SHA,
  per_mode:{Street:{total:A.total,dev:A.dev,fac:A.fac,by_category:A.by_category,by_symbol:A.by_symbol,by_lifecycle:A.by_lifecycle,dom:A.dom_markers,container:A.container},
            Satellite:{total:B.total,dev:B.dev,fac:B.fac,by_category:B.by_category,by_symbol:B.by_symbol,by_lifecycle:B.by_lifecycle,dom:B.dom_markers,container:B.container},
            Focus:{total:C.total,dev:C.dev,fac:C.fac,by_category:C.by_category,by_symbol:C.by_symbol,by_lifecycle:C.by_lifecycle,dom:C.dom_markers,container:C.container}},
  legend:{labels:A.legend_labels,symbols:A.legend_symbols,lifecycle_chips:A.lifecycle_chips},
  parity:{records_compared:ids.length,same_id_set:sameIdSet,mismatches},
  tabs:{count:tabs.length,rows:tabs.map(t=>({name:t.name,lifecycle:t.lifecycle,category:t.category,symbol:t.symbol,filterKey:t.filterKey,kind:t.kind,registry_id:t.registry_id,evidence:t.evidence}))},
  filters, console_errors:consoleErrors.slice(0,10), page_errors:pageErrors.slice(0,10)
},null,1));
await b.close(); srv.close();
