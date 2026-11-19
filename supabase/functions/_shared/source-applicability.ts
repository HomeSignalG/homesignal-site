// WHICH SOURCES ARE GEOGRAPHICALLY APPLICABLE TO A SUBJECT — decided from the registry's declared coverage and the subject's VERIFIED state and county.
// A source is applicable only when its declared coverage names the subject's state and, if it names a county, the same county. Unknown or unmatched
// geography makes NO source applicable by this route (never a guess). Pure: the geography arrives as an argument (read from `communities` by report-reads.ts).
import coverageFile from './source-coverage.generated.json' with { type: 'json' };

export type Jurisdiction = { state: string; county: string };
const COVERAGE: Record<string, Array<{ state: string; county?: string }>> =
  ((coverageFile as unknown as { families?: Record<string, Array<{ state: string; county?: string }>> }).families) ?? {};

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME',
  maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
/** A state as two letters, or null when it is not a state name or code. */
export function stateCode(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATES[t.toLowerCase()] ?? null;
}
/** A county as a comparable word: lower case, without a trailing ", ST" or the word "County". */
export function countyKey(c: string | null | undefined): string {
  return String(c ?? '').toLowerCase().replace(/,\s*[a-z]{2}\s*$/, '').replace(/\s+county\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
/** Registry families whose declared coverage includes ANY of the verified jurisdictions. */
export function applicableFamilies(places: Jurisdiction[], coverage: Record<string, Array<{ state: string; county?: string }>> = COVERAGE): string[] {
  const ps = places.map((p) => ({ st: stateCode(p.state), ck: countyKey(p.county) })).filter((p) => p.st);
  if (!ps.length) return [];
  return Object.keys(coverage).filter((id) => coverage[id].some((c) => ps.some((p) =>
    p.st === c.state && (!c.county || (p.ck !== '' && p.ck === countyKey(c.county)))))).sort();
}
