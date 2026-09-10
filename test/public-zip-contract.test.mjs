// THE PUBLIC ZIP — the PS-001 / A-017 contract, frozen.
//
// WHY THIS FILE EXISTS. /community/<zip>/ is the one surface an anonymous stranger and a
// search crawler see, and every phase of this rebuild has touched the shared shell that
// renders it. The contract is entirely "change nothing", which is the kind that erodes in
// silence: nothing fails when JSON-LD is added because it "helps SEO", when a locked
// placeholder is switched on, when the public Follow copy is renamed to match the logged-in
// vocabulary, when View Development Map is retargeted at the list, when the Local News cap
// moves, or — worst — when JavaScript starts writing #robots-meta and a page can promote
// itself client-side. This file is the thing that fails.
//
// TWO SCOPE RULES, both deliberate and both load-bearing:
//   1. It does NOT assert that #zip-health-authed is absent from lib/community-page.js.
//      A-022 is AUTHORIZED in that same renderer for a signed-in, non-demo session. What is
//      pinned is the GATE (`sess && !sess.demo`), never the block's absence — the absence
//      form would fail the authorized feature it is supposed to protect.
//   2. Rule F is pinned at BUILD time (scripts/gen_zip_pages.py) and by the ABSENCE of any
//      robots write in the runtime. homesignalmap.html legitimately flips its own
//      #robots-meta for Utah indexability; that is not Rule F and is not in scope here.
//
// Every check runs on a COMMENT-STRIPPED copy — assertions in this repo have already gone
// green off a comment naming the very string they forbid, and community-page.js carries a
// long comment about robots for exactly the reason this file checks it.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
  + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : '')); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const cpRaw = read('lib/community-page.js');
const cp    = strip(cpRaw);
const gen   = read('scripts/gen_zip_pages.py');
const legacy= strip(read('community.html'));
const shellHtml = strip(read('partials/shell.html'));

// ---- A-017: ROBOTS IS BUILD-TIME AND JAVASCRIPT MUST NEVER MOVE IT ----
ok(/^RULE_F_MIN = 3\b/m.test(gen), 'A-017 RULE_F_MIN is still 3');
ok(/p\["rule_f_count"\] = p\["n_ln_journalism"\] \+ p\["n_gn"\] \+ p\["n_um"\]/.test(gen),
  'A-017 the Rule F count is journalism + government notices + capped meetings');
ok(/p\["rule_f"\] = p\["rule_f_count"\] >= RULE_F_MIN/.test(gen), 'A-017 ...and the threshold is that constant');
ok(/robots = "index, follow" if p\["rule_f"\] else "noindex, follow"/.test(gen),
  'A-017 the generator writes index,follow on a pass and noindex,FOLLOW on a fail');
// Read the generator's actual line first: it is an f-string,
// f'<meta name="robots" content="{robots}" id="robots-meta">\n'
ok(/<meta name="robots" content="\{robots\}" id="robots-meta">/.test(gen),
  'A-017 ...into the INITIAL HTML of the generated document, as #robots-meta');
