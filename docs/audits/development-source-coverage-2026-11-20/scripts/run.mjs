import fs from 'node:fs';
import { runInNewContext } from 'node:vm';
const site='/home/user/homesignal-site';
const H = await import(site+'/supabase/functions/get-development-activity-report/handler.ts');
const sb={window:{}}; runInNewContext(fs.readFileSync(site+'/lib/da-report-view.js','utf8'), sb); const V=sb.window.HS.daReportView;
const CREDITS = JSON.parse(fs.readFileSync(site+'/supabase/functions/_shared/source-attribution.json','utf8'));
const D = JSON.parse(fs.readFileSync('data.json','utf8'));
const subj = {
 S1:{addr:'3225 W Oberlin Way, Phoenix, AZ 85083',lat:33.7359618783347,lng:-112.129279887116,zip:'85083'},
 S2:{addr:'COORDINATE-ONLY ZIP 48854 centre (42.5796,-84.4561)',lat:42.5796,lng:-84.4561,zip:'48854'},
 S3:{addr:'12400 NE Sherman Rd, Kansas City, MO 64166',lat:39.316609376222,lng:-94.511564544437,zip:'64166'},
 S4:{addr:'6550 W Happy Valley Rd, Phoenix, AZ 85310',lat:33.7134154669538,lng:-112.201473975353,zip:'85310'}};
const rows=(n)=>D.radius[n].map(a=>({source_key:a[0],feature_id:a[1],registry_id:a[2],provenance:a[3],distance_mi:+a[4],geometry_type:a[5],has_more:a[6],marker_lat:a[7],marker_lng:a[8]}));
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const text=h=>decode(h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const out={};
for (const n of Object.keys(subj)) {
  const s=subj[n]; const R=rows(n);
  const deps={ now:()=>new Date('2026-11-20T19:30:00Z'), attribution:CREDITS,
    authenticate:async t=>t==='t'?{email:'audit@example.com'}:null, isAdmin:async()=>true,
    geocode:async()=>({matchedAddress:s.addr,lat:s.lat,lng:s.lng,zip:s.zip}), zipSupported:async()=>true,
    radius:async()=>R,
    hydrate:async keys=>D.hydrate.filter(p=>keys.includes(p.source_key)),
    ledger:async keys=>D.ledger.filter(l=>keys.includes(l.identity_key)),
    events:async keys=>D.events.filter(e=>keys.includes(e.identity_key)),
    health:async fams=>D.health.filter(h=>fams.includes(h.registry_id)), jurisdictions:async()=>[] };
  const res=await H.makeHandler(deps)(new Request('https://x.supabase.co/functions/v1/get-development-activity-report',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer t'},body:JSON.stringify({address:s.addr,radius_mi:0.5})}));
  const body=JSON.parse(await res.text()); const rep=body.report??body;
  const keys=[...new Set(R.map(r=>r.source_key))]; const hyd=new Set(D.hydrate.map(p=>p.source_key));
  const cnt=(f)=>{const m={};for(const x of R){const k=f(x);m[k]=(m[k]||0)+1}return m};
  out[n]={status:res.status, addr:s.addr, geometry_rows:R.length, unique_keys:keys.length, hydrated:keys.filter(k=>hyd.has(k)).length,
    misses:keys.filter(k=>!hyd.has(k)).length, miss_by_family:Object.entries(keys.filter(k=>!hyd.has(k)).reduce((m,k)=>{const f=R.find(r=>r.source_key===k).registry_id;m[f]=(m[f]||0)+1;return m},{})), has_more:R.some(r=>r.has_more),
    provenance:cnt(r=>r.provenance), geom:cnt(r=>r.geometry_type),
    keys_top:Object.keys(rep).slice(0,40), cov:JSON.stringify(rep.coverage).slice(0,1800),
    included:(rep.projects||[]).length, included_by_family:(rep.projects||[]).reduce((m,p)=>{const f=p.source?.family||p.source_family||'?';m[f]=(m[f]||0)+1;return m},{}),
    relevance_review_by_reason:(rep.relevance_review||[]).reduce((m,x)=>{m[x.reason]=(m[x.reason]||0)+1;return m},{}),
    limitations:(rep.coverage?.limitations||rep.limitations||[]).map(l=>l.code), coverage_state:rep.coverage_state};
  const html=V.html(body,{subject:s.addr}); out[n].headline=(text(html).match(/\d+ official records? within .*? Types:/)||[null])[0]; out[n].shown=text(html).slice(0,700);
}
console.log(JSON.stringify(out,null,1));
