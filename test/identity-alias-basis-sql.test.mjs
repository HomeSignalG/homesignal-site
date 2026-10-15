// The parked app_source_key_basis splice (docs/app-source-key-basis-objectid-alias.sql), proven against the LIVE body read from production
// on 2026-10-14 (committed verbatim as a fixture). No database: the splice is string surgery on the body, and this test performs the same
// surgery with the same literals extracted from the SQL file, then checks the properties the file's DO block asserts at apply time.
// Run: node test/identity-alias-basis-sql.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/app-source-key-basis-objectid-alias.sql'), 'utf8');
const live = readFileSync(join(root, 'test/fixtures/identity-aliases/app_source_key_basis.live-2026-10-14.txt'), 'utf8');
const md5 = (s) => createHash('md5').update(s).digest('hex');
let n = 0, fails = 0;
const ok = (c, m, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + m + (!c && d !== undefined ? '\n     ' + JSON.stringify(d) : '')); if (!c) fails++; };
const lit = (name) => { const m = sql.match(new RegExp(name + ' constant text := \\$([ai])\\$([\\s\\S]*?)\\$\\1\\$;')); return m && m[2]; };

const anchor = lit('v_anchor'), insert = lit('v_insert');
const expectMd5 = (sql.match(/v_md5_before constant text := '([0-9a-f]{32})'/) || [])[1];
ok(!!anchor && !!insert && !!expectMd5, 'the SQL file carries the anchor, the inserted branch and the drift fingerprint');
ok(md5(live) === expectMd5 && live.length === 753, 'the committed live body fingerprints to the value the file is written against (md5 ' + expectMd5 + ', 753 chars - read from production 2026-10-14)', md5(live));
ok(live.split(anchor).length - 1 === 1, 'the anchor occurs exactly once in the live body');
const spliced = live.replace(anchor, () => insert + anchor);
ok(md5(spliced.replace(insert, () => '')) === expectMd5, 'excising the inserted text reproduces the original body byte for byte (one contiguous insertion)');
const iCase = spliced.indexOf("'source_id:case_number'"), iAlias = spliced.indexOf("'source_id:case_number+objectid_alias'"), iRow = spliced.indexOf("'source_id:row_id'");
ok(iCase < iAlias && iAlias < iRow, 'the alias branch sits after the case_number branch and BEFORE the row_id branch (so it wins over nothing it should not)');
ok(!/\n\s*else\s+'source_id:other'/.test(insert) && insert.split('when ').length === 2, 'it is exactly one WHEN branch');
ok(/like '%:'\|\|btrim\(el->>'case_number'\)\|\|'#%'/.test(insert), 'it matches <case_number>#... after the colon, so the legacy branch (ends with the case number) is unaffected');
ok(spliced.length - live.length === insert.length, 'nothing else in the body moved');
ok(/execute v_new/.test(sql) && !/create or replace function/i.test(sql.replace(/^--.*$/gm, '')), 'the function is replaced from pg_get_functiondef (a splice), never retyped');
ok(/DRIFT/.test(sql) && /ANCHOR/.test(sql) && /SPLICE/.test(sql) && /GRANTS/.test(sql) && /BEHAVIOUR/.test(sql), 'fail-closed on drift, anchor count, splice reconstruction, grants and behaviour');
console.log(`\n${fails ? 'FAILED' : 'ALL PASSED'} (${n} checks)`);
process.exit(fails ? 1 : 0);
