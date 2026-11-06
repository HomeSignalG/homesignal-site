// creator-script/1: the storyboard parser, the saved form and the checks (lib/creator-script.js).
// The fixture is the founder's 14-scene EPA methane storyboard; its saved form is the JSON beside it,
// which homesignal-ingest tests/fixtures/creator/epa-methane-14.json copies byte for byte.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const CS = require('../lib/creator-script.js');
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) failed++; };
const TXT = readFileSync(new URL('./fixtures/creator-script/epa-methane-14.txt', import.meta.url), 'utf8');
const SAVED = JSON.parse(readFileSync(new URL('./fixtures/creator-script/epa-methane-14.json', import.meta.url), 'utf8'));

const r = CS.parse(TXT);
const s = CS.normalize(r.script);
ok(s.scenes.length === 14 && r.confident, '1 the storyboard parses into 14 scenes, each with narration');
ok(s.target_seconds === 270, '2 "Target length 4:30" is 270 seconds');
ok(s.scenes.slice(0, 4).every((x) => x.stage === 'fear') && s.scenes.slice(4, 11).every((x) => x.stage === 'anger')
  && s.scenes.slice(11).every((x) => x.stage === 'motivation'), '3 stages: Fear 1-4, Anger 5-11, Motivation 12-14');
ok(JSON.stringify(s.scenes) === JSON.stringify(SAVED.scenes), '4 the parse equals the committed saved form scene for scene');
ok(CS.problems(s).length === 0, '5 the saved form has no problems');
// the version hash, computed as the engine and the database compute it
const h = createHash('md5').update(s.scenes.map((x) => [x.n, x.stage, x.stage_label, x.headline, x.narration].join('\u001f')).join('\u001e')).digest('hex');
ok(h === '0a716a897032f76f8f00d3e44b93dada', '6 the script hash matches the engine and SQL value (' + h + ')');
// nothing is dropped: lines the parser cannot place are returned as notes
const odd = CS.parse('Intro paragraph\nScene 1: Fear\nNarration: Hello there.\n\nan unlabeled line\nScene 3 (12s)\nHeadline: X\nNarration: Second.');
ok(odd.notes.some((n) => /before the first scene/.test(n.why)) && odd.notes.some((n) => n.line === 'an unlabeled line')
  && odd.notes.some((n) => /renumbered 2/.test(n.why)), '7 unplaced and renumbered lines are reported, never dropped');
ok(odd.script.scenes[1].seconds === 12 && odd.script.scenes[1].stage === 'fear', '8 a duration in the scene header is read; the stage carries forward');
// limits: no 12,000-character cap, 30+ scenes allowed
const many = { format: CS.FORMAT, target_seconds: null, raw: '', scenes: Array.from({ length: 40 }, (_, i) => ({ ...CS.emptyScene(i + 1, 'anger'), narration: 'x '.repeat(400) })) };
ok(CS.problems(CS.normalize(many)).length === 0, '9 forty scenes with 32,000 characters of narration are accepted');
const tooMany = { ...many, scenes: Array.from({ length: 61 }, (_, i) => ({ ...CS.emptyScene(i + 1, 'fear'), narration: 'a' })) };
ok(CS.problems(CS.normalize(tooMany)).some((p) => /at most 60 scenes/.test(p)), '10 more than 60 scenes is refused with a reason');
const custom = CS.normalize({ format: CS.FORMAT, scenes: [{ ...CS.emptyScene(1, 'custom'), narration: 'a' }] });
ok(CS.problems(custom).some((p) => /name the custom stage/.test(p)), '11 a custom stage must be named');
ok(CS.problems(CS.normalize({ format: CS.FORMAT, scenes: [{ ...CS.emptyScene(1), narration: 'a', sources: ['not a link'] }] })).some((p) => /not a web link/.test(p)),
  '12 a source that is not a web link is refused');
const t = CS.timing({ scenes: [{ narration: 'word '.repeat(60), seconds: 10 }] });
ok(t[0].estimated === 24 && t[0].over, '13 timing estimates 150 words a minute and flags a scene longer than asked');
if (failed) { console.log(failed + ' FAILED'); process.exit(1); } else console.log('ALL PASS');
