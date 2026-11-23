import fs from 'node:fs';
const site='/home/user/homesignal-site';
const H = await import(site+'/supabase/functions/get-development-activity-report/handler.ts');
const CREDITS = JSON.parse(fs.readFileSync(site+'/supabase/functions/_shared/source-attribution.json','utf8'));
const D = JSON.parse(fs.readFileSync('data.json','utf8'));
const hav=(a,b,c,d)=>{const R=3958.8,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b);const h=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const s={lat:42.5796,lng:-84.4561};
const extra=[['arcgis:mdot-stip-projects:215962',42.5841824674024,-84.455030103031,'pt:1'],['arcgis:mdot-stip-projects:226633',42.5791797646983,-84.4476284701801,'pt:1'],['arcgis:mdot-stip-projects:226633',42.5791797646983,-84.4474128745119,'pt:2']].map(([k,la,ln,f])=>({source_key:k,feature_id:f,registry_id:'mdot-stip-projects',provenance:'proven_stored_point',distance_mi:+hav(s.lat,s.lng,la,ln).toFixed(4),geometry_type:'ST_Point',has_more:false,marker_lat:la,marker_lng:ln}));
console.log('distances',extra.map(e=>e.source_key.split(':')[2]+' '+e.feature_id+' '+e.distance_mi));
const hyd=[{"name":"N Bush St Tri-County Areawide","type":"Utility","stage":"Active","status":"Approved","address":"Tri-County Areawide","date_kind":"scheduled","provenance":{"case_number":"215962"},"source_key":"arcgis:mdot-stip-projects:215962","source_ref":"https://mdotgis.state.mi.us/arcgis/rest/services/Planning/MdotStip/FeatureServer/2","record_kind":"development","registry_id":"mdot-stip-projects","submitted_at":"2026-09-30"},{"name":"M-36 over Sycamore Creek","type":"Utility","stage":"Active","status":"Approved","address":"over Sycamore Creek","date_kind":"scheduled","provenance":{"case_number":"226633"},"source_key":"arcgis:mdot-stip-projects:226633","source_ref":"https://mdotgis.state.mi.us/arcgis/rest/services/Planning/MdotStip/FeatureServer/2","record_kind":"development","registry_id":"mdot-stip-projects","submitted_at":"2026-09-01"}];
const base=D.radius.S2.map(a=>({source_key:a[0],feature_id:a[1],registry_id:a[2],provenance:a[3],distance_mi:+a[4],geometry_type:a[5],has_more:a[6],marker_lat:a[7],marker_lng:a[8]}));
for (const [label,R,H2] of [['actual',base,D.hydrate],['counterfactual +2 rejected projects',[...base,...extra],[...D.hydrate,...hyd]]]) {
 const deps={now:()=>new Date('2026-11-20T19:30:00Z'),attribution:CREDITS,authenticate:async t=>t==='t'?{email:'a@example.com'}:null,isAdmin:async()=>true,
  geocode:async()=>({matchedAddress:'COORD-ONLY 48854',lat:s.lat,lng:s.lng,zip:'48854'}),zipSupported:async()=>true,radius:async()=>R,
  hydrate:async k=>H2.filter(p=>k.includes(p.source_key)),ledger:async k=>D.ledger.filter(l=>k.includes(l.identity_key)),events:async k=>D.events.filter(e=>k.includes(e.identity_key)),health:async f=>D.health.filter(h=>f.includes(h.registry_id)),jurisdictions:async()=>[]};
 const res=await H.makeHandler(deps)(new Request('https://x.supabase.co/functions/v1/get-development-activity-report',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer t'},body:JSON.stringify({address:'COORD-ONLY 48854',radius_mi:0.5})}));
 const b=JSON.parse(await res.text()); const rep=b.report??b;
 console.log(label,'-> included',rep.projects.length,rep.projects.map(p=>p.name+' ('+p.distance_mi+' mi)').join(' | '),'| review',JSON.stringify((rep.relevance_review||[]).map(x=>x.reason)));
}
