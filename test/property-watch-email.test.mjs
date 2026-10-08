// THE WATCH EMAIL (Development Activity build step 9) — offline. The composer is pure: it builds a subject, a text body and an HTML body from the
// selection `selectForEmail` made, and sends nothing. Every expectation is hard-coded.
//   1. what it says: the count, the property named only as "the one in Report N", each change in the publisher's words, the official link;
//   2. what it NEVER says: the address, the label, any coordinate, the agent's name or address — by construction (it is not given them) and by a
//      scan with a positive control (a project name carrying a marker DOES appear, so the scan can find things);
//   3. publisher text is untrusted: escaped in HTML, one line, bounded, control characters removed; a link only when it is https with no credentials;
//   4. the caps and the "more to come" line.
// Run: node test/property-watch-email.test.mjs
const W = await import('../supabase/functions/_shared/watch-email.ts');
const P = await import('../supabase/functions/_shared/property-watch.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const entry = (x = {}) => ({ event_type: 'status_changed', detected_at: '2026-10-01T06:30:00Z', recorded_at: '2026-10-01T06:35:00Z', publisher_event: { kind: 'completed', date: '2026-10-01' }, changes: [{ field: 'stage', from: 'Approved', to: 'Complete' }], ...x });
const change = (id, x = {}) => ({ project_id: id, name: 'Ravenna Bridge Retrofit', type: { key: 'infrastructure', label: 'Roads & infrastructure' }, source: { url: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/X/FeatureServer/0', attribution: 'Data: WSDOT' }, entries: [entry()], ...x });
const compose = (changes, o = {}) => W.composeWatchEmail({ selection: P.selectForEmail(changes), partial: false, reportNumber: 3, reportDate: '2026-09-29T12:00:05Z', ...o });

// ---- 1. what it says --------------------------------------------------------------------------------------------------------------------------------------------
{
  const e = compose([change('k1')]);
  ok(e.subject === 'HomeSignal: 1 official development change near a property you are watching', '1a the subject counts the changes (singular)', e.subject);
  const two = compose([change('k1'), change('k3', { name: 'Fremont Bike Lane Extension', entries: [entry({ event_type: 'first_detected', changes: [], publisher_event: { kind: 'filed', date: '2026-09-12' } })] })]);
  ok(two.subject === 'HomeSignal: 2 official development changes near a property you are watching', '1b and the plural', two.subject);
  ok(e.text.includes('The property is the one in Report 3, made Sep 29, 2026. Open that report in HomeSignal to see which property it is.'), '1c the property is named only as the one in the report, by number and date');
  ok(e.text.includes('Ravenna Bridge Retrofit · Roads & infrastructure') && e.text.includes('Official status changed (found Oct 1, 2026)') && e.text.includes('Stage: Approved → Complete') && e.text.includes('The source records it as: Completed 2026-10-01'),
    '1d each change is the project, its kind, what changed in the publisher\'s words (from → to) and what the source records');
  ok(e.text.includes('Official source: https://data.wsdot.wa.gov/arcgis/rest/services/Shared/X/FeatureServer/0') && e.text.includes('Data: WSDOT'), '1e with the official link and the attribution');
  ok(two.text.includes('New official record (found Oct 1, 2026)') && two.text.includes('Filed 2026-09-12'), '1f a project first seen is "New official record", with the publisher\'s filing event');
  ok(compose([change('k1', { entries: [entry({ event_type: 'first_detected', changes: [], publisher_event: null })] })]).text.includes('A record near the property that HomeSignal had not seen before.'), '1g a new record that carries no field changes still says what it is');
  ok(e.text.includes('Open the report: https://homesignal.net/development-activity-reports.html') && e.html.includes('href="https://homesignal.net/development-activity-reports.html"') && e.text.includes('choose Stop watching'), '1h one link to open the report - signed-in, no token - and one line on how to stop');
  ok(e.text.includes('it is not a legal opinion'), '1i and the standing disclaimer: HomeSignal shows what the source states and when it found it');
  ok(compose([change('k1')], { reportNumber: null }).text.includes('The property is the one in Your saved report, made Sep 29, 2026.'), '1j a report with no number is "Your saved report"');
  const nodate = compose([change('k1')], { reportDate: 'nonsense' });
  ok(nodate.text.includes('Report 3.') && !nodate.text.includes('made'), '1k and a date that cannot be read is left out, not guessed');
  ok(compose([change('k1', { entries: [entry({ changes: [{ field: 'status', from: null, to: 'Approved' }] })] })]).text.includes('Status: not stated → Approved'), '1l a value the source did not state reads "not stated", never "null" or blank');
  ok(compose([change('k1', { name: null, type: null })]).text.startsWith('Development records near') && compose([change('k1', { name: null, type: null })]).text.includes('\nDevelopment record\n'), '1m a project with no name is "Development record"');
}

// ---- 2. what it never says ---------------------------------------------------------------------------------------------------------------------------------------
{
  const MARKERS = ['742 Evergreen Terrace', 'Springfield, OR', 'Homer Simpson buyers', '44.04612345', '-122.98123456', 'agent.one@example.test', 'Agent One', 'token=', '0.21 mi', 'miles'];
  const e = compose([change('k1'), change('k3', { name: 'Fremont Bike Lane Extension' })], { partial: true });
  const found = MARKERS.filter((m) => (e.subject + e.text + e.html).includes(m));
  ok(found.length === 0, '2a the address, the label, the point, the agent\'s name and address, a token and a distance appear nowhere in subject, text or HTML (10 markers)', found);
  const control = compose([change('k1', { name: 'Evergreen 742 Evergreen Terrace Annex' })]);
  ok((control.text + control.html).includes('742 Evergreen Terrace'), '2b (control) a project whose PUBLIC name carries a marker DOES appear - the scan above can find things');
  ok(!/\b\d+(\.\d+)?\s*(mi|miles?|km|feet|ft|metres?|meters?)\b/i.test(e.text) && !/\b(north|south|east|west|northeast|northwest|southeast|southwest)\b/i.test(e.text.replace(/Official source.*|Data: .*/g, '')),
    '2c no distance and no direction from the property: either would let a reader work out where it is');
  const hrefs = [...e.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  ok(hrefs.every((h) => h === 'https://homesignal.net/development-activity-reports.html' || h.startsWith('https://data.wsdot.wa.gov/')), '2d every link in the HTML is the report page or an official source', hrefs);
}

// ---- 3. publisher text is untrusted ------------------------------------------------------------------------------------------------------------------------------
{
  const evil = '<script>alert("x")</script> & "quoted" \'single\'';
  const e = compose([change('k1', { name: evil, entries: [entry({ changes: [{ field: 'stage', from: '<b>Approved</b>', to: 'A\nB\rC\u0000D\u202eE' }] })] })]);
  ok(!e.html.includes('<script>') && !e.html.includes('<b>Approved') && e.html.includes('&lt;script&gt;') && e.html.includes('&amp;') && e.html.includes('&quot;quoted&quot;') && e.html.includes('&#39;single&#39;'), '3a publisher text is escaped in the HTML: markup, ampersands and both quote kinds');
  ok(e.text.includes('  Stage: <b>Approved</b> → A B C D E\n'), '3b and in the text a line break, a carriage return, a null and a bidirectional override become spaces: one line, and markup is left as inert text', e.text.split('\n').filter((l) => l.includes('Stage')));
  const lines = e.text.split('\n').filter((l) => l.includes('Stage:'));
  ok(lines.length === 1 && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/.test(e.text) && !/[\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/.test(e.html), '3c no control, zero-width or bidirectional-override character survives in the text or the HTML', lines.length);
  const long = 'W'.repeat(500);
  const l = compose([change('k1', { name: long })]);
  const titleLine = l.text.split('\n').find((x) => x.startsWith('WWW'));
  ok(titleLine.length <= 160 + ' · Roads & infrastructure'.length && titleLine.includes('…'), '3d a 500-character name is cut to a bounded length with an ellipsis', titleLine.length);
  const link = (url) => compose([change('k1', { source: { url, attribution: null } })]);
  ok(!link('javascript:alert(1)').text.includes('Official source') && !link('http://example.org/x').text.includes('Official source') && !link('https://user:pw@example.org/x').text.includes('Official source') && !link('https://localhost/x').text.includes('Official source') && !link(null).text.includes('Official source') && !link('not a url').text.includes('Official source'),
    '3e a link is printed only if it is an https URL, with no credentials and a real host: javascript:, http:, user:pass@, a bare host, null and nonsense are not (6 values)');
  ok(link('https://example.org/a?b=1&c=2').html.includes('href="https://example.org/a?b=1&amp;c=2"'), '3f and a good link is escaped in the attribute');
  ok(compose([change('k1', { source: { url: 'https://example.org/x', attribution: '<i>Data</i> & Co' } })]).html.includes('&lt;i&gt;Data&lt;/i&gt; &amp; Co'), '3g the attribution is escaped too');
  ok(compose([change('k1', { entries: [entry({ changes: Array.from({ length: 12 }, (_, i) => ({ field: 'f' + i, from: 'a', to: 'b' })) })] })]).text.split('\n').filter((x) => x.includes('→')).length === 6, '3h an entry shows at most six field changes');
  ok(compose([change('k1', { entries: [entry({ changes: [{ field: 'zoning_note', from: 'a', to: 'b' }] })] })]).text.includes('Zoning note: a → b'), '3i a field the table has no word for is made readable (underscores to spaces, capitalised)');
}

// ---- 4. the caps and the next email --------------------------------------------------------------------------------------------------------------------------------------
{
  const many = Array.from({ length: 14 }, (_, i) => change('p' + i, { name: 'Project ' + String(i).padStart(2, '0') }));
  const e = compose(many);
  const named = many.filter((c) => e.text.includes(c.name));
  ok(named.length === 10 && !e.text.includes('Project 10') && !e.text.includes('Project 13'), '4a fourteen projects: ten are listed in detail and the other four are not', named.length);
  ok(e.subject === 'HomeSignal: 14 official development changes near a property you are watching', '4b but the subject counts all fourteen: the agent is told the true total', e.subject);
  ok(e.text.includes('4 more changes will be in your next email.') && e.html.includes('4 more changes will be in your next email.'), '4c and the email says four more will follow, in both parts');
  const five = compose([change('k1', { entries: Array.from({ length: 8 }, (_, i) => entry({ detected_at: '2026-10-01T0' + i + ':00:00Z' })) })]);
  ok(five.text.includes('3 more changes will be in your next email.') && five.text.split('\n').filter((x) => x.includes('Official status changed')).length === 5, '4d a project with eight entries lists five and leaves three');
  ok(compose([change('k1')]).text.includes('will be in your next email') === false, '4e nothing left over, no "next email" line');
  ok(compose([change('k1')], { partial: true }).text.includes('could not be fully read recently') && compose([change('k1')], { partial: true }).html.includes('could not be fully read recently') && !compose([change('k1')]).text.includes('could not be fully read'),
    '4f the partial line is in both parts when a source could not be read, and only then');
  const one = compose([change('k1', { entries: [entry(), entry({ detected_at: '2026-10-01T08:00:00Z' }), entry({ detected_at: '2026-10-01T09:00:00Z' }), entry({ detected_at: '2026-10-01T10:00:00Z' }), entry({ detected_at: '2026-10-01T11:00:00Z' }), entry({ detected_at: '2026-10-01T12:00:00Z' })] })]);
  ok(one.text.includes('1 more change will be in your next email.'), '4g and "1 more change" is singular');
}

// ---- 5. text and HTML tell the same story ---------------------------------------------------------------------------------------------------------------------------------------
{
  const e = compose([change('k1'), change('k3', { name: 'Fremont Bike Lane Extension', entries: [entry({ event_type: 'first_detected', changes: [], publisher_event: { kind: 'filed', date: '2026-09-12' } })] })], { partial: true });
  const plain = e.html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
  const facts = ['Ravenna Bridge Retrofit', 'Fremont Bike Lane Extension', 'Stage: Approved → Complete', 'New official record', 'Filed 2026-09-12', 'could not be fully read', 'Stop watching'];
  ok(facts.every((f) => e.text.includes(f) && plain.includes(f)), '5a every fact in the text is in the HTML and the other way round (7 facts)', facts.filter((f) => !(e.text.includes(f) && plain.includes(f))));
  ok(e.html.startsWith('<!doctype html>') && e.html.includes('max-width:620px') && !/<(script|iframe|img|form|link|style)\b/i.test(e.html), '5b the HTML is a single column with inline styles and no script, frame, image, form or stylesheet');
}

console.log('\n' + (n - bad) + ' of ' + n + ' passed');
if (bad) process.exit(1);
