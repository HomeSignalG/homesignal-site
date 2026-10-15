// Record hygiene for registry-driven connectors: two PURE functions, no I/O, no clock.
//
//   isMinorRepairNoise(text)       — true for routine minor-repair paperwork (furnace swaps,
//                                    fire-alarm replacements, water-damage repairs ...) that is
//                                    NOT development activity.
//   cleanApplicantTitle(type,name) — turns "<permit type> <applicant name>" into a readable title.
//
// Both are OPT-IN per registry entry (`drop_minor_repairs`, `applicant_title`) and additive: an
// entry that declares neither behaves byte-for-byte as before.
//
// WHY A TEXT RULE AT ALL. Tacoma's Accela layer files nearly everything as permit_type "Building",
// so the TYPE column cannot separate a 60-storey tower from a furnace swap; only the scope text can.
// A type whitelist (the usual lever) is therefore impossible there. Measured 2026-10-15 on the 5,334
// cached Tacoma records on Pierce County ZIP pages (4,691 type "Building").
//
// PRECISION OVER RECALL, and the override is the point. A record is dropped only when it names a
// minor-repair job AND states no development evidence. Any new construction, addition, ADU,
// demolition, alteration/remodel/renovation/tenant-improvement wording keeps the record even if it also mentions a
// furnace. A miss leaves today's behaviour; a false drop removes a real project. The scope text is
// the publisher's own; nothing is inferred.
//
// REGEX FLAVOUR. Patterns are written to mean the same in JavaScript and PostgreSQL ARE (no \b, \m,
// lookbehind), so scripts/audits/pierce-county-launch-audit.sql can evaluate the identical rule over
// the cached sites. `test/record-hygiene.test.mjs` pins the pattern strings against that SQL file.

const W = "[^a-z0-9]"; // word edge, usable in both flavours: (^|W) ... (W|$)

const MINOR_TERMS = [
  "furnaces?",
  "heat pumps?",
  "water heaters?",
  "mini[- ]?splits?",
  "ductless",
  "boilers?",
  "air condition(?:er|ers|ing)",
  "fire alarms?",
  "smoke (?:detectors?|alarms?)",
  "fire sprinkler (?:heads?|risers?)",
  "sprinkler (?:heads?|risers?)",
  "water damage",
  "fire damage",
  "smoke damage",
  "water mitigation",
  "mold remediation",
  "re-?roof(?:ing)?",
  "roof replacement",
  "window replacement",
  "replac(?:e|ing) (?:the |existing |all )?(?:windows?|siding|doors?)",
  "re-?pipe",
  "re-?piping",
  "water ?lines?",
  "sewer lines?",
  "gas lines?",
  "panel upgrade",
  "ev chargers?",
];

const DEVELOPMENT_TERMS = [
  "new (?:single|sfd|sfr|multi|building|construction|dwelling|home|house|duplex|townhome|apartment|structure|residence|commercial)",
  "construct(?:ion)? (?:of )?(?:a |an )?(?:new|[0-9,]+ ?sf)",
  "additions?",
  "adu",
  "dadu",
  "accessory dwelling",
  "(?:full |complete |building |structure |house )demolition",
  "demolish(?:ing)? (?:the |an? )?(?:existing )?(?:building|structure|house|home|sfd|sfr|garage)",
  "alterations?",
  "remodel(?:ing)?",
  "renovations?",
  "tenant improvements?",
  "interior improvements?",
  "subdivision",
  "shell",
];

const edge = (terms: string[]): string => `(^|${W})(?:${terms.join("|")})(${W}|$)`;

export const MINOR_REPAIR_PATTERN = edge(MINOR_TERMS);
export const DEVELOPMENT_OVERRIDE_PATTERN = edge(DEVELOPMENT_TERMS);

const MINOR_RE = new RegExp(MINOR_REPAIR_PATTERN, "i");
const DEV_RE = new RegExp(DEVELOPMENT_OVERRIDE_PATTERN, "i");

/** True when `text` describes a routine minor repair and states no development evidence. */
export function isMinorRepairNoise(text: string | null | undefined): boolean {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return false;             // no text ⇒ no evidence either way ⇒ KEEP
  if (DEV_RE.test(t)) return false; // development evidence always wins
  return MINOR_RE.test(t);
}

// ───────────────────────────── applicant-named titles ─────────────────────────────
//
// FOUNDER DECISION (2026-10-15): an INDIVIDUAL homeowner's name never appears in a title. A corporate /
// business applicant is kept and labelled as the applicant. Plat / subdivision strings are left as filed.
//
//   corporate  → "Residential construction (applicant: 3705 Rental LLC)"
//   individual → "Single Family Residence construction"            (name stripped entirely)
//   plat text  → "Residential construction: Lake Minterwood, Lot 38, Blk 2"   (untouched)
//
// FAIL CLOSED. The name column is free text with no marker separating a person from a project name
// ("Lucy Chege" and "Gig Harbor Medical Office" look the same to code), so ONLY a name that positively
// matches the entity list or the plat shape is shown. Everything else is dropped, including a genuine
// project name that carries no entity word. A false strip loses a label; a false keep publishes a person.

