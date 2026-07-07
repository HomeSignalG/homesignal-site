// Verify the fix resolves all 3 followed communities from the LIVE communities table.
// Runs the EXTRACTED resolution logic (identical to the new dashboard.html code) against
// the real communities endpoint. Follows = the user's 3 real users rows (community_id + zip).
const https = require('https');
const SB = 'https://qwnnmljucajnexpxdgxr.supabase.co';
const ANON = process.env.SB_ANON;
const COV_LEGACY_PAGE = { 'box-elder':'box-elder.html', 'eagle-mountain':'eagle-mountain.html' };
const FOLLOWS = [ // the user's 3 users rows (from execute_sql)
  { community_id:'3aa7541e-2aa1-4254-96d2-962240cd2e32', zip_code:'84302' },
  { community_id:'8c0c2194-6263-4475-9a31-3156c73f8c27', zip_code:'84401' },
  { community_id:'d67c558f-1f04-4811-a565-873ae2afd6f3', zip_code:'84302' },
];
function communityPage(slug, zip){ if (slug && COV_LEGACY_PAGE[slug]) return COV_LEGACY_PAGE[slug]; return 'community.html' + (zip?('?zip='+encodeURIComponent(zip)):''); }
function get(url){ return new Promise((res,rej)=>{ https.get(url,{headers:{apikey:ANON,Authorization:'Bearer '+ANON}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej); }); }
(async()=>{
  const ids = FOLLOWS.map(f=>f.community_id);
  const rows = await get(`${SB}/rest/v1/communities?select=id,name,slug&id=in.(${ids.join(',')})`);
  const live = {}; rows.forEach(r=>live[r.id]={name:r.name,slug:r.slug});
  console.log('resolved communities from live DB:', rows.length, 'of', ids.length);
  const cards = FOLLOWS.map(f=>{ const l=live[f.community_id]; return { name:l?l.name:'(UNRESOLVED)', page:l?communityPage(l.slug,f.zip_code):'index.html' }; });
  cards.forEach((c,i)=>console.log(`  CARD ${i+1}: name="${c.name}"  href="${c.page}"`));
  console.log('TOTAL CARDS:', cards.length, cards.every(c=>c.name!=='(UNRESOLVED)')?'ALL RESOLVED':'*** SOME UNRESOLVED ***');
})();
