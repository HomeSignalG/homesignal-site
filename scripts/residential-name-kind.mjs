// GENERATOR — derive, from the registry's OWN column_map, whether each source family's
// `name` is ACTIVITY text or pure LABEL text (a project / plan / case name or an address).
//
// WHY THIS EXISTS. `app_projects.name` is `column_map.title` joined. For some families that
// is the work performed ("NEW CONSTRUCTION", "Repairs to Existing Structure"); for others it
// is a plan title ("Cherry Tree") or a street address ("594 BARRINGTON PL"). Reading routine
// vocabulary out of the second kind is how a subdivision called "Cherry Tree" was removed by
// the tree-removal rule, and how Texas subdivisions called "... Addition" were read as
// building additions. The classification is therefore taken from the registry configuration,
// never guessed per record.
//
// Run:  node scripts/residential-name-kind.mjs            # print the table
//       node scripts/residential-name-kind.mjs --check    # compare against the shipped table
import fs from 'node:fs';

const REGISTRY = 'supabase/functions/get-address-report/jurisdiction-registry.json';

// A title column whose NAME states work, class, use or a description. If a family has at
// least one of these, its `name` carries activity text and the full routine vocabulary is
// safe to read from it.
const ACTIVITY_COL = /(desc|work|scope|typ|class|use|proposal|permit_for|category|construction|occupancy|structure|status)/i;
// A title column whose NAME states an address, a parcel, or a project / plan / case NAME.
const LABEL_COL = /(address|addr|location|street|parcel|project_?name|plan_title|case_name|foldername|owner|subdivision|mapping_name|add_no|dirp|permitnum|case_number)/i;

export function titleColumns(entry) {
  const t = entry && entry.column_map && entry.column_map.title;
  if (Array.isArray(t)) return t.filter((x) => typeof x === 'string');
  if (typeof t === 'string') return [t];
  return [];
}

// 'activity' when any title column describes work/class/use; 'label' when every title column
// is an address or a name. A family with no title mapping at all is 'label' - there is
// nothing there that could be activity, and treating unknown text as activity is the unsafe
// direction (it manufactures routine verdicts out of place names).
export function nameKindFor(entry) {
  const cols = titleColumns(entry);
  if (!cols.length) return 'label';
  for (const c of cols) {
    if (ACTIVITY_COL.test(c) && !LABEL_COL.test(c)) return 'activity';
  }
  return 'label';
}

export function deriveTable(registryPath = REGISTRY) {
  const d = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const out = {};
  for (const plat of ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft']) {
    for (const e of d[plat] || []) {
      if (!e || !e.registry_id) continue;
      out[e.registry_id] = nameKindFor(e);
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('residential-name-kind.mjs')) {
  const table = deriveTable();
  const label = Object.keys(table).filter((k) => table[k] === 'label').sort();
  const activity = Object.keys(table).filter((k) => table[k] === 'activity').sort();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ label, activity }, null, 2));
  } else {
    console.log('LABEL-kind families (' + label.length + '):');
    label.forEach((k) => console.log('  ' + k));
    console.log('\nACTIVITY-kind families (' + activity.length + ')');
  }
}
