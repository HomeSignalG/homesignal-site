// Map 1 wording for the "operating" lifecycle bucket (2026-11-09).
//
// The bucket holds two different claims:
//   * permits and cases an agency marked complete (Closed, Final, Work Completed ...). Completion says
//     nothing about occupancy or a business opening, so these read "Completed (agency record)";
//   * national data-centre records (HS.isSourceOwnRecord), which are their source's own listing of a
//     facility as operating. They keep that claim and say whose it is: "Operating (source listing)".
// This is WORDING ONLY. Stored status, bucket membership, colour and counts are unchanged, and nothing
// here decides whether a record is relevant or what stage it is really at (that is the lifecycle plan,
// docs/lifecycle-classification-audit-2026-11-01.md).
import fs from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('PASS — ' + msg); } else { fail++; console.log('FAIL — ' + msg); } }

const PAGE = fs.readFileSync('homesignalmap.html', 'utf8');
// Comments may quote the old words as history; the shipped text may not.
const CODE = PAGE.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 1. The band
ok(/<div class="band-h t-built">Completed \(agency record\)<\/div>/.test(PAGE), '1a band header reads "Completed (agency record)"');
const sub = (PAGE.match(/<div class="band-h t-built">[^<]*<\/div>\s*<div class="band-s">([^<]*)<\/div>/) || [])[1] || '';
ok(/does not confirm a building is occupied or a business is open/.test(sub), '1b band explains completion is not occupancy or opening');
ok(/listed as operating by their source/.test(sub), '1c band names the source-listing claim for data centers');
ok(!/standing today/i.test(CODE), '1d no "standing today"');
ok(!/Operating now/.test(CODE) && !/operating now/.test(CODE), '1e no "Operating now" in shipped text or code');

// 2. Empty state: says what Jody has, never that nothing operates
const empty = (PAGE.match(/listInto\("builtList", builtRows, "([^"]*)"\)/) || [])[1] || '';
ok(/^No completed agency records in Jody for this area\./.test(empty), '2a empty state is about Jody\'s records');
ok(/This does not mean nothing operates here\./.test(empty), '2b empty state refuses the "nothing operates" reading');
ok(!/operating right now/.test(CODE), '2c old empty sentence is gone');

// 3. Legend chip, marker titles, popup words
ok(/TRACKER_LABELS = \{ operating:"Completed \(agency record\)"/.test(PAGE), '3a legend / Stage chip label');
ok(/operating:"Completed \(agency record\)", built:"Completed \(agency record\)" \}/.test(PAGE), '3b popup stage words');
ok(/operating:"Completed", built:"Completed" \}/.test(PAGE), '3c marker title stage words');

// 4. Behaviour of the stage word, executed: agency completion vs a source's own listing
const defs = ['var STAGE_WORD', 'function ownOperating', 'function stageWord'].map((start) => {
  const i = PAGE.indexOf(start);
  if (i < 0) return '';
  if (start.startsWith('var')) return PAGE.slice(i, PAGE.indexOf(';', i) + 1);
  let d = 0, j = PAGE.indexOf('{', i);
  for (let k = j; k < PAGE.length; k++) { if (PAGE[k] === '{') d++; else if (PAGE[k] === '}' && --d === 0) return PAGE.slice(i, k + 1); }
  return '';
});
ok(defs.every(Boolean), '4a stage-word definitions found');
const ctx = { HS: {} };
vm.createContext(ctx);
// The real predicate, from lib/map.js.
const mapSrc = fs.readFileSync('lib/map.js', 'utf8');
const pred = mapSrc.match(/HS\.isSourceOwnRecord = function \(item\) \{[\s\S]*?\};/);
ok(!!pred, '4b HS.isSourceOwnRecord found in lib/map.js');
vm.runInContext((pred ? pred[0] : '') + '\nfunction stageOf(s){ return s.bucket; }\n' + defs.join('\n'), ctx);
const word = (s) => vm.runInContext('stageWord(' + JSON.stringify(s) + ')', ctx);
ok(word({ bucket: 'operating' }) === 'Completed (agency record)', '4c a closed permit reads Completed (agency record)');
ok(word({ bucket: 'built' }) === 'Completed (agency record)', '4d a built-stamped record reads Completed (agency record)');
ok(word({ bucket: 'operating', record_kind: 'national_project' }) === 'Operating (source listing)', '4e a national data-centre listing keeps its operating claim, attributed');
ok(word({ bucket: 'approved', record_kind: 'national_project' }) === 'Approved / permitted', '4f a listing in another stage is unchanged');
ok(word({ bucket: 'proposed' }) === 'Proposed / hearing', '4g other stages unchanged');

// 5. Surfaces that describe the same bucket
const HIW = fs.readFileSync('how-it-works.html', 'utf8');
ok(/completed \(agency record\), approved and coming, and still proposed\. An agency marking a permit or case complete does not confirm/.test(HIW), '5a how-it-works');
ok(!/operating now/i.test(HIW), '5b how-it-works no longer says operating now');
const GUIDE = fs.readFileSync('scripts/gen_zip_pages.py', 'utf8');
ok(/<strong>Completed \(agency record\)<\/strong> — the agency marked the permit or case complete\./.test(GUIDE), '5c guide page');
ok(!/Operating \/ built<\/strong>/.test(GUIDE), '5d guide no longer says Operating / built');
ok(/<li><strong>Status:<\/strong> completed \(agency record\), approved, or proposed/.test(PAGE), '5e map landing "What you can see"');

// 6. The band copy sits inside the <template>, which /map/<zip>/ fingerprints ignore
const tpl = PAGE.slice(PAGE.indexOf('<template id="hs-content">'), PAGE.indexOf('</template>'));
ok(tpl.includes('Completed (agency record)</div>'), '6a band copy is inside the template');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
