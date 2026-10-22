// Phase 3 of scripts/source-monitor.mjs: what passes the auto-wire gate becomes a PROPOSAL.
//
// NOTHING HERE WRITES THE REGISTRY (2026-10-22, founder "remove deploy key"). Until then the
// monitor appended each gate-built entry to jurisdiction-registry.json and the workflow pushed
// it straight to main with an SSH deploy key that the "Protect Main" ruleset let bypass, then
// dispatched deploy-edge-functions. The key is gone, so the entry is reported instead (job
// summary + the run's artifact) and the workflow goes red until a human wires it through a PR.
// An entry that is never wired is proposed again on every nightly run, so it cannot be lost.
//
// Pure: no I/O, no clock. The monitor passes its findings and the registry it read; the tests
// (test/source-monitor-no-push.test.mjs) pass fixtures.

export const REGISTRY_FILE = 'supabase/functions/get-address-report/jurisdiction-registry.json';

// The family list an entry belongs in. The same rule the monitor used when it appended entries:
// an ArcGIS entry goes in `arcgis`, everything the gate builds otherwise is Socrata.
export const familyOf = (entry) => (entry && entry.platform === 'arcgis' ? 'arcgis' : 'socrata');

// Is the SOURCE behind this entry already wired? The same test the monitor uses before it builds
// an entry (scripts/source-monitor.mjs alreadyWired): an ArcGIS service by its service_url, a
// Socrata dataset by its dataset_id. The registry_id is NOT the test: the gate builds its id from
// the jurisdiction and layer name, and hand-written ids often differ (3 of the 8 wired entries
// reachable from discovery catalogs have ids the gate can never produce, 2026-10-22).
export function wiredBySource(entry, registry) {
  if (!entry || !registry) return false;
  if (entry.service_url && (registry.arcgis || []).some((e) => e && e.service_url === entry.service_url)) return true;
  if (entry.dataset_id && (registry.socrata || []).some((e) => e && e.dataset_id && e.dataset_id === entry.dataset_id)) return true;
  return false;
}

// Split the gate's output into:
//   proposals: sources not wired yet, never wired here. If the gate's registry_id is already used
//              by a DIFFERENT source, the proposal says so (`id_collision`): it needs a new id,
//              and silently skipping it would lose a real source.
//   rebuilt:   sources already wired (same service_url / dataset_id; only reachable with
//              --include-wired, the gate-validation mode). Reported for comparison; never a proposal.
// One entry per registry_id: the first finding wins, as it did when the first one was appended.
export function collectProposals(findings, registry) {
  const proposals = [];
  const rebuilt = [];
  const seen = new Set();
  for (const f of findings || []) {
    const entry = f && f.res && f.res.result === 'wire' ? f.res.entry : null;
    if (!entry || !entry.registry_id || seen.has(entry.registry_id)) continue;
    seen.add(entry.registry_id);
    const family = familyOf(entry);
    const row = { family, registry_id: entry.registry_id, target: f.id || null, entry };
    if (wiredBySource(entry, registry)) { rebuilt.push(row); continue; }
    const idTaken = ((registry && registry[family]) || []).some((e) => e && e.registry_id === entry.registry_id);
    proposals.push(idTaken ? { ...row, id_collision: true } : row);
  }
  return { proposals, rebuilt };
}

// The artifact file: the entries only, never a rewritten registry. Rewriting the whole
// 1.2 MB registry with JSON.stringify would reformat ~17,000 unrelated lines (measured
// 2026-10-22), which is a diff nobody can review.
export function proposalsFileText(proposals) {
  return JSON.stringify((proposals || []).map((p) => ({
    family: p.family, registry_id: p.registry_id, target: p.target,
    ...(p.id_collision ? { id_collision: true } : {}), entry: p.entry,
  })), null, 2) + '\n';
}

// The report lines (job summary + artifact). Plain instructions, because the reader may not
// know the registry's layout.
export function proposalSectionLines(proposals, rebuilt) {
  const out = [];
  if (proposals && proposals.length) {
    out.push(
      ``,
      `### Proposed registry entries — passed the auto-wire gate, NOT wired (needs a PR)`,
      ``,
      `Nothing is wired automatically any more (2026-10-22). To wire an entry below:`,
      ``,
      `1. On a branch, add the entry to the list named after it (\`arcgis\` or \`socrata\`) in \`${REGISTRY_FILE}\`. Add only the entry; do not reformat the file.`,
      `2. Open a pull request and merge it once the \`unit\` check is green.`,
      `3. Run Actions → **deploy-edge-functions** with \`function=get-address-report\`, so the engine reads the new entry. The nightly refresh (09:00 UTC) then puts its records on pages.`,
      ``,
      `The same entries are in this run's \`source-monitor-<run id>\` artifact as \`proposed-registry-entries.json\`. Until an entry is wired, every nightly run proposes it again and fails.`,
    );
    for (const p of proposals) {
      out.push(``, `#### \`${p.registry_id}\` → registry \`${p.family}\` list${p.target ? ` (target \`${p.target}\`)` : ''}`, ``);
      if (p.id_collision) out.push(`⚠️ This registry_id is already used by a DIFFERENT source in the registry. Give this entry a new, unique registry_id before adding it.`, ``);
      out.push('```json', JSON.stringify(p.entry, null, 2), '```');
    }
  }
  if (rebuilt && rebuilt.length) {
    out.push(
      ``,
      `### Gate validation (--include-wired) — entries rebuilt for already-wired targets, NOT proposals`,
      ``,
      `Compare each with the entry already in the registry; nothing here is proposed or wired.`,
      ``,
      ...rebuilt.map((p) => `- \`${p.registry_id}\` (registry \`${p.family}\` list)`),
    );
  }
  return out;
}
