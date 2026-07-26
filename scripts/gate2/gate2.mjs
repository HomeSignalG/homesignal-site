// STEP A/B — identify and PROVE the canonical plotted inventory. Harness-owned wrappers
// installed after load via page.evaluate; production files untouched.
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
await new Promise(r=>srv.listen(8797,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1440,height:960}}); const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await ctx.route('**/*',async r=>{const u=r.request().url();
  if(u.includes('/seed/delvalle.js'))return r.fulfill({status:200,contentType:'application/javascript',body:SEED_JS});
  if(u.includes('leaflet@1.9.4/dist/leaflet.js'))return r.fulfill({status:200,contentType:'application/javascript',body:L});
  if(u.includes('leaflet@1.9.4/dist/leaflet.css'))return r.fulfill({status:200,contentType:'text/css',body:LC});
  if(u.includes('supabase-js'))return r.fulfill({status:200,contentType:'application/javascript',body:SB});
  if(u.includes('cdn.jsdelivr.net'))return r.fulfill({status:200,contentType:'application/javascript',body:'/*stub*/'});
  if(/tile\.openstreetmap|arcgisonline|amazonaws/.test(u))return r.fulfill({status:200,contentType:'image/png',body:PNG});
  if(u.includes('supabase.co'))return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  return r.continue();});
await page.goto('http://127.0.0.1:8797/maps.html?zip=78617&data=seed',{waitUntil:'load'});
for(let i=0;i<250;i++){ if(await page.evaluate(()=>!!(window.__HS_MAP&&window.__HS_MAP.items))) break; await page.waitForTimeout(100); }
await page.waitForTimeout(800);
// Harness-owned recorder of the CANONICAL plotted inventory: visible (all dev after
// filtering) UNION facs (all facilities) — proven in Step A/B to be 39 with 0 loss, and
// corroborated by the page's own __HS_MAP.focusMarkerCount/focusExpected = 39.
await page.evaluate(()=>{ const HS=window.HS;
  const rs=HS.reserveFacilitySlots; HS.reserveFacilitySlots=function(dev,facs,o){
    window.__CANON={visible:dev||[],facs:facs||[]};
    const out=rs.apply(this,arguments); window.__LETTERED=out; return out; };
  const ra=HS.restAfterLetters; if(ra) HS.restAfterLetters=function(){ const o=ra.apply(this,arguments); window.__REST=o; return o; };
});
const MODES=[['street','Street'],['satellite','Satellite'],['impact','Focus']];
const per={};
for(const [key,label] of MODES){
  await page.evaluate(k=>{const b=document.querySelector('#mapMode button[data-mode="'+k+'"]');if(b)b.click();},key);
  await page.waitForTimeout(1800);
  per[label]=await page.evaluate(()=>{ const HS=window.HS, C=window.__CANON||{visible:[],facs:[]};
    const id=x=>(x&&(x.source_ref||x.name))||'?';
    const all=C.visible.concat(C.facs);
    const rec=all.map(it=>{ const m=HS.resolveMarker(it);
      return {id:id(it),name:it.name,kind:m.isFacility?'facility':'development',category:m.categoryKey,
              symbol:m.shape,lifecycle:m.lifecycle,color:m.color,evidence:it.source_ref||'',
              filterKey:m.filterKey,legendLabel:m.legendLabel,registry_id:it.registry_id||null,
              popupTitle:m.popupLabel}; });
    const q=s=>Array.from(document.querySelectorAll(s));
    return {records:rec,total:rec.length,dev:rec.filter(r=>r.kind==='development').length,
      fac:rec.filter(r=>r.kind==='facility').length,
      lettered:(window.__LETTERED||[]).length, rest:(window.__REST||[]).length,
      by_category:rec.reduce((a,r)=>{a[r.category]=(a[r.category]||0)+1;return a;},{}),
      by_symbol:rec.reduce((a,r)=>{a[r.symbol]=(a[r.symbol]||0)+1;return a;},{}),
      by_lifecycle:rec.reduce((a,r)=>{a[r.lifecycle]=(a[r.lifecycle]||0)+1;return a;},{}),
      legend_labels:(HS.SHAPE_LEGEND||[]).map(x=>x.label).concat([HS.CATEGORY_REGISTRY.facility.label]),
      legend_symbols:(HS.SHAPE_LEGEND||[]).map(x=>x.shape).concat([HS.CATEGORY_REGISTRY.facility.symbol]),
      lifecycle_chips:(HS.STATUS_LEGEND_ROWS||[]).map(x=>x.key+':'+x.label),
      dom:q('#mapSch svg polygon,#mapSch svg rect,#mapSch svg circle,#maplf .leaflet-marker-icon,#mapgl .maplibregl-marker').length,
      focusMarkerCount:(window.__HS_MAP||{}).focusMarkerCount, complete:(window.__HS_MAP||{}).complete};});
  await page.screenshot({path:`gate2-${key}-full.png`});
}
const [A,B2,C2]=[per.Street,per.Satellite,per.Focus];
const ix=m=>Object.fromEntries(m.records.map(r=>[r.id,r]));
const iA=ix(A),iB=ix(B2),iC=ix(C2); const ids=Object.keys(iA).sort();
const mism=[];
for(const id of ids){const a=iA[id],b=iB[id],c=iC[id];
  if(!b||!c){mism.push({id,field:'presence',street:!!a,sat:!!b,focus:!!c});continue;}
  for(const f of ['kind','category','symbol','lifecycle','evidence','filterKey','color','popupTitle'])
    if(!(a[f]===b[f]&&b[f]===c[f])) mism.push({id,field:f,street:a[f],sat:b[f],focus:c[f]});}
