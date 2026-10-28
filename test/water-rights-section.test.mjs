// WATER RIGHTS FILINGS on the ZIP page (founder decision 2026-10-28) — the offline half.
// The executable SQL half is test/state_water_rights_pg/run.sh (state-water-rights-suite.yml).
//   A  every reader state renders its own sentence; nothing malformed reads as "none"
//   B  a filing card: the agency's words, its record link, no undecoded use code, no person named
//   C  the absence sentence appears ONLY for a complete read with no filings
//   D  wiring: its own block outside the three What's Changing groups, loaded on both ZIP hosts
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let fails = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { fails++; console.log('FAIL — ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(read('lib/water-rights.js'), ctx);
const W = ctx.window.HS.waterRights;
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// The real production answer for 84336 (a55167, shape from the local PostGIS run of the shipped SQL).
const A55167 = { zip: '84336', state: 'UT', state_name: 'Utah', agency: 'Utah Division of Water Rights', status: 'complete',
  checked_at: '2026-10-28T15:45:00+00:00',
  filings: [{ filing_no: 'a55167', right_no: '13-2', filing_type: 'Application To Appropriate', status: 'Unapproved',
    uses: 'OP', diversion: 'Point of Return · Salt Wells Spring Stream', applicant: 'BAR H RANCH INC.',
    filed_on: '2026-10-15', date_label: 'Priority date', record_url: 'https://www.waterrights.utah.gov/search/?q=a55167',
    points: [{ lat: 41.7334, lng: -112.7003 }, { lat: 41.7534, lng: -112.6602 }] }] };

// A
const h1 = W.sectionHTML(A55167), t1 = text(h1);
ok(/data-water-rights-state="complete"/.test(h1), 'A1: complete answer renders as complete');
ok(t1.includes('Water rights filings') && t1.includes('1 pending application'), 'A2: heading and count', t1);
const nc = text(W.sectionHTML({ zip: '33301', state: 'FL', state_name: 'Florida', status: 'not_covered', filings: [] }));
ok(nc.includes('HomeSignal does not read Florida’s water-rights records yet.'), 'A3: not_covered is about us, names the state', nc);
ok(!/publish|does not have|no water rights/i.test(nc), 'A4: not_covered never says the state publishes nothing', nc);
ok(text(W.sectionHTML({ status: 'not_covered', filings: [] })).includes('this state’s water-rights records'), 'A5: not_covered without a state name');
const nm = text(W.sectionHTML({ status: 'not_measured', agency: 'Utah Division of Water Rights', filings: [] }));
ok(nm.includes('no mapped Census area') && !/No pending/.test(nm), 'A6: not_measured never reads as none', nm);
[null, undefined, {}, { status: 'complete' }, { status: 'weird', filings: [] }, 'x'].forEach((b, i) => {
  const t = text(W.sectionHTML(b));
  ok(t.includes('could not be read just now') && !/No pending/.test(t), 'A7.' + i + ': a malformed or failed read is a failed read', t);
});
const un0 = text(W.sectionHTML({ status: 'unavailable', agency: 'Idaho Department of Water Resources', filings: [] }));
ok(un0.includes('could not be read on the last check') && !/No pending/.test(un0), 'A8: unavailable with nothing stored is unknown, not none', un0);
const un1 = text(W.sectionHTML(Object.assign({}, A55167, { status: 'unavailable' })));
ok(un1.includes('could not be refreshed') && un1.includes('last confirmed Oct 28, 2026') && un1.includes('a55167'), 'A9: unavailable shows stored filings with their date', un1);

// B
ok(t1.includes('Application To Appropriate a55167') && t1.includes('Agency status: Unapproved'), 'B1: filing type, number and the agency’s status word', t1);
ok(t1.includes('BAR H RANCH INC.') && t1.includes('Priority date Oct 15, 2026') && t1.includes('Changes right 13-2'), 'B2: applicant, labelled date, underlying right', t1);
ok(h1.includes('href="https://www.waterrights.utah.gov/search/?q=a55167"'), 'B3: links the agency’s own record');
ok(!/Use: OP/.test(t1), 'B4: an undecoded use code is not shown', t1);
const id1 = text(W.sectionHTML({ status: 'complete', agency: 'Idaho Department of Water Resources', checked_at: '2026-10-28T00:00:00Z',
  filings: [{ filing_no: '63-35880', filing_type: 'Application for permit', status: 'Active', uses: 'IRRIGATION,DOMESTIC',
    applicant: 'Individual applicant', applicant_withheld: true, filed_on: '2026-10-22', date_label: 'Priority date',
    record_url: 'https://research.idwr.idaho.gov/apps/x' }] }));
ok(id1.includes('Use: IRRIGATION,DOMESTIC') && id1.includes('Individual applicant'), 'B5: a worded use is shown; a person is not named', id1);
const bad = W.sectionHTML({ status: 'complete', filings: [{ filing_no: '<b>x</b>', record_url: 'javascript:alert(1)', applicant: '<img src=x>' }] });
ok(!/javascript:/.test(bad) && !/<img/.test(bad) && !/<b>x/.test(bad), 'B6: escapes text and refuses a non-https link', bad);
ok(W.day('2026-10-15') === 'Oct 15, 2026' && W.day('2026-13-01') === '' && W.day('') === '', 'B7: dates are the stored day, never shifted');
const many = { status: 'complete', agency: 'Utah Division of Water Rights', filings: Array.from({ length: 8 }, (_, i) => ({ filing_no: 'a' + i, record_url: 'https://www.waterrights.utah.gov/' + i })) };
const tm = text(W.sectionHTML(many));
ok((W.sectionHTML(many).match(/data-water-right=/g) || []).length === 5 && tm.includes('Showing 5 of 8'), 'B8: shows 5 and says how many there are', tm);

// C
const none = text(W.sectionHTML({ status: 'complete', agency: 'Utah Division of Water Rights', checked_at: '2026-10-28T12:00:00Z', filings: [] }));
ok(none.includes('No pending water-rights applications in Utah Division of Water Rights’s records lie in this ZIP. Checked Oct 28, 2026.'), 'C1: the one absence sentence names the agency and the day', none);
ok(!/No pending/.test(t1), 'C2: no absence sentence beside filings');

// D
const page = read('lib/community-page.js');
const iSec = page.indexOf('HS.waterRights.sectionHTML(waterRights)');
const iNews = page.indexOf('No qualifying local news on file for this ZIP yet.');
const iRight = page.indexOf("+ '</div><div>'", iNews);
ok(iSec > iNews && iSec < iRight, 'D1: the section renders after Local news, in the same column');
ok(!/groupHead/.test(read('lib/water-rights.js')), 'D2: it is its own block, never a fourth What’s Changing group');
ok(/HS\.waterRights\.load\(zip\)/.test(page), 'D3: the page reads the one reader');
['community.html', 'scripts/gen_zip_pages.py'].forEach((f) => {
  const s = read(f), iW = s.indexOf('lib/water-rights.js'), iC = s.indexOf('lib/community-page.js?v=');
  ok(iW > 0 && iW < iC, 'D4: ' + f + ' loads lib/water-rights.js before the page runtime');
});
ok(!/category[^;\n]{0,80}water/i.test(page), 'D5: no category pattern over "water" (Environment rule)');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
