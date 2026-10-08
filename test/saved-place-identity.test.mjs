// FIX 17 — SAVED-PLACE IDENTITY. The producer, the invariant, and the lifecycle.
//
// THE DEFECT. app_properties had no natural-key uniqueness, and HS.saveHome was a bare
// INSERT with no in-flight guard, so a double-click filed the same place twice. Measured
// in production 2026-09-13: one resident held two byte-identical rows for 96 ISLAND DR,
// written 0.991 s apart.
//
// WHAT THIS FILE PINS, and what it deliberately does NOT. The integrity mechanism is the
// DATABASE (unique index app_properties_user_place_key). A client-side check cannot win a
// race and must never be mistaken for the guarantee — so these checks assert that the
// client does NOT rely on one, as well as asserting the guard that exists is UX only.
//
// Every check runs on a COMMENT-STRIPPED copy. Assertions in this repo have gone green off
// a comment naming the very string they forbid; a comment explaining an absence must not
// be able to satisfy a check for that absence.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
  + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : '')); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const shell     = strip(read('shell.js'));
const shellHtml = strip(read('partials/shell.html'));
const sql       = read('docs/saved-place-identity.sql');            // comments ARE the record here
const sqlExec   = strip(sql.replace(/^\s*--.*$/gm, ''));            // executable statements only

