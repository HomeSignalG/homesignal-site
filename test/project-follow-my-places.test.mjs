// FIX 1 — project follow copy, persistence restore, and My Places truthfulness.
//
// Following a project = adding it to My Places. The button must say that, the
// followed state must restore from persisted app_follows / localStorage, and a
// followed project must actually appear in My Places. ZIP follows, property
// watches, Notify, and Places Monitored stay on their existing contracts.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 240) : ''));
  if (!c) fails++;
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(join(root, f), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const shell = strip(read('shell.js'));
const shellRaw = read('shell.js');
const dev = strip(read('development.html'));
const props = strip(read('properties.html'));
const data = strip(read('lib/data.js'));
const property = strip(read('property.html'));
const templates = strip(read('lib/templates.js'));
const cpage = strip(read('lib/community-page.js'));
const dash = strip(read('dashboard.html'));
const map = strip(read('homesignalmap.html'));
const seed = read('seed/delvalle.js');

const ADD = 'Add to My Places to follow';
const ON = '✓ Following in My Places';

// ---- copy on the project surface ------------------------------------------------
ok(shellRaw.includes("HS.PROJECT_FOLLOW_ADD = '" + ADD + "'"),
  'shell.js pins PROJECT_FOLLOW_ADD exactly');
ok(shellRaw.includes("HS.PROJECT_FOLLOW_ON = '" + ON + "'"),
  'shell.js pins PROJECT_FOLLOW_ON exactly');
ok(dev.includes("HS.toggleFollow(this,\\'project\\'"),
  'development.html still calls toggleFollow for projects');
ok(dev.includes(ADD) && dev.includes(ON),
  'development.html paints both Fix 1 labels');
ok(/function projectFollowButton/.test(dev) && /HS\.isFollowing\('project'/.test(dev),
  'projectFollowButton restores from HS.isFollowing, not a hardcoded unfollowed label');
ok(!/Follow this project/.test(dev),
  'development.html no longer says "Follow this project"');

// ---- persistence: one store, target_type=project --------------------------------
ok(/eq\('target_type', 'project'\)/.test(shell),
  'syncProjectFollowsFromAccount reads app_follows target_type=project');
ok(/target_type: 'project'/.test(shell),
  'project follows persist as target_type project');
ok(/HS\.isFollowing = function/.test(shell) && /state\.follows\.has\(type \+ ':' \+ id\)/.test(shell),
  'isFollowing reads the existing state.follows Set');
ok(/HS\.followedProjectIds = function/.test(shell),
  'followedProjectIds enumerates project: keys from the same Set');
ok(/persistFollow\('project', id, false\)/.test(shell),
  'unfollowProject deletes through persistFollow, not a second writer');
ok(/if \(on\) await HS\.sb\(\)\.from\('app_follows'\)\.insert/.test(shell)
  && /else await HS\.sb\(\)\.from\('app_follows'\)\.delete\(\)\.match/.test(shell),
  'persistFollow is still insert-or-delete on app_follows (no new source of truth)');
ok(/unique \(user_id, target_type, target_id\)/.test(read('docs/phase1-app-schema.sql')),
  'app_follows unique (user_id, target_type, target_id) still blocks duplicate rows');
ok(/indexOf\('project:'\) !== 0/.test(shell),
  'account-scope clear drops only project: keys, leaving property/change follows');

// restore after reload: hydrate pulls project rows into state.follows before onReady
ok(/await syncProjectFollowsFromAccount\(\);/.test(shell)
  && /await hydrateAccountLocation\(\);/.test(shell)
  && /_resolveReady\(HS\)/.test(shell),
  'account hydrate (including project follows) finishes before HS.onReady');

// ---- My Places truthfulness -----------------------------------------------------
ok(/data-view="projects"/.test(props) && /function projectCard/.test(props),
  'My Places has a Projects view and a Project card');
ok(/HS\.followedProjectIds/.test(props) && /projectsByIds/.test(data),
  'My Places loads followed projects by id, not by inventing rows');
ok(/Location not listed on this project record/.test(props),
  'missing street address is stated, never fabricated');
ok(!/p\.lat|p\.lng/.test((props.match(/function projectLocationLine[\s\S]*?\n  \}/) || [''])[0]),
  'projectLocationLine does not treat lat/lng as an address');
ok(/data-act="unfollow-project"/.test(props) && /HS\.unfollowProject/.test(props),
  'My Places can unfollow a project through the existing helper');
ok(/development\.html/.test((props.match(/function projectCard[\s\S]*?\n  \}/) || [''])[0]),
  'project card opens development.html, not a new route');

// ---- do not invent an address; seed records lack one ----------------------------
ok(!/\baddress:/.test(seed.match(/id:'proj-datacenter'[\s\S]*?\},\s*\n\s*\{ id:'proj-giga'/) || [''])[0],
  'seed proj-datacenter has no street address field');
ok(/id:'proj-giga'[\s\S]{0,1200}note:'Giga Texas \(1 Tesla Rd/.test(seed),
  'Giga Texas street text lives in note, not an address field — do not promote it');
ok(/async projectsByIds\(ids\)/.test(data) && !/geocode/.test((data.match(/async projectsByIds[\s\S]*?async properties/) || [''])[0]),
  'projectsByIds looks up stored rows and does not geocode');

// ---- regressions: ZIP / property / Notify / Places Monitored / email ------------
ok(cpage.includes('＋ Follow this zip code') && /✓ Following/.test(cpage),
  'ZIP follow copy is unchanged');
ok(/Watch this property/.test(property) && /Watching ✓/.test(shell),
  'property watch copy is unchanged');
ok(/Notify me/.test(templates) && /Following ✓/.test(shell),
  'change-card Notify copy is unchanged');
ok(/id='propWatch'>Watch this address</.test(map)
  && /Watch requests aren't live yet/.test(map),
  'map Watch stub is unchanged');
ok(/var placesMonitored = S\.properties\.length \+ followedZips\.length;/.test(dash),
  'Places Monitored is still Addresses + ZIP Codes');
ok(!/followedProjectIds/.test(dash),
  'Dashboard does not fold followed projects into Places Monitored');
ok(!/digest\.py|user_subscriptions|pipeline_type/.test(dev + props)
  && !/from\('alerts'\)/.test(shell.match(/HS\.toggleFollow = function[\s\S]*?\n  \};/) || [''])[0],
  'Fix 1 does not enroll email alerts or touch digest');

console.log(fails ? '\n' + fails + ' failed' : '\nAll project-follow My Places assertions passed.');
process.exit(fails ? 1 : 0);
