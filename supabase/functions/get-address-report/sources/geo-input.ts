// geo-input.ts — build a COMPLETE one-line address for the geocoder, from the fields a
// connector already has. Shared by every source connector so the assembly logic lives in
// ONE place (no per-connector duplication).
//
// Why this exists (measured root cause, 2026-07-22): connectors passed the BARE address
// column value (e.g. "825 GREENRIDGE RD") to resolveGeocode(). The US Census one-line
// geocoder cannot disambiguate a bare street line and returns no match → the record fell
// to scope='area' at the ZIP centroid. Receipts: bare "825 GREENRIDGE RD" → 0 matches;
// "825 GREENRIDGE RD, Columbus, OH 43235" → 1 match in-fence. This helper assembles the
// complete address so the SAME resolveGeocode()/cache/fence produce a real point.
//
// It ONLY builds the input string + surfaces the filed ZIP. It NEVER geocodes, caches,
// fences, or changes validation — the caller still runs the unchanged resolveGeocode() and
// the unchanged geofence. Missing fields degrade gracefully (a part is simply omitted).

export interface GeoInputParts {
  /** the raw address column value (may already contain city/state/zip for some sources) */
  rawAddress: string | null | undefined;
  /** the connector's jurisdiction string, e.g. "City of Columbus" or "Pierce County (PALS)" */
  jurisdiction?: string | null;
  /** the entry's coverage state, e.g. "OH" */
  state?: string | null;
  /** the value of the mapped ZIP column for this row, if any */
  zipColValue?: string | null;
  /** the ZIP of the report being built (fallback locality signal) */
  reportZip?: string | null;
}

export interface GeoInput {
  /** the complete one-line address to pass to resolveGeocode() */
  input: string;
  /** the ZIP to use as "filed ZIP" in the existing geofence (matched-ZIP == filed-ZIP).
   *  Prefers the mapped ZIP column, else a ZIP embedded in the address, else reportZip. */
  filedZip: string | null;
}

const _ZIP5 = /\b(\d{5})(?:-\d{4})?\b/;
// A ZIP embedded in an address sits at the END (after the city/state), never at the start
// where a 5-digit HOUSE NUMBER lives (e.g. "15419 SE 8th St" — 15419 is not a ZIP).
const _ZIP5_TRAILING = /(\d{5})(?:-\d{4})?\s*$/;
// A trailing unit/suite/apt token block, e.g. " APT 3", " STE 200", " UNIT B", " #12".
const _UNIT = /\s+(?:APT|APARTMENT|STE|SUITE|UNIT|RM|ROOM|FL|FLOOR|BLDG|BUILDING|LOT|SPC|SPACE|TRLR|#)\b.*$/i;
// A US state postal code (used to detect a state already embedded in the address).
const _STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK",
  "OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
]);

function trailingZip(s: string): string | null {
  const m = s.match(_ZIP5_TRAILING);
  return m ? m[1] : null;
}

/** City from a jurisdiction string, or null when the jurisdiction is NOT a city.
 *  "City of Columbus" → "Columbus". A COUNTY/regional jurisdiction ("Pierce County (PALS)",
 *  "Clark County") returns null — a county spans many cities, so guessing one hurts the
 *  geocode (measured: "…, Tacoma, WA 98444" matched the WRONG ZIP 98445, fenced out; the
 *  city-less "…, WA 98444" matched 98444, in-fence). */
export function cityFromJurisdiction(j?: string | null): string | null {
  const s = (j || "").trim();
  if (!s) return null;
  const cityOf = s.match(/^(?:City|Town|Village|Borough|Township)\s+of\s+(.+)$/i);
  if (cityOf) return cityOf[1].trim();
  // county / district / authority / parenthetical vendor tags → not a city
  if (/\b(county|parish|borough|district|authority|region|metro)\b/i.test(s)) return null;
  if (/[()]/.test(s)) return null;
  return s;   // a bare place name ("Fort Worth", "Anaheim")
}

/** Does the address already END with a "<ST> <ZIP>" (an already-complete one-line address,
 *  e.g. Clark County's "4510 NE 62ND AVE, VANCOUVER, WA 98661")? */
function endsWithStateZip(addr: string): boolean {
  const m = addr.match(/\b([A-Z]{2})\b[ ,]+\d{5}(?:-\d{4})?\s*$/i);
  return !!(m && _STATES.has(m[1].toUpperCase()));
}

function stripUnit(addr: string): string {
  return addr.replace(_UNIT, "").replace(/[\s,]+$/, "").trim();
}

/** Build the complete geocoder input + the filed ZIP for the fence.
 *  - already-complete address (ends with ST ZIP) → passed through UNCHANGED; filedZip = its
 *    embedded ZIP (this is the Clark County fix: fence against the address's own ZIP, not
 *    the report ZIP).
 *  - otherwise: "<street>[, <city>], <ST> <ZIP>", appending only parts not already present,
 *    stripping a trailing unit/suite, and OMITTING the city for county-wide jurisdictions. */
export function buildGeocodeInput(p: GeoInputParts): GeoInput {
  const raw = (p.rawAddress || "").trim();
  const zipCol = (p.zipColValue || "").match(_ZIP5)?.[1] || null;
  const embeddedZip = trailingZip(raw);
  const reportZip = (p.reportZip || "").match(_ZIP5)?.[1] || null;

  if (!raw) return { input: raw, filedZip: zipCol || reportZip };

  // Already a full one-line address → don't touch it; fence on its own ZIP.
  if (endsWithStateZip(raw)) {
    return { input: raw, filedZip: embeddedZip || zipCol || reportZip };
  }

  const filedZip = zipCol || embeddedZip || reportZip;
  const street = stripUnit(raw);
  const parts: string[] = [street];

  const st = (p.state || "").trim().toUpperCase();
  // A state is "present" only if it's a real trailing state token, not a street suffix.
  const hasState = /\b([A-Z]{2})\s*,?\s*(?:\d{5})?\s*$/i.test(street)
    && _STATES.has((street.match(/\b([A-Z]{2})\s*,?\s*(?:\d{5})?\s*$/i)?.[1] || "").toUpperCase());

  const city = cityFromJurisdiction(p.jurisdiction);
  // Only add the city when the street doesn't already end with it (cheap containment check).
  if (city && !new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(street)) {
    parts.push(city);
  }

  let tail = "";
  if (st && _STATES.has(st) && !hasState) tail += st;
  if (filedZip && !embeddedZip) tail += (tail ? " " : "") + filedZip;

  const input = tail ? `${parts.join(", ")}, ${tail}` : parts.join(", ");
  return { input, filedZip };
}
