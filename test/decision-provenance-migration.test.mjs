#!/usr/bin/env node
// docs/decision-provenance-migration.sql — structural pins (2026-11-13). The first version anchored on a line the
// live app_refresh_zip contains twice (development AND facility provenance), so its own fail-closed count refused
// it. These pin the corrected anchor, the reviewed-body guard, and that the rollback removes exactly what the
// migration inserts. The behaviour was run on a disposable Postgres; this keeps the text from drifting back.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = readFileSync(join(root, 'docs/decision-provenance-migration.sql'), 'utf8');
const rb = readFileSync(join(root, 'docs/decision-provenance-migration.rollback.sql'), 'utf8');
let fails = 0;
const ok = (c, m) => { if (c) console.log('PASS — ' + m); else { fails++; console.log('FAIL — ' + m); } };
const grab = (s, name) => { const m = new RegExp('\\$' + name + '\\$([\\s\\S]*?)\\$' + name + '\\$').exec(s); return m ? m[1] : null; };

const anchor = grab(mig, 'anchor');
ok(anchor && anchor.indexOf("'canonical_addr'") !== -1, 'the anchor starts inside the DEVELOPMENT provenance object (canonical_addr is not in the facility one)');
ok(anchor && anchor.split('\n').length === 3, 'the anchor is the three-line form, not the bare source_vintage line that matches twice');
ok(/_reviewed_md5 constant text := '7718e5dbd2f4702048be9cba3b59ae13'/.test(mig), 'the migration pins the reviewed live body md5');
ok(/_before <> _reviewed_md5/.test(mig) && /raise exception 'live app_refresh_zip md5/.test(mig), 'it refuses when the live body differs from the reviewed one');
ok(/_n <> 1 then/.test(mig), 'it still refuses unless the anchor matches exactly once');
ok(mig.indexOf("decision already carried") < mig.indexOf('_reviewed_md5 then') || mig.indexOf("decision already carried") < mig.indexOf('_before <> _reviewed_md5'), 'idempotence is checked before the md5 pin, so a second apply is a no-op');
const strip = (s) => s.replace(/''/g, "'");
const insMig = /_anchor \|\| '([\s\S]*?)'\);/.exec(mig);
const insRb = grab(rb, 'ins');
ok(insMig && insRb && strip(insMig[1]) === insRb, 'the rollback removes exactly the text the migration inserts');
ok(/_reviewed_md5 constant text := '7718e5dbd2f4702048be9cba3b59ae13'/.test(rb) && /md5\(_new\) <> _reviewed_md5/.test(rb), 'the rollback refuses unless excision restores the reviewed body');
console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nAll decision-provenance migration checks passed.');
process.exit(fails ? 1 : 0);