const sameSet=JSON.stringify(ids)===JSON.stringify(Object.keys(iB).sort())&&JSON.stringify(ids)===JSON.stringify(Object.keys(iC).sort());
const tabs=A.records.filter(r=>!r.registry_id&&r.kind==='development');
const facs=A.records.filter(r=>r.kind==='facility');
// filters
await page.evaluate(()=>{const b=document.querySelector('#mapMode button[data-mode="street"]');if(b)b.click();});
await page.waitForTimeout(1200);
const filters={};
for(const key of ['proposed','approved','operating','unknown']){
  const before=await page.evaluate(()=>{const C=window.__CANON||{visible:[],facs:[]};return C.visible.length+C.facs.length;});
  await page.evaluate(k=>window.HS.setStatusFilter(k,false),key);
  await page.evaluate(()=>{const b=document.querySelector('#mapMode button[data-mode="satellite"]');if(b)b.click();});
  await page.waitForTimeout(500);
  await page.evaluate(()=>{const b=document.querySelector('#mapMode button[data-mode="street"]');if(b)b.click();});
  await page.waitForTimeout(1100);
  const afterIds=await page.evaluate(()=>{const C=window.__CANON||{visible:[],facs:[]};
    return C.visible.concat(C.facs).map(x=>x.source_ref||x.name);});
  await page.screenshot({path:`gate2-filter-${key}-off.png`});
  await page.evaluate(k=>window.HS.setStatusFilter(k,true),key);
  await page.evaluate(()=>{const b=document.querySelector('#mapMode button[data-mode="satellite"]');if(b)b.click();});
  await page.waitForTimeout(400);
  await page.evaluate(()=>{const b=document.querySelector('#mapMode button[data-mode="street"]');if(b)b.click();});
  await page.waitForTimeout(1000);
  const restored=await page.evaluate(()=>{const C=window.__CANON||{visible:[],facs:[]};return C.visible.length+C.facs.length;});
  const removed=ids.filter(i=>!afterIds.includes(i));
  filters[key]={before,after:afterIds.length,restored,removed_count:removed.length,
    removed_tabs:removed.filter(i=>i.includes('tdlr.texas.gov')).length,
    removed_sample:removed.slice(0,3)};
}
console.log(JSON.stringify({
 validation:{canonical:A.total,dev:A.dev,fac:A.fac,tabs:tabs.length,lettered:A.lettered,rest:A.rest,
   focusMarkerCount:C2.focusMarkerCount,complete:A.complete,unexplained_loss:39-A.total},
 aggregates:{Street:{t:A.total,d:A.dev,f:A.fac,cat:A.by_category,sym:A.by_symbol,lc:A.by_lifecycle,dom:A.dom},
             Satellite:{t:B2.total,d:B2.dev,f:B2.fac,cat:B2.by_category,sym:B2.by_symbol,lc:B2.by_lifecycle,dom:B2.dom},
             Focus:{t:C2.total,d:C2.dev,f:C2.fac,cat:C2.by_category,sym:C2.by_symbol,lc:C2.by_lifecycle,dom:C2.dom}},
 legend:{labels:A.legend_labels,symbols:A.legend_symbols,chips:A.lifecycle_chips},
 parity:{compared:ids.length,same_id_set:sameSet,mismatches:mism},
 tabs:tabs.map(t=>({name:t.name,lifecycle:t.lifecycle,legendLabel:t.legendLabel,category:t.category,symbol:t.symbol,kind:t.kind,filterKey:t.filterKey,registry_id:t.registry_id,evidence:t.evidence})),
 facilities:facs.map(f=>({name:f.name,kind:f.kind,category:f.category,symbol:f.symbol,color:f.color,lifecycle:f.lifecycle,evidence:f.evidence.slice(0,60)})),
 filters, page_errors:errs.slice(0,6)},null,1));
await b.close(); srv.close();
