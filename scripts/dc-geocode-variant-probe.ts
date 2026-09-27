// dc-geocode-variant-probe.ts — ZERO-WRITE measurement for step 8 (C4): of the data-centre addresses
// the shared ladder could not match, which ones would match if the address LINE were rewritten, and
// which rewrites are safe?
//
// WHAT IT REUSES: censusRung from geocode-cache.ts — the ladder's only live rung (the OpenAddresses
// dataset rung holds ~8.5k Austin-area points and matched none of these). Calling the rung itself,
// rather than a copy of its HTTP request, means a variant that matches here matches in production.
//
// WHAT IT DECIDES: nothing. The rewrites below are CANDIDATES, measured so a shared-policy change
// (dc_geocodable_site_address) can be proposed on evidence. Each candidate is judged two ways:
//   RECOVERED  failed queries it changes that then match;
//   SAFE       control queries (ones that already match) it changes that still match within 25 m of
//              the stored point. A candidate that moves a control is not a fix, whatever it recovers.
// A rewrite that does not change a string is not sent (it cannot change the answer).
//
// INPUT  PROBE_INPUT = JSON lines {kind: 'failed'|'control', query, lat?, lng?}. Writes nothing
// anywhere; the only output is this job's log (artifact storage is unreachable from the sandbox).

import { censusRung } from "../supabase/functions/get-address-report/geocode-cache.ts";

const inPath = Deno.env.get("PROBE_INPUT");
if (!inPath) { console.error("REFUSED: PROBE_INPUT is required"); Deno.exit(2); }

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const stateRe = new RegExp(",\\s*(" + Object.keys(STATES).sort((a, b) => b.length - a.length).join("|") + ")(\\s+\\d{5}(-\\d{4})?)?\\s*$", "i");

// The candidate rewrites. Each returns the rewritten line (unchanged if it does not apply).
const REWRITES: Record<string, (q: string) => string> = {
  strip_country: (q) => q.replace(/,\s*(USA|US|U\.S\.A?\.?|United States( of America)?)\s*$/i, ""),
  strip_trailing_county: (q) => q.replace(/,\s*[A-Za-z .'-]+ County\s*$/i, ""),
  abbreviate_state: (q) => q.replace(stateRe, (_m, st: string, zip?: string) => `, ${STATES[st.toLowerCase()]}${zip ?? ""}`),
  drop_zip: (q) => q.replace(/(,\s*[A-Z]{2})\s+\d{5}(-\d{4})?\s*$/, "$1"),
  drop_unit: (q) => q.replace(/,?\s*(suite|ste\.?|unit|bldg\.?|building|#)\s*[\w-]+(?=,)/i, ""),
  all_cleanups: (q) => [ "strip_country", "strip_trailing_county", "abbreviate_state", "drop_unit" ]
    .reduce((s, k) => REWRITES[k](s), q),
};

const rung = censusRung(fetch);
const R = 6371000, rad = (d: number) => d * Math.PI / 180;
const dist = (a: number, b: number, c: number, d: number) => {
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
async function ask(q: string) {
  await new Promise((res) => setTimeout(res, 250)); // polite pacing for the public Census endpoint
  try { return await rung.resolve(q, q); } catch (e) { return { error: String(e) } as const; }
}

const inputs = (await Deno.readTextFile(inPath)).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const failed = inputs.filter((r) => r.kind === "failed");
const controls = inputs.filter((r) => r.kind === "control");
console.log(`inputs: failed ${failed.length} · control ${controls.length}`);
if (!failed.length || !controls.length) { console.error("REFUSED: an empty input class measures nothing"); Deno.exit(2); }

// Baseline: the unchanged line, re-asked now. A failed query that matches unchanged means Census's
// data moved since the cache was written (a re-queue alone would recover it) — reported separately,
// never credited to a rewrite. A control that no longer matches unchanged is excluded from safety.
let errors = 0;
const baseFailed = new Map<string, boolean>();
for (const r of failed) { const a = await ask(r.query); if (a && "error" in a) errors++; baseFailed.set(r.query, !!(a && "lat" in a)); }
const baseControl = new Map<string, { lat: number; lng: number } | null>();
for (const r of controls) { const a = await ask(r.query); if (a && "error" in a) errors++; baseControl.set(r.query, a && "lat" in a ? a : null); }
const nowMatches = [...baseFailed].filter(([, m]) => m).map(([q]) => q);
const controlOk = [...baseControl].filter(([, v]) => v).length;
console.log(`baseline: failed-that-now-match-unchanged ${nowMatches.length}/${failed.length} · controls still matching ${controlOk}/${controls.length} · transport errors ${errors}`);
if (controlOk < controls.length * 0.9) { console.error("REFUSED: the controls no longer match unchanged — the endpoint or the instrument is broken"); Deno.exit(1); }

const lines: string[] = [];
const recoveredBy = new Map<string, string[]>();
for (const [name, fn] of Object.entries(REWRITES)) {
  let fChanged = 0, fRecovered = 0, cChanged = 0, cSame = 0, cMoved = 0, cLost = 0;
  const moved: string[] = [];
  for (const r of failed) {
    if (baseFailed.get(r.query)) continue;
    const v = fn(r.query); if (v === r.query) continue;
    fChanged++;
    const a = await ask(v);
    if (a && "lat" in a) { fRecovered++; recoveredBy.set(r.query, [...(recoveredBy.get(r.query) ?? []), name]); }
  }
  for (const r of controls) {
    const b = baseControl.get(r.query); if (!b) continue;
    const v = fn(r.query); if (v === r.query) continue;
    cChanged++;
    const a = await ask(v);
    if (!(a && "lat" in a)) { cLost++; moved.push(`LOST ${r.query}`); continue; }
    const d = dist(b.lat, b.lng, a.lat, a.lng);
    if (d <= 25) cSame++; else { cMoved++; moved.push(`MOVED ${Math.round(d)} m ${r.query}`); }
  }
  lines.push(`${name.padEnd(22)} failed changed ${fChanged} recovered ${fRecovered} · control changed ${cChanged} same ${cSame} moved ${cMoved} lost ${cLost}`);
  for (const m of moved.slice(0, 10)) lines.push(`    ${m}`);
}

console.log("----- BEGIN VARIANT RESULT -----");
console.log(`failed ${failed.length} · control ${controls.length} · transport errors ${errors}`);
console.log(`matched UNCHANGED now (Census data moved; recoverable by re-queue alone): ${nowMatches.length}`);
for (const q of nowMatches) console.log(`    NOW ${q}`);
for (const l of lines) console.log(l);
console.log(`failed queries recovered by at least one rewrite: ${recoveredBy.size}`);
for (const [q, ks] of recoveredBy) console.log(`    REC [${ks.join(",")}] ${q}`);
const unrecovered = failed.map((r) => r.query).filter((q) => !baseFailed.get(q) && !recoveredBy.has(q));
console.log(`unrecovered by any rewrite: ${unrecovered.length}`);
for (const q of unrecovered) console.log(`    NONE ${q}`);
console.log("----- END VARIANT RESULT -----");