// The display cap must be applied AFTER the count, or a rendering choice could move robots.
ok(/^LN_CAP, GN_CAP, UM_CAP = 20, 10, 12$/m.test(gen), 'A-017 LN_CAP is 20');
ok(gen.indexOf('p["rule_f"] = p["rule_f_count"] >= RULE_F_MIN') < gen.indexOf('ln_show = [x for x in p["ln"] if not x["weather"]][:LN_CAP]'),
  'A-017 the 20-item display cap is applied AFTER the Rule F count, so it can never move robots');
{
  // The whole of A-017's runtime half: the renderer must contain NO robots write at all.
  const writes = cp.match(/robots-meta|name="robots"|\.content\s*=\s*['"](?:index|noindex)/g) || [];
  ok(writes.length === 0,
    'A-017 lib/community-page.js contains NO robots-meta assignment — a page cannot promote itself client-side', writes);
}
ok(/ROBOTS IS BUILD-TIME AUTHORITATIVE/.test(cpRaw) && /JavaScript must never move it/.test(cpRaw),
  'A-017 the rule is recorded at its site in lib/community-page.js');

// ---- PS-001 ROUTING: the canonical surface is the generated document ----
ok(/canon = f"\{BASE\}\/community\/\{z\}\/"/.test(gen) && /<link rel="canonical" href="\{esc\(canon\)\}">/.test(gen),
  'PS-001 the generated document self-canonicalises to <BASE>/community/<zip>/');
ok(/<meta name="robots" content="noindex, nofollow" id="robots-meta">/.test(legacy),
  'PS-001 the LEGACY community.html?zip= surface is noindex, nofollow — it is not the SEO contract');

// ---- PS-001 STRUCTURED DATA: absence is preserved, never "improved" ----
for (const [f, body] of [['lib/community-page.js', cp], ['scripts/gen_zip_pages.py', gen], ['community.html', legacy]])
  ok(!/application\/ld\+json/.test(body), 'PS-001 no application/ld+json invented in ' + f,
    (body.match(/.{0,40}ld\+json.{0,40}/) || [])[0]);

// ---- PS-001 CHROME: seven items, Maps and Today both present ----
{
  const nav = [...shellHtml.matchAll(/href="([^"]+)"\s+data-nav="([a-z]+)"/g)].map(m => m[2] + '->' + m[1]);
  ok(nav.length === 7, 'PS-001 the shared chrome is SEVEN items', nav);
  ok(nav.includes('today->today.html'), 'PS-001 Today is still in the chrome — not retired', nav);
  ok(nav.includes('maps->homesignalmap.html'), 'PS-001 Maps is still in the chrome — not folded', nav);
  ok(nav.includes('comm->community.html'), 'PS-001 the public ZIP is still a chrome destination', nav);
}

// ---- PS-001 PRODUCT ENTRY: the public page's own copy and targets ----
ok(cp.includes('＋ Follow this community') && cp.includes('✓ Following'),
  'PS-001 the public Follow copy is unchanged (U+FF0B), including its followed state');
ok(/id="commFollowBtn"/.test(cp), 'PS-001 ...on the same control id');
ok(/View Development Map →/.test(cp) && /HS\.navHref\('homesignalmap\.html', zip\)/.test(cp),
  'PS-001 "View Development Map →" still targets Map 1, not the development list');
// The onclick lives inside a single-quoted JS string, so the inner quotes are escaped in
// the SOURCE bytes: onclick="HS.openModal(\\'shareModal\\')". Match what is actually there.
ok(/◍ Invite your neighbors/.test(cp) && cp.includes("HS.openModal(\\'shareModal\\')"),
  'PS-001 "Invite your neighbors" still opens the share modal');

// ---- FM-078: placeholders stay PLACEHOLDERS ----
ok(/🔒 Demographics<\/span><span class="d">Phase 1\.5 · \+ Census \(free\)/.test(cp),
  'FM-078 the Demographics placeholder is present and still locked');
ok(/🔒 Economy &amp; Market<\/span><span class="d">Phase 2 · \+ market data/.test(cp),
  'FM-078 the Economy & Market placeholder is present and still locked');
ok(/🔒<\/span> Community profile — Phase 1\.5 \/ 2/.test(cp),
  'FM-078 the Community profile placeholder is present and still locked');
ok(/opacity:\.55/.test(cp), 'FM-078 ...and still rendered in the locked/dimmed state');

// ---- LOCAL NEWS CAP: display-only, and the same number on both renderers ----
ok(/var LOCAL_NEWS_CAP = 20;/.test(cp), 'PS-001 LOCAL_NEWS_CAP is 20 in the runtime renderer');
ok(/slice\(0,LOCAL_NEWS_CAP\)/.test(cp), 'PS-001 ...and it is applied as a display slice');

// ---- A-022: pin the GATE, never the block's absence ----
ok(/var authedZipHealth = \(sess && !sess\.demo\)/.test(cp),
  'A-022 the ZIP-health block is gated on a real, NON-DEMO session');
ok(/id="zip-health-authed"/.test(cp),
  'A-022 ...and the authorized authenticated block still exists (this pin protects the gate, not the absence)');
ok(/var sess = HS\.state\.session;/.test(cp), 'A-022 the gate reads the live session, not a config flag');

// ---- FM-081: the PUBLIC tile is a different thing and must survive ----
ok(/id="zip-score-strip"/.test(cp), 'FM-081 the public score strip is present');
ok(/Community score/.test(cp), 'FM-081 ...carrying the public Community score');

console.log(fails ? '\nFAILED ' + fails : '\nAll public-zip-contract checks passed');
process.exit(fails ? 1 : 0);