// The founder's entity indicators, WORD-BOUNDED. Unanchored, "CO" would match Jacob / Rebecca / Marco and
// "INC" would match Lincoln / Vincent, which would publish individuals. Grammatical variants of the listed
// words are accepted (corporation, homes, builders, developments, partners).
const ENTITY_RE = /(^|[^a-z0-9])(l\.?l\.?c|inc|corp(?:oration)?|holdings?|propert(?:y|ies)|builders?|homes?|developments?|group|partners?|limited|co|lp)(?=$|[^a-z0-9])/i;
const SUFFIX_WORD = /^(l\.?l\.?c|inc|corp|co|ltd|llp|lp|pllc|jr|sr|ii|iii|iv)\.?$/i;
// A plat / lot / subdivision reference: a plat keyword immediately followed by a number.
const PLAT_RE = /(^|[^a-z0-9])(lots?|blk|block|tract|plat|phase|div(?:ision)?|parcel|unit|sec(?:tion)?|subdivision)\.?\s*#?\d/i;
// Words that follow a comma in plat descriptions, never in a person's name.
const NOT_A_FIRST_NAME = /^(lot|lots|blk|block|unit|phase|tract|parcel|suite|ste|bldg|building|apt|no|div|division|plat|addition|add|sec|section|tr|subdivision)$/i;

/** True when the text contains a "Last, First" pair, i.e. it is shaped like an individual's name. A comma
 *  followed by a corporate suffix ("Acme Holdings, LLC") or a plat word ("Minterwood, Lot 38") is not one. */
function hasPersonPair(name: string): boolean {
  for (const m of name.matchAll(/[A-Za-z][A-Za-z'.-]*, ([A-Za-z][A-Za-z'.-]*)/g)) {
    const first = m[1];
    if (!SUFFIX_WORD.test(first) && !NOT_A_FIRST_NAME.test(first) && !ENTITY_RE.test(first)) return true;
  }
  return false;
}

/** Title-case ALL-CAPS or all-lowercase text; leave already mixed-case text alone. */
export function tidyCase(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return t;
  const letters = t.replace(/[^A-Za-z]/g, "");
  const mixed = /[a-z]/.test(letters) && /[A-Z]/.test(letters);
  if (mixed) return t;
  return t
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      const bare = w.replace(/[^a-z]/g, "").toUpperCase();
      if (KEEP_UPPER.has(bare)) return w.toUpperCase();
      if (i > 0 && SMALL.has(w)) return w;
      return w.replace(/(^|[-'(])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
    })
    .join(" ");
}
const KEEP_UPPER = new Set(["LLC", "LLP", "LP", "PLLC", "INC", "II", "III", "IV", "USA", "WA", "RV", "ADU"]);
const SMALL = new Set(["of", "and", "the", "at", "for", "to", "in", "on", "a", "an", "dba", "&"]);

/** "Construction Residential" → "Residential construction"; "Construction Single Family Residence" →
 *  "Single Family Residence construction"; any other type → sentence case. */
export function readableType(type: string): string {
  const t = tidyCase(type);
  const m = t.match(/^Construction\s+(.+)$/i);
  if (m) return `${m[1]} construction`;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase().replace(/\b(adu)\b/g, "ADU");
}

/**
 * Compose a readable title from a permit TYPE and the free-text NAME column, which on some layers holds
 * the APPLICANT rather than a project name.
 *
 * Nothing is invented: no "new", no use, no size. The applicant is labelled as the applicant so a reader
 * is never told it is the project. Empty name ⇒ the type alone. The raw type survives verbatim in the
 * record's `type_raw`.
 */
export function cleanApplicantTitle(type: unknown, name: unknown): string {
  const ty = String(type ?? "").replace(/\s+/g, " ").trim();
  let nm = String(name ?? "").replace(/\s+/g, " ").trim();
  const label = ty ? readableType(ty) : "";
  if (!nm) return label;
  // A name that merely repeats the type adds nothing.
  if (ty && nm.toLowerCase() === ty.toLowerCase()) return label;
  // Some layers concatenate the type in front of the name; strip one leading copy.
  if (ty && nm.toLowerCase().startsWith(ty.toLowerCase() + " ")) nm = nm.slice(ty.length).trim();
  if (!nm) return label;
  const person = hasPersonPair(nm);
  // 1. plat / subdivision text: left exactly as filed (unless it also names an individual).
  if (PLAT_RE.test(nm) && !person) return label ? `${label}: ${nm}` : nm;
  // 2. corporate / business applicant: kept, labelled (unless it also names an individual).
  if (ENTITY_RE.test(nm) && !person) {
    const shown = tidyCase(nm);
    return label ? `${label} (applicant: ${shown})` : shown;
  }
  // 3. anything else is treated as an individual or unknown: stripped entirely.
  return label;
}
