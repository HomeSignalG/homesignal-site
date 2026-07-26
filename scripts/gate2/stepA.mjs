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
// install harness-owned recorders, then force a re-render via the real mode control
await page.evaluate(()=>{ const HS=window.HS; window.__CAP={};
  const id=x=>(x&&(x.source_ref||x.name))||'?';
  const rs=HS.reserveFacilitySlots; HS.reserveFacilitySlots=function(dev,facs,o){
    window.__CAP.visible={n:(dev||[]).length,ids:(dev||[]).map(id)};
    window.__CAP.facs={n:(facs||[]).length,ids:(facs||[]).map(id)};
    const out=rs.apply(this,arguments); window.__CAP.lettered={n:out.length,ids:out.map(id)}; return out; };
  const ra=HS.restAfterLetters; if(ra) HS.restAfterLetters=function(vis,let_){
    const out=ra.apply(this,arguments); window.__CAP.rest={n:out.length,ids:out.map(id)}; return out; };
  const pm=HS.plottedMarkerSet; if(pm) HS.plottedMarkerSet=function(){
    const out=pm.apply(this,arguments); window.__CAP.plotted={n:out.length,ids:out.map(p=>id(p.item))}; return out; };
});
await page.evaluate(()=>{const s=document.querySelector('#mapMode button[data-mode="satellite"]');if(s)s.click();});
await page.waitForTimeout(1500);
await page.evaluate(()=>{const s=document.querySelector('#mapMode button[data-mode="impact"]');if(s)s.click();});
await page.waitForTimeout(1800);
const out=await page.evaluate(()=>{ const C=window.__CAP||{}, MAP=window.__HS_MAP||{};
  const HS=window.HS; let synth=null;
  try{ const vis=(C.visible&&C.visible.ids)||[], fac=(C.facs&&C.facs.ids)||[];
       synth={visible:vis.length,facs:fac.length,union:Array.from(new Set(vis.concat(fac))).length}; }catch(e){synth={err:String(e)};}
  return { __HS_MAP:{items:(MAP.items||[]).length,devTotal:MAP.devTotal,facTotal:MAP.facTotal,
      visibleTotal:MAP.visibleTotal,restFacTotal:MAP.restFacTotal,restCount:MAP.restCount,
      focusMarkerCount:MAP.focusMarkerCount,focusExpected:MAP.focusExpected,complete:MAP.complete},
    captured:Object.fromEntries(Object.entries(C).map(([k,v])=>[k,{n:v.n}])), synth,
    lettered_ids:(C.lettered&&C.lettered.ids)||[], rest_ids:(C.rest&&C.rest.ids)||[],
    plotted_ids:(C.plotted&&C.plotted.ids)||[], visible_ids:(C.visible&&C.visible.ids)||[], facs_ids:(C.facs&&C.facs.ids)||[] };
});
const uni=(...a)=>Array.from(new Set([].concat(...a)));
const combined=uni(out.lettered_ids,out.rest_ids,out.facs_ids);
console.log(JSON.stringify({page_errors:errs.slice(0,5), __HS_MAP:out.__HS_MAP, captured:out.captured, synth:out.synth,
  partition:{lettered:out.lettered_ids.length,rest:out.rest_ids.length,facs:out.facs_ids.length,
             plottedMarkerSet:out.plotted_ids.length, combined_unique:combined.length},
  combined_missing_vs_39: 39-combined.length},null,1));
await b.close(); srv.close();
