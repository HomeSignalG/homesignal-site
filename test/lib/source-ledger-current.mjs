// The CURRENT view of the source ledger: the immutable 2026-11-19 audit rows, plus every source registered since, classified UNVERIFIED until it is audited.
// The audit file never changes when the live registry grows (a new source needs no edit anywhere to keep CI green).
export function registryIds(reg) {
  return [...new Set(Object.values(reg).filter(Array.isArray).flat().filter((e) => e && typeof e.registry_id === 'string').map((e) => e.registry_id))].sort();
}
export function currentView(ledger, liveIds) {
  const audited = new Map(ledger.sources.map((s) => [s.registry_id, s]));
  const rows = liveIds.map((id) => audited.get(id) ?? { registry_id: id, registered: true, classification: 'UNVERIFIED', audited: false,
    hydration_verification: 'UNVERIFIED', report_eligibility_verification: 'UNVERIFIED' });
  const removedSinceAudit = [...audited.values()].filter((s) => s.registered && !liveIds.includes(s.registry_id)).map((s) => s.registry_id);
  return { rows, newlyRegistered: rows.filter((r) => r.audited === false).map((r) => r.registry_id), removedSinceAudit };
}