const fn = (name) => {
  const m = shell.match(new RegExp(name + '\\s*=\\s*(async\\s*)?function[\\s\\S]*?\\n  \\};'));
  return m ? m[0] : '';
};
const decl = (name) => {
  const m = shell.match(new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\([\\s\\S]*?\\n  \\}'));
  return m ? m[0] : '';
};

// ─────────────────────────────── 1. ONE WRITER, ONE CONTRACT ───────────────────────────
const savePlaceRow = decl('savePlaceRow');
ok(savePlaceRow.length > 0, '1a savePlaceRow exists — the single saved-place write');

const inserts = shell.match(/from\('app_properties'\)\s*\n?\s*\.insert\(/g) || [];
ok(inserts.length === 1, '1b exactly ONE app_properties insert in shell.js', inserts.length);
ok(/from\('app_properties'\)\.insert\(row\)/.test(savePlaceRow.replace(/\s*\n\s*/g, '')),
  '1c that insert is the one inside savePlaceRow');

const updates = shell.match(/from\('app_properties'\)\s*\n?\s*\.update\(/g) || [];
ok(updates.length === 0,
  '1d the onboarding UPDATE-the-existing-home branch is GONE (it encoded a rival identity)', updates.length);

const saveHome = fn('HS\\.saveHome');
const onb = decl('saveOnboardingAddress');
ok(/savePlaceRow\(row\)/.test(saveHome), '1e HS.saveHome writes through savePlaceRow');
ok(/savePlaceRow\(row\)/.test(onb), '1f saveOnboardingAddress writes through savePlaceRow');
ok(!/isRealHome/.test(onb),
  '1g onboarding no longer elects a row by isRealHome (the one-home-per-user contract)');

// ───────────────────── 2. THE GUARD IS UX; THE DATABASE IS THE INTEGRITY ────────────────
ok(/_savingHome/.test(saveHome) && /if \(_savingHome\) return;/.test(saveHome),
  '2a HS.saveHome has an in-flight guard');
ok(/btn\.disabled = true/.test(saveHome), '2b the Save button is disabled while in flight');
ok(/id="homeSaveBtn"/.test(shellHtml), '2c the Save button carries the id the guard targets');
ok(/_savingHome = false/.test(saveHome), '2d the guard is released so a failed save can be retried');
// A guard that can LATCH ON is worse than the duplicate it prevents. The first draft
// released only on failure; production hides it behind location.reload(), and the browser
// suite is what caught it. Pin the success path explicitly.
const successTail = saveHome.slice(saveHome.indexOf("homeDone'"));
ok(/release\(\);/.test(successTail), '2d2 the guard is released on the SUCCESS path too', successTail.slice(0, 200));
ok(/_savingHome = false/.test(fn('HS\\.openHome')), '2d3 reopening the modal always restores a usable Save button');

// THE LOAD-BEARING NEGATIVE: no select-then-insert. A client existence check would look
// like a fix and would lose to two tabs, two devices, or one fast double-click.
const preSelect = /select\([^)]*\)[\s\S]{0,200}?\.insert\(/.test(savePlaceRow);
ok(!preSelect, '2e savePlaceRow does NOT select-then-insert (that check is race-prone)');
ok(savePlaceRow.indexOf('.insert(') < savePlaceRow.indexOf('.select(\'*\')'),
  '2f the re-read happens only AFTER the insert is refused, never before it');
ok(/isDuplicateRowError/.test(savePlaceRow) && /23505/.test(shell),
  '2g a unique-violation is recognised and turned into an honest success');
ok(/\.eq\('user_id', row\.user_id\)/.test(savePlaceRow),
  '2h the conflict re-read is scoped to the owner — never another account\'s row');

// ───────────────────────── 3. UNITS: input_address IS IDENTITY, NOT DISPLAY ─────────────
ok(/input_address/.test(saveHome) && /input_address/.test(onb),
  '3a both writers carry the resident\'s typed line');
ok(/_homeInput = q;/.test(shell), '3b findHome captures the typed string on a confirmed match');
ok(/_homeInput = null;/.test(shell), '3c openHome clears it, so one save cannot inherit another\'s input');
// It must never be rendered: the displayed address stays the Census-confirmed match.
for (const f of ['properties.html', 'property.html', 'dashboard.html', 'reports.html'])
  ok(!/input_address/.test(strip(read(f))), '3d input_address is never rendered by ' + f);
ok(!/homeMatched'\)\.textContent = .*_homeInput/.test(shell),
  '3e the confirmation still shows the geocoder match, not the raw input');

// ────────────────────── 4. REMOVE ADDRESS CLEANS UP ITS PROPERTY WATCH ──────────────────
const rm = fn('HS\\.removeAddress');
ok(/from\('app_follows'\)[\s\S]{0,200}target_type: 'property'/.test(rm),
  '4a removeAddress deletes the matching property watch');
ok(/target_id: String\(id\)/.test(rm), '4b scoped to THIS property id');
ok(!/target_type: 'community'/.test(rm) && !/target_type: 'project'/.test(rm),
  '4c it does not touch ZIP follows or followed projects');
ok(rm.indexOf("from('app_properties')") < rm.indexOf("from('app_follows')"),
  '4d the Address is removed first; the watch cleanup can never pre-empt a failed delete');
ok(/console\.warn\('remove-address follow cleanup'/.test(rm),
  '4e a cleanup failure is logged, not reported as a failed removal');

// ───────────────────────────── 5. THE DATABASE INVARIANT, IN THE SQL ────────────────────
ok(/create unique index if not exists app_properties_user_place_key/.test(sqlExec),
  '5a the SQL of record creates a UNIQUE index');
for (const part of ['user_id', 'hs_premium_fold_address\\(address\\)', "coalesce\\(zip, ''\\)",
                    'hs_premium_fold_address\\(coalesce\\(input_address, address\\)\\)'])
  ok(new RegExp(part).test(sqlExec), '5b the key includes ' + part.replace(/\\\\/g, ''));
ok(/2a4b63222018325185b6540aa5853d77/.test(sqlExec),
  '5c the reused Fix 15 normalizer is pinned by body md5 — a silent edit fails the apply');
ok(!/create or replace function public\.hs_(place|saved)_fold/.test(sqlExec),
  '5d no SECOND address normalizer is introduced');
// The cleanup must be computed in-DB and partitioned BY USER, never by address alone.
ok(/partition by user_id/.test(sqlExec), '5e the duplicate cohort is partitioned by user_id');
ok(/order by created_at asc/.test(sqlExec), '5f the OLDEST row survives');
ok(/count\(distinct user_id\) > 1/.test(sqlExec),
  '5g a post-condition proves the cross-user repeats survived');
ok(/app_follows f/.test(sqlExec) && /orphan/i.test(sql),
  '5h the soft app_follows reference is checked before any delete');
ok(/collate "C"/.test(sqlExec), '5i fingerprints pin the collation (CLAUDE.md rule 9)');
ok(/user_subscriptions/.test(sqlExec) && !/alter table public\.user_subscriptions/.test(sqlExec),
  '5j the alert surface is asserted unchanged, never modified');

// ─────────────────────── 6. FIX 6 / ALERT BOUNDARIES ARE NOT CROSSED ────────────────────
ok(!/user_subscriptions|app_topic_prefs/.test(saveHome + onb + rm + savePlaceRow),
  '6a no saved-place writer touches alert subscriptions or topic prefs');
ok(!/LS\.set\('myZip'/.test(saveHome) && !/LS\.set\('viewZip'/.test(saveHome),
  '6b saving a place does not reassign the viewed geography');
ok(!/state\.zip = /.test(saveHome), '6c saveHome does not move state.zip');
ok(/ensureAreaSubscribed/.test(saveHome),
  '6d the pre-existing covered-area follow is preserved (not a Fix 17 change)');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
