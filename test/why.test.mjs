// Pins HS.whyDerive (lib/why.js) — the "Why This Matters" derivation shared by
// maps.html and development.html. Every assertion is an ANTI-FABRICATION gate:
// a sentence may exist only when the record field that supports it exists, and
// a known fact must never re-appear under "What we don't know yet".
// Run: node --test test/why.test.mjs
import test from 'node:test';
import assert from 'node:assert';

global.window = { HS: {} };
await import('../lib/templates.js');   // esc / fmtDate / daysUntil
await import('../lib/why.js');
const HS = global.window.HS;

const future = new Date(Date.now() + 12 * 86400000).toISOString();
const past = new Date(Date.now() - 12 * 86400000).toISOString();

const fullProject = {
  id: 'p1', type: 'Data Center', name: 'Campus', status: 'Proposed',
  stage: 'Application submitted', submitted_at: '2026-06-18',
  developer: 'Applicant LLC', lat: 30.18, lng: -97.6,
  distance_mi: 0.8, dist: '0.8 mi', source_ref: 'https://county.example/rec'
};
const homeCtx = { hasHome: true, homeAddress: '4400 Wildhorse Trail', place: 'Del Valle', radiusMi: 1.5 };

test('why-this-matters derivation is evidence-gated', () => {
  // ── the four questions, fully-evidenced record ──
  let d = HS.whyDerive(fullProject, homeCtx);
  assert.match(d.seeing, /1\.5-mile map view/, 'Q1 cites the radius only when distance <= radius');
  assert.match(d.close, /about 0\.8 mi .* 4400 Wildhorse Trail/, 'Q2 uses the computed distance + saved address');
  assert.match(d.stage, /“Application submitted” — filed June 18, 2026/, 'Q3 quotes the record stage verbatim + real filing date');
  assert.match(d.participate, /review the official record/, 'Q4 falls back to the record when no window/hearing exists');

  // ── no saved home -> NO distance sentence, ever (never fabricated) ──
  const noHome = HS.whyDerive({ ...fullProject, distance_mi: null, dist: '' }, { hasHome: false, place: 'Del Valle' });
  assert.doesNotMatch(noHome.close, /mi from/, 'no home -> no distance claim');
  assert.match(noHome.close, /Save your home address/, 'no home -> says why, offers the fix');
  assert.match(noHome.seeing, /Del Valle/, 'no home -> Q1 anchors on the viewed place instead');

  // ── beyond the radius -> the radius claim is NOT made ──
  const far = HS.whyDerive({ ...fullProject, distance_mi: 3.2, dist: '3.2 mi' }, homeCtx);
  assert.doesNotMatch(far.seeing, /map view/, 'distance > radius -> no "inside your view" claim');
  assert.match(far.seeing, /near your saved home/);

  // ── area-wide record (no point) -> whole-area sentence, no distance ──
  const areaRec = HS.whyDerive({ id: 'n1', category: 'Notice', occurred_at: past, source_ref: 'https://x' }, homeCtx);
  assert.match(areaRec.close, /whole area/, 'no coordinates -> area-wide, not a fake distance');

  // ── stage: never invented ──
  const bare = HS.whyDerive({ id: 'b1', type: 'Industrial' }, {});
  assert.match(bare.stage, /doesn’t state a stage/, 'no stage/status/date -> said to be absent');
  const statusOnly = HS.whyDerive({ id: 'b2', type: 'Industrial', status: 'Approved' }, {});
  assert.match(statusOnly.stage, /“Approved/, 'status-only -> status verbatim, no invented stage');

  // ── participation: window > hearing > record > none ──
  const win = HS.whyDerive({ ...fullProject, window_closes_at: future }, homeCtx);
  assert.match(win.participate, /Public comments are open/, 'open window wins');
  const hear = HS.whyDerive(fullProject, { ...homeCtx, meeting: { starts_at: future } });
  assert.match(hear.participate, /public hearing is scheduled/, 'upcoming hearing next');
  const pastHear = HS.whyDerive(fullProject, { ...homeCtx, meeting: { starts_at: past } });
  assert.doesNotMatch(pastHear.participate, /hearing is scheduled/, 'a PAST hearing never claims participation');
  const none = HS.whyDerive({ id: 'n2', type: 'X' }, {});
  assert.match(none.participate, /No participation opportunity/, 'nothing on record -> honest none');

  // ── What we know: one line per present field, absent fields absent ──
  d = HS.whyDerive(fullProject, { ...homeCtx, meeting: { starts_at: future } });
  const know = d.know.join(' | ');
  assert.match(know, /application filed June 18, 2026/);
  assert.match(know, /Status on file: Proposed/);
  assert.match(know, /Applicant on file: Applicant LLC/);
  assert.match(know, /hearing scheduled/);
  assert.match(know, /Official public record available/);
  const bareKnow = HS.whyDerive({ id: 'b3', type: 'X' }, {}).know;
  assert.strictEqual(bareKnow.length, 0, 'bare record -> zero fabricated "known" facts');

  // ── What we don't know: gated by what IS known ──
  const proposed = HS.whyDerive({ id: 'u1', type: 'X', status: 'Proposed' }, {}).unknown.join(' | ');
  assert.match(proposed, /Final approval decision/, 'proposed -> approval unknown');
  const approved = HS.whyDerive({ id: 'u2', type: 'X', status: 'Approved' }, {}).unknown.join(' | ');
  assert.doesNotMatch(approved, /Final approval decision/, 'approved -> approval NOT listed as unknown');
  assert.match(approved, /Construction start date/, 'approved but not building -> start date unknown');
  const operating = HS.whyDerive({ id: 'u3', type: 'X', status: 'Operating' }, {}).unknown.join(' | ');
  assert.doesNotMatch(operating, /Construction start date|Final approval|operating conditions/, 'operating -> lifecycle unknowns resolved');

  // ── notices: next-known-step fallback instead of project unknowns ──
  const notice = HS.whyDerive({ id: 'n3', category: 'Notice', occurred_at: past }, { meeting: { starts_at: future } });
  assert.strictEqual(notice.unknown.length, 0);
  assert.match(notice.nextKnown, /scheduled hearing/, 'hearing on record -> that IS the next step');

  // ── markup builders escape + render ──
  const html = HS.whyQaHTML(d) + HS.whyKnowHTML(d) + HS.whyUnknownHTML(d);
  assert.match(html, /Why am I seeing this\?/);
  assert.match(html, /What stage is it in\?/);
  const xss = HS.whyDerive({ id: 'x', type: 'T', developer: '<img onerror=1>' }, {});
  assert.doesNotMatch(HS.whyKnowHTML(xss), /<img/, 'record values are escaped');

  // ── bestMeeting: an upcoming hearing is never hidden behind an earlier held one ──
  const mts = [
    { related_project_id: 'p', starts_at: past },
    { related_project_id: 'p', starts_at: future },
    { related_project_id: 'other', starts_at: future }
  ];
  assert.strictEqual(HS.bestMeeting(mts, 'p').starts_at, future, 'upcoming beats earlier held meeting');
  assert.strictEqual(HS.bestMeeting([mts[0]], 'p').starts_at, past, 'no upcoming -> latest held (history)');
  assert.strictEqual(HS.bestMeeting(mts, 'zzz'), null, 'no match -> null, never borrowed');

  console.log('All why-this-matters gates hold.');
});
