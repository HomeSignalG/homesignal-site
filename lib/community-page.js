// Community ZIP page runtime - THE ONE SHARED IMPLEMENTATION.
//
// Loaded by BOTH the legacy community.html?zip= page and every generated canonical
// page at /community/<zip>/. There is exactly one implementation and one template;
// the build turns them into per-ZIP DOCUMENTS. There are never 12,722 source
// implementations - that is the architecture invariant (CLAUDE.md 0).
//
// Extracted verbatim from community.html`s inline block, with three changes, each
// marked at its site: data-zip identity, robots is build-time authoritative, and the
// SSR block is torn down on hydration.
HS.onReady(async function () {
  // ZIP identity: the legacy URL carries ?zip=; the generated canonical page at
  // /community/<zip>/ has no query string and declares it as <body data-zip>.
  // Neither is an address, a point or a centroid - it is the ZIP geography key.
  var zip = new URLSearchParams(location.search).get('zip') || document.body.dataset.zip || HS.state.zip;
  var focusScore = new URLSearchParams(location.search).get('focus') === 'score';
  HS.state.zip = zip;
  // LEGACY URL COMPATIBILITY: community.html?zip= must never compete with the canonical
  // /community/<zip>/ document. The generated page already ships its own <link rel=canonical>
  // in the initial HTML; only the legacy page needs one added, and it points AWAY from itself.
  // community.html is also permanently noindex, so there is no duplicate-indexing ambiguity.
  if (zip && !document.querySelector('link[rel="canonical"]')) {
    var cl = document.createElement('link');
    cl.rel = 'canonical';
    cl.href = '/community/' + encodeURIComponent(zip) + '/';
    document.head.appendChild(cl);
  }
  var page = document.getElementById('commPage');
  // Progressive enhancement: drop the build-time SSR block once the app has a page to draw
  // into. The SSR block is the crawlable floor, not a second renderer.
  function dropSsr(){ var s = document.getElementById('hs-ssr'); if (s && s.parentNode) s.parentNode.removeChild(s); }
  // KEEP the build-time block on any branch where the app does NOT re-render the same
  // Alerts populations. A ZIP can carry real Alerts substance while data_quality is
  // 'coverage_coming' (measured 2026-09-04: 529 ZIPs are Alerts-PASS with the
  // development/facility gate FAIL, e.g. 01034 Granville MA at 5 local-news items), and
  // those branches render coverage copy only. Dropping the SSR there would delete real
  // content the crawler was just shown — hydration corrupting the build-time contract.
  function keepSsrAbove(){ var s = document.getElementById('hs-ssr'); if (s) s.setAttribute('data-hydrated','kept'); }
  // ROBOTS IS BUILD-TIME AUTHORITATIVE (Alerts SEO unit). scripts/gen_zip_pages.py writes
  // the robots directive into the INITIAL HTML from Rule F. JavaScript must never move it:
  // a crawler that does not execute JS must see the same decision as one that does, and a
  // page must not be able to promote itself client-side.

  // DATA-QUALITY GATE: only render the full page when the ZIP has real, sourced data.
  var status = await HS.data.coverageStatus(zip);   // 'pass' | 'coverage_coming' | null
  var meta = status ? await HS.data.community(zip) : null;
  // Phase 2 coverage-state (ADDITIVE, fail-soft): truthful state copy only — the
  // layout gate above stays keyed on data_quality, so rendering behavior is unchanged.
  var cov = status ? await HS.data.coverageState(zip) : null;
  if (cov && cov.coverage_state) page.setAttribute('data-coverage-state', cov.coverage_state);
  var covBanner = '';
  if (cov) {
    if (cov.coverage_state === 'facilities_only') {
      covBanner = '<div class="quiet" style="margin:10px 0 2px">Local government meeting and permit feeds for this area are still being wired — the EPA-registered facility records below are live public data.</div>';
    } else if (cov.coverage_state === 'stale_data' || cov.coverage_state === 'temporarily_unavailable' || cov.coverage_state === 'failed_ingest') {
      var covDays = cov.refreshed_at ? Math.max(1, Math.round((Date.now() - new Date(cov.refreshed_at).getTime()) / 86400000)) : null;
      covBanner = '<div class="quiet" style="margin:10px 0 2px">' + (covDays ? 'Records on this page were last verified ' + covDays + ' day' + (covDays > 1 ? 's' : '') + ' ago. ' : '') + 'An automatic refresh is scheduled — nothing shown here is ever fabricated.</div>';
    }
  }

  // The development/facility flag (app_community_meta.indexable) still governs the
  // map/development page. It no longer governs THIS page: community indexability is the
  // Alerts decision, made at build time. Page-purpose separation.

  if (!status) {
    keepSsrAbove();
    page.innerHTML = '<div class="ph"><div class="eyebrow">Communities</div><h1>' + HS.esc(zip) + ' isn\'t covered yet</h1>'
      + '<p>We\'re not tracking this ZIP yet — request it and we\'ll email you when it goes live.</p>'
      + '<button class="inlinebtn" style="margin-top:12px" onclick="HS.openLoc()">Request this community →</button></div>';
    return;
  }
  if (status !== 'pass') {
    var county0 = meta && meta.county ? HS.esc(meta.county) + ' County' : 'the county';
    keepSsrAbove();
    page.innerHTML = '<div class="ph"><div class="eyebrow">Communities</div><h1>' + HS.esc(zip) + (meta && meta.name ? ' · ' + HS.esc(meta.name) : '') + (meta && meta.state ? ', ' + HS.esc(meta.state) : '') + '</h1>'
      + (cov && cov.coverage_state === 'honestly_empty'
          ? '<p>We checked every supported public source for this area — government registries, permit feeds, and the EPA facility registry — and found no qualifying records yet. That check is real and repeats automatically; the moment a record appears it will show here, linked to its official source.</p></div>'
          : '<p>Coverage for this ZIP is being wired. We show a community only when it has real, sourced records — no placeholder cards. '
            + 'The government meeting and permit feeds for this area are on the way.</p></div>')
      + '<div class="quiet" style="margin-top:6px"><b>Coverage coming.</b> We never show made-up activity. When ' + county0 + ' meeting and permit feeds are wired for '
      + HS.esc(zip) + ', this page fills with real records — each linked to its official source.'
      + '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">'
      + '<button class="inlinebtn" onclick="HS.openLoc()">◉ Notify me when it\'s live →</button>'
      + '<a class="inlinebtn" href="' + HS.esc(HS.navHref('homesignalmap.html', zip)) + '" data-znav="homesignalmap.html" style="text-decoration:none">View Development Map →</a>'
      + '</div></div>';
    return;
  }

  var c = meta;
  var following = HS.isFollowingCommunity(zip);
  // Never measure real public records from the FICTIONAL demo home — even on its own
  // ZIP (78617). Only a real saved property produces distance labels here.
  var home = HS.state.activeProperty;
  if (home && home.sample) home = null;
  var projects = await HS.data.projects(zip, home);      // DEVELOPMENT only (guardrail #3)
  var facilities = await HS.data.facilities(zip, home);  // regulated facilities — own section
  var changes = await HS.data.changes(zip, home);
  var meetings = await HS.data.meetings(zip, home);
  // LOCAL NEWS — read and RENDERED here (Alerts SEO unit). It was fetched by alerts.html
  // only, so a ZIP could qualify for indexing on local news this page never displayed
  // (the d4392d7 mismatch). Measured 2026-09-04: 701 of the 7,256 Rule F passers qualify
  // ONLY via local news. Same read as the Local News tab — one materialized pipeline.
  var news = [];
  try { news = await HS.data.news(zip, home); } catch (e) { news = []; }
  HS.shareUrlOverride = HS_CONFIG.BASE_URL + '/community.html?zip=' + zip;

  var active = projects.filter(function(p){return p.status==='Active'||p.status==='Approved'||p.status==='Operating';});
  var proposed = projects.filter(function(p){return p.status==='Proposed';});
  // Top cards: proposed + active first; if a county's records carry other real statuses
  // (Decided / Operating / On file), fall back to the full list rather than hiding them.
  var topProjects = proposed.concat(active); if (!topProjects.length) topProjects = projects;
  var envChanges = changes.filter(function(x){return /environment|utilit|water/i.test(x.category);});
  // Planning & zoning + civic NOTICES (jurisdiction-wide public records — agendas, hearing
  // notices). Meetings render from meetings(); exclude their app_changes mirrors.
  var notices = changes.filter(function(x){
    return /planning|government|civic/i.test(x.category) && !/^Public meeting/.test(x.title||'');
  });
  // GOVERNMENT NOTICES — always render a determinate state, never a bare count with
  // nothing under it. Before this, a ZIP with 0 notices rendered the heading and then the
  // empty string, so "no source is wired for this county" and "nothing was posted this
  // week" were indistinguishable on 6,491 of 12,722 canonical pages (measured 2026-09-04).
  // The map is only fetched when the section is actually empty — a page with notices pays
  // nothing. Fail closed: an unreadable map yields the no-source-identified copy, which
  // names no source and promises nothing (lib/gov-notice-copy.js ban 5).
  var govNoticeState = null;
  if (!notices.length) {
    var gnMap = await fetch('lib/generated/gov-notice-coverage.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    govNoticeState = HS.govNoticeCopy.build({
      zip: zip, county: c.county, state: c.state,
      noticeCount: notices.length, map: gnMap
    });
  }
  // TRUE totals come from the meta score labels (uncapped engine counts); the
  // materialized lists are capped, so caption them "latest N shown" when smaller.
  function metaCount(key, floor){
    var s = c.component_scores && c.component_scores[key];
    var v = s && parseInt(s.label, 10);
    return (typeof v === 'number' && !isNaN(v) && v >= floor) ? v : floor;
  }
  // WHOLE-ZIP DEVELOPMENT MAY BE UNAVAILABLE, AND THAT IS NOT ZERO. HS.data.projects stamps
  // `unavailable` when the ZIP's current geography state cannot support a whole-ZIP read -
  // `not_measured` (no ZCTA for this ZIP in the pinned TIGER contract, so the measurement never
  // happened) or an unresolved/pending state. Rendering the ordinary empty section there would
  // tell a resident "no permit or planning records on file", which asserts a measurement we
  // never made; serving the pre-authoritative legacy rows instead would substitute a
  // centroid/proxy for the whole-ZIP geography this page claims. Both are forbidden, so the
  // page says what is actually true and keeps every other section.
  var devUnavailable = projects && projects.unavailable ? String(projects.unavailable) : null;
  var devTotal = devUnavailable ? 0 : metaCount('development projects', projects.length);
  var facTotal = metaCount('regulated facilities', facilities.length);

  // Guardrail #3: EPA/ECHO regulated facilities render in their OWN clearly-labeled section —
  // never under Development / what's changing. Factual public-record count, not a verdict.
  var facHtml = facilities.length
    ? '<div class="groupHead"><span class="gd" style="background:#3f7fb0"></span> Regulated facilities nearby <span class="gc">— ' + facTotal + ' on record' + (facTotal > facilities.length ? ' · ' + facilities.length + ' shown' : '') + ' · environmental context</span></div>'
      + '<div class="quiet" style="margin:-2px 0 10px;font-size:12.5px">EPA/ECHO-registered facilities near this ZIP — a factual public-record count, not development and not a verdict on any operator.</div>'
      + facilities.slice(0,6).map(function(f){
          return '<div class="card mini" style="border-left-color:#3f7fb0;margin-bottom:10px">'
            + '<span class="lens">Operating' + (f.dist? ' · ' + HS.esc(f.dist):'') + '</span><h3>' + HS.esc(f.name) + '</h3>'
            + '<p class="sowhat">' + HS.esc(f.type||'Regulated facility') + (f.developer? ' · ' + HS.esc(f.developer):'') + '</p>'
            + (f.source_ref? '<a href="' + HS.esc(f.source_ref) + '" target="_blank" rel="noopener" style="font-size:12.5px;font-weight:600">View public record →</a>':'') + '</div>';
        }).join('')
    : '';

  dropSsr();
  page.innerHTML =
    '<div class="ph"><div class="eyebrow">Communities</div><h1>' + HS.esc(zip) + ' · ' + HS.esc(c.name) + ', ' + HS.esc(c.state) + '</h1>'
    + '<p>What\'s changing across your community — aggregated from the same feeds that power your alerts.</p>'
    + covBanner
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">'
    + '<button class="inlinebtn' + (following ? ' following' : '') + '" id="commFollowBtn" data-zip="' + HS.esc(zip) + '" data-name="' + HS.esc(c.name||'') + '" data-state="' + HS.esc(c.state||'') + '" onclick="HS.toggleFollowCommunityBtn(this)">' + (following ? '✓ Following' : '＋ Follow this community') + '</button>'
    + '<a class="inlinebtn" href="' + HS.esc(HS.navHref('homesignalmap.html', zip)) + '" data-znav="homesignalmap.html" style="text-decoration:none">View Development Map →</a>'
    + '<button class="inlinebtn" onclick="HS.openModal(\'shareModal\')">◍ Invite your neighbors</button>'
    + '</div>'
    + '<div style="margin-top:14px"><div class="bt" style="font-size:13px;color:var(--ink-2);margin-bottom:6px">Your communities</div><div id="commStrip">' + HS.communitiesStripHTML() + '</div></div></div>'
    + '<div class="strip" id="zip-score-strip">'
    + HS.tpl.statTile(c.community_score, 'Community score', 'g')
    + HS.tpl.statTile(devTotal, 'Development projects', '')
    + HS.tpl.statTile(meetings.length, 'Public meetings', 'accent')
    + HS.tpl.statTile(facTotal, 'Regulated facilities', '')
    + '</div>'
    + '<div class="lensnav">'
    + '<button class="lenscard on"><span class="q">What\'s changing</span><span class="d">Live · built on existing feeds</span></button>'
    + '<button class="lenscard" style="opacity:.55"><span class="q">🔒 Demographics</span><span class="d">Phase 1.5 · + Census (free)</span></button>'
    + '<button class="lenscard" style="opacity:.55"><span class="q">🔒 Economy &amp; Market</span><span class="d">Phase 2 · + market data</span></button>'
    + '</div>'
    + '<div class="cols"><div>'
    + '<div class="groupHead" style="margin-top:0"><span class="gd traffic"></span> Development &amp; growth <span class="gc">— ' + (devUnavailable ? 'not measured' : devTotal + (devTotal===1?' record':' records') + (devTotal > projects.length ? ' · latest ' + projects.length + ' shown' : '')) + '</span></div>'
    + (devUnavailable ? '<div class="quiet" style="margin-bottom:10px;font-size:12.5px">' + HS.esc(HS.zipDevelopmentUnavailableNote(devUnavailable, zip)) + '</div>'
      : projects.length ? topProjects.slice(0,3).map(function(p){
        return '<div class="card mini" style="border-left-color:' + HS.barColor(p) + ';margin-bottom:10px">'
          + '<span class="lens">' + HS.esc(p.status) + ' · ' + HS.esc(p.dist||'') + '</span><h3>' + HS.esc(p.name) + '</h3>'
          + HS.tpl.devImpactBlock(p)
          + '<p class="sowhat"><b>' + (p.sowhat_factual ? 'On the record:' : 'How it impacts you:') + '</b> ' + HS.esc(p.sowhat||'') + '</p></div>';
      }).join('') : '<div class="quiet" style="margin-bottom:10px;font-size:12.5px">No permit or planning records on file for this ZIP yet — the regulated-facility record below is the current public-record floor.</div>')
    + facHtml
    + '<div class="groupHead"><span class="gd water"></span> Environment &amp; utilities <span class="gc">— ' + envChanges.length + ' change' + (envChanges.length===1?'':'s') + '</span></div>'
    + (envChanges.length ? envChanges.slice(0,2).map(function(ch){ return HS.tpl.miniCard(ch, ch.category); }).join('') : '<div class="quiet" style="margin-bottom:10px;font-size:12.5px">No environment or utility notices on file for this ZIP yet.</div>')
    + '<div class="groupHead"><span class="gd" style="background:var(--violet)"></span> Government &amp; civic <span class="gc">— ' + meetings.length + ' upcoming · ' + notices.length + (notices.length===1?' notice':' notices') + '</span></div>'
    + (meetings.length ? '<div class="card mini" style="border-left-color:var(--violet)"><span class="lens">Civic</span><h3>' + HS.esc(meetings.map(function(m){return m.body;}).slice(0,2).join(' & ')) + '</h3>'
      + '<p class="sowhat">Upcoming public meetings — development and environment items on the agendas.</p></div>'
      : '<div class="quiet" style="margin-bottom:10px;font-size:12.5px">No upcoming public meetings on file for this ZIP yet.</div>')
    + (notices.length
        ? notices.slice(0,2).map(function(n){ return HS.tpl.miniCard(n, n.category); }).join('')
        : (govNoticeState
            ? '<div class="quiet" style="margin-bottom:10px;font-size:12.5px"><b>'
              + HS.esc(govNoticeState.label) + '.</b> ' + HS.esc(govNoticeState.text) + '</div>'
            : ''))
    // LOCAL NEWS renders here, in the same column as the other Alerts tiles, from the same
    // materialized app_changes pipeline. Rule F counts it, so the page shows it.
    + '<div class="groupHead"><span class="gd" style="background:var(--blue)"></span> Local news <span class="gc">— ' + news.length + (news.length===1?' item':' items') + '</span></div>'
    + (news.length ? news.slice(0,6).map(function(n){ return HS.tpl.miniCard(n, n.category); }).join('')
        : '<div class="quiet" style="margin-bottom:10px;font-size:12.5px">No qualifying local news on file for this ZIP yet.</div>')
    + '</div><div>'
    + '<div class="block"><h2 class="bt">Community pulse</h2>'
    // Every pulse value is DERIVED from records (materializer) or reads "Tracking" — never hardcoded.
    + '<div class="vital"><span class="vl">Development activity</span><span class="vv"' + (c.growth_pressure==='High'?' style="color:var(--amber)"':'') + '>' + HS.esc(c.growth_pressure||'Tracking') + '</span></div>'
    + '<div class="vital"><span class="vl">Civic activity</span><span class="vv">' + HS.esc(c.civic_activity||'Tracking') + '</span></div>'
    + '<div class="vital"><span class="vl">Value trend · 12 mo</span><span class="vv">' + HS.trend(c.value_trend) + '</span></div></div>'
    + '<div class="p2"><div class="p2h"><span>🔒</span> Community profile — Phase 1.5 / 2</div>'
    + '<div class="p2sub">The "what\'s changing" view is live now; the demographic &amp; market profile activates with new feeds.</div>'
    + '<div class="p2i"><div style="flex:1"><div class="t">Population &amp; demographics</div><div class="d">Community DNA radar, household mix</div></div><span class="feed">+ Census (free)</span></div>'
    + '<div class="p2i"><div style="flex:1"><div class="t">Median home value &amp; market</div><div class="d">Prices, growth outlook</div></div><span class="feed">+ market data</span></div></div>'
    + '</div></div>';

  if (focusScore) {
    var el = document.getElementById('zip-score-strip');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
