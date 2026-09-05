// COMMERCIAL WORK-EVIDENCE GATE — the founder's Commercial product rule, executable.
//
// FOUNDER DECISION (2026-09-05). A Map 1 Commercial object means a real commercial
// building/site development or material physical construction project that a resident would
// reasonably understand as commercial development occurring near them. Commercial is NOT a
// generic bucket for every permit or administrative record attached to a commercially
// occupied property.
//
// THE EVIDENCE RULE, which is what this file enforces:
//
//   A field describing only property type, building occupancy, zoning, land use, primary use
//   or building use is INSUFFICIENT BY ITSELF to prove that the record represents a
//   Commercial development project.
//
// That is precisely the shape of the defect this gate exists to remove. Measured in the
// read-only decision gate (2026-09-05), of 69,404 Map 1 Commercial objects:
//
//   • 17,237 derived their Type from a property/occupancy/land-use field, never from the work;
//   • little-rock-permits alone contributed 10,021 objects, 7,574 of them (75.6%) carrying a
//     source PermitType other than BLD — standalone electrical, mechanical and plumbing
//     permits rendered as commercial development, because BldUseDesc said COMMERCIAL;
//   • one address, 100 E MARKHAM ST in ZIP 72201, produced TWELVE Commercial hexagons.
//
// WHY A SEPARATE OPTION RATHER THAN `extra_where`
//
// `extra_where` is pushed down at fetch time and is therefore ENTRY-WIDE: it filters the
// Residential rows of a mixed-type dataset too. little-rock-permits carries 37,646 Residential
// objects alongside its Commercial ones, so an entry-wide `PermitType = 'BLD'` clause would
// silently rewrite Residential — a Type this workstream does not own. This gate is guarded on
// `useType === "Commercial"` BY CONSTRUCTION, so no other Type can be reached from here. Where
// an entry is effectively single-type, `extra_where` remains the right tool and is unchanged
// (asheville-accela-permits is the in-repo precedent, already excluding Electrical/Plumbing/
// Mechanical/Fire Alarm/Sprinkler/Reroof/Repair-Replacement that way).
//
// FAIL-CLOSED, DELIBERATELY. A missing column, an empty value, or a value outside the
// whitelist all yield "not Commercial". The founder's ordering is explicit — a sparse but
// truthful Commercial layer beats a dense one — so an unknown work class must never inherit
// Commercial from the building's occupancy.
//
// TERMINAL, NOT GENERIC. A downgraded record becomes NON_QUALIFYING_COMMERCIAL_USE_TYPE,
// which lib/map.js resolves through TYPE_EXACT to the honest neutral "Other project" circle
// and which is deliberately ABSENT from GENERIC_EXACT. That matters: "unclassified" and
// "Development" are NON-TERMINAL, so a downgraded record would fall through to the name phase,
// where NAME_RULES matches /commercial|retail|office|hotel/ against the record's own label —
// and these labels routinely contain those words ("ELECTRIC COMMERCIAL 1200 SE ...",
// "Commercial Amusement (Inside)", any address on a street named Commercial). Downgrading into
// a generic bucket would hand a large share of these records straight back to the hexagon.

/** The use_type a record carries once it fails the Commercial work-evidence gate.
 *  Resolved by lib/map.js::TYPE_EXACT to the `other` category (circle, "Other project") and
 *  kept OUT of GENERIC_EXACT so the name phase cannot re-promote it. */
export const NON_QUALIFYING_COMMERCIAL_USE_TYPE = "other project";

export interface CommercialWorkEvidence {
  /** Source-native column carrying the WORK class. Defaults to the entry's own type_source
   *  column when omitted — the case where type_source already IS the work field and only some
   *  of its values qualify. */
  column?: string;
  /** VERBATIM publisher values that independently establish material physical commercial
   *  work. Compared trimmed and case-insensitively, matching how type_map values resolve.
   *  Omitted or empty ⇒ nothing from this entry qualifies. */
  qualifying?: string[];
  /** Set when the source publishes NO field capable of distinguishing qualifying development
   *  from routine permit activity. The founder rule requires that such a source be recorded as
   *  unresolved rather than allowed to assert Commercial from occupancy. Equivalent in effect
   *  to an empty whitelist; kept separate so the registry states WHICH of the two it is. */
  unresolved?: boolean;
  /** Free-text provenance for the decision. Never read by code. */
  note?: string;
}

export interface CommercialGateResult {
  useType: string;
  /** True only when this gate actually changed the classification. */
  downgraded: boolean;
  /** The work value the gate read, for reporting. Null when no column was resolvable. */
  workValue: string | null;
}

/**
 * Apply the founder's Commercial work-evidence rule to one already-classified record.
 *
 * INVARIANT, asserted in test/commercial-work-evidence.test.mjs: this function is a no-op for
 * every useType other than "Commercial". No other Map 1 Type can be reached from here.
 */
export function applyCommercialWorkEvidence(
  useType: string,
  rule: CommercialWorkEvidence | undefined,
  readValue: (column: string) => unknown,
  typeSourceColumn: string | null,
): CommercialGateResult {
  const unchanged: CommercialGateResult = { useType, downgraded: false, workValue: null };
  // Guard 1 — the Commercial scope. Everything else leaves untouched.
  if (String(useType).trim().toLowerCase() !== "commercial") return unchanged;
  // Guard 2 — entries that declare no rule keep their existing behaviour byte-for-byte.
  if (!rule) return unchanged;

  const down = (workValue: string | null): CommercialGateResult => ({
    useType: NON_QUALIFYING_COMMERCIAL_USE_TYPE,
    downgraded: true,
    workValue,
  });

  // The source cannot answer the question at all.
  if (rule.unresolved) return down(null);

  const column = rule.column ?? typeSourceColumn ?? null;
  if (!column) return down(null);                     // fail closed: nothing to read

  const raw = readValue(column);
  const value = raw == null ? "" : String(raw).trim();
  if (!value) return down(null);                      // fail closed: publisher stated nothing

  const qualifying = rule.qualifying ?? [];
  const needle = value.toLowerCase();
  const ok = qualifying.some((q) => String(q).trim().toLowerCase() === needle);
  return ok ? { useType, downgraded: false, workValue: value } : down(value);
}
